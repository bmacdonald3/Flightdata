#!/bin/bash
python3 -c "
import sys, os; sys.path.insert(0, os.path.expanduser('~'))
from config import *
import pyodbc
try:
    conn = pyodbc.connect(AZURE_CONN_STR)
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) FROM flights')
    print(cursor.fetchone()[0])
    conn.close()
except:
    print(-1)
"
