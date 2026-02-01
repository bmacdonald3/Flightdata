#!/bin/bash

# ================================================================

# BMAC3 Flight Tracker - Setup Script

# Run this ONCE to set everything up on the Pi

# ================================================================

echo “=== BMAC3 Flight Tracker Setup ===”

BMAC3_DIR=”$HOME/FlightData”
USER=$(whoami)

# ── Create systemd service files ──────────────────────

# Collector service

sudo tee /etc/systemd/system/bmac3-collector.service > /dev/null <<EOF
[Unit]
Description=BMAC3 SWIM Flight Data Collector
After=network-online.target
Wants=network-online.target

[Service]
User=${USER}
WorkingDirectory=${HOME}
ExecStart=/usr/bin/python3 ${BMAC3_DIR}/collector.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Parser service

sudo tee /etc/systemd/system/bmac3-parser.service > /dev/null <<EOF
[Unit]
Description=BMAC3 Flight Data Parser & Azure Uploader
After=network-online.target bmac3-collector.service
Wants=network-online.target

[Service]
User=${USER}
WorkingDirectory=${HOME}
ExecStart=/usr/bin/python3 ${BMAC3_DIR}/parser.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Home Assistant API service

sudo tee /etc/systemd/system/bmac3-ha.service > /dev/null <<EOF
[Unit]
Description=BMAC3 Home Assistant API
After=network-online.target

[Service]
User=${USER}
WorkingDirectory=${HOME}
ExecStart=/usr/bin/python3 ${BMAC3_DIR}/ha_integration.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Auto-pull service (pulls changes from GitHub)

sudo tee /etc/systemd/system/bmac3-autopull.service > /dev/null <<EOF
[Unit]
Description=BMAC3 GitHub Auto-Pull
After=network-online.target
Wants=network-online.target

[Service]
User=${USER}
WorkingDirectory=${BMAC3_DIR}
ExecStart=/usr/bin/python3 ${BMAC3_DIR}/auto_pull.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# ── Enable and start services ─────────────────────────

sudo systemctl daemon-reload
sudo systemctl enable bmac3-collector.service
sudo systemctl enable bmac3-parser.service
sudo systemctl enable bmac3-ha.service
sudo systemctl enable bmac3-autopull.service

sudo systemctl start bmac3-ha.service
sudo systemctl start bmac3-collector.service
sudo systemctl start bmac3-parser.service
sudo systemctl start bmac3-autopull.service

echo “”
echo “=== Services Status ===”
sudo systemctl status bmac3-collector.service –no-pager
sudo systemctl status bmac3-parser.service –no-pager
sudo systemctl status bmac3-ha.service –no-pager
sudo systemctl status bmac3-autopull.service –no-pager

echo “”
echo “=== Setup Complete ===”
echo “Services will start automatically on boot.”
echo “Edit code on GitHub → Pi pulls changes automatically every 5 min”
echo “Control via Home Assistant or:”
echo “  sudo systemctl start/stop bmac3-collector”
echo “  sudo systemctl start/stop bmac3-parser”
echo “  curl http://localhost:8123/state”
echo “  curl -X POST http://localhost:8123/enable”
echo “  curl -X POST http://localhost:8123/disable”
