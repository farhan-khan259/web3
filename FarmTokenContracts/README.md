# Farm Token Protocol

A comprehensive Web3 financial protocol featuring lending, borrowing, collateral management, and real-time monitoring.

## Quick Start with Docker Compose

The easiest way to run the entire stack (PostgreSQL, Hardhat node, Backend, Frontend, Python monitor) is with Docker Compose.

### Prerequisites

- Docker and Docker Compose installed
- `.env.local` file with required environment variables (see [Environment Variables](#environment-variables) below)

### Running the Stack

```bash
docker-compose up --build
```

This command will:
1. Build all Docker images from source
2. Start PostgreSQL database
3. Start a local Hardhat blockchain node
4. Run the Node.js backend API (port 8000)
5. Build and run the Next.js frontend (port 3000)
6. Start the Python LTV monitor service

### Service Ports

| Service | Port | URL |
|---------|------|-----|
| Frontend (Next.js) | 3000 | http://localhost:3000 |
| Backend (Node.js) | 8000 | http://localhost:8000 |
| Hardhat Node | 8545 | http://localhost:8545 |
| PostgreSQL | 5432 | postgres://localhost:5432 |

### Accessing Services

- **Frontend**: Open http://localhost:3000 in your browser
- **Backend API**: http://localhost:8000
- **Hardhat RPC**: http://localhost:8545

### Health Checks

All services include built-in health checks. Docker Compose will only consider a service healthy when all checks pass.

```bash
# View service status
docker-compose ps

# View service logs
docker-compose logs -f <service-name>

# Example: view backend logs
docker-compose logs -f backend
```

### Stopping the Stack

```bash
# Stop all running containers
docker-compose down

# Stop and remove volumes (clears database)
docker-compose down -v
```

### Rebuilding Services

```bash
# Rebuild all images and restart
docker-compose up --build --force-recreate

# Rebuild a specific service
docker-compose up --build --force-recreate backend
```

## Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```env
# Database
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=farm_tokens

# Blockchain / Smart Contracts
LOAN_ENGINE_ADDRESS=0x...
VAULT_ADDRESS=0x...
REVENUE_DISTRIBUTOR_ADDRESS=0x...

# Backend
JWT_SECRET=your-secret-key-at-least-32-chars
ADMIN_WALLET_ALLOWLIST=0x...,0x...
CORS_ORIGINS=http://localhost:3000
PRIVATE_KEY=0x...
ADMIN_PRIVATE_KEY=0x...

# Frontend
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_LOAN_ENGINE_ADDRESS=0x...
NEXT_PUBLIC_VAULT_ADDRESS=0x...
NEXT_PUBLIC_REVENUE_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_MULTISIG_SIGNERS=0x...,0x...
```

## Running Individual Services Locally

If you prefer to run services locally (without Docker):

### Backend

```bash
cd backend
npm install
npm run prisma:generate
npm start
```

### Frontend

```bash
cd frontend
npm install
npm run build
npm start
```

### Hardhat Node

```bash
cd smart_contracts
npm install
npm run node
```

### Python Monitor

```bash
cd python
pip install -r requirements.txt
python ltv_monitor.py
```

## Architecture

### Services

1. **PostgreSQL** - Primary data store with Prisma ORM
   - User accounts, loans, deposits
   - Oracle snapshots, panic events
   - Revenue flows, license assignments

2. **Hardhat Node** - Local Ethereum blockchain
   - Primary network for development/testing
   - Runs on `http://localhost:8545`
   - Compatible with ethers.js v6

3. **Backend (Node.js/Express)** - REST API + WebSocket server
   - User endpoints (collateral, debt, loans)
   - Admin endpoints (oracle updates, LTV queries)
   - WebSocket events (ltv-update, oracle-update)
   - JWT authentication for admin operations
   - Socket.IO for real-time updates

4. **Frontend (Next.js)** - React-based UI
   - User dashboard with wallet integration
   - Admin control panel (SIWE login)
   - Real-time LTV monitoring
   - QR code scanning for collateral

5. **Python Monitor** - Asynchronous monitoring service
   - Tracks LTV changes across loans
   - Monitors vault health
   - Posts updates to database
   - Alerts on threshold breaches

## API Documentation

### User Endpoints

- `GET /api/user/collateral` - Total collateral value
- `GET /api/user/debt` - Outstanding debt
- `GET /api/user/available-borrowing-power` - Available to borrow
- `GET /api/user/panic-alerts` - Active panic alerts
- `GET /api/user/debt-history` - Historical debt records
- `GET /api/loans/active` - Active loans for wallet
- `GET /api/loans/history` - Loan repayment history
- `GET /api/revenue/earned` - Revenue earned
- `GET /api/license/available` - Available licenses

### Admin Endpoints (require JWT)

- `POST /api/admin/update-oracle` - Update oracle data
- `GET /api/admin/tvl` - Total value locked
- `GET /api/admin/panic-list` - Loans in panic
- `POST /api/admin/force-liquidate` - Force liquidate a loan
- `PUT /api/admin/parameters` - Update protocol parameters

### Authentication

- `POST /auth/nonce` - Get SIWE nonce
- `POST /auth/verify` - Verify SIWE signature, get JWT

### WebSocket Events

Connect to `/socket.io` for real-time updates:

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:8000');

// Subscribe to LTV updates for token
socket.emit('subscribe-ltv', { tokenId: '123' });

// Receive LTV updates
socket.on('ltv-update', (data) => {
  console.log(data.tokenId, data.ltvPct);
});

// Subscribe to wallet updates
socket.emit('subscribe-wallet', { walletAddress: '0x...' });
```

## Troubleshooting

### Service Won't Start

Check the logs:
```bash
docker-compose logs <service-name>
```

Common issues:
- **Port conflicts**: Ensure ports 3000, 8000, 8545, 5432 are available
- **Database connection**: Wait for PostgreSQL healthcheck (may take 10-20s)
- **Hardhat startup**: First startup may take 30-60s

### Database Migration Issues

```bash
# Connect to PostgreSQL container
docker-compose exec postgres psql -U postgres -d farm_tokens

# Or manually migrate from backend
docker-compose exec backend npm run prisma:migrate
```

### Frontend Can't Connect to Backend

Ensure `NEXT_PUBLIC_BACKEND_URL` is set correctly in `.env.local`:

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

### Hardhat Node Issues

```bash
# Check if Hardhat is responding
docker-compose exec hardhat curl http://localhost:8545

# View Hardhat logs
docker-compose logs -f hardhat
```

## Development Workflow

1. **Start Docker Compose**: `docker-compose up --build`
2. **Open Frontend**: http://localhost:3000
3. **Connect Wallet**: Use the UI to connect your wallet (MetaMask, etc.)
4. **View Logs**: `docker-compose logs -f backend` to debug API calls
5. **Modify Code**: Edit source files; changes require image rebuild
6. **Rebuild Service**: `docker-compose up --build <service-name>`

## Building for Production

For production deployments:

1. **Use specific image tags**: Update docker-compose.yml to use versioned images
2. **Set strong JWT_SECRET**: Use a cryptographically secure secret
3. **Configure CORS_ORIGINS**: Restrict to your domain
4. **Use environment-specific .env files**: Separate dev and prod configs
5. **Enable database backups**: Mount persistent volumes with backup strategy
6. **Review healthcheck settings**: Adjust timeouts for your network

Example production environment:

```env
NODE_ENV=production
JWT_SECRET=<cryptographically-secure-random-string>
ADMIN_WALLET_ALLOWLIST=0x<multisig-address>
CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
DATABASE_URL=postgresql://<user>:<pass>@<db-host>:5432/farm_tokens_prod
RPC_URL=https://mainnet.infura.io/v3/<your-api-key>
```

## Contributing

1. Clone the repository
2. Create a `.env.local` with dev variables
3. Run `docker-compose up --build`
4. Make changes and test
5. Submit pull requests

## License

ISC
