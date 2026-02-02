#!/bin/bash

# metar_azure_count.sh - Get total METAR observations in Azure

# Called by Home Assistant via SSH

# Load environment variables

set -a
source “$HOME/.env”
set +a

# Query Azure SQL for count

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
cursor.execute(“SELECT COUNT(*) FROM metar_observations”)
count = cursor.fetchone()[0]
print(count)
cursor.close()
conn.close()
except Exception as e:
print(f”Error: {e}”)
EOF
