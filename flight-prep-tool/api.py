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

AIRPORT_ELEVATIONS = {
    'KJFK': 13, 'KLGA': 21, 'KEWR': 18, 'KTEB': 9, 'KHPN': 439,
    'KBDR': 10, 'KHVN': 14, 'KGON': 10, 'KDXR': 457, 'KOXC': 726,
    'KSWF': 491, 'KCDW': 173, 'KMMU': 187, 'KFOK': 67, 'KISP': 99,
    'KFRG': 80, 'KPOU': 165, 'KPNC': 13, 'KLOM': 302, 'KBOS': 20,
    'KPVD': 55, 'KALB': 285, 'KSYR': 421, 'KBUF': 728, 'KROC': 559,
    'KPWM': 76, 'KBGR': 192, 'KBTV': 335, 'KMHT': 266, 'KBED': 133,
    'KACK': 48, 'KMVY': 67, 'KHYA': 54, 'KHWV': 81, 'KTTN': 213,
    'KHFD': 18, 'KACY': 75, 'KPNE': 120, 'KRDG': 344, 'KABE': 393,
    'KAVP': 962, 'KBGM': 1636, 'KORH': 1009, 'KMDT': 310, 'KLNS': 403,
    'KITH': 1099, 'KELM': 954, 'KIPT': 529, 'KPSM': 100, 'KLEB': 603,
    'KCON': 342, 'KASH': 199, 'KLCI': 545, 'KEEN': 488, 'KRUT': 787,
    'KMPV': 1166, 'KMVL': 732, 'KDDH': 827, 'KVSF': 577, 'KAUG': 352,
    'KPQI': 534, 'KSFM': 244, 'KLEW': 288, 'KRKD': 56, 'KBHB': 83,
    'KSFZ': 441, 'KWST': 81, 'KOQU': 18, 'KUUU': 172, 'KEWB': 80,
    'KBVY': 107, 'KLWM': 148, 'KFIT': 348, 'KPYM': 148, 'KTAN': 43,
    'KPVC': 9, 'KIJD': 247, 'KBDL': 173, 'KPHL': 36,
}

def get_conn():
    return pymssql.connect(
        server=AZURE_SERVER, user=AZURE_USERNAME, password=AZURE_PASSWORD,
        database=AZURE_DATABASE, tds_version='7.3', autocommit=True
    )

def _bearing(lat1, lon1, lat2, lon2):
    """Compute initial bearing from point 1 to point 2 (degrees true)."""
    lat1, lon1, lat2, lon2 = (math.radians(x) for x in (lat1, lon1, lat2, lon2))
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    brg = math.degrees(math.atan2(x, y))
    return brg % 360

def determine_flight_status(last_alt, last_speed, last_vs, min_alt, arrival_airport, last_seen, now=None):
    """
    Determine flight status based on last point data and minimum altitude reached.

    Args:
        last_alt: Altitude at last position
        last_speed: Speed at last position
        last_vs: Vertical speed at last position
        min_alt: Minimum altitude seen in last N points
        arrival_airport: Destination airport
        last_seen: Timestamp of last position
        now: Current time (for staleness check)
    """
    if last_alt is None or last_speed is None:
        return 'Unknown'

    field_elev = AIRPORT_ELEVATIONS.get(arrival_airport, 0)
    last_agl = last_alt - field_elev
    min_agl = (min_alt - field_elev) if min_alt else last_agl

    # Check if data is stale (no update in 5+ minutes)
    if now is None:
        now = datetime.utcnow()
    if isinstance(last_seen, str):
        try:
            last_seen = datetime.fromisoformat(last_seen.replace('Z', '+00:00')).replace(tzinfo=None)
        except:
            last_seen = now

    minutes_since_update = (now - last_seen).total_seconds() / 60 if last_seen else 0

    # LANDED: Data went stale while aircraft was low (< 500 AGL)
    # Radar typically loses aircraft below 200-500 AGL
    if minutes_since_update > 2 and min_agl < 500:
        return 'Landed'

    # LANDED: Very low and very slow (actually on ground)
    if last_agl < 100 and last_speed < 40:
        return 'Landed'

    # APPROACH: Descending, low altitude
    if last_agl < 3000 and last_vs is not None and last_vs < -200:
        return 'Approach'

    # PATTERN: Low altitude, slow, not descending fast (traffic pattern)
    if last_agl < 2000 and last_speed < 150 and (last_vs is None or last_vs > -500):
        return 'Pattern'

    # CLIMBING: Positive VS and gaining altitude after being low
    if last_vs is not None and last_vs > 300 and last_agl < 3000:
        return 'Departure'

    return 'Enroute'

