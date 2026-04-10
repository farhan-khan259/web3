# Docker Quick Reference

## Common Commands

```bash
# Start all services with build
docker-compose up --build

# Start services in background
docker-compose up -d

# Stop all services
docker-compose down

# View logs (all services)
docker-compose logs -f

# View specific service logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Check service status
docker-compose ps

# Rebuild a specific service
docker-compose up --build backend

# Remove all volumes (clean database)
docker-compose down -v
```

## Using the Makefile

```bash
make help          # Show all available commands
make up            # Start all services
make down          # Stop all services
make logs          # View all logs
make logs-backend  # View backend logs
make status        # Show service status
make clean         # Stop and remove volumes
make shell-backend # SSH into backend container
make shell-postgres# Connect to PostgreSQL
```

## Database Management

```bash
# Run database migration
docker-compose exec backend npm run prisma:migrate

# Access PostgreSQL via psql
docker-compose exec postgres psql -U postgres -d farm_tokens

# View database schema
docker-compose exec postgres pg_dump -U postgres -d farm_tokens -s
```

## Health Checks

All services have built-in health checks:

```bash
# Check if backend is healthy
curl http://localhost:8000/health

# Check all services
make health-check
```

## Debugging

```bash
# Execute command in container
docker-compose exec backend npm run prisma:generate

# Get shell access
docker-compose exec backend sh

# View complete config
docker-compose config

# Container stats
docker stats
```

## Port Mapping

| Service | Port | Environment |
|---------|------|-------------|
| Frontend | 3000 | http://localhost:3000 |
| Backend | 8000 | http://localhost:8000 |
| Hardhat | 8545 | http://localhost:8545 |
| PostgreSQL | 5432 | postgres://localhost:5432 |

## Environment Setup

1. **Copy template to .env.local:**
   ```bash
   cp .env.example .env.local
   ```

2. **Edit `.env.local` with your values:**
   ```env
   LOAN_ENGINE_ADDRESS=0x...
   VAULT_ADDRESS=0x...
   JWT_SECRET=your-secret-here
   ```

3. **Start services:**
   ```bash
   docker-compose up --build
   ```

## Production Deployment

1. Use versioned images: Update docker-compose.yml to reference specific tags
2. Set strong JWT_SECRET: Use a cryptographically secure random string
3. Configure CORS_ORIGINS: Restrict to your domain
4. Use environment-specific .env files
5. Enable database backups: Mount volumes with backup strategy

## Troubleshooting

### Service won't start
```bash
# Check logs
docker-compose logs <service-name>

# Rebuild and restart
docker-compose up --build --force-recreate <service-name>
```

### Port already in use
```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or change ports in docker-compose.yml
```

### Database connection issues
```bash
# Ensure PostgreSQL is healthy
docker-compose ps postgres

# Check PostgreSQL logs
docker-compose logs postgres

# Reset database
docker-compose down -v
docker-compose up postgres
```

### Cannot reach backend from frontend
1. Ensure `NEXT_PUBLIC_BACKEND_URL=http://localhost:8000`
2. Check backend is running: `curl http://localhost:8000/health`
3. Check CORS configuration in backend: `CORS_ORIGINS=http://localhost:3000`
