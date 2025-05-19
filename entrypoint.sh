#!/bin/bash
if [ ! -d "/app/data" ]; then
  mkdir -p /app/data
fi
if [ ! -f "/app/data/vms.json" ]; then
  echo "{}" > /app/data/vms.json
fi
if [ -f "/app/vms.json" ] && [ ! -L "/app/vms.json" ]; then
  # If it exists and is not a symlink, move the content
  if [ -s "/app/vms.json" ]; then
    cp -f /app/vms.json /app/data/vms.json
  fi
  rm /app/vms.json
fi
if [ ! -L "/app/vms.json" ]; then
  ln -s /app/data/vms.json /app/vms.json
fi
# Ensure Azure CLI is logged in if credentials are provided
if [ -n "$AZURE_SPN_ID" ] && [ -n "$AZURE_SPN_SECRET" ] && [ -n "$AZURE_TENANT_ID" ] && [ -n "$AZURE_SUBSCRIPTION_ID" ]; then
  echo "Logging into Azure..."
  az login --service-principal -u "$AZURE_SPN_ID" -p "$AZURE_SPN_SECRET" --tenant "$AZURE_TENANT_ID"
  az account set --subscription "$AZURE_SUBSCRIPTION_ID"
  echo "Azure login completed."
fi
exec node bot.js
