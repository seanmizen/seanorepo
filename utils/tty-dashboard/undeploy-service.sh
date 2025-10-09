#!/bin/bash
set -e

SERVICE_NAME="tty-dashboard"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "🧹 Undeploying $SERVICE_NAME ..."

sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
sudo rm -f "$SERVICE_FILE"

sudo systemctl daemon-reexec
sudo systemctl daemon-reload

echo "✅ $SERVICE_NAME undeployed successfully."
