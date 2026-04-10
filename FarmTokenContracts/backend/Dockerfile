# Backend Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy only package files first (for better cache layering)
COPY package*.json ./
COPY prisma ./prisma

# Install dependencies
RUN npm ci

# Copy application code
COPY src ./src

# Generate Prisma client
RUN npm run prisma:generate

# Expose port
EXPOSE 8000

# Health check endpoint (curl the health endpoint)
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD curl -f http://localhost:8000/health || exit 1

# Start the application
CMD ["npm", "start"]
