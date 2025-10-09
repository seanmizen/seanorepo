#!/bin/bash
set -e

SERVICE_NAME="tty-dashboard-custom"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
APP_DIR="$(pwd)"  # current working directory
USER_NAME="$USER"

echo "🚀 Deploying $SERVICE_NAME from $APP_DIR ..."

# Ensure the build output exists
if [ ! -d "$APP_DIR/dist" ]; then
  echo "❌ No dist/ directory found. Run 'yarn build' first."
  exit 1
fi

# Find node and yarn paths
NODE_PATH=$(command -v node)
NODEMON_PATH=$(command -v nodemon || true)

# Create systemd service
sudo bash -c "cat > '$SERVICE_FILE'" <<EOF
[Unit]
Description=TTY Dashboard (local monorepo service)
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$NODE_PATH $APP_DIR/dist/cli.js
Restart=always
RestartSec=3

# --- Make it visible on screen ---
StandardInput=tty
StandardOutput=tty
StandardError=tty
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes

# --- Replace getty so login prompt doesn't conflict ---
After=systemd-user-sessions.service getty@tty1.service
Conflicts=getty@tty1.service

[Install]
WantedBy=multi-user.target
EOF

echo "✓ Service file written to $SERVICE_FILE"

# Reload systemd and enable service
sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo ""
sudo systemctl status "$SERVICE_NAME" --no-pager -l | grep -E 'Loaded:|Active:|Main PID:' || true
echo ""
echo "✅ $SERVICE_NAME deployed successfully!"
