#!/usr/bin/env python3
"""Flight Data Prep API"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import pymssql
import sys
import os
import math
from datetime import datetime, timedelta

sys.path.insert(0, os.path.expanduser('~'))
from config import AZURE_SERVER, AZURE_DATABASE, AZURE_USERNAME, AZURE_PASSWORD

app = Flask(__name__)
CORS(app)

# Airport elevations (approximate) - add more as needed
AIRPORT_ELEVATIONS = {
    'KJFK': 13, 'KLGA': 21, 'KEWR': 18, 'KTEB': 9, 'KHPN': 439,
    'KBDR': 10, 'KHVN': 14, 'KGON': 10, 'KDXR': 457, 'KOXC': 726,
    'KSWF': 491, 'KCDW': 173, 'KMMU': 187, 'KFOK': 67, 'KISP': 99,
    'KFRG': 80, 'KPOU': 165, 'KPNC': 13, 'KLOM': 302,
}

def get_conn():
    return pymssql.connect(
        server=AZURE_SERVER, user=AZURE_USERNAME, password=AZURE_PASSWORD,
        database=AZURE_DATABASE, tds_version='7.3', autocommit=True
    )

def determine_flight_status(last_alt, last_speed, last_vs, arrival_airport):
    """Determine if flight is Enroute, Approach, or Landed"""
    if last_alt is None or last_speed is None:
        return 'Unknown'
    
    # Get airport elevation (default 0 if unknown)
    field_elev = AIRPORT_ELEVATIONS.get(arrival_airport, 0)
    agl = last_alt - field_elev
    
    # Landed: Below 200 AGL and slow
    if agl < 200 and last_speed < 50:
        return 'Landed'
    
    # Approach: Descending, below 3000 AGL, moderate speed
    if agl < 3000 and last_vs is not None and last_vs < -200:
        return 'Approach'
    
    # Low altitude but not descending much - pattern/maneuvering
    if agl < 2000 and last_speed < 150:
        return 'Pattern'
    
    # Otherwise enroute
    return 'Enroute'

def calculate_derivatives(points):
    """Calculate acceleration, turn rate, and vertical acceleration for each point"""
    if len(points) < 2:
        return points
    
    for i in range(len(points)):
        points[i]['accel'] = None
        points[i]['turn_rate'] = None
        points[i]['vert_accel'] = None
        
        if i == 0:
            continue
            
        prev = points[i-1]
        curr = points[i]
        
        try:
            t1 = datetime.fromisoformat(prev['position_time'].replace('Z', '+00:00'))
            t2 = datetime.fromisoformat(curr['position_time'].replace('Z', '+00:00'))
            dt = (t2 - t1).total_seconds()
        except:
            continue
            
        if dt <= 0 or dt > 120:
            continue
        
        if prev.get('speed') is not None and curr.get('speed') is not None:
            accel = (curr['speed'] - prev['speed']) / dt
            curr['accel'] = round(accel, 2)
        
        if prev.get('track') is not None and curr.get('track') is not None:
            try:
                track1 = float(prev['track'])
                track2 = float(curr['track'])
                diff = track2 - track1
                if diff > 180:
                    diff -= 360
                elif diff < -180:
                    diff += 360
                turn_rate = diff / dt
                curr['turn_rate'] = round(turn_rate, 2)
            except:
                pass
        
        if prev.get('vertical_speed') is not None and curr.get('vertical_speed') is not None:
            vert_accel = (curr['vertical_speed'] - prev['vertical_speed']) / dt
            curr['vert_accel'] = round(vert_accel, 1)
    
    return points

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
    
    # Get last point data for each flight to determine status
    for f in flights:
        cursor.execute("""
            SELECT TOP 1 altitude, speed, vertical_speed
            FROM flights WHERE gufi = %s
            ORDER BY position_time DESC
        """, (f['gufi'],))
        last = cursor.fetchone()
        if last:
            f['last_altitude'] = last['altitude']
            f['last_speed'] = last['speed']
            f['flight_status'] = determine_flight_status(
                last['altitude'], last['speed'], last['vertical_speed'], f['arrival']
            )
        else:
            f['flight_status'] = 'Unknown'
    
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
    
    points = calculate_derivatives(points)
    
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
    
    # Get last point for status
    cursor.execute("""
        SELECT TOP 1 altitude, speed, vertical_speed
        FROM flights WHERE gufi = %s
        ORDER BY position_time DESC
    """, (gufi,))
    last = cursor.fetchone()
    flight_status = 'Unknown'
    if last:
        flight_status = determine_flight_status(
            last['altitude'], last['speed'], last['vertical_speed'], flight['arrival']
        )
    
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
    return jsonify({
        'success': True, 
        'staged_flight_id': staged_id, 
        'callsign': callsign, 
        'aircraft': aircraft,
        'flight_status': flight_status
    })

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
    
    # Determine flight status from last point
    if points:
        last = points[-1]
        flight['flight_status'] = determine_flight_status(
            last.get('altitude'), last.get('speed'), last.get('vertical_speed'), flight.get('arr_airport')
        )
        flight['last_altitude'] = last.get('altitude')
        flight['last_speed'] = last.get('speed')
    else:
        flight['flight_status'] = 'Unknown'
    
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
