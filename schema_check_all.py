#!/usr/bin/env python3
"""Dynamic schema checker - shows ALL tables automatically"""

import sys
sys.path.insert(0, '/home/bmacdonald3')
import config
import pyodbc

conn_str = (
    f"DRIVER={{ODBC Driver 18 for SQL Server}};"
    f"SERVER={config.AZURE_SERVER};"
    f"DATABASE={config.AZURE_DATABASE};"
    f"UID={config.AZURE_USERNAME};"
    f"PWD={config.AZURE_PASSWORD};"
    f"Encrypt=yes;"
    f"TrustServerCertificate=no;"
)

print("\n" + "=" * 80)
print("AZURE SQL DATABASE - COMPLETE SCHEMA")
print("=" * 80)
conn = pyodbc.connect(conn_str)
cursor = conn.cursor()
print("✓ Connected!\n")

# Get all tables
cursor.execute("""
    SELECT TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_TYPE='BASE TABLE' 
    ORDER BY TABLE_NAME
""")
tables = [row[0] for row in cursor.fetchall()]

# Show summary first
print("=" * 80)
print("DATABASE SUMMARY")
print("=" * 80)
for table in tables:
    cursor.execute(f"SELECT COUNT(*) FROM [{table}]")
    count = cursor.fetchone()[0]
    print(f"  • {table:<40} {count:,} rows")

print("\n")

# Show detailed schema for each table
for table_name in tables:
    print("=" * 80)
    print(f"{table_name.upper()} TABLE SCHEMA")
    print("=" * 80)
    
    cursor.execute(f"""
        SELECT 
            ORDINAL_POSITION, 
            COLUMN_NAME, 
            DATA_TYPE, 
            CHARACTER_MAXIMUM_LENGTH, 
            IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME='{table_name}' 
        ORDER BY ORDINAL_POSITION
    """)
    
    print(f"{'#':<4} {'Column Name':<30} {'Type':<20} {'Max Len':<10} {'Nullable'}")
    print("-" * 80)
    
    for row in cursor.fetchall():
        pos, col, dtype, maxlen, nullable = row
        maxlen_str = str(maxlen) if maxlen else '-'
        print(f"{pos:<4} {col:<30} {dtype:<20} {maxlen_str:<10} {nullable}")
    
    print()

# Show some statistics for major tables
print("=" * 80)
print("KEY STATISTICS")
print("=" * 80)

# Flights
if 'flights' in tables:
    try:
        cursor.execute("""
            SELECT 
                COUNT(*) as total,
                MIN(timestamp) as earliest,
                MAX(timestamp) as latest
            FROM flights
        """)
        row = cursor.fetchone()
        print(f"\nFlights:")
        print(f"  Total rows:     {row[0]:,}")
        print(f"  Date range:     {row[1]} to {row[2]}")
    except:
        pass

# METAR
if 'metar_observations' in tables:
    try:
        cursor.execute("""
            SELECT 
                COUNT(*) as total,
                COUNT(DISTINCT station_id) as stations,
                MIN(observation_time) as earliest,
                MAX(observation_time) as latest
            FROM metar_observations
        """)
        row = cursor.fetchone()
        print(f"\nMETAR Observations:")
        print(f"  Total rows:     {row[0]:,}")
        print(f"  Stations:       {row[1]:,}")
        print(f"  Date range:     {row[2]} to {row[3]}")
    except:
        pass

# Aircraft
if 'aircraft' in tables:
    try:
        cursor.execute("SELECT COUNT(*) FROM aircraft")
        count = cursor.fetchone()[0]
        print(f"\nAircraft:")
        print(f"  Total rows:     {count:,}")
    except:
        pass

# Airports
if 'airports' in tables:
    try:
        cursor.execute("SELECT COUNT(*) FROM airports")
        count = cursor.fetchone()[0]
        print(f"\nAirports:")
        print(f"  Total rows:     {count:,}")
    except:
        pass

cursor.close()
conn.close()

print("\n" + "=" * 80)
print("✓ Complete schema inspection finished!")
print("=" * 80 + "\n")
