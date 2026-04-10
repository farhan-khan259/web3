.PHONY: help build up down logs clean restart status

help:
	@echo "Farm Token Protocol - Docker Commands"
	@echo "===================================="
	@echo ""
	@echo "make build         - Build all Docker images"
	@echo "make up            - Start all services (with --build)"
	@echo "make down          - Stop all running services"
	@echo "make logs          - View logs from all services"
	@echo "make logs-backend  - View backend logs only"
	@echo "make logs-frontend - View frontend logs only"
	@echo "make logs-hardhat  - View hardhat logs only"
	@echo "make logs-postgres - View postgres logs only"
	@echo "make restart       - Restart all services"
	@echo "make status        - Show service status"
	@echo "make clean         - Stop services and remove volumes"
	@echo "make shell-backend - Open shell in backend container"
	@echo "make shell-frontend- Open shell in frontend container"
	@echo "make shell-postgres- Open psql shell in postgres container"
	@echo ""

build:
	docker-compose build

up:
	docker-compose up --build -d
	@echo "✓ All services started!"
	@echo ""
	@echo "Services available at:"
	@echo "  Frontend:   http://localhost:3000"
	@echo "  Backend:    http://localhost:8000"
	@echo "  Hardhat:    http://localhost:8545"
	@echo "  Postgres:   localhost:5432"
	@echo ""

down:
	docker-compose down

logs:
	docker-compose logs -f

logs-backend:
	docker-compose logs -f backend

logs-frontend:
	docker-compose logs -f frontend

logs-hardhat:
	docker-compose logs -f hardhat

logs-postgres:
	docker-compose logs -f postgres

restart:
	docker-compose restart

status:
	docker-compose ps

clean:
	docker-compose down -v
	@echo "✓ Services stopped and volumes removed"

shell-backend:
	docker-compose exec backend sh

shell-frontend:
	docker-compose exec frontend sh

shell-postgres:
	docker-compose exec postgres psql -U postgres -d farm_tokens

# Advanced targets
migrate-db:
	docker-compose exec backend npm run prisma:migrate

seed-db:
	docker-compose exec backend npm run seed:scores

test-backend:
	docker-compose exec backend npm test

test-contracts:
	docker-compose exec hardhat npm test

lints:
	docker-compose exec frontend npm run lint
	docker-compose exec backend npm run lint 2>/dev/null || true

format:
	docker-compose exec frontend npx prettier --write .
	docker-compose exec backend npx prettier --write . 2>/dev/null || true

health-check:
	@echo "Checking service health..."
	@curl -s http://localhost:8000/health | grep -q "ok" && echo "✓ Backend: OK" || echo "✗ Backend: DOWN"
	@curl -s http://localhost:3000 > /dev/null && echo "✓ Frontend: OK" || echo "✗ Frontend: DOWN"
	@curl -s http://localhost:8545 > /dev/null && echo "✓ Hardhat: OK" || echo "✗ Hardhat: DOWN"
	@pg_isready -h localhost -p 5432 > /dev/null 2>&1 && echo "✓ Postgres: OK" || echo "✗ Postgres: DOWN"

dev:
	@echo "Starting services in development mode..."
	docker-compose -f docker-compose.yml -f docker-compose.override.yml up
