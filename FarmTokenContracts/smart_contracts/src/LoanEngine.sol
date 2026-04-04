// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IOracleRegistry {
    function getLiquidationValue(uint256 tokenId) external view returns (uint256);
    function getRiskStatus(uint256 tokenId) external view returns (bool);
    function getVolatilityIndex() external view returns (uint256);
}

interface IVault {
    function isLocked(uint256 tokenId) external view returns (bool);
    function lockedBy(uint256 tokenId) external view returns (address);
    function getSnapshotValue(uint256 tokenId) external view returns (uint256);
}

/**
 * @title LoanEngine
 * @dev Per-NFT credit state engine with dynamic LTV and panic mode controls.
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
    mapping(uint256 => bool) public tokenInPanic;

    IOracleRegistry public oracle;
    IVault public vault;
    address public revenueRouter;

    event Borrow(uint256 indexed tokenId, uint256 amount);
    event Repay(uint256 indexed tokenId, uint256 amount);
    event PanicTriggered(uint256 indexed tokenId);
    event RevenueRouterUpdated(address indexed oldRouter, address indexed newRouter);

    modifier onlyRevenueRouter() {
        require(msg.sender == revenueRouter, "Only revenue router");
        _;
    }

    modifier onlyIfHealthy(uint256 tokenId) {
        require(
            checkOracleHealth(tokenId),
            "Panic Mode Active - Revenue diverted to debt repayment"
        );
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

    function getCurrentLTV(uint256 tokenId) public view returns (uint256) {
        Position memory p = positions[tokenId];
        if (p.debt == 0) {
            return 0;
        }

        uint256 value = vault.getSnapshotValue(tokenId);
        if (value == 0) {
            return type(uint256).max;
        }

        return (p.debt * BASIS_POINTS) / value;
    }

    function borrow(
        uint256 tokenId,
        uint256 amount
    ) external onlyRole(OPERATOR_ROLE) onlyIfHealthy(tokenId) nonReentrant {
        require(amount > 0, "Amount is zero");
        require(vault.isLocked(tokenId), "NFT not in vault");

        Position storage p = positions[tokenId];
        require(!p.inPanic, "Token in panic");

        uint256 value = vault.getSnapshotValue(tokenId);
        require(value > 0, "No oracle value");

        uint256 maxDebt = (value * getDynamicMaxLTV()) / BASIS_POINTS;
        require(p.debt + amount <= maxDebt, "LTV cap exceeded");
        require(address(this).balance >= amount, "Insufficient liquidity");

        address recipient = vault.lockedBy(tokenId);
        require(recipient != address(0), "Invalid recipient");

        p.debt += amount;

        autoProtect(tokenId);

        (bool ok, ) = recipient.call{value: amount}("");
        require(ok, "Borrow transfer failed");

        emit Borrow(tokenId, amount);
    }

    function autoProtect(uint256 tokenId) public {
        if (getCurrentLTV(tokenId) > AUTO_PANIC_LTV) {
            Position storage p = positions[tokenId];
            if (!p.inPanic) {
                p.inPanic = true;
                tokenInPanic[tokenId] = true;
                emit PanicTriggered(tokenId);
            }
        }
    }

    function checkAndUpdatePanic(uint256 tokenId) public returns (bool) {
        require(vault.isLocked(tokenId), "NFT not in vault");

        bool ltvBreach = getCurrentLTV(tokenId) > getDynamicMaxLTV();
        bool oracleRisk = oracle.getRiskStatus(tokenId);
        bool shouldPanic = ltvBreach || oracleRisk;

        Position storage p = positions[tokenId];
        if (shouldPanic && !p.inPanic) {
            p.inPanic = true;
            tokenInPanic[tokenId] = true;
            emit PanicTriggered(tokenId);
        } else if (!shouldPanic && p.inPanic) {
            p.inPanic = false;
            tokenInPanic[tokenId] = false;
        }

        return p.inPanic;
    }

    function repay(uint256 tokenId) external payable onlyRole(OPERATOR_ROLE) nonReentrant {
        uint256 used = _repay(tokenId, msg.value);
        uint256 refund = msg.value - used;
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            require(ok, "Refund failed");
        }
    }

    function repayFromRevenue(
        uint256 tokenId
    ) external payable onlyRevenueRouter nonReentrant returns (uint256 used, uint256 refund) {
        used = _repay(tokenId, msg.value);
        refund = msg.value - used;
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            require(ok, "Refund failed");
        }
    }

    function _repay(uint256 tokenId, uint256 amount) internal returns (uint256 used) {
        require(amount > 0, "No repayment");
        require(vault.isLocked(tokenId), "NFT not in vault");

        Position storage p = positions[tokenId];
        if (amount > p.debt) {
            used = p.debt;
        } else {
            used = amount;
        }

        p.debt -= used;
        emit Repay(tokenId, used);
        checkAndUpdatePanic(tokenId);
    }

    function autoCheck(uint256 tokenId) external returns (bool) {
        return checkAndUpdatePanic(tokenId);
    }

    function checkOracleHealth(uint256 tokenId) public view returns (bool) {
        return !oracle.getRiskStatus(tokenId);
    }

    function outstandingDebt(uint256 tokenId) external view returns (uint256) {
        return positions[tokenId].debt;
    }

    function isPanicMode(uint256 tokenId) external view returns (bool) {
        return tokenInPanic[tokenId];
    }
}