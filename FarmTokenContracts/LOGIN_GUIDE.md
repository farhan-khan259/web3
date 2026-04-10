# Login Guide - Farm Token Protocol

## 🌐 Frontend URLs

### User Dashboard
**URL:** http://localhost:3000/dashboard

**Access:** 
- Click "Connect Wallet" on home page
- Connect any Ethereum wallet (MetaMask, WalletConnect, etc.)
- Automatically redirected to user dashboard

---

### Admin Panel
**URL:** http://localhost:3000/admin/overview

**Access:**
- Go to http://localhost:3000/admin-login
- Connect a wallet that's in the admin allowlist
- Sign the SIWE message to get JWT token
- Redirected to admin panel

---

## 📝 User Credentials

### Any User
- **Type:** Ethereum Wallet
- **How to Login:** 
  1. Open http://localhost:3000
  2. Click "Connect Wallet"
  3. Select your wallet (MetaMask, Coinbase, etc.)
  4. Approve connection
  5. Redirected to `/dashboard`

**For Testing:** You can use any wallet address. Common test wallets:
- MetaMask test accounts
- Hardware wallet addresses
- Any Ethereum address you control

---

## 🔐 Admin Credentials

### Admin/Multisig Signer
You need a wallet address in the **NEXT_PUBLIC_MULTISIG_SIGNERS** environment variable.

#### Test Admin Account (from Hardhat)

**Private Key:**
```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

**Derived Address (Admin Wallet):**
```
0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

#### How to Use in .env.local

```env
# Set this in .env.local to make the above address an admin
NEXT_PUBLIC_MULTISIG_SIGNERS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# Also set on backend
ADMIN_WALLET_ALLOWLIST=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

#### How to Login as Admin

1. **Import private key into MetaMask:**
   - Open MetaMask
   - Account menu → Import Account
   - Paste private key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
   - Account name: "Admin Wallet"
   - Click Import

2. **Login to Admin Panel:**
   - Go to http://localhost:3000/admin-login
   - Click "Connect Wallet"
   - Select the imported admin wallet
   - MetaMask will ask to sign a SIWE message
   - Approve the signature
   - Redirected to http://localhost:3000/admin/overview

3. **Admin Features Now Available:**
   - Overview dashboard
   - Update oracle data
   - View total value locked (TVL)
   - View loans in panic mode
   - Force liquidate loans
   - Update protocol parameters

---

## 🔄 Hardhat Test Accounts

The Hardhat node includes 20 pre-funded test accounts. Here are the first few:

| Account | Private Key | Address |
|---------|-------------|---------|
| 0 (Admin) | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| 1 (User) | `0x47e1c7a1ad28202395c8651b37a67ca52ec6c65e5cbf103e81635cb12b38f79` | `0x70997970C51812e339D9B73b0245ad59cc793a3A` |
| 2 (User) | `0x8b3a350cf5c34c9194ca85829a2df0ec3153be0428a4ffe1c2b6713f3c313d0e` | `0x3C44CdDdB6a900c6671B362144b7B1aCEd51d659` |
| 3 (User) | `0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88220bd791eb1` | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |

Each account has **10,000 ETH** for testing.

---

## 🧪 Testing Different Roles

### Super Admin Wallet
```env
NEXT_PUBLIC_MULTISIG_SIGNERS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
ADMIN_WALLET_ALLOWLIST=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

### Multiple Admins
```env
NEXT_PUBLIC_MULTISIG_SIGNERS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266,0x70997970C51812e339D9B73b0245ad59cc793a3A
ADMIN_WALLET_ALLOWLIST=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266,0x70997970C51812e339D9B73b0245ad59cc793a3A
```

---

## 🔐 Authentication Flow

### User Login Flow
```
1. User visits http://localhost:3000
2. Redirected to /dashboard (via "(user)" route group)
3. If wallet not connected:
   → See "Connect Wallet" button
4. User clicks "Connect Wallet"
5. MetaMask/WalletConnect opens
6. User approves connection
7. Dashboard loads with user data
   → GET /api/user/collateral
   → GET /api/user/debt
   → GET /api/loans/active
   → GET /api/revenue/earned
```