def calculate_derivatives(points):
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
                if diff > 180: diff -= 360
                elif diff < -180: diff += 360
                curr['turn_rate'] = round(diff / dt, 2)
            except:
                pass
        if prev.get('vertical_speed') is not None and curr.get('vertical_speed') is not None:
            curr['vert_accel'] = round((curr['vertical_speed'] - prev['vertical_speed']) / dt, 1)
    return points

@app.route('/api/flights', methods=['GET'])
def list_flights():
    date = request.args.get('date')
    now = datetime.utcnow()

    # Single optimized query with min altitude from last 10 points
    sql = """
        WITH FlightSummary AS (
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
    sql += """
            GROUP BY f.gufi, f.callsign, f.departure, f.arrival
        ),
        LastPoints AS (
            SELECT gufi, altitude, speed, vertical_speed,
                   ROW_NUMBER() OVER (PARTITION BY gufi ORDER BY position_time DESC) as rn
            FROM flights
            WHERE gufi IN (SELECT gufi FROM FlightSummary)
        ),
        MinAltLast10 AS (
            SELECT gufi, MIN(altitude) as min_alt
            FROM LastPoints
            WHERE rn <= 10
            GROUP BY gufi
        )
        SELECT fs.*,
               lp.altitude as last_altitude, lp.speed as last_speed, lp.vertical_speed as last_vs,
               ma.min_alt
        FROM FlightSummary fs
        LEFT JOIN LastPoints lp ON fs.gufi = lp.gufi AND lp.rn = 1
        LEFT JOIN MinAltLast10 ma ON fs.gufi = ma.gufi
        ORDER BY fs.first_seen DESC
    """

    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    cursor.execute(sql)
    flights = cursor.fetchall()
    conn.close()

    for f in flights:
        f['flight_status'] = determine_flight_status(
            f.get('last_altitude'),
            f.get('last_speed'),
            f.get('last_vs'),
            f.get('min_alt'),
            f.get('arrival'),
            f.get('last_seen'),
            now
        )
        for k, v in f.items():
            if isinstance(v, datetime):
                f[k] = v.isoformat()

    return jsonify(flights[:300])

@app.route('/api/track', methods=['GET'])
def get_flight_track():
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

@app.route('/api/runways', methods=['GET'])
def get_runways():
    airport = request.args.get('airport')
    if not airport:
        return jsonify([])

    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    cursor.execute("SELECT * FROM v_runway_lookup WHERE icao_id = %s", (airport,))
    rows = cursor.fetchall()
    conn.close()

    runways = []
    for row in rows:
        # Build a runway entry for each end (base and reciprocal)
        for end, opp in [('be', 're'), ('re', 'be')]:
            lat = row.get(f'{end}_lat')
            lon = row.get(f'{end}_lon')
            opp_lat = row.get(f'{opp}_lat')
            opp_lon = row.get(f'{opp}_lon')

            if lat is None or lon is None:
                continue

            # Compute true heading from this threshold toward opposite end
            computed_hdg = None
            if opp_lat is not None and opp_lon is not None:
                computed_hdg = _bearing(lat, lon, opp_lat, opp_lon)

            faa_hdg = row.get(f'{end}_true_hdg')
            best_heading = computed_hdg if computed_hdg is not None else faa_hdg

            # Use displaced threshold coords if available, otherwise threshold
            disp_lat = row.get(f'{end}_displaced_lat')
            disp_lon = row.get(f'{end}_displaced_lon')
            th_lat = disp_lat if disp_lat else lat
            th_lon = disp_lon if disp_lon else lon

            runways.append({
                'airport_icao': row.get('icao_id'),
                'runway_id': row.get(f'{end}_id'),
                'threshold_lat': th_lat,
                'threshold_lon': th_lon,
                'heading': round(best_heading, 2) if best_heading is not None else faa_hdg,
                'faa_heading': faa_hdg,
                'computed_heading': round(computed_hdg, 2) if computed_hdg is not None else None,
                'elevation': row.get(f'{end}_tdze') or row.get('airport_elevation'),
                'glideslope': 3.0,
                'tch': 50,
                'length_ft': row.get('length_ft'),
                'width_ft': row.get('width_ft'),
                'surface_type': row.get('surface_type'),
                'ils_type': row.get(f'{end}_ils_type'),
                'displaced_ft': row.get(f'{end}_displaced_ft'),
                'facility_name': row.get('facility_name'),
            })

    return jsonify(runways)

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

    cursor.execute("""
        SELECT TOP 1 altitude, speed, vertical_speed
        FROM flights WHERE gufi = %s ORDER BY position_time DESC
    """, (gufi,))
    last = cursor.fetchone()

    cursor.execute("""
        SELECT MIN(altitude) as min_alt FROM (
            SELECT TOP 10 altitude FROM flights WHERE gufi = %s ORDER BY position_time DESC
        ) t
    """, (gufi,))
    min_row = cursor.fetchone()
    min_alt = min_row['min_alt'] if min_row else None

    flight_status = 'Unknown'
    if last:
        flight_status = determine_flight_status(
            last['altitude'], last['speed'], last['vertical_speed'],
            min_alt, flight['arrival'], flight['last_seen']
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

    if points:
        last = points[-1]
        # Get min altitude from last 10 points
        last_10 = points[-10:] if len(points) >= 10 else points
        min_alt = min(p.get('altitude') or 99999 for p in last_10)

        flight['flight_status'] = determine_flight_status(
            last.get('altitude'), last.get('speed'), last.get('vertical_speed'),
            min_alt, flight.get('arr_airport'), last.get('position_time')
        )
        flight['last_altitude'] = last.get('altitude')
        flight['last_speed'] = last.get('speed')
    else:
        flight['flight_status'] = 'Unknown'

    cursor.execute("SELECT * FROM staged_metars WHERE staged_flight_id = %s ORDER BY observation_time", (flight['id'],))
    metars = cursor.fetchall()

    # Fetch runways from new FAA tables
    runways = []
    if flight.get('arr_airport'):
        cursor.execute("SELECT * FROM v_runway_lookup WHERE icao_id = %s", (flight['arr_airport'],))
        rows = cursor.fetchall()
        for row in rows:
            for end, opp in [('be', 're'), ('re', 'be')]:
                lat = row.get(f'{end}_lat')
                lon = row.get(f'{end}_lon')
                opp_lat = row.get(f'{opp}_lat')
                opp_lon = row.get(f'{opp}_lon')

                if lat is None or lon is None:
                    continue

                computed_hdg = None
                if opp_lat is not None and opp_lon is not None:
                    computed_hdg = _bearing(lat, lon, opp_lat, opp_lon)

                faa_hdg = row.get(f'{end}_true_hdg')
                best_heading = computed_hdg if computed_hdg is not None else faa_hdg

                disp_lat = row.get(f'{end}_displaced_lat')
                disp_lon = row.get(f'{end}_displaced_lon')
                th_lat = disp_lat if disp_lat else lat
                th_lon = disp_lon if disp_lon else lon

                runways.append({
                    'airport_icao': row.get('icao_id'),
                    'runway_id': row.get(f'{end}_id'),
                    'threshold_lat': th_lat,
                    'threshold_lon': th_lon,
                    'heading': round(best_heading, 2) if best_heading is not None else faa_hdg,
                    'faa_heading': faa_hdg,
                    'computed_heading': round(computed_hdg, 2) if computed_hdg is not None else None,
                    'elevation': row.get(f'{end}_tdze') or row.get('airport_elevation'),
                    'glideslope': 3.0,
                    'tch': 50,
                    'length_ft': row.get('length_ft'),
                    'width_ft': row.get('width_ft'),
                    'surface_type': row.get('surface_type'),
                    'ils_type': row.get(f'{end}_ils_type'),
                    'displaced_ft': row.get(f'{end}_displaced_ft'),
                    'facility_name': row.get('facility_name'),
                })

    conn.close()

    for obj in [flight] + points + metars:
        for k, v in obj.items():
            if isinstance(v, datetime):
                obj[k] = v.isoformat()

    return jsonify({'flight': flight, 'track': points, 'metars': metars, 'runways': runways})

@app.route('/api/scoring_attempts', methods=['GET'])
def get_scoring_attempts():
    success_only = request.args.get('success') == 'true'
    failed_only = request.args.get('failed') == 'true'
    callsign = request.args.get('callsign')
    airport = request.args.get('airport')
    limit = int(request.args.get('limit', 100))
    
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    
    where = []
    params = []
    if success_only:
        where.append("success = 1")
    if failed_only:
        where.append("success = 0")
    if callsign:
        where.append("callsign = %s")
        params.append(callsign)
    if airport:
        where.append("arr_airport = %s")
        params.append(airport)
    
    where_sql = "WHERE " + " AND ".join(where) if where else ""
    
    cursor.execute(f"""
        SELECT TOP {limit} gufi, callsign, ac_type, arr_airport, flight_date,
               attempted_at, success, score_percentage, score_grade,
               failure_reason, min_altitude, max_altitude, track_points
        FROM scoring_attempts
        {where_sql}
        ORDER BY attempted_at DESC
    """, tuple(params))
    attempts = cursor.fetchall()
    
    cursor.execute("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as succeeded,
               SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed
        FROM scoring_attempts
    """)
    stats = cursor.fetchone()
    conn.close()
    
    for a in attempts:
        if a.get('flight_date'):
            a['flight_date'] = a['flight_date'].isoformat()
        if a.get('attempted_at'):
            a['attempted_at'] = a['attempted_at'].isoformat()
    
    return jsonify({'stats': stats, 'attempts': attempts})


