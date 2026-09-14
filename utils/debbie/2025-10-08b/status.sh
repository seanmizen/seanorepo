#!/bin/bash
# Quick status summary of all Debbie services

set -euo pipefail

echo "========================================="
echo "Debbie Services Status"
echo "========================================="
echo ""

# Detect server name
if [ -f "/etc/hostname" ]; then
    SERVER_NAME=$(cat /etc/hostname)
else
    SERVER_NAME="unknown"
fi

echo "Server: $SERVER_NAME"
echo "Hostname: $(hostname -f 2>/dev/null || hostname)"
echo ""

# Network information
echo "Network Status:"
echo "---------------"
ip -br addr show | grep -E "UP|DOWN" || echo "No network interfaces found"
echo ""

# Check for custom services
echo "Custom Services:"
echo "----------------"
SERVICES=(
    "deployment-custom.service"
    "deploy-poll-custom.service"
    "deploy-poll-custom.timer"
    "cloudflared-custom.service"
)

for service in "${SERVICES[@]}"; do
    if systemctl list-unit-files | grep -q "^$service"; then
        STATUS=$(systemctl is-active "$service" 2>/dev/null || echo "not-found")
        ENABLED=$(systemctl is-enabled "$service" 2>/dev/null || echo "disabled")
        
        if [ "$STATUS" = "active" ]; then
            STATUS_COLOR="✓"
        else
            STATUS_COLOR="✗"
        fi
        
        printf "  %s %-30s %s (%s)\n" "$STATUS_COLOR" "$service" "$STATUS" "$ENABLED"
        
        # Show last 3 log lines if service is running
        if [ "$STATUS" = "active" ]; then
            echo "    Last activity:"
            journalctl -u "$service" -n 3 --no-pager 2>/dev/null | sed 's/^/      /' || echo "      (no logs available)"
        fi
    else
        echo "  - $service (not installed)"
    fi
done

echo ""

# Deploy state
echo "Deploy State:"
echo "-------------"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/seanorepo"
if [ -f "$STATE_DIR/last-deployed" ]; then
    echo "  Last deployed: $(cat "$STATE_DIR/last-deployed")"
    echo "  At:            $(date -r "$STATE_DIR/last-deployed" 2>/dev/null || echo unknown)"
else
    echo "  Last deployed: (never - no marker at $STATE_DIR/last-deployed)"
fi
if [ -f "$STATE_DIR/last-failed" ]; then
    echo "  ✗ Failing:     $(cat "$STATE_DIR/last-failed") (sha attempts)"
fi
if systemctl list-timers deploy-poll-custom.timer --no-pager 2>/dev/null | grep -q deploy-poll; then
    echo "  Next poll:     $(systemctl list-timers deploy-poll-custom.timer --no-pager | awk 'NR==2 {print $1, $2, $3}')"
fi

echo ""

# Docker status
echo "Docker Status:"
echo "--------------"
if command -v docker &> /dev/null; then
    if systemctl is-active --quiet docker; then
        echo "  ✓ Docker service: active"
        CONTAINERS=$(docker ps --format "{{.Names}}" 2>/dev/null | wc -l)
        echo "  Running containers: $CONTAINERS"
        if [ "$CONTAINERS" -gt 0 ]; then
            echo ""
            docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | sed 's/^/  /'
        fi
    else
        echo "  ✗ Docker service: inactive"
    fi
else
    echo "  - Docker not installed"
fi

echo ""

# System information
echo "System Information:"
echo "-------------------"
echo "  Uptime: $(uptime -p 2>/dev/null || uptime)"
echo "  Load: $(uptime | awk -F'load average:' '{print $2}')"
echo "  Memory: $(free -h | awk '/^Mem:/ {print $3 " used / " $2 " total"}')"
echo "  Disk: $(df -h / | awk 'NR==2 {print $3 " used / " $2 " total (" $5 " full)"}')"

echo ""
echo "========================================="
echo "For detailed logs, use:"
echo "  journalctl -u <service-name> -f"
echo "========================================="
