#!/bin/bash
set -e

IFACE="en8"
CONFIG="config/dnsmasq.conf"

echo "Killing any existing dnsmasq..."
sudo pkill dnsmasq || true

echo "Starting dnsmasq..."
sudo dnsmasq --conf-file="$CONFIG" --no-daemon &

echo "Starting HTTP server on port 8000..."
python3 -m http.server 8000 --directory .
# to listen for responses:
# sudo tcpdump -i en8 port 67 or port 69 or port 4011 or port 8000
