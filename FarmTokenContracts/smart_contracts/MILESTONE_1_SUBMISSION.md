# Milestone 1 Submission Note

## Status
COMPLETE

## Scope Verified
This note confirms Milestone 1 implementation and validation for:
- Vault system and NFT lock controls
- Per-NFT position state
- Per-token panic mode
- Oracle integration with LoanEngine
- LTV calculation
- Security controls (roles, reentrancy, safe ETH transfer)

## Requirement Checklist

### 1) Vault System
- Secure vault contract implemented: `src/Vault.sol`
- ERC721 receiver support used via `ERC721Holder`: `src/Vault.sol` line 17
- Deposit restricted to owner role: `src/Vault.sol` line 52
- Withdrawal restricted to owner role: `src/Vault.sol` line 66
- Withdrawal blocked when debt exists:
  - loan engine must be configured: `src/Vault.sol` line 69
  - debt must be zero: `src/Vault.sol` line 70

Result: PASS

### 2) Per-NFT State Tracking
- Required struct implemented in LoanEngine:
  - `Position { uint256 debt; bool inPanic; }`: `src/LoanEngine.sol` lines 26-28
- Per-token mapping implemented and used:
  - `mapping(uint256 => Position) public positions;`: `src/LoanEngine.sol` line 34

Result: PASS

### 3) Per-Token Panic Mode
- Panic tracked per token in `positions[tokenId].inPanic`: `src/LoanEngine.sol` lines 159-165
- `checkAndUpdatePanic(tokenId)` exists: `src/LoanEngine.sol` line 152
- Panic triggers when:
  - LTV breach: `src/LoanEngine.sol` line 155
  - Oracle risk true: `src/LoanEngine.sol` line 156

Result: PASS

### 4) Oracle Integration (Basic)
- LoanEngine bound to oracle interface: `src/LoanEngine.sol` line 36, constructor line 71
- Uses required oracle methods:
  - `getLiquidationValue(tokenId)`: `src/LoanEngine.sol` lines 104, 122
  - `getRiskStatus(tokenId)`: `src/LoanEngine.sol` lines 156, 211
- Oracle output affects panic decisions: `src/LoanEngine.sol` line 157

Result: PASS

### 5) Basic LTV Calculation
- `getCurrentLTV(tokenId)` implemented: `src/LoanEngine.sol` line 98
- Formula implemented correctly:
  - `(debt * 10000) / value`: `src/LoanEngine.sol` line 109

Result: PASS

### 6) Security
- Access control used (`AccessControl`):
  - `src/Vault.sol` line 17
  - `src/LoanEngine.sol` line 22
  - `src/RevenueRouter.sol` line 21
- Reentrancy protection used (`ReentrancyGuard`) on ETH flow paths:
  - Borrow/repay in `src/LoanEngine.sol` lines 115, 170, 181
  - Revenue deposit in `src/RevenueRouter.sol` line 62
- Safe ETH transfer call pattern used:
  - Borrow payout: `src/LoanEngine.sol` line 136
  - Repay refunds: `src/LoanEngine.sol` lines 174-175, 185-186
  - Revenue router payouts: `src/RevenueRouter.sol` lines 93-99

Result: PASS

## Fixes Applied in Final Pass
1. Vault withdrawal hardening
- Enforced mandatory loan engine configuration before withdrawal.
- Enforced unconditional debt check before NFT release.

2. Borrow payout routing fix
- Borrow proceeds now transfer to token locker (`vault.lockedBy(tokenId)`), not operator caller.

3. Repay overpayment safety
- Direct `repay()` now refunds excess ETH (matching revenue-repay behavior).

## Validation Evidence
Executed:
- `npx hardhat test`

Result:
- 8 passing
- 0 failing

Test suites passed:
- Institutional NFT Credit Engine MVP
- OracleRegistry

## Submission Conclusion
Milestone 1 is implemented, validated, and ready for submission.
