# Use the official Node.js LTS image
FROM node:20-slim

# Install Azure CLI - needed for azure.js which uses CLI commands
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    apt-transport-https \
    lsb-release \
    gnupg \
    && curl -sL https://aka.ms/InstallAzureCLIDeb | bash \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy app source
COPY . .

# Create volume mount point for persistent data
VOLUME /app/data

# Copy the entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Define entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]

# Document that the container listens on no ports (since this is a bot, not a web server)
EXPOSE 0
