#!/bin/bash
set -e

ANCHOR_NAME="pxe-nat"
ANCHOR_FILE="/etc/pf.anchors/$ANCHOR_NAME"
TEMP_RULES="nat-rules.conf"

echo "[*] Disabling IP forwarding..."
sudo sysctl -w net.inet.ip.forwarding=0

echo "[*] Removing PF anchor rules..."
sudo rm -f "$ANCHOR_FILE"

echo "[*] Flushing PF anchor and reloading default rules..."
cat > "$TEMP_RULES" <<EOF
# Flush our custom anchor
nat-anchor "$ANCHOR_NAME"
EOF

sudo pfctl -q -f "$TEMP_RULES"

echo "[*] Teardown complete. NAT rules removed."
