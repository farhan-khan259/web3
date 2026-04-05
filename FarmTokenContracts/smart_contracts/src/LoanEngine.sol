// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IOracleRegistry {
    function getLiquidationValue(uint256 rightsId) external view returns (uint256);
    function getRiskStatus(uint256 rightsId) external view returns (bool);
    function getVolatilityIndex() external view returns (uint256);
    function validateOraclePath(uint256 rightsId, uint8 expectedType) external view returns (bool);
}

interface IVault {
    function isLocked(uint256 rightsId) external view returns (bool);
    function lockedBy(uint256 rightsId) external view returns (address);
    function rightTypeOf(uint256 rightsId) external view returns (uint8);
    function getSnapshotValue(uint256 rightsId) external view returns (uint256);
}

/**
 * @title LoanEngine
 * @dev Lending engine for mint-right collateral with strict oracle/type validation.
 */
contract LoanEngine is AccessControl, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    struct Position {
        uint256 debt;
        bool inPanic;
    }

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant AUTO_PANIC_LTV = 8_000;

    mapping(uint256 => Position) public positions;
    mapping(uint256 => bool) public rightInPanic;

    IOracleRegistry public oracle;
    IVault public vault;
    address public revenueRouter;

    event Borrow(uint256 indexed rightsId, uint256 amount);
    event Repay(uint256 indexed rightsId, uint256 amount);
    event PanicTriggered(uint256 indexed rightsId);
    event RevenueRouterUpdated(address indexed oldRouter, address indexed newRouter);

    modifier onlyRevenueRouter() {
        require(msg.sender == revenueRouter, "Only revenue router");
        _;
    }

    constructor(
        address oracleAddress,
        address vaultAddress,
        address admin
    ) {
        require(oracleAddress != address(0), "Invalid oracle");
        require(vaultAddress != address(0), "Invalid vault");
        require(admin != address(0), "Invalid admin");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);

        oracle = IOracleRegistry(oracleAddress);
        vault = IVault(vaultAddress);
    }

    receive() external payable {}

    function setRevenueRouter(address newRouter) external onlyRole(ADMIN_ROLE) {
        require(newRouter != address(0), "Invalid router");
        address oldRouter = revenueRouter;
        revenueRouter = newRouter;
        emit RevenueRouterUpdated(oldRouter, newRouter);
    }

    function getDynamicMaxLTV() public view returns (uint256) {
        uint256 vol = oracle.getVolatilityIndex();
        if (vol < 20) {
            return 7_500;
        }
        if (vol < 50) {
            return 7_000;
        }
        if (vol < 80) {
            return 6_500;
        }
        return 6_000;
    }

    function getCurrentLTV(uint256 rightsId) public view returns (uint256) {
        Position memory p = positions[rightsId];
        if (p.debt == 0) {
            return 0;
        }

        uint256 value = vault.getSnapshotValue(rightsId);
        if (value == 0) {
            return type(uint256).max;
        }

        return (p.debt * BASIS_POINTS) / value;
    }

    function borrow(
        uint256 rightsId,
        uint8 expectedType,
        uint256 amount
    ) external onlyRole(OPERATOR_ROLE) nonReentrant {
        // Borrow is blocked unless vault type and oracle route are consistent for the right.
        require(amount > 0, "Amount is zero");
        require(vault.isLocked(rightsId), "Right not in vault");
        require(oracle.validateOraclePath(rightsId, expectedType), "Oracle/type mismatch");
        require(vault.rightTypeOf(rightsId) == expectedType, "Vault/type mismatch");
        require(checkOracleHealth(rightsId), "Panic mode active");

        Position storage p = positions[rightsId];
        require(!p.inPanic, "Right in panic");

        uint256 value = vault.getSnapshotValue(rightsId);
        require(value > 0, "No oracle value");

        uint256 maxDebt = (value * getDynamicMaxLTV()) / BASIS_POINTS;
        require(p.debt + amount <= maxDebt, "LTV cap exceeded");
        require(address(this).balance >= amount, "Insufficient liquidity");

        address recipient = vault.lockedBy(rightsId);
        require(recipient != address(0), "Invalid recipient");

        p.debt += amount;
        autoProtect(rightsId, expectedType);

        (bool ok, ) = recipient.call{value: amount}("");
        require(ok, "Borrow transfer failed");

        emit Borrow(rightsId, amount);
    }

    function autoProtect(uint256 rightsId, uint8 expectedType) public {
        bool typeMismatch = !oracle.validateOraclePath(rightsId, expectedType);
        if (typeMismatch || getCurrentLTV(rightsId) > AUTO_PANIC_LTV) {
            Position storage p = positions[rightsId];
            if (!p.inPanic) {
                p.inPanic = true;
                rightInPanic[rightsId] = true;
                emit PanicTriggered(rightsId);
            }
        }
    }

    function checkAndUpdatePanic(uint256 rightsId) public returns (bool) {
        require(vault.isLocked(rightsId), "Right not in vault");

        uint8 expectedType = vault.rightTypeOf(rightsId);
        bool typeMismatch = !oracle.validateOraclePath(rightsId, expectedType);
        bool ltvBreach = getCurrentLTV(rightsId) > getDynamicMaxLTV();
        bool oracleRisk = oracle.getRiskStatus(rightsId);
        bool shouldPanic = typeMismatch || ltvBreach || oracleRisk;

        Position storage p = positions[rightsId];
        if (shouldPanic && !p.inPanic) {
            p.inPanic = true;
            rightInPanic[rightsId] = true;
            emit PanicTriggered(rightsId);
        } else if (!shouldPanic && p.inPanic) {
            p.inPanic = false;
            rightInPanic[rightsId] = false;
        }

        return p.inPanic;
    }

    function repay(uint256 rightsId) external payable onlyRole(OPERATOR_ROLE) nonReentrant {
        uint256 used = _repay(rightsId, msg.value);
        uint256 refund = msg.value - used;
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            require(ok, "Refund failed");
        }
    }

    function repayFromRevenue(
        uint256 rightsId
    ) external payable onlyRevenueRouter nonReentrant returns (uint256 used, uint256 refund) {
        used = _repay(rightsId, msg.value);
        refund = msg.value - used;
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            require(ok, "Refund failed");
        }
    }

    function _repay(uint256 rightsId, uint256 amount) internal returns (uint256 used) {
        require(amount > 0, "No repayment");
        require(vault.isLocked(rightsId), "Right not in vault");

        Position storage p = positions[rightsId];
        if (amount > p.debt) {
            used = p.debt;
        } else {
            used = amount;
        }

        p.debt -= used;
        emit Repay(rightsId, used);
        checkAndUpdatePanic(rightsId);
    }

    function autoCheck(uint256 rightsId) external returns (bool) {
        return checkAndUpdatePanic(rightsId);
    }

    function checkOracleHealth(uint256 rightsId) public view returns (bool) {
        return !oracle.getRiskStatus(rightsId);
    }

    function outstandingDebt(uint256 rightsId) external view returns (uint256) {
        return positions[rightsId].debt;
    }

    function isPanicMode(uint256 rightsId) external view returns (bool) {
        return rightInPanic[rightsId];
    }
}
