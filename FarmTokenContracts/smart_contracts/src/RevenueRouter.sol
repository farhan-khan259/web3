// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILoanEngine {
    function repayFromRevenue(
        uint256 rightsId
    ) external payable returns (uint256 used, uint256 refund);

    function isPanicMode(uint256 rightsId) external view returns (bool);

    function outstandingDebt(uint256 rightsId) external view returns (uint256);
}

/**
 * @title RevenueRouter
 * @dev Allocates incoming mint-right revenue between debt repayment and beneficiary payout.
 */
contract RevenueRouter is AccessControl, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant DEBT_SHARE_BPS = 7_000;

    ILoanEngine public loanEngine;
    mapping(uint256 => address) public beneficiaryByRight;
    address public reserveWallet;

    event BeneficiaryUpdated(uint256 indexed rightsId, address indexed beneficiary);
    event ReserveWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event RevenueProcessed(uint256 indexed rightsId, uint256 amount);

    constructor(address loanEngineAddress, address admin, address reserve) {
        require(loanEngineAddress != address(0), "Invalid loan engine");
        require(admin != address(0), "Invalid admin");
        require(reserve != address(0), "Invalid reserve wallet");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);

        loanEngine = ILoanEngine(loanEngineAddress);
        reserveWallet = reserve;
    }

    function setReserveWallet(address newReserveWallet) external onlyRole(ADMIN_ROLE) {
        require(newReserveWallet != address(0), "Invalid reserve wallet");
        address oldWallet = reserveWallet;
        reserveWallet = newReserveWallet;
        emit ReserveWalletUpdated(oldWallet, newReserveWallet);
    }

    function setBeneficiary(uint256 rightsId, address beneficiary) external onlyRole(ADMIN_ROLE) {
        require(beneficiary != address(0), "Invalid beneficiary");
        beneficiaryByRight[rightsId] = beneficiary;
        emit BeneficiaryUpdated(rightsId, beneficiary);
    }

    function depositRevenue(uint256 rightsId) external payable onlyRole(OPERATOR_ROLE) nonReentrant {
        require(msg.value > 0, "No revenue");

        bool panicMode = loanEngine.isPanicMode(rightsId);

        address receiver = beneficiaryByRight[rightsId];
        if (receiver == address(0)) {
            receiver = msg.sender;
        }

        if (panicMode) {
            (, uint256 refundPanic) = loanEngine.repayFromRevenue{value: msg.value}(rightsId);
            if (refundPanic > 0) {
                (bool panicRefundOk, ) = receiver.call{value: refundPanic}("");
                require(panicRefundOk, "Panic refund failed");
            }
            emit RevenueProcessed(rightsId, msg.value);
            return;
        }

        uint256 debtPayment = (msg.value * DEBT_SHARE_BPS) / BASIS_POINTS;
        uint256 userAmount = msg.value - debtPayment;
        uint256 debtRefund = 0;

        if (debtPayment > 0) {
            (, debtRefund) = loanEngine.repayFromRevenue{value: debtPayment}(rightsId);
        }

        userAmount += debtRefund;

        if (userAmount > 0) {
            (bool userOk, ) = receiver.call{value: userAmount}("");
            require(userOk, "User transfer failed");
        }

        emit RevenueProcessed(rightsId, msg.value);
    }
}