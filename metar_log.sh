#!/bin/bash
# metar_log.sh - Get recent METAR collector log entries
# Called by Home Assistant via SSH

LOG_FILE="$HOME/metar.log"
LINES=${1:-5}

if [ -f "$LOG_FILE" ]; then
    tail -n "$LINES" "$LOG_FILE" | while read line; do
        # Extract timestamp and message, format for HA
        echo "$line"
    done
else
    echo "No log file found"
fi