### Admin SIWE Login Flow
```
1. Admin visits http://localhost:3000/admin-login
2. Clicks "Connect Wallet"
3. MetaMask opens
4. Admin approves connection
5. Frontend fetches nonce:
   → POST /auth/nonce
6. Frontend builds SIWEMessage:
   → Message signed by user
7. Admin signs in MetaMask
8. Frontend sends signature:
   → POST /auth/verify
9. Backend verifies:
   ✓ Signature valid
   ✓ Wallet in ADMIN_WALLET_ALLOWLIST
10. Backend returns JWT token (1 hour valid)
11. Frontend stores JWT in localStorage
12. Admin redirected to /admin/overview
13. All admin API calls include JWT:
    → Authorization: Bearer <jwt-token>
14. Backend requireAdminJwt middleware validates token
```

---

## 🌍 Live Environment Variables (.env.local)

For full setup, ensure your `.env.local` includes:

```env
# Frontend URLs
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_LOAN_ENGINE_ADDRESS=0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6
NEXT_PUBLIC_VAULT_ADDRESS=0x0165878A594ca255338adfa4d48449f69242Eb8F
NEXT_PUBLIC_REVENUE_ROUTER_ADDRESS=0x610178dA211FEF7D417bC0e6FeD39F05609AD788
NEXT_PUBLIC_MULTISIG_SIGNERS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# Admin access control
ADMIN_WALLET_ALLOWLIST=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# Backend auth
JWT_SECRET=your-secret-key-at-least-32-characters-long

# RPC configuration
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
```

---

## 🚀 Quick Start

1. **Copy environment template:**
   ```bash
   cp .env.example .env.local
   ```

2. **Update wallet addresses in .env.local:**
   ```bash
   # Add admin wallet
   NEXT_PUBLIC_MULTISIG_SIGNERS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
   ADMIN_WALLET_ALLOWLIST=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
   ```

3. **Start Docker Compose:**
   ```bash
   docker-compose up --build
   ```

4. **Open URLs:**
   - **User:** http://localhost:3000/dashboard
   - **Admin:** http://localhost:3000/admin-login

5. **Import admin wallet into MetaMask:**
   - Private Key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
   - Import as account in MetaMask

6. **Login with admin wallet** at /admin-login

---

## 📋 Admin Features Available After Login

Once you're logged in as admin at `/admin/overview`:

- **📊 Overview** - TVL, panic events, recent activities
- **🔮 Oracle Admin** - Update oracle prices and valuations
- **💰 Vault** - Manage deposits and withdrawals  
- **⚙️ Revenue** - Configure revenue distribution
- **🏛️ License Admin** - Manage license issuance
- **🎛️ Parameters** - Update protocol thresholds

---

## ⚠️ Common Issues

### "Connected wallet is not in the MULTISIG_OWNERS list"
- Check `.env.local` has correct admin wallet in `NEXT_PUBLIC_MULTISIG_SIGNERS`
- Restart Docker/frontend: `docker-compose restart frontend`
- Ensure wallet address matches exactly (case-insensitive, but must be full 42-char address)

### "Failed to get nonce from backend"
- Check backend is running: `curl http://localhost:8000/health`
- Check `NEXT_PUBLIC_BACKEND_URL=http://localhost:8000` in `.env.local`
- Check CORS in backend: `CORS_ORIGINS=http://localhost:3000`

### "Cannot connect wallet"
- Ensure MetaMask is set to Hardhat network (RPC: `http://127.0.0.1:8545`)
- Check RainbowKit configuration in frontend

---

## 🔗 Useful Links

- **Frontend Home:** http://localhost:3000
- **User Dashboard:** http://localhost:3000/dashboard
- **Admin Login:** http://localhost:3000/admin-login
- **Admin Overview:** http://localhost:3000/admin/overview
- **Backend Health:** http://localhost:8000/health
- **Hardhat RPC:** http://127.0.0.1:8545
