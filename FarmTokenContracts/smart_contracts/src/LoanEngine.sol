// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IOracleRegistry {
    function getLiquidationValue(uint256 rightsId) external view returns (uint256);
    function getRiskStatus(uint256 rightsId) external view returns (bool);
    function getVolatilityIndex() external view returns (uint256);
    function validateOraclePath(uint256 rightsId, uint8 expectedType) external view returns (bool);
    function getDynamicLTV(uint256 rightsId) external view returns (uint256);
}

interface IVault {
    function isLocked(uint256 rightsId) external view returns (bool);
    function lockedBy(uint256 rightsId) external view returns (address);
    function rightTypeOf(uint256 rightsId) external view returns (uint8);
    function getSnapshotValue(uint256 rightsId) external view returns (uint256);
}

interface IDebtToken {
    function mint(address to, uint256 amount) external;
    function burnFromLoan(address from, uint256 amount) external;
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
        bool liquidated;
    }

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant AUTO_PANIC_LTV = 8_500;

    mapping(uint256 => Position) public positions;
    mapping(uint256 => bool) public rightInPanic;

    IOracleRegistry public oracle;
    IVault public vault;
    IDebtToken public debtToken;
    address public revenueRouter;

    event Borrowed(uint256 indexed rightsId, address indexed borrower, uint256 amount, uint256 debtAfter);
    event Repaid(uint256 indexed rightsId, address indexed payer, uint256 amount, uint256 debtAfter);
    event Liquidated(uint256 indexed rightsId, uint256 debtCleared, uint256 ltvBps);
    event PanicTriggered(uint256 indexed rightsId);
    event PanicResolved(uint256 indexed rightsId);
    event RevenueRouterUpdated(address indexed oldRouter, address indexed newRouter);

    modifier onlyRevenueRouter() {
        require(msg.sender == revenueRouter, "Only revenue router");
        _;
    }

    constructor(
        address oracleAddress,
        address vaultAddress,
        address debtTokenAddress,
        address admin
    ) {
        require(oracleAddress != address(0), "Invalid oracle");
        require(vaultAddress != address(0), "Invalid vault");
        require(debtTokenAddress != address(0), "Invalid debt token");
        require(admin != address(0), "Invalid admin");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);

        oracle = IOracleRegistry(oracleAddress);
        vault = IVault(vaultAddress);
        debtToken = IDebtToken(debtTokenAddress);
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
            return 7_000;
        }
        if (vol < 50) {
            return 6_000;
        }
        return 4_000;
    }

    function getDynamicMaxLTV(uint256 rightsId) public view returns (uint256) {
        return oracle.getDynamicLTV(rightsId);
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
        require(amount > 0, "Amount is zero");
        require(vault.isLocked(rightsId), "Right not in vault");
        require(oracle.validateOraclePath(rightsId, expectedType), "Oracle/type mismatch");
        require(vault.rightTypeOf(rightsId) == expectedType, "Vault/type mismatch");
        require(checkOracleHealth(rightsId), "Oracle risk active");

        Position storage p = positions[rightsId];
        require(!p.inPanic, "Right in panic");
        require(!p.liquidated, "Right liquidated");

        uint256 value = oracle.getLiquidationValue(rightsId);
        require(value > 0, "No oracle value");

        uint256 maxDebt = (value * oracle.getDynamicLTV(rightsId)) / BASIS_POINTS;
        require(p.debt + amount <= maxDebt, "LTV cap exceeded");
        require(address(this).balance >= amount, "Insufficient liquidity");

        address recipient = vault.lockedBy(rightsId);
        require(recipient != address(0), "Invalid recipient");

        p.debt += amount;
        debtToken.mint(recipient, amount);
        autoProtect(rightsId, expectedType);

        (bool ok, ) = recipient.call{value: amount}("");
        require(ok, "Borrow transfer failed");

        emit Borrowed(rightsId, recipient, amount, p.debt);
    }

    function autoProtect(uint256 rightsId, uint8 expectedType) public {
        bool typeMismatch = !oracle.validateOraclePath(rightsId, expectedType);
        bool oracleRisk = oracle.getRiskStatus(rightsId);
        uint256 currentLtv = getCurrentLTV(rightsId);

        if (typeMismatch || oracleRisk || currentLtv > AUTO_PANIC_LTV) {
            Position storage p = positions[rightsId];
            if (!p.inPanic) {
                p.inPanic = true;
                rightInPanic[rightsId] = true;
                emit PanicTriggered(rightsId);
            }
        }

        _autoLiquidateIfNeeded(rightsId, currentLtv);
    }

    function checkAndUpdatePanic(uint256 rightsId) public returns (bool) {
        require(vault.isLocked(rightsId), "Right not in vault");

        uint8 expectedType = vault.rightTypeOf(rightsId);
        bool typeMismatch = !oracle.validateOraclePath(rightsId, expectedType);
        uint256 currentLtv = getCurrentLTV(rightsId);
        bool ltvBreach = currentLtv > oracle.getDynamicLTV(rightsId);
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
            emit PanicResolved(rightsId);
        }

        _autoLiquidateIfNeeded(rightsId, currentLtv);

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
        address borrower = vault.lockedBy(rightsId);
        require(borrower != address(0), "Invalid borrower");
        if (amount > p.debt) {
            used = p.debt;
        } else {
            used = amount;
        }

        p.debt -= used;
        if (used > 0) {
            debtToken.burnFromLoan(borrower, used);
        }
        emit Repaid(rightsId, msg.sender, used, p.debt);
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

    function checkAndLiquidate(uint256 rightsId) external nonReentrant returns (bool) {
        require(vault.isLocked(rightsId), "Right not in vault");
        Position storage p = positions[rightsId];
        if (p.debt == 0 || p.liquidated) {
            return false;
        }

        uint256 currentLtv = getCurrentLTV(rightsId);
        bool shouldLiquidate = currentLtv > oracle.getDynamicLTV(rightsId) || oracle.getRiskStatus(rightsId);
        if (!shouldLiquidate) {
            return false;
        }

        _liquidate(rightsId, currentLtv);
        return true;
    }

    function _autoLiquidateIfNeeded(uint256 rightsId, uint256 currentLtv) internal {
        Position storage p = positions[rightsId];
        if (p.debt == 0 || p.liquidated) {
            return;
        }

        bool shouldLiquidate = currentLtv > oracle.getDynamicLTV(rightsId) || oracle.getRiskStatus(rightsId);
        if (shouldLiquidate) {
            _liquidate(rightsId, currentLtv);
        }
    }

    function _liquidate(uint256 rightsId, uint256 currentLtv) internal {
        Position storage p = positions[rightsId];
        address borrower = vault.lockedBy(rightsId);
        uint256 debtCleared = p.debt;

        p.debt = 0;
        p.inPanic = true;
        p.liquidated = true;
        rightInPanic[rightsId] = true;

        if (borrower != address(0) && debtCleared > 0) {
            debtToken.burnFromLoan(borrower, debtCleared);
        }

        emit PanicTriggered(rightsId);
        emit Liquidated(rightsId, debtCleared, currentLtv);
    }
}
