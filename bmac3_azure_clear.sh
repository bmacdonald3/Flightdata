#!/bin/bash
cd ~
python3 << 'EOF'
import sys
import json
sys.path.insert(0, '/home/bmacdonald3')
from config import AZURE_CONN_STR
import pyodbc

# Clear Azure
conn = pyodbc.connect(AZURE_CONN_STR)
cursor = conn.cursor()
cursor.execute("DELETE FROM flights")
count = cursor.rowcount
conn.commit()
conn.close()

# Reset state counter
state_file = '/home/bmacdonald3/bmac3_state.json'
with open(state_file, 'r') as f:
    state = json.load(f)
state['total_rows_uploaded'] = 0
state['last_upload_count'] = 0
with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)

print(f"DELETED {count} rows, counter reset")
EOF
