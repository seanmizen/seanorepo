#!/bin/bash
set -e

SERVICE_NAME="tty-dashboard-custom"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
APP_DIR="$(pwd)"
USER_NAME="$USER"
NODE_PATH="/usr/bin/node"

echo "🚀 Deploying $SERVICE_NAME from $APP_DIR ..."

if [ ! -f "$APP_DIR/dist/cli.js" ]; then
  echo "❌ Build output missing (expected $APP_DIR/dist/cli.js)"
  exit 1
fi

sudo bash -c "cat > '$SERVICE_FILE'" <<EOF
[Unit]
Description=TTY Dashboard (local monorepo service)
After=systemd-user-sessions.service getty@tty1.service
Conflicts=getty@tty1.service

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$NODE_PATH $APP_DIR/dist/cli.js
Restart=always
RestartSec=3

# Show on screen (take over tty1)
StandardInput=tty
StandardOutput=tty
StandardError=tty
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes

[Install]
WantedBy=multi-user.target
EOF

echo "✓ Service file written to $SERVICE_FILE"

sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

sudo systemctl status "$SERVICE_NAME" --no-pager -l | grep -E 'Loaded:|Active:|Main PID:' || true
echo ""
echo "✅ $SERVICE_NAME deployed successfully!"
