#!/bin/bash
export AZURE_PASSWORD=$(grep AZURE_PASSWORD ~/.env | cut -d'=' -f2)
python3 << 'PYEOF'
import os
import pyodbc
conn = pyodbc.connect(
    f"DRIVER={{ODBC Driver 18 for SQL Server}};"
    f"SERVER=flight-data-server-macdonaldfamily.database.windows.net;"
    f"DATABASE=Flightdata;"
    f"UID=flightadmin;"
    f"PWD={os.environ['AZURE_PASSWORD']};"
    f"Encrypt=yes;"
    f"TrustServerCertificate=no;"
    f"Connection Timeout=30;"
)
cursor = conn.cursor()
cursor.execute("SELECT COUNT(*) FROM flights")
print(cursor.fetchone()[0])
cursor.close()
conn.close()
PYEOF
