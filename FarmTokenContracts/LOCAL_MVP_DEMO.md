# Local MVP Demo (Hardhat + Next.js)

## What this gives you
- Local blockchain on `http://127.0.0.1:8545`
- Fully deployed and wired contracts
- Frontend connected to local contracts
- Real on-chain interactions from UI (no static data)

## One-time setup
1. Install dependencies:
   - `cd smart_contracts && npm install`
   - `cd ../frontend && npm install`

## One command startup
1. From project root:
   - `./run_local_mvp.sh`
2. This single command will:
   - start Hardhat node if not already running
   - deploy and seed local contracts
   - start frontend dev server

## Start local chain
1. In terminal A:
   - `cd smart_contracts`
   - `npm run node`

## Deploy and seed local contracts
1. In terminal B:
   - `cd smart_contracts`
   - `npm run deploy:local`
2. This script does all of the following:
   - Deploys MockNFT, OracleRegistry, Vault, LoanEngine, RevenueRouter
   - Wires Vault/LoanEngine/Router/Oracle
   - Mints tokenId `1` to deployer wallet
   - Seeds oracle data for tokenId `1`:
     - value = `10 ETH`
     - volatility = `20`
     - trademarkValid = `true`
     - provenanceValid = `true`
   - Funds LoanEngine with `100 ETH` liquidity
   - Writes frontend env file: `frontend/.env.local`
   - Writes deployment output: `smart_contracts/deployed_local.json`

## Start frontend
1. In terminal C:
   - `cd frontend`
   - `npm run dev`
2. Open shown URL (for example: `http://localhost:3003`)

## MetaMask config
1. Add network:
   - Name: Hardhat Local
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Currency: ETH
2. Import Hardhat account #0 private key:
   - `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

## Demo flow (client-ready)
1. Dashboard page
   - Connect MetaMask
   - Click Refresh
   - Confirm live contract values render
2. Vault page
   - Token ID: `1`
   - Click Deposit NFT (snapshot is captured in Vault)
3. Borrow page
   - Token ID: `1`
   - Borrow amount: `5`
   - Click Execute Borrow
   - Click Refresh and verify debt/LTV updated
4. Revenue page
   - Token ID: `1`
   - Deposit amount: `2`
   - Click Deposit Revenue
   - Verify debt decreases (70/30 split in non-panic)
5. Oracle Admin page
   - Token ID: `1`
   - Set value to `1`, volatility `90`, keep booleans true
   - Click Set Oracle Data
6. Borrow page
   - Click Run Panic Check
   - Verify Panic status turns true
   - Try borrowing again and observe borrow blocking behavior

## Files involved
- `smart_contracts/scripts/deploy_local_mvp.js`
- `smart_contracts/deployed_local.json`
- `frontend/.env.local`
- `frontend/app/page.tsx`
- `frontend/app/vault/page.tsx`
- `frontend/app/borrow/page.tsx`
- `frontend/app/revenue/page.tsx`
- `frontend/app/oracle-admin/page.tsx`
