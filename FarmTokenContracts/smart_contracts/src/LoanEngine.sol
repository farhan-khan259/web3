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
    function transferRightsOnLiquidation(uint256 rightsId, address to) external;
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
    bytes32 public constant RECOVERY_ROLE = keccak256("RECOVERY_ROLE");

    struct Position {
        uint256 debt;
        bool inPanic;
        bool liquidated;
    }

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant AUTO_PANIC_LTV = 8_500;
    uint256 public constant SAFE_EXIT_LTV_BPS = 6_000;

    mapping(uint256 => Position) public positions;
    mapping(uint256 => bool) public rightInPanic;
    mapping(uint256 => bool) public isPanicMode;

    uint256 public panicThresholdBps = AUTO_PANIC_LTV;
    address public multisigWallet;

    IOracleRegistry public oracle;
    IVault public vault;
    IDebtToken public debtToken;
    address public revenueRouter;
    address public revenueDistributor;

    event Borrowed(uint256 indexed rightsId, address indexed borrower, uint256 amount, uint256 debtAfter);
    event Repaid(uint256 indexed rightsId, address indexed payer, uint256 amount, uint256 debtAfter);
    event Liquidated(uint256 indexed rightsId, uint256 debtCleared, uint256 ltvBps);
    event LiquidatedCommercialOnly(uint256 indexed tokenId, address indexed liquidator, uint256 debtAmount);
    event PanicTriggered(uint256 indexed rightsId);
    event PanicResolved(uint256 indexed rightsId);
    event PanicModeEntered(uint256 indexed tokenId, uint256 currentLTV, uint256 panicThreshold);
    event PanicModeExited(uint256 indexed tokenId, uint256 currentLTV, uint256 safeThreshold);
    event PanicHistory(
        uint256 indexed tokenId,
        bool entered,
        uint256 currentLTV,
        uint256 threshold,
        address indexed actor,
        string reason
    );
    event PanicThresholdUpdated(uint256 oldThresholdBps, uint256 newThresholdBps);
    event MultisigWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event RevenueRouterUpdated(address indexed oldRouter, address indexed newRouter);
    event RevenueDistributorUpdated(address indexed oldDistributor, address indexed newDistributor);

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
        _grantRole(RECOVERY_ROLE, admin);

        oracle = IOracleRegistry(oracleAddress);
        vault = IVault(vaultAddress);
        debtToken = IDebtToken(debtTokenAddress);
        multisigWallet = admin;
    }

    receive() external payable {}

    function setRevenueRouter(address newRouter) external onlyRole(ADMIN_ROLE) {
        require(newRouter != address(0), "Invalid router");
        address oldRouter = revenueRouter;
        revenueRouter = newRouter;
        emit RevenueRouterUpdated(oldRouter, newRouter);
    }

    function setRevenueDistributor(address newDistributor) external onlyRole(ADMIN_ROLE) {
        require(newDistributor != address(0), "Invalid distributor");
        address oldDistributor = revenueDistributor;
        revenueDistributor = newDistributor;

        // Backward compatibility: revenue repayment guard historically used revenueRouter.
        address oldRouter = revenueRouter;
        revenueRouter = newDistributor;

        emit RevenueDistributorUpdated(oldDistributor, newDistributor);
        emit RevenueRouterUpdated(oldRouter, newDistributor);
    }

    function setPanicThresholdBps(uint256 newThresholdBps) external onlyRole(ADMIN_ROLE) {
        require(newThresholdBps <= BASIS_POINTS, "Threshold too high");
        require(newThresholdBps >= 6_000, "Threshold too low");
        uint256 old = panicThresholdBps;
        panicThresholdBps = newThresholdBps;
        emit PanicThresholdUpdated(old, newThresholdBps);
    }

    function setMultisigWallet(address newWallet) external onlyRole(ADMIN_ROLE) {
        require(newWallet != address(0), "Invalid multisig");
        address old = multisigWallet;
        multisigWallet = newWallet;
        emit MultisigWalletUpdated(old, newWallet);
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
        _requestLoan(rightsId, expectedType, amount);
    }

    function requestLoan(
        uint256 tokenId,
        uint8 expectedType,
        uint256 amount
    ) external onlyRole(OPERATOR_ROLE) nonReentrant {
        _requestLoan(tokenId, expectedType, amount);
    }

    function _requestLoan(
        uint256 rightsId,
        uint8 expectedType,
        uint256 amount
    ) internal {
        require(amount > 0, "Amount is zero");
        require(vault.isLocked(rightsId), "Right not in vault");
        require(oracle.validateOraclePath(rightsId, expectedType), "Oracle/type mismatch");
        require(vault.rightTypeOf(rightsId) == expectedType, "Vault/type mismatch");
        require(checkOracleHealth(rightsId), "Oracle risk active");
        require(!isPanicMode[rightsId], "Panic mode active");

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

    function canBorrow(uint256 tokenId) public view returns (bool) {
        if (isPanicMode[tokenId]) {
            return false;
        }
        Position memory p = positions[tokenId];
        if (p.liquidated) {
            return false;
        }
        return checkOracleHealth(tokenId);
    }

    function enterPanicMode(uint256 tokenId) public returns (bool) {
        require(vault.isLocked(tokenId), "Right not in vault");
        uint256 currentLtv = getCurrentLTV(tokenId);
        require(currentLtv >= panicThresholdBps, "Panic threshold not met");

        if (isPanicMode[tokenId]) {
            return false;
        }

        _setPanicState(tokenId, true);
        emit PanicModeEntered(tokenId, currentLtv, panicThresholdBps);
        emit PanicHistory(tokenId, true, currentLtv, panicThresholdBps, msg.sender, "manual_or_auto_enter");
        return true;
    }

    function exitPanicMode(uint256 tokenId) public returns (bool) {
        require(vault.isLocked(tokenId), "Right not in vault");

        Position storage p = positions[tokenId];
        bool authorizedRecovery = hasRole(RECOVERY_ROLE, msg.sender) || msg.sender == multisigWallet;
        bool automatedRecovery = p.debt == 0;
        require(authorizedRecovery || automatedRecovery, "Recovery authorization required");

        uint256 currentLtv = getCurrentLTV(tokenId);
        require(currentLtv < SAFE_EXIT_LTV_BPS, "LTV not in safe range");
        require(!oracle.getRiskStatus(tokenId), "Oracle risk still active");

        if (!isPanicMode[tokenId]) {
            return false;
        }

        _setPanicState(tokenId, false);
        emit PanicModeExited(tokenId, currentLtv, SAFE_EXIT_LTV_BPS);
        emit PanicHistory(tokenId, false, currentLtv, SAFE_EXIT_LTV_BPS, msg.sender, "manual_or_auto_exit");
        return true;
    }

    function forceExitPanic(uint256 tokenId) external onlyRole(RECOVERY_ROLE) returns (bool) {
        require(vault.isLocked(tokenId), "Right not in vault");

        if (!isPanicMode[tokenId]) {
            return false;
        }

        uint256 currentLtv = getCurrentLTV(tokenId);
        _setPanicState(tokenId, false);

        emit PanicModeExited(tokenId, currentLtv, SAFE_EXIT_LTV_BPS);
        emit PanicHistory(tokenId, false, currentLtv, SAFE_EXIT_LTV_BPS, msg.sender, "force_exit");
        return true;
    }

    function updateHealthFactor(uint256 tokenId) public returns (bool) {
        require(vault.isLocked(tokenId), "Right not in vault");
        uint256 currentLtv = getCurrentLTV(tokenId);

        if (currentLtv >= panicThresholdBps && !isPanicMode[tokenId]) {
            _setPanicState(tokenId, true);
            emit PanicModeEntered(tokenId, currentLtv, panicThresholdBps);
            emit PanicHistory(tokenId, true, currentLtv, panicThresholdBps, msg.sender, "health_factor_trigger");
            return true;
        }

        return isPanicMode[tokenId];
    }

    function getPanicStatus(
        uint256 tokenId
    ) external view returns (bool panic, uint256 currentLTV, uint256 panicThreshold) {
        return (isPanicMode[tokenId], getCurrentLTV(tokenId), panicThresholdBps);
    }

    function autoProtect(uint256 rightsId, uint8 expectedType) public {
        bool typeMismatch = !oracle.validateOraclePath(rightsId, expectedType);
        bool oracleRisk = oracle.getRiskStatus(rightsId);
        uint256 currentLtv = getCurrentLTV(rightsId);

        if (typeMismatch || oracleRisk || currentLtv > panicThresholdBps) {
            Position storage p = positions[rightsId];
            if (!p.inPanic) {
                _setPanicState(rightsId, true);
                emit PanicTriggered(rightsId);
                emit PanicModeEntered(rightsId, currentLtv, panicThresholdBps);
                emit PanicHistory(rightsId, true, currentLtv, panicThresholdBps, msg.sender, "auto_protect");
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
            _setPanicState(rightsId, true);
            emit PanicTriggered(rightsId);
            emit PanicModeEntered(rightsId, currentLtv, panicThresholdBps);
            emit PanicHistory(rightsId, true, currentLtv, panicThresholdBps, msg.sender, "check_and_update");
        } else if (!shouldPanic && p.inPanic) {
            _setPanicState(rightsId, false);
            emit PanicResolved(rightsId);
            emit PanicModeExited(rightsId, currentLtv, SAFE_EXIT_LTV_BPS);
            emit PanicHistory(rightsId, false, currentLtv, SAFE_EXIT_LTV_BPS, msg.sender, "check_and_update");
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
        updateHealthFactor(rightsId);
        return checkAndUpdatePanic(rightsId);
    }

    function checkOracleHealth(uint256 rightsId) public view returns (bool) {
        return !oracle.getRiskStatus(rightsId);
    }

    function getLiquidationTerms(uint256 tokenId) external pure returns (string memory) {
        tokenId;
        return "Liquidation transfers only commercial rights (trademark license), not physical artwork.";
    }

    function outstandingDebt(uint256 rightsId) external view returns (uint256) {
        return positions[rightsId].debt;
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
        _setPanicState(rightsId, true);
        p.liquidated = true;

        if (debtCleared > 0) {
            require(borrower != address(0), "Invalid borrower");
            debtToken.burnFromLoan(borrower, debtCleared);
        }

        // Liquidation settles collateral control for commercial rights only.
        vault.transferRightsOnLiquidation(rightsId, msg.sender);

        emit PanicTriggered(rightsId);
        emit PanicModeEntered(rightsId, currentLtv, panicThresholdBps);
        emit PanicHistory(rightsId, true, currentLtv, panicThresholdBps, msg.sender, "liquidation");
        emit Liquidated(rightsId, debtCleared, currentLtv);
        emit LiquidatedCommercialOnly(rightsId, msg.sender, debtCleared);
    }

    function _setPanicState(uint256 rightsId, bool enabled) internal {
        positions[rightsId].inPanic = enabled;
        rightInPanic[rightsId] = enabled;
        isPanicMode[rightsId] = enabled;
    }
}
