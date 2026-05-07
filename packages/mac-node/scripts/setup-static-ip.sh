#!/usr/bin/env bash
set -euo pipefail

# Configure a static IP on the Mac's primary network interface.
# This ensures the Talos cluster can always reach Ollama at a known address.
#
# NOTE: Prefer setting a DHCP reservation on your router instead of this script.
# Router-side DHCP reservation is more reliable across reboots and network changes.

TARGET_IP="${1:-192.168.1.33}"
SUBNET="255.255.255.0"
ROUTER="192.168.1.1"
DNS="192.168.1.1 1.1.1.1 8.8.8.8"

# Detect primary network service (usually "Wi-Fi" or "Ethernet")
PRIMARY_SERVICE=$(networksetup -listnetworkserviceorder | grep -A1 "Hardware Port" | head -4 | grep -oP '(?<=\().*(?=,)' | head -1)
if [[ -z "$PRIMARY_SERVICE" ]]; then
  # Fallback: try common names
  for svc in "Ethernet" "Wi-Fi" "USB 10/100/1000 LAN"; do
    if networksetup -getinfo "$svc" &>/dev/null; then
      PRIMARY_SERVICE="$svc"
      break
    fi
  done
fi

if [[ -z "$PRIMARY_SERVICE" ]]; then
  echo "Could not detect network service. Available services:"
  networksetup -listallnetworkservices
  echo ""
  echo "Usage: $0 <ip> <network-service>"
  exit 1
fi

echo "Setting static IP on '$PRIMARY_SERVICE':"
echo "  IP:      $TARGET_IP"
echo "  Subnet:  $SUBNET"
echo "  Router:  $ROUTER"
echo "  DNS:     $DNS"
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

sudo networksetup -setmanual "$PRIMARY_SERVICE" "$TARGET_IP" "$SUBNET" "$ROUTER"
sudo networksetup -setdnsservers "$PRIMARY_SERVICE" $DNS

echo ""
echo "Static IP configured. Verify with:"
echo "  networksetup -getinfo '$PRIMARY_SERVICE'"
echo ""
echo "To revert to DHCP:"
echo "  sudo networksetup -setdhcp '$PRIMARY_SERVICE'"
