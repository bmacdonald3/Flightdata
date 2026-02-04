#!/usr/bin/env python3
"""Flight Data Prep API"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import pymssql
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.expanduser('~'))
from config import AZURE_SERVER, AZURE_DATABASE, AZURE_USERNAME, AZURE_PASSWORD

app = Flask(__name__)
CORS(app)

def get_conn():
    return pymssql.connect(
        server=AZURE_SERVER, user=AZURE_USERNAME, password=AZURE_PASSWORD,
        database=AZURE_DATABASE, tds_version='7.3', autocommit=True
    )

@app.route('/api/flights', methods=['GET'])
def list_flights():
    date = request.args.get('date')
    sql = """
        SELECT 
            f.gufi, f.callsign, f.departure, f.arrival,
            CAST(MIN(f.position_time) AS DATE) as flight_date,
            MIN(f.position_time) as first_seen,
            MAX(f.position_time) as last_seen,
            DATEDIFF(MINUTE, MIN(f.position_time), MAX(f.position_time)) as duration_minutes,
            COUNT(*) as point_count,
            MAX(a.manufacturer) as manufacturer,
            MAX(a.model) as model,
            MAX(a.aircraft_type) as aircraft_type
        FROM flights f
        LEFT JOIN aircraft a ON f.callsign = a.n_number
        WHERE f.gufi IS NOT NULL AND f.callsign LIKE 'N%'
    """
    if date:
        sql += f" AND CAST(f.position_time AS DATE) = '{date}'"
    sql += " GROUP BY f.gufi, f.callsign, f.departure, f.arrival ORDER BY MIN(f.position_time) DESC"
    
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    cursor.execute(sql)
    flights = cursor.fetchall()
    conn.close()
    
    for f in flights:
        for k, v in f.items():
            if isinstance(v, datetime):
                f[k] = v.isoformat()
    return jsonify(flights)

@app.route('/api/track', methods=['GET'])
def get_flight_track():
    """Get track points for a specific flight by gufi query param"""
    gufi = request.args.get('gufi')
    if not gufi:
        return jsonify({'error': 'gufi parameter required'}), 400
    
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    cursor.execute("""
        SELECT position_time, latitude, longitude, altitude, speed, track, vertical_speed,
               status, operator, center, computer_id, departure_actual_time, arrival_estimated_time,
               assigned_altitude, assigned_altitude_type, controlling_unit, controlling_sector,
               flight_plan_id, mode_s
        FROM flights WHERE gufi = %s ORDER BY position_time
    """, (gufi,))
    points = cursor.fetchall()
    conn.close()
    
    for p in points:
        for k, v in p.items():
            if isinstance(v, datetime):
                p[k] = v.isoformat()
    return jsonify({'points': points})

@app.route('/api/stage', methods=['POST'])
def stage_flight():
    data = request.json
    gufi = data.get('gufi')
    
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    
    cursor.execute("""
        SELECT callsign, departure, arrival,
               MIN(position_time) as first_seen, MAX(position_time) as last_seen,
               DATEDIFF(MINUTE, MIN(position_time), MAX(position_time)) as duration
        FROM flights WHERE gufi = %s
        GROUP BY callsign, departure, arrival
    """, (gufi,))
    flight = cursor.fetchone()
    
    if not flight:
        conn.close()
        return jsonify({'error': 'Flight not found'}), 404
    
    callsign = flight['callsign']
    cursor.execute("SELECT manufacturer, model, aircraft_type FROM aircraft WHERE n_number = %s", (callsign,))
    aircraft = cursor.fetchone() or {}
    
    cursor.execute("DELETE FROM staged_metars")
    cursor.execute("DELETE FROM staged_track_points")  
    cursor.execute("DELETE FROM staged_flights")
    
    cursor.execute("""
        INSERT INTO staged_flights 
        (gufi, callsign, aircraft_type, manufacturer, model, dep_airport, arr_airport, flight_date, duration_minutes)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (gufi, callsign, aircraft.get('aircraft_type'), aircraft.get('manufacturer'),
          aircraft.get('model'), flight['departure'], flight['arrival'],
          flight['first_seen'].date() if flight['first_seen'] else None, flight['duration']))
    
    cursor.execute("SELECT MAX(id) as id FROM staged_flights")
    staged_id = cursor.fetchone()['id']
    
    cursor.execute("""
        INSERT INTO staged_track_points 
        (staged_flight_id, position_time, latitude, longitude, altitude, speed, track, vertical_speed)
        SELECT %s, position_time, latitude, longitude, altitude, speed, track, vertical_speed
        FROM flights WHERE gufi = %s ORDER BY position_time
    """, (staged_id, gufi))
    
    airports = [a for a in [flight['departure'], flight['arrival']] if a]
    if airports and flight['first_seen']:
        start = flight['first_seen'] - timedelta(hours=1)
        end = flight['last_seen'] + timedelta(hours=1)
        placeholders = ','.join(['%s'] * len(airports))
        cursor.execute(f"""
            INSERT INTO staged_metars
            (staged_flight_id, airport_icao, observation_time, altimeter_inhg, temp_c, 
             wind_dir_degrees, wind_speed_kt, visibility_miles, raw_text)
            SELECT %s, a.icao_code, m.observation_time, m.altimeter_inhg, m.temp_c,
                   m.wind_dir_degrees, m.wind_speed_kt, m.visibility_miles, m.raw_text
            FROM metar_observations m
            JOIN airports a ON m.airport_id = a.airport_id
            WHERE a.icao_code IN ({placeholders})
              AND m.observation_time BETWEEN %s AND %s
        """, (staged_id, *airports, start, end))
    
    conn.close()
    return jsonify({'success': True, 'staged_flight_id': staged_id, 'callsign': callsign, 'aircraft': aircraft})

@app.route('/api/staged', methods=['GET'])
def get_staged():
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    
    cursor.execute("SELECT * FROM staged_flights ORDER BY id DESC")
    flight = cursor.fetchone()
    
    if not flight:
        conn.close()
        return jsonify({'error': 'No staged flight'}), 404
    
    cursor.execute("SELECT * FROM staged_track_points WHERE staged_flight_id = %s ORDER BY position_time", (flight['id'],))
    points = cursor.fetchall()
    
    cursor.execute("SELECT * FROM staged_metars WHERE staged_flight_id = %s ORDER BY observation_time", (flight['id'],))
    metars = cursor.fetchall()
    conn.close()
    
    for obj in [flight] + points + metars:
        for k, v in obj.items():
            if isinstance(v, datetime):
                obj[k] = v.isoformat()
    
    return jsonify({'flight': flight, 'track': points, 'metars': metars})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002, debug=True)
