#!/bin/bash
# metar_status.sh - Get full METAR collector status as JSON
# Called by Home Assistant via SSH

STATE_FILE="$HOME/metar_state.json"

if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE"
else
    # Return default state
    echo '{"collector_enabled": true, "collector_running": false, "total_fetches": 0, "total_observations": 0}'
fi
