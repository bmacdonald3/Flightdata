#!/bin/bash
# metar_azure_count.sh - Get total METAR observations in Azure
# Called by Home Assistant via SSH

# Load environment variables
set -a
source "$HOME/.env"
set +a

# Query Azure SQL for count
python3 << 'EOF'
import os
import pymssql

try:
    conn = pymssql.connect(
        server=os.environ.get('AZURE_SERVER', 'flight-data-server-macdonaldfamily.database.windows.net'),
        user=os.environ['AZURE_USER'],
        password=os.environ['AZURE_PASSWORD'],
        database=os.environ.get('AZURE_DATABASE', 'Flightdata'),
        tds_version='7.3'
    )
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM metar_observations")
    count = cursor.fetchone()[0]
    print(count)
    cursor.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
EOF
