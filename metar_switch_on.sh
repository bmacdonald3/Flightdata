#!/bin/bash
STATE_FILE="$HOME/metar_state.json"
if [ -f "$STATE_FILE" ]; then
    jq '.collector_enabled = true' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
fi
echo "ON"
