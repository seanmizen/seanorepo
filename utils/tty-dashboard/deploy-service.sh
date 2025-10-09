#!/bin/bash
# Deploy debbie-dash-custom.service cleanly from remote SSH

SERVICE_NAME="debbie-dash-custom"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
APP_DIR="$HOME/debbie-dash"
AUTOLOGIN_DIR="/etc/systemd/system/getty@tty1.service.d"

echo "Setting up ${SERVICE_NAME}.service..."

# Paths for node + nodemon
NODE_PATH=$(command -v node)
NODEMON_PATH=$(command -v nodemon)

if [ -z "$NODE_PATH" ] || [ -z "$NODEMON_PATH" ]; then
    echo "Error: node or nodemon not found in PATH."
    exit 1
fi

# --- Create service file (as root) ---
sudo bash -c "cat > '$SERVICE_FILE'" <<EOF
[Unit]
Description=Debbie Dash Custom Service
After=network.target systemd-user-sessions.service getty@tty1.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
ExecStart=$NODEMON_PATH --watch $APP_DIR/dist --exec $NODE_PATH $APP_DIR/dist/cli.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "✓ Service file written to $SERVICE_FILE"

# --- Configure tty1 autologin (optional, harmless if exists) ---
sudo mkdir -p "$AUTOLOGIN_DIR"
sudo tee "$AUTOLOGIN_DIR/autologin.conf" >/dev/null <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $USER --noclear %I \$TERM
Type=idle
EOF

echo "✓ Auto-login config written to $AUTOLOGIN_DIR/autologin.conf"

# --- Reload systemd and enable service ---
sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo ""
echo "Service status (short):"
sudo systemctl status "$SERVICE_NAME" --no-pager -l | grep -E 'Loaded:|Active:|Main PID:' || true

echo ""
echo "✓ ${SERVICE_NAME}.service deployed successfully!"
echo "  - Auto-starts on boot"
echo "  - Logs: sudo journalctl -u ${SERVICE_NAME} -f"
echo "  - Console login (tty1) remains available"
