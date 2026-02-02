#!/bin/bash
# metar_status.sh - Get full METAR collector status as JSON
STATE_FILE="$HOME/metar_state.json"
if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE"
else
    echo '{"collector_enabled": true, "collector_running": false, "total_fetches": 0, "total_observations": 0}'
fi
