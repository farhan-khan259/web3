// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILoanEngineRevenue {
    function repayFromRevenue(uint256 rightsId) external payable returns (uint256 used, uint256 refund);
    function isPanicMode(uint256 rightsId) external view returns (bool);
    function outstandingDebt(uint256 rightsId) external view returns (uint256);
    function getDebtAmount(uint256 tokenId) external view returns (uint256);
}

interface ILicenseTokenRevenue {
    function onRevenueReceived(uint256 tokenId) external payable;
}

/**
 * @title RevenueDistributor
 * @dev Milestone 3 debt-first waterfall for NFT-backed revenue.
 * Waterfall order per token:
 * 1) Debt servicing
 * 2) Reserve allocation
 * 3) Surplus distribution (treasury + license routing)
 */
contract RevenueDistributor is Ownable, ReentrancyGuard {
    uint256 public constant BASIS_POINTS = 10_000;

    ILoanEngineRevenue public loanEngine;
    address public multisigWallet;
    address public reserveWallet;
    address public treasuryWallet;
    address public licenseToken;

    // Distribution is applied on post-debt remainder.
    uint8 public reservePercent;
    uint8 public treasuryPercent;

    struct Breakdown {
        uint256 debtAmount;
        uint256 reserveAmount;
        uint256 surplusAmount;
    }

    mapping(uint256 => Breakdown) public lastBreakdownByToken;

    event RevenueReceived(uint256 indexed tokenId, uint256 amount, address indexed payer);
    event DebtServiced(uint256 indexed tokenId, uint256 amount);
    event ReserveAllocated(uint256 indexed tokenId, uint256 amount, address indexed reserveWallet);
    event SurplusDistributed(
        uint256 indexed tokenId,
        uint256 treasuryAmount,
        uint256 licenseAmount,
        address indexed treasuryWallet,
        address licenseToken
    );
    event DistributionConfigUpdated(uint8 reservePercent, uint8 treasuryPercent);
    event MultisigWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event LoanEngineUpdated(address indexed oldEngine, address indexed newEngine);
    event ReserveWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event TreasuryWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event LicenseTokenUpdated(address indexed oldToken, address indexed newToken);

    modifier onlyMultisigOrOwner() {
        require(msg.sender == owner() || msg.sender == multisigWallet, "Not multisig/owner");
        _;
    }

    constructor(
        address loanEngineAddress,
        address initialOwner,
        address multisigAddress,
        address reserveAddress,
        address treasuryAddress,
        address licenseTokenAddress,
        uint8 initialReservePercent,
        uint8 initialTreasuryPercent
    ) Ownable(initialOwner) {
        require(loanEngineAddress != address(0), "Invalid loan engine");
        require(initialOwner != address(0), "Invalid owner");
        require(multisigAddress != address(0), "Invalid multisig");
        require(reserveAddress != address(0), "Invalid reserve");
        require(treasuryAddress != address(0), "Invalid treasury");

        loanEngine = ILoanEngineRevenue(loanEngineAddress);
        multisigWallet = multisigAddress;
        reserveWallet = reserveAddress;
        treasuryWallet = treasuryAddress;
        licenseToken = licenseTokenAddress;

        _setDistributionConfig(initialReservePercent, initialTreasuryPercent);
    }

    function setDistributionConfig(uint8 newReservePercent, uint8 newTreasuryPercent) external onlyMultisigOrOwner {
        _setDistributionConfig(newReservePercent, newTreasuryPercent);
    }

    function setMultisigWallet(address newMultisig) external onlyOwner {
        require(newMultisig != address(0), "Invalid multisig");
        address oldWallet = multisigWallet;
        multisigWallet = newMultisig;
        emit MultisigWalletUpdated(oldWallet, newMultisig);
    }

    function setReserveWallet(address newReserve) external onlyMultisigOrOwner {
        require(newReserve != address(0), "Invalid reserve");
        address oldWallet = reserveWallet;
        reserveWallet = newReserve;
        emit ReserveWalletUpdated(oldWallet, newReserve);
    }

    function setLoanEngine(address newLoanEngine) external onlyMultisigOrOwner {
        require(newLoanEngine != address(0), "Invalid loan engine");
        address oldEngine = address(loanEngine);
        loanEngine = ILoanEngineRevenue(newLoanEngine);
        emit LoanEngineUpdated(oldEngine, newLoanEngine);
    }

    function setTreasuryWallet(address newTreasury) external onlyMultisigOrOwner {
        require(newTreasury != address(0), "Invalid treasury");
        address oldWallet = treasuryWallet;
        treasuryWallet = newTreasury;
        emit TreasuryWalletUpdated(oldWallet, newTreasury);
    }

    function setLicenseToken(address newLicenseToken) external onlyMultisigOrOwner {
        address oldToken = licenseToken;
        licenseToken = newLicenseToken;
        emit LicenseTokenUpdated(oldToken, newLicenseToken);
    }

    /**
     * @notice Distribute incoming native-token revenue for a specific tokenId.
     * @dev Caller must send msg.value == amount.
     */
    function distributeRevenue(uint256 tokenId, uint256 amount) external payable nonReentrant {
        require(amount > 0, "Amount is zero");
        require(msg.value == amount, "Amount/value mismatch");

        emit RevenueReceived(tokenId, amount, msg.sender);

        uint256 remaining = amount;
        bool panicMode = loanEngine.isPanicMode(tokenId);
        uint256 debt = _getDebtAmount(tokenId);

        // Panic mode forces max debt repayment priority.
        if (panicMode || debt > 0) {
            (uint256 used, uint256 refund) = loanEngine.repayFromRevenue{value: remaining}(tokenId);
            if (used > 0) {
                emit DebtServiced(tokenId, used);
            }
            remaining = refund;
            debt = _getDebtAmount(tokenId);

            // If panic is active, route any leftover to reserve for conservative handling.
            if (panicMode && remaining > 0) {
                _safeNativeTransfer(reserveWallet, remaining, "Reserve transfer failed");
                emit ReserveAllocated(tokenId, remaining, reserveWallet);
                lastBreakdownByToken[tokenId] = Breakdown({
                    debtAmount: used,
                    reserveAmount: remaining,
                    surplusAmount: 0
                });
                return;
            }

            if (remaining == 0) {
                lastBreakdownByToken[tokenId] = Breakdown({
                    debtAmount: used,
                    reserveAmount: 0,
                    surplusAmount: 0
                });
                return;
            }
        }

        // Debt cleared: split remaining by configured percentages.
        uint256 reserveAmount = (remaining * reservePercent) / 100;
        uint256 treasuryAmount = (remaining * treasuryPercent) / 100;
        uint256 licenseAmount = remaining - reserveAmount - treasuryAmount;

        if (reserveAmount > 0) {
            _safeNativeTransfer(reserveWallet, reserveAmount, "Reserve transfer failed");
            emit ReserveAllocated(tokenId, reserveAmount, reserveWallet);
        }

        if (treasuryAmount > 0) {
            _safeNativeTransfer(treasuryWallet, treasuryAmount, "Treasury transfer failed");
        }

        if (licenseAmount > 0) {
            _routeLicenseShare(tokenId, licenseAmount);
        }

        emit SurplusDistributed(tokenId, treasuryAmount, licenseAmount, treasuryWallet, licenseToken);

        lastBreakdownByToken[tokenId] = Breakdown({
            debtAmount: 0,
            reserveAmount: reserveAmount,
            surplusAmount: treasuryAmount + licenseAmount
        });
    }

    /**
     * @notice Returns the most recent distribution breakdown for a token.
     */
    function getRevenueBreakdown(uint256 tokenId) external view returns (
        uint256 debtAmount,
        uint256 reserveAmount,
        uint256 surplusAmount
    ) {
        Breakdown memory b = lastBreakdownByToken[tokenId];
        return (b.debtAmount, b.reserveAmount, b.surplusAmount);
    }

    function _setDistributionConfig(uint8 newReservePercent, uint8 newTreasuryPercent) internal {
        require(newReservePercent <= 100, "Reserve > 100");
        require(newTreasuryPercent <= 100, "Treasury > 100");
        require(uint256(newReservePercent) + uint256(newTreasuryPercent) <= 100, "Config overflow");

        reservePercent = newReservePercent;
        treasuryPercent = newTreasuryPercent;

        emit DistributionConfigUpdated(newReservePercent, newTreasuryPercent);
    }

    function _getDebtAmount(uint256 tokenId) internal view returns (uint256) {
        // Backward compatible with LoanEngine variants.
        try loanEngine.getDebtAmount(tokenId) returns (uint256 debt) {
            return debt;
        } catch {
            return loanEngine.outstandingDebt(tokenId);
        }
    }

    function _routeLicenseShare(uint256 tokenId, uint256 amount) internal {
        // If license token not configured, route to treasury.
        if (licenseToken == address(0)) {
            _safeNativeTransfer(treasuryWallet, amount, "Treasury fallback transfer failed");
            return;
        }

        // Preferred explicit hook for future LicenseToken implementations.
        try ILicenseTokenRevenue(licenseToken).onRevenueReceived{value: amount}(tokenId) {
            return;
        } catch {
            // Fallback to treasury if hook is not implemented.
            _safeNativeTransfer(treasuryWallet, amount, "Treasury fallback transfer failed");
        }
    }

    function _safeNativeTransfer(address to, uint256 amount, string memory errorMessage) internal {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, errorMessage);
    }
}
