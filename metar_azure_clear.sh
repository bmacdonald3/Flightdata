#!/bin/bash

# metar_azure_clear.sh - Clear all METAR observations from Azure

# Called by Home Assistant via SSH

# WARNING: This deletes all METAR data!

# Load environment variables

set -a
source “$HOME/.env”
set +a

STATE_FILE=”$HOME/metar_state.json”

# Clear Azure tables

python3 << ‘EOF’
import os
import pyodbc

AZURE_CONN_STR = (
f”DRIVER={{ODBC Driver 18 for SQL Server}};”
f”SERVER=flight-data-server-macdonaldfamily.database.windows.net;”
f”DATABASE=Flightdata;”
f”UID=flightadmin;”
f”PWD={os.environ[‘AZURE_PASSWORD’]};”
f”Encrypt=yes;”
f”TrustServerCertificate=no;”
f”Connection Timeout=30;”
)

try:
conn = pyodbc.connect(AZURE_CONN_STR)
cursor = conn.cursor()

```
# Clear observations
cursor.execute("DELETE FROM metar_observations")
conn.commit()

# Clear fetch log
cursor.execute("DELETE FROM metar_fetch_log")
conn.commit()

print("OK")
cursor.close()
conn.close()
```

except Exception as e:
print(f”Error: {e}”)
EOF

# Reset state file counters

if [ -f “$STATE_FILE” ]; then
jq ‘.total_fetches = 0 | .total_observations = 0 | .session_fetches = 0 | .session_observations = 0 | .updated_at = (now | todate)’ “$STATE_FILE” > “${STATE_FILE}.tmp” && mv “${STATE_FILE}.tmp” “$STATE_FILE”
fi

echo “METAR data cleared”
