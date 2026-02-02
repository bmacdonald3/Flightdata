#!/bin/bash
# metar_azure_clear.sh - Clear all METAR observations from Azure
# Called by Home Assistant via SSH
# WARNING: This deletes all METAR data!

# Load environment variables
set -a
source "$HOME/.env"
set +a

STATE_FILE="$HOME/metar_state.json"

# Clear Azure tables
python3 << 'EOF'
import os
import pymssql

try:
    conn = pymssql.connect(
        server=os.environ.get('AZURE_SERVER', 'flight-data-server-macdonaldfamily.database.windows.net'),
        user=os.environ['AZURE_USER'],
        password=os.environ['AZURE_PASSWORD'],
        database=os.environ.get('AZURE_DATABASE', 'Flightdata'),
        tds_version='7.3',
        autocommit=True
    )
    cursor = conn.cursor()
    
    # Clear observations
    cursor.execute("DELETE FROM metar_observations")
    
    # Clear fetch log
    cursor.execute("DELETE FROM metar_fetch_log")
    
    print("OK")
    cursor.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
EOF

# Reset state file counters
if [ -f "$STATE_FILE" ]; then
    jq '.total_fetches = 0 | .total_observations = 0 | .session_fetches = 0 | .session_observations = 0 | .updated_at = (now | todate)' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
fi

echo "METAR data cleared"
