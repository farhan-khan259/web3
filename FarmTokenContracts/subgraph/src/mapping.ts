import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { RightLocked } from "../generated/Vault/Vault";
import {
  Borrowed,
  Repaid,
  Liquidated,
  PanicModeEntered,
  PanicModeExited,
} from "../generated/LoanEngine/LoanEngine";
import {
  RevenueReceived,
  DebtServiced,
} from "../generated/RevenueDistributor/RevenueDistributor";
import {
  LicenseMinted,
  LicenseRevoked,
} from "../generated/LicenseToken/LicenseToken";
import {
  Deposit,
  Loan,
  Liquidation as LiquidationEntity,
  PanicEvent,
  RevenueDistribution,
  License,
} from "../generated/schema";

const LOAN_STATUS_ACTIVE = "ACTIVE";
const LOAN_STATUS_REPAID = "REPAID";
const LOAN_STATUS_LIQUIDATED = "LIQUIDATED";
const LOAN_STATUS_PANIC = "PANIC";

const DIST_REVENUE_RECEIVED = "REVENUE_RECEIVED";
const DIST_DEBT_REPAYMENT = "DEBT_REPAYMENT";

function eventId(txHash: Bytes, logIndex: BigInt): string {
  return txHash.toHexString() + "-" + logIndex.toString();
}

function loanIdByToken(tokenId: BigInt): string {
  return tokenId.toString();
}

function panicIdByToken(tokenId: BigInt): string {
  return tokenId.toString();
}

function getOrCreateLoan(tokenId: BigInt, borrower: Address, timestamp: BigInt): Loan {
  const id = loanIdByToken(tokenId);
  let loan = Loan.load(id);
  if (loan == null) {
    loan = new Loan(id);
    loan.tokenId = tokenId;
    loan.borrower = borrower;
    loan.amount = BigInt.zero();
    loan.ltv = BigInt.zero();
    loan.status = LOAN_STATUS_ACTIVE;
    loan.createdAt = timestamp;
  }
  return loan as Loan;
}

export function handleVaultDeposit(event: RightLocked): void {
  const deposit = new Deposit(eventId(event.transaction.hash, event.logIndex));
  deposit.user = event.params.locker;

  // The underlying NFT collection address is not emitted in RightLocked.
  // We store the Vault contract address as collection context.
  deposit.collection = event.address;
  deposit.tokenId = event.params.rightsId;
  deposit.timestamp = event.block.timestamp;
  deposit.txHash = event.transaction.hash;
  deposit.save();
}

export function handleLoanCreated(event: Borrowed): void {
  const loan = getOrCreateLoan(event.params.rightsId, event.params.borrower, event.block.timestamp);
  loan.borrower = event.params.borrower;
  loan.amount = event.params.debtAfter;
  loan.ltv = event.params.debtAfter;
  loan.status = LOAN_STATUS_ACTIVE;
  loan.createdAt = event.block.timestamp;
  loan.save();
}

export function handleLoanRepaid(event: Repaid): void {
  const loan = getOrCreateLoan(event.params.rightsId, event.params.payer, event.block.timestamp);
  loan.amount = event.params.debtAfter;
  loan.ltv = event.params.debtAfter;
  if (event.params.debtAfter.equals(BigInt.zero())) {
    loan.status = LOAN_STATUS_REPAID;
    loan.repaidAt = event.block.timestamp;
  }
  loan.save();
}

export function handleLoanLiquidated(event: Liquidated): void {
  const loanId = loanIdByToken(event.params.rightsId);
  let loan = Loan.load(loanId);
  if (loan == null) {
    loan = new Loan(loanId);
    loan.borrower = Address.zero();
    loan.tokenId = event.params.rightsId;
    loan.amount = event.params.debtCleared;
    loan.ltv = event.params.ltvBps;
    loan.createdAt = event.block.timestamp;
  }

  loan.status = LOAN_STATUS_LIQUIDATED;
  loan.amount = BigInt.zero();
  loan.ltv = event.params.ltvBps;
  loan.repaidAt = event.block.timestamp;
  loan.save();

  const liquidation = new LiquidationEntity(eventId(event.transaction.hash, event.logIndex));
  liquidation.loan = loan.id;
  liquidation.tokenId = event.params.rightsId;
  liquidation.liquidationPrice = event.params.debtCleared;
  liquidation.timestamp = event.block.timestamp;
  liquidation.save();
}

export function handlePanicModeEntered(event: PanicModeEntered): void {
  const loan = getOrCreateLoan(event.params.tokenId, Address.zero(), event.block.timestamp);
  loan.status = LOAN_STATUS_PANIC;
  loan.ltv = event.params.currentLTV;
  loan.save();

  const panicId = panicIdByToken(event.params.tokenId);
  let panic = PanicEvent.load(panicId);
  if (panic == null) {
    panic = new PanicEvent(panicId);
    panic.tokenId = event.params.tokenId;
  }

  panic.enteredAt = event.block.timestamp;
  panic.exitedAt = null;
  panic.duration = null;
  panic.save();
}

export function handlePanicModeExited(event: PanicModeExited): void {
  const loanId = loanIdByToken(event.params.tokenId);
  const loan = Loan.load(loanId);
  if (loan != null) {
    loan.status = LOAN_STATUS_ACTIVE;
    loan.ltv = event.params.currentLTV;
    loan.save();
  }

  const panicId = panicIdByToken(event.params.tokenId);
  let panic = PanicEvent.load(panicId);
  if (panic == null) {
    panic = new PanicEvent(panicId);
    panic.tokenId = event.params.tokenId;
    panic.enteredAt = event.block.timestamp;
  }

  panic.exitedAt = event.block.timestamp;
  panic.duration = event.block.timestamp.minus(panic.enteredAt);
  panic.save();
}

export function handleRevenueReceived(event: RevenueReceived): void {
  const item = new RevenueDistribution(eventId(event.transaction.hash, event.logIndex));
  item.tokenId = event.params.tokenId;
  item.amount = event.params.amount;
  item.distributionType = DIST_REVENUE_RECEIVED;
  item.timestamp = event.block.timestamp;
  item.save();
}

export function handleDebtServiced(event: DebtServiced): void {
  const item = new RevenueDistribution(eventId(event.transaction.hash, event.logIndex));
  item.tokenId = event.params.tokenId;
  item.amount = event.params.amount;
  item.distributionType = DIST_DEBT_REPAYMENT;
  item.timestamp = event.block.timestamp;
  item.save();
}

export function handleLicenseMinted(event: LicenseMinted): void {
  const license = new License(event.params.licenseId.toString());
  license.holder = event.params.holder;
  license.nftCollection = event.params.nftCollection;
  license.nftTokenId = event.params.nftTokenId;
  license.licenseType = event.params.licenseType;
  license.expiresAt = event.params.endTimestamp;
  license.save();
}

export function handleLicenseRevoked(event: LicenseRevoked): void {
  const license = License.load(event.params.licenseId.toString());
  if (license == null) {
    return;
  }

  // Mark as expired on revoke.
  license.expiresAt = event.block.timestamp;
  license.save();
}
