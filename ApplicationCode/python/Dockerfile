FROM python:3.11-slim

WORKDIR /app

# Install system deps (curl, for healthcheck)
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY . .

# Expose Ollama API port
EXPOSE 5001

# Run the Ollama API Python app
CMD ["python", "multi_ollama_api.py"]
