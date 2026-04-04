# GPM Token Yield Projections

This document outlines the yield generation rates for staking NFTs in the PrivateNFTVault contract.

## Base Parameters
- **Yield Token:** Gorilla in Pink Mask (GPM)
- **Token Max Supply:** 50,000,000 GPM (Fixed supply, no minting function)
- **Yield Rate:** 1.23 GPM per hour per NFT
- **Daily Yield Rate:** 29.52 GPM per day per NFT

---

## 📈 Yield Projections by NFT Count

| Staked NFTs | Hourly Yield | Daily Yield | Weekly Yield | Monthly Yield (30 Days) | Yearly Yield (365 Days) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1 NFT** | 1.23 GPM | 29.52 GPM | 206.64 GPM | 885.60 GPM | 10,774.80 GPM |
| **10 NFTs** | 12.30 GPM | 295.20 GPM | 2,066.40 GPM | 8,856.00 GPM | 107,748.00 GPM |
| **200 NFTs** | 246.00 GPM | 5,904.00 GPM | 41,328.00 GPM | 177,120.00 GPM | 2,154,960.00 GPM |
| **1,000 NFTs** | 1,230.00 GPM | 29,520.00 GPM | 206,640.00 GPM | 885,600.00 GPM | 10,774,800.00 GPM |
| **5,000 NFTs** | 6,150.00 GPM | 147,600.00 GPM | 1,033,200.00 GPM | 4,428,000.00 GPM | 53,874,000.00 GPM |
| **9,000 NFTs** | 11,070.00 GPM | 265,680.00 GPM | 1,859,760.00 GPM | 7,970,400.00 GPM | 96,973,200.00 GPM |
| **10,000 NFTs** | 12,300.00 GPM | 295,200.00 GPM | 2,066,400.00 GPM | 8,856,000.00 GPM | 107,748,000.00 GPM |

---

## ⚠️ Vault Token Supply Limits (Depletion Rate)

Since the `PortfolioYieldToken` contract deploys precisely `50,000,000 GPM` tokens directly to the original owner and **cannot mint more**, the PrivateNFTVault relies entirely on those 50M tokens being deposited into it. Once those are gone, no further yield can be claimed.

### At 9,000 NFTs Staked:
- **Daily Generation:** 265,680 GPM
- **Time Until Vault Runs Out:** `50,000,000 ÷ 265,680` = **~188 Days** (Just over 6 months)

### At 200 NFTs Staked:
- **Daily Generation:** 5,904 GPM
- **Time Until Vault Runs Out:** `50,000,000 ÷ 5,904` = **~8,468 Days** (Approx. 23 Years)
