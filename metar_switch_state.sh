#!/bin/bash
STATE_FILE="$HOME/metar_state.json"
if [ -f "$STATE_FILE" ]; then
    ENABLED=$(jq -r ".collector_enabled" "$STATE_FILE")
    if [ "$ENABLED" = "true" ]; then
        echo "ON"
    else
        echo "OFF"
    fi
else
    echo "ON"
fi