@app.route('/api/benchmarks', methods=['GET'])
def get_benchmarks():
    benchmark_type = request.args.get('type', 'ac_type')
    key = request.args.get('key')
    
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    
    if key:
        cursor.execute("""
            SELECT * FROM approach_benchmarks 
            WHERE benchmark_type = %s AND benchmark_key = %s
        """, (benchmark_type, key))
        result = cursor.fetchone()
    else:
        cursor.execute("""
            SELECT * FROM approach_benchmarks 
            WHERE benchmark_type = %s 
            ORDER BY avg_percentage DESC
        """, (benchmark_type,))
        result = cursor.fetchall()
    
    conn.close()
    return jsonify(result if result else {})


@app.route('/api/aircraft_speeds', methods=['GET'])
def get_aircraft_speeds():
    ac_type = request.args.get('ac_type')
    if not ac_type:
        return jsonify({'error': 'ac_type required'}), 400
    
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    cursor.execute("SELECT * FROM aircraft_speeds WHERE ac_type = %s", (ac_type,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return jsonify(result)
    else:
        return jsonify({}), 404


@app.route('/api/scored_flights', methods=['GET'])
def get_scored_flights():
    ac_type = request.args.get('ac_type')
    airport = request.args.get('airport')
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    limit = int(request.args.get('limit', 500))
    
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    
    where = []
    params = []
    if ac_type:
        where.append("ac_type = %s")
        params.append(ac_type)
    if airport:
        where.append("arr_airport = %s")
        params.append(airport)
    if date_from:
        where.append("flight_date >= %s")
        params.append(date_from)
    if date_to:
        where.append("flight_date <= %s")
        params.append(date_to)
    
    where_sql = "WHERE " + " AND ".join(where) if where else ""
    
    cursor.execute(f"""
        SELECT TOP {limit} gufi, callsign, ac_type, arr_airport, runway_id, flight_date,
               percentage, grade, total_score, max_score, severe_penalty_count,
               descent_score, stabilized_score, centerline_score, 
               turn_to_final_score, speed_control_score, threshold_score,
               wind_speed_kt, crosswind_kt, scored_at
        FROM approach_scores
        {where_sql}
        ORDER BY flight_date DESC, scored_at DESC
    """, tuple(params))
    flights = cursor.fetchall()
    
    # Get filter options
    cursor.execute("SELECT DISTINCT ac_type FROM approach_scores WHERE ac_type IS NOT NULL ORDER BY ac_type")
    ac_types = [r['ac_type'] for r in cursor.fetchall()]
    
    cursor.execute("SELECT DISTINCT arr_airport FROM approach_scores WHERE arr_airport IS NOT NULL ORDER BY arr_airport")
    airports = [r['arr_airport'] for r in cursor.fetchall()]
    
    # Get summary stats
    cursor.execute(f"""
        SELECT COUNT(*) as total,
               AVG(CAST(percentage as FLOAT)) as avg_pct,
               SUM(CASE WHEN grade = 'A' THEN 1 ELSE 0 END) as grade_a,
               SUM(CASE WHEN grade = 'B' THEN 1 ELSE 0 END) as grade_b,
               SUM(CASE WHEN grade = 'C' THEN 1 ELSE 0 END) as grade_c,
               SUM(CASE WHEN grade = 'D' THEN 1 ELSE 0 END) as grade_d,
               SUM(CASE WHEN grade = 'F' THEN 1 ELSE 0 END) as grade_f
        FROM approach_scores
        {where_sql}
    """, tuple(params))
    stats = cursor.fetchone()
    
    conn.close()
    
    for f in flights:
        if f.get('flight_date'):
            f['flight_date'] = f['flight_date'].isoformat()
        if f.get('scored_at'):
            f['scored_at'] = f['scored_at'].isoformat()
    
    return jsonify({
        'flights': flights,
        'stats': stats,
        'filter_options': {
            'ac_types': ac_types,
            'airports': airports
        }
    })


@app.route('/api/scoring_status', methods=['GET'])
def get_scoring_status():
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    
    # Get last scoring attempt time
    cursor.execute("SELECT TOP 1 attempted_at FROM scoring_attempts ORDER BY attempted_at DESC")
    last_attempt = cursor.fetchone()
    
    # Get last successful score time
    cursor.execute("SELECT TOP 1 scored_at FROM approach_scores ORDER BY scored_at DESC")
    last_score = cursor.fetchone()
    
    # Get counts
    cursor.execute("SELECT COUNT(*) as total FROM approach_scores")
    total_scored = cursor.fetchone()['total']
    
    cursor.execute("SELECT COUNT(*) as pending FROM flights f WHERE f.callsign LIKE 'N%' AND f.arrival IS NOT NULL AND NOT EXISTS (SELECT 1 FROM scoring_attempts s WHERE s.gufi = f.gufi) GROUP BY f.gufi HAVING MIN(f.altitude) < 2000")
    # This query is complex, simplify
    cursor.execute("""
        SELECT COUNT(*) as pending FROM (
            SELECT f.gufi
            FROM flights f
            WHERE f.callsign LIKE 'N%%'
              AND f.arrival IS NOT NULL
              AND f.gufi NOT IN (SELECT gufi FROM scoring_attempts)
            GROUP BY f.gufi
            HAVING MIN(f.altitude) < 2000
        ) sub
    """)
    pending_result = cursor.fetchone()
    pending = pending_result['pending'] if pending_result else 0
    
    conn.close()
    
    return jsonify({
        'last_attempt': last_attempt['attempted_at'].isoformat() if last_attempt and last_attempt['attempted_at'] else None,
        'last_score': last_score['scored_at'].isoformat() if last_score and last_score['scored_at'] else None,
        'total_scored': total_scored,
        'pending': pending
    })


@app.route('/api/run_scoring', methods=['POST'])
def run_scoring():
    import subprocess
    try:
        # Run batch scoring in background
        result = subprocess.Popen(
            ['python3', '/home/bmacdonald3/flight-prep-tool/batch_score.py', '--days', '7', '--limit', '100'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd='/home/bmacdonald3/flight-prep-tool'
        )
        return jsonify({'status': 'started', 'message': 'Scoring process started in background'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500




# ══════════════════════════════════════════════════════════════
# Scoring Config Endpoints (added by patch_api_config.py)
# ══════════════════════════════════════════════════════════════

@app.route('/api/scoring_config', methods=['GET'])
def get_scoring_config():
    """Get all scoring config values, grouped by category."""
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    cursor.execute(
        "SELECT config_key, config_value, category, description "
        "FROM scoring_config ORDER BY category, config_key"
    )
    configs = cursor.fetchall()
    conn.close()

    grouped = {}
    for c in configs:
        cat = c['category']
        if cat not in grouped:
            grouped[cat] = []
        grouped[cat].append(c)

    return jsonify({'configs': configs, 'grouped': grouped})


@app.route('/api/scoring_config', methods=['POST'])
def update_scoring_config():
    """Update one or more config values. Body: {"key1": "value1", "key2": "value2"}"""
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    conn = get_conn()
    cursor = conn.cursor()

    updated = 0
    for key, value in data.items():
        cursor.execute(
            "UPDATE scoring_config "
            "SET config_value = %s, updated_at = GETUTCDATE() "
            "WHERE config_key = %s",
            (str(value), key)
        )
        updated += cursor.rowcount

    conn.commit()
    conn.close()

    return jsonify({'status': 'ok', 'updated': updated})


@app.route('/api/scoring_config/reset', methods=['POST'])
def reset_scoring_config():
    """Reset all config values to original defaults."""
    defaults = {
        'descent_max': '20', 'stabilized_max': '20', 'centerline_max': '20',
        'turn_to_final_max': '15', 'speed_control_max': '15', 'threshold_max': '10',
        'cfit_penalty': '20', 'stall_penalty': '20',
        'gs_dangerous_below': '-200', 'gs_warning_below': '-100', 'gs_high_above': '150',
        'climbing_threshold': '200',
        'stabilized_speed_tol': '10', 'stabilized_gs_tol': '150', 'stabilized_cl_tol': '300',
        'stabilized_critical_dist': '1.0', 'stabilized_late_dist': '2.0', 'stabilized_ideal_dist': '3.0',
        'cl_max_severe': '500', 'cl_max_warning': '300',
        'cl_avg_severe': '200', 'cl_avg_warning': '100', 'crosswind_allowance': '20',
        'bank_angle_steep': '30', 'cl_crossing_threshold': '50',
        'speed_base_tolerance': '5', 'speed_major_deviation': '15',
        'speed_minor_deviation': '10', 'speed_out_of_tol_pct': '30',
        'threshold_target': '50', 'threshold_dangerous_low': '20',
        'threshold_low': '35', 'threshold_high': '100', 'threshold_slightly_high': '75',
        'cfit_agl_threshold': '500', 'cfit_gs_below': '-50',
        'stall_agl_threshold': '50', 'stall_margin': '10',
    }

    conn = get_conn()
    cursor = conn.cursor()
    for key, value in defaults.items():
        cursor.execute(
            "UPDATE scoring_config "
            "SET config_value = %s, updated_at = GETUTCDATE() "
            "WHERE config_key = %s",
            (value, key)
        )
    conn.commit()
    conn.close()

    return jsonify({'status': 'ok', 'message': f'Reset {len(defaults)} settings to defaults'})


@app.route('/api/rescore_all', methods=['POST'])
def rescore_all():
    """Clear all scores and re-run batch scoring in background."""
    import subprocess

    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM approach_scores")
    cursor.execute("DELETE FROM scoring_attempts")
    conn.commit()
    conn.close()

    try:
        subprocess.Popen(
            ['python3', '/home/bmacdonald3/flight-prep-tool/batch_score.py',
             '--days', '30', '--limit', '5000'],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd='/home/bmacdonald3/flight-prep-tool'
        )
        return jsonify({'status': 'started', 'message': 'Cleared all scores and started re-scoring'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500




@app.route('/api/score_grid', methods=['GET'])
def get_score_grid():
    """Get average scores grouped by ac_type and date for heatmap grid."""
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    cursor.execute("""
        SELECT ac_type, CONVERT(varchar, flight_date, 23) as flight_date,
               COUNT(*) as flights, AVG(percentage) as avg_score,
               MIN(percentage) as min_score, MAX(percentage) as max_score
        FROM approach_scores
        WHERE ac_type IS NOT NULL AND flight_date IS NOT NULL
        GROUP BY ac_type, flight_date
        ORDER BY ac_type, flight_date
    """)
    rows = cursor.fetchall()
    conn.close()
    return jsonify({'grid': rows})



@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check for Home Assistant monitoring."""
    import time
    status = {'api': 'ok', 'uptime': time.time()}
    try:
        conn = get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        conn.close()
        status['database'] = 'ok'
    except Exception as e:
        status['database'] = 'error'
        status['db_error'] = str(e)
    try:
        conn = get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM approach_scores")
        status['scored_flights'] = cursor.fetchone()[0]
        cursor.execute("SELECT TOP 1 scored_at FROM approach_scores ORDER BY scored_at DESC")
        row = cursor.fetchone()
        status['last_scored'] = row[0].isoformat() if row else None
        conn.close()
    except:
        pass
    return jsonify(status)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002, debug=True)
