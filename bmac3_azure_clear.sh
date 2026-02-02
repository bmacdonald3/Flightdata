#!/bin/bash
cd ~
python3 << 'EOF'
import sys
sys.path.insert(0, '/home/bmacdonald3')
from config import AZURE_CONN_STR
import pyodbc
conn = pyodbc.connect(AZURE_CONN_STR)
cursor = conn.cursor()
cursor.execute("DELETE FROM flights")
count = cursor.rowcount
conn.commit()
conn.close()
print(f"DELETED {count} rows")
EOF
