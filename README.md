# Azure RDP Generator Bot (Dockerized)

A Telegram bot for creating and managing Windows RDP servers on Azure.

## Docker Setup

### Prerequisites

- Docker and Docker Compose installed
- Azure account with permissions to create resources
- Azure CLI service principal (for authentication)

### Configuration

1. Copy the environment template file:

   ```bash
   cp .env.template .env
   ```

2. Edit the `.env` file and fill in your Azure service principal credentials:

   ```
   AZURE_SPN_ID=your-app-id
   AZURE_SPN_SECRET=your-password
   AZURE_TENANT_ID=your-tenant-id
   AZURE_SUBSCRIPTION_ID=your-subscription-id
   ```

   You can create a service principal using the Azure CLI:

   ```bash
   az ad sp create-for-rbac --name "RDPBotSP" --role contributor --scopes /subscriptions/{subscription-id}
   ```

### Building and Running

Build and start the container:

```bash
docker-compose up -d
```

To stop the container:

```bash
docker-compose down
```

### Data Persistence

The bot stores VM information in a `vms.json` file, which is mapped to a Docker volume at `./data/vms.json`. This ensures data persistence across container restarts.

## Usage

The bot supports the following commands:

- `/start` - Start the bot
- `/help` - Show available commands
- `/create <name>` - Create a new RDP VM
- `/list` - List all saved VMs
- `/get <name>` - Get credentials for a specific VM
- `/startvm <name>` - Start a VM
- `/stopvm <name>` - Stop a VM
- `/delete <name>` - Delete a VM and associated resources

## Troubleshooting

If you encounter issues with Azure authentication, make sure:

1. Your service principal has sufficient permissions
2. Your Azure subscription is active and has sufficient quota
3. Check logs with `docker-compose logs`

## Security Considerations

- The bot only allows access to the configured owner (Telegram user ID)
- VM passwords are generated securely
- Consider using Azure KeyVault for additional security
