#!/bin/bash
# metar_switch_state.sh - Check if METAR collector is enabled
# Called by Home Assistant via SSH

STATE_FILE="$HOME/metar_state.json"

if [ -f "$STATE_FILE" ]; then
    ENABLED=$(jq -r '.collector_enabled // true' "$STATE_FILE")
    if [ "$ENABLED" = "true" ]; then
        echo "ON"
    else
        echo "OFF"
    fi
else
    echo "ON"  # Default to enabled if no state file
fi
