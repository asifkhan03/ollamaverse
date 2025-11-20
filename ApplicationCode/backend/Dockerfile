FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy rest of backend code
COPY . .

# Expose API port
EXPOSE 5000

# Run the backend server.js
CMD ["node", "server.js"]

