#!/bin/bash
LOG_FILE="$HOME/metar.log"
LINES=${1:-5}
if [ -f "$LOG_FILE" ]; then
    tail -n "$LINES" "$LOG_FILE"
else
    echo "No log file found"
fi
