# Python LTV Monitor Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for psycopg2 and web3
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    postgresql-client \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Health check (curl the backend)
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD python -c "import psycopg2; print('healthy')" || exit 1

# Run the LTV monitor
CMD ["python", "ltv_monitor.py"]
