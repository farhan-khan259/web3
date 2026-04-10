# Docker Troubleshooting Guide

## Table of Contents
1. [Installation Issues](#installation-issues)
2. [Service Startup Issues](#service-startup-issues)
3. [Network & Connectivity](#network--connectivity)
4. [Database Issues](#database-issues)
5. [Performance Issues](#performance-issues)
6. [Development Workflow](#development-workflow)

## Installation Issues

### Docker or Docker Compose Not Found

**Problem:** `command not found: docker` or `docker-compose`

**Solution:**
```bash
# macOS with Homebrew
brew install docker docker-compose

# Or install Docker Desktop (includes docker-compose)
# Download from https://www.docker.com/products/docker-desktop

# Verify installation
docker --version
docker-compose --version
```

### Permission Denied Error

**Problem:** `Permission denied while trying to connect to Docker daemon`

**Solution:**
```bash
# Add your user to docker group
sudo usermod -aG docker $USER
newgrp docker

# OR run with sudo
sudo docker-compose up
```

## Service Startup Issues

### "Port already in use"

**Problem:** 
```
Error response from daemon: driver failed programming external connectivity on endpoint: 
Bind for 0.0.0.0:3000 failed: port is already allocated.
```

**Solution:**
```bash
# Find process using the port
lsof -i :3000  # Check port 3000
lsof -i :8000  # Check port 8000
lsof -i :8545  # Check port 8545
lsof -i :5432  # Check port 5432

# Kill the process
kill -9 <PID>

# OR change ports in docker-compose.yml
# Change "3000:3000" to "3001:3000" etc.
```

### Service Stuck in "Starting" State

**Problem:** Service never becomes healthy

**Solution:**
```bash
# Check service logs
docker-compose logs -f <service-name>

# Common causes:
# 1. Port conflicts
# 2. Missing environment variables
# 3. Insufficient disk space
# 4. Low memory

# Restart specific service
docker-compose restart <service-name>

# Or rebuild
docker-compose up --build --force-recreate <service-name>
```

### Hardhat Node Won't Start

**Problem:**
```
Error: EADDRINUSE: address already in use :::8545
```

**Solution:**
```bash
# Kill existing hardhat process
lsof -i :8545 | grep node | awk '{print $2}' | xargs kill -9

# Clear Docker cache and rebuild
docker-compose down
docker system prune -a
docker-compose up --build hardhat
```

### Backend Won't Connect to PostgreSQL

**Problem:**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solution:**
1. Ensure PostgreSQL is running:
   ```bash
   docker-compose ps postgres
   # Should show "healthy" status
   ```

2. Check the wait time - PostgreSQL takes 10-20 seconds:
   ```bash
   docker-compose logs postgres
   ```

3. Increase healthcheck retries if needed:
   ```yaml
   healthcheck:
     retries: 10  # Increase from 5
   ```

4. Manually test connection:
   ```bash
   docker-compose exec postgres psql -U postgres -d farm_tokens
   ```

## Network & Connectivity

### Frontend Can't Connect to Backend

**Problem:** UI shows "Failed to connect to backend" or CORS errors

**Causes & Solutions:**

1. **Wrong Backend URL:**
   ```bash
   # Check .env.local
   echo $NEXT_PUBLIC_BACKEND_URL
   # Should output: http://localhost:8000
   
   # If not set, update .env.local
   NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
   ```

2. **CORS Not Configured:**
   ```bash
   # Verify CORS in .env.local
   CORS_ORIGINS=http://localhost:3000
   
   # Rebuild backend
   docker-compose up --build backend
   ```

3. **Backend Not Running:**
   ```bash
   # Check status
   curl http://localhost:8000/health
   
   # Should return JSON with "status": "ok"
   # If fails, check logs
   docker-compose logs backend
   ```

### Services Can't Communicate

**Problem:** Backend can't reach hardhat, python can't reach backend, etc.

**Solution:**
```yaml
# In docker-compose.yml, services use service names:
# Wrong: http://localhost:8545
# Right: http://hardhat:8545

# Verify in environment variables
DATABASE_URL: postgresql://postgres:postgres@postgres:5432/farm_tokens
RPC_URL: http://hardhat:8545
```

**Test connectivity:**
```bash
# From backend container
docker-compose exec backend curl http://hardhat:8545

# From frontend container  
docker-compose exec frontend curl http://backend:8000/health

# From python container
docker-compose exec python-monitor curl http://backend:8000/health
```

## Database Issues

### PostgreSQL Won't Start

**Problem:**
```
FATAL: could not create shared memory segment
```

**Solution:**
```bash
# For macOS, Docker Desktop limits shared memory
# Increase Docker memory allocation:

# 1. Open Docker Desktop Preferences
# 2. Go to Resources
# 3. Increase Memory to 4GB+
# 4. Increase Swap to 2GB+
# 5. Restart Docker

# Or use alternative:
docker-compose down -v
docker-compose up postgres
```

### Database Migration Fails

**Problem:**
```
Error: P3014 Migration deployed but failed to finalize
```

**Solution:**
```bash
# Check Prisma schema for errors
docker-compose exec backend npm run prisma:validate

# Reset database (WARNING: deletes data)
docker-compose down -v
docker-compose up --build backend

# Or manually reset:
docker-compose exec postgres psql -U postgres -d farm_tokens -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

### Can't Connect to Database Manually

**Problem:**
```
psql: error: could not translate host name "postgres" to address: Name or service not known
```

**Solution:**
```bash
# Use localhost from docker host (not from container)
# From your machine:
psql -h localhost -U postgres -d farm_tokens

# From container:
docker-compose exec postgres psql -U postgres -d farm_tokens
```

## Performance Issues

### Services Running Very Slowly

**Problem:** Docker services are slow to respond

**Solution:**

1. **Check Docker resources:**
   ```bash
   docker stats
   # Look for high CPU/Memory usage
   ```

2. **Increase Docker resources:**
   - Docker Desktop → Preferences → Resources
   - Increase CPU to 4+, Memory to 4GB+

3. **Check disk space:**
   ```bash
   df -h  # Unix/Linux/macOS
   dir C:  # Windows
   ```

4. **Reduce unnecessary logs:**
   ```bash
   # Only watch specific service logs
   docker-compose logs -f backend
   # Instead of
   docker-compose logs -f
   ```

### High CPU Usage

**Problem:** Docker processes using 100% CPU

**Causes:**
- Infinite loops in hot-reload code
- Database queries without limits
- Memory pressure causing swapping

**Solution:**
```bash
# Identify problematic container
docker stats

# Check logs for errors
docker-compose logs <container>

# Restart container
docker-compose restart <container>

# Or rebuild to pull fresh code
git pull
docker-compose up --build <container>
```

## Development Workflow

### Changes Not Reflected in Container

**Problem:** Code changes don't appear after rebuild

**Solution:**

1. **Rebuild without cache:**
   ```bash
   docker-compose up --build --no-cache backend
   ```

2. **Check if file was actually changed:**
   ```bash
   git status
   # Should show modified files
   
   # If not staged, stage changes
   git add .
   ```

3. **Using docker-compose.override.yml for development:**
   ```bash
   # This automatically mounts source code
   docker-compose -f docker-compose.yml -f docker-compose.override.yml up
   
   # Changes are reflected immediately (need hot-reload configured)
   ```

### Hot-Reload Not Working

**Problem:** Changed files aren't reloaded in running containers

**Solution:**

1. **For backend (Node.js):**
   ```yaml
   # Add to docker-compose.override.yml
   backend:
     command: npm run dev  # Uses nodemon
     volumes:
       - ./backend/src:/app/src
   ```

2. **For frontend (Next.js):**
   ```yaml
   frontend:
     volumes:
       - ./frontend:/app
       - /app/node_modules  # Don't override node_modules
       - /app/.next  # Don't override .next cache
   ```

3. **Install nodemon in backend:**
   ```bash
   cd backend
   npm install --save-dev nodemon
   ```

### Running Tests in Docker

**Problem:** Can't run tests easily

**Solution:**
```bash
# Backend tests
docker-compose exec backend npm test

# Frontend tests
docker-compose exec frontend npm test

# Smart contracts
docker-compose exec hardhat npm test

# Run in watch mode
docker-compose exec backend npm test -- --watch
```

## Useful Diagnostic Commands

```bash
# Full system diagnosis
docker-compose ps
docker-compose logs
docker system df  # Check space usage
docker system prune  # Clean up unused data

# Per-service diagnosis
docker-compose exec <service> env  # View environment variables
docker-compose exec <service> ps aux  # List processes
docker network inspect farm_network  # Check network

# Database diagnosis
docker-compose exec postgres pg_stat_database
docker-compose exec postgres psql -U postgres -d farm_tokens -c "SELECT version();"
```

## Still Having Issues?

1. Check logs first:
   ```bash
   docker-compose logs -f
   ```

2. Restart everything:
   ```bash
   docker-compose down
   docker-compose up --build
   ```

3. Nuclear option (removes all data):
   ```bash
   docker-compose down -v
   docker system prune -a
   docker-compose up --build
   ```

4. Check Docker documentation:
   - https://docs.docker.com/compose/
   - https://docs.docker.com/config/containers/resource_constraints/

5. Check service-specific docs:
   - PostgreSQL: https://hub.docker.com/_/postgres
   - Hardhat: https://hardhat.org/docs
   - Next.js: https://nextjs.org/docs
