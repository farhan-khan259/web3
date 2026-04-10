# Hardhat local node Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy smart contracts
COPY . .

# Expose Hardhat node port
EXPOSE 8545

# Health check to verify Hardhat is running
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD curl -f http://localhost:8545 || exit 1

# Start Hardhat node
CMD ["npm", "run", "node"]
