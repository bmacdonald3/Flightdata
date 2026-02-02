#!/bin/bash
# metar_switch_on.sh - Enable METAR collector
# Called by Home Assistant via SSH

STATE_FILE="$HOME/metar_state.json"

if [ -f "$STATE_FILE" ]; then
    # Use jq to update the enabled flag
    jq '.collector_enabled = true | .updated_at = (now | todate)' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
else
    # Create initial state file
    echo '{"collector_enabled": true, "updated_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "$STATE_FILE"
fi

echo "ON"
