# -----------------------------
# Stage 1: Build dependencies
# -----------------------------
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files and install
COPY package*.json ./
RUN npm ci --only=production

# -----------------------------
# Stage 2: Runtime image
# -----------------------------
FROM node:18-alpine

WORKDIR /app

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Expose the application port
EXPOSE 9000

# Environment variables
ENV NODE_ENV=production

# Start command
CMD ["node", "server.js"]
