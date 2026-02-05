#!/usr/bin/env python3
"""
Update approach benchmarks from scored flight data.
Run after batch scoring to refresh statistics.
"""

import pymssql
import sys
import os

sys.path.insert(0, os.path.expanduser('~'))
from config import AZURE_SERVER, AZURE_DATABASE, AZURE_USERNAME, AZURE_PASSWORD

def get_conn():
    return pymssql.connect(
        server=AZURE_SERVER, user=AZURE_USERNAME, password=AZURE_PASSWORD,
        database=AZURE_DATABASE, tds_version='7.3', autocommit=True
    )

def update_benchmarks():
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    
    print("Updating approach benchmarks...")
    
    # Clear existing benchmarks
    cursor.execute("DELETE FROM approach_benchmarks")
    
    # 1. Benchmarks by aircraft type
    cursor.execute("""
        INSERT INTO approach_benchmarks (
            benchmark_type, benchmark_key, flight_count,
            avg_percentage, min_percentage, max_percentage,
            grade_a, grade_b, grade_c, grade_d, grade_f,
            avg_descent, avg_stabilized, avg_centerline,
            avg_turn_to_final, avg_speed_control, avg_threshold
        )
        SELECT 
            'ac_type', ac_type, COUNT(*),
            AVG(CAST(percentage as DECIMAL(5,2))),
            MIN(percentage), MAX(percentage),
            SUM(CASE WHEN grade = 'A' THEN 1 ELSE 0 END),
            SUM(CASE WHEN grade = 'B' THEN 1 ELSE 0 END),
            SUM(CASE WHEN grade = 'C' THEN 1 ELSE 0 END),
            SUM(CASE WHEN grade = 'D' THEN 1 ELSE 0 END),
            SUM(CASE WHEN grade = 'F' THEN 1 ELSE 0 END),
            AVG(CAST(descent_score as DECIMAL(5,2))),
            AVG(CAST(stabilized_score as DECIMAL(5,2))),
            AVG(CAST(centerline_score as DECIMAL(5,2))),
            AVG(CAST(turn_to_final_score as DECIMAL(5,2))),
            AVG(CAST(speed_control_score as DECIMAL(5,2))),
            AVG(CAST(threshold_score as DECIMAL(5,2)))
        FROM approach_scores
        WHERE ac_type IS NOT NULL
        GROUP BY ac_type
    """)
    cursor.execute("SELECT COUNT(*) as cnt FROM approach_benchmarks WHERE benchmark_type = 'ac_type'")
    print(f"  Aircraft types: {cursor.fetchone()['cnt']}")
    
    # 2. Benchmarks by airport
    cursor.execute("""
        INSERT INTO approach_benchmarks (
            benchmark_type, benchmark_key, flight_count,
            avg_percentage, min_percentage, max_percentage,
            grade_a, grade_b, grade_c, grade_d, grade_f,
            avg_descent, avg_stabilized, avg_centerline,
            avg_turn_to_final, avg_speed_control, avg_threshold
        )
        SELECT 
            'airport', arr_airport, COUNT(*),
            AVG(CAST(percentage as DECIMAL(5,2))),
            MIN(percentage), MAX(percentage),
            SUM(CASE WHEN grade = 'A' THEN 1 ELSE 0 END),
            SUM(CASE WHEN grade = 'B' THEN 1 ELSE 0 END),
            SUM(CASE WHEN grade = 'C' THEN 1 ELSE 0 END),
            SUM(CASE WHEN grade = 'D' THEN 1 ELSE 0 END),
            SUM(CASE WHEN grade = 'F' THEN 1 ELSE 0 END),
            AVG(CAST(descent_score as DECIMAL(5,2))),
            AVG(CAST(stabilized_score as DECIMAL(5,2))),
            AVG(CAST(centerline_score as DECIMAL(5,2))),
            AVG(CAST(turn_to_final_score as DECIMAL(5,2))),
            AVG(CAST(speed_control_score as DECIMAL(5,2))),
            AVG(CAST(threshold_score as DECIMAL(5,2)))
        FROM approach_scores
        WHERE arr_airport IS NOT NULL
        GROUP BY arr_airport
    """)
    cursor.execute("SELECT COUNT(*) as cnt FROM approach_benchmarks WHERE benchmark_type = 'airport'")
    print(f"  Airports: {cursor.fetchone()['cnt']}")
    
    # 3. Benchmarks by callsign (pilot/aircraft)
    cursor.execute("""
        INSERT INTO approach_benchmarks (
            benchmark_type, benchmark_key, flight_count,
            avg_percentage, min_percentage, max_percentage,
            grade_a, grade_b, grade_c, grade_d, grade_f,
            avg_descent, avg_stabilized, avg_centerline,
            avg_turn_to_final, avg_speed_control, avg_threshold
        )
        SELECT 
            'callsign', callsign, COUNT(*),
            AVG(CAST(percentage as DECIMAL(5,2))),
            MIN(percentage), MAX(percentage),
            SUM(CASE WHEN grade = 'A' THEN 1 ELSE 0 END),
            SUM(CASE WHEN grade = 'B' THEN 1 ELSE 0 END),
            SUM(CASE WHEN grade = 'C' THEN 1 ELSE 0 END),
            SUM(CASE WHEN grade = 'D' THEN 1 ELSE 0 END),
            SUM(CASE WHEN grade = 'F' THEN 1 ELSE 0 END),
            AVG(CAST(descent_score as DECIMAL(5,2))),
            AVG(CAST(stabilized_score as DECIMAL(5,2))),
            AVG(CAST(centerline_score as DECIMAL(5,2))),
            AVG(CAST(turn_to_final_score as DECIMAL(5,2))),
            AVG(CAST(speed_control_score as DECIMAL(5,2))),
            AVG(CAST(threshold_score as DECIMAL(5,2)))
        FROM approach_scores
        WHERE callsign IS NOT NULL
        GROUP BY callsign
    """)
    cursor.execute("SELECT COUNT(*) as cnt FROM approach_benchmarks WHERE benchmark_type = 'callsign'")
    print(f"  Callsigns: {cursor.fetchone()['cnt']}")
    
    # Summary
    cursor.execute("SELECT COUNT(*) as total FROM approach_benchmarks")
    print(f"\nTotal benchmarks: {cursor.fetchone()['total']}")
    
    # Show top aircraft types
    print("\nTop Aircraft Types by Avg Score:")
    cursor.execute("""
        SELECT TOP 10 benchmark_key, flight_count, avg_percentage
        FROM approach_benchmarks 
        WHERE benchmark_type = 'ac_type' AND flight_count >= 2
        ORDER BY avg_percentage DESC
    """)
    print(f"  {'Type':<20} {'Flights':>8} {'Avg %':>8}")
    print("  " + "-" * 40)
    for r in cursor.fetchall():
        print(f"  {r['benchmark_key']:<20} {r['flight_count']:>8} {r['avg_percentage']:>8.1f}")
    
    conn.close()
    print("\nDone!")

if __name__ == '__main__':
    update_benchmarks()
