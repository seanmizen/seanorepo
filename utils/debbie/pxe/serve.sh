#!/bin/bash
set -e

IFACE="enx9cebe84aa579"
CONFIG="config/dnsmasq.conf"

echo "Killing any existing dnsmasq..."
sudo pkill dnsmasq || true

echo "Starting dnsmasq..."
sudo dnsmasq --conf-file="$CONFIG" --no-daemon &

echo "Starting HTTP server on port 8000..."
python3 -m http.server 8000 --directory .