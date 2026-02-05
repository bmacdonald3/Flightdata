#!/usr/bin/env python3
"""Flight Data Prep API"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import pymssql
import sys
import os
import math
from datetime import datetime, timedelta
import json

sys.path.insert(0, os.path.expanduser('~'))
from approach_scoring import calculate_approach_score, calc_approach_data, get_schema, SCORING_VERSION
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
            t1 = prev['position_time'] if isinstance(prev['position_time'], datetime) else datetime.fromisoformat(prev['position_time'].replace('Z', '+00:00'))
            t2 = curr['position_time'] if isinstance(curr['position_time'], datetime) else datetime.fromisoformat(curr['position_time'].replace('Z', '+00:00'))
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
    points = calculate_derivatives(points)

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

@app.route('/api/scoring_schema', methods=['GET'])
def get_scoring_schema():
    """Return current scoring schema for frontend/database sync"""
    return jsonify(get_schema())


@app.route('/api/score_approach', methods=['POST'])
def score_approach():
    """Score an approach and optionally save to database"""
    data = request.json
    gufi = data.get('gufi')
    save = data.get('save', True)
    
    if not gufi:
        return jsonify({'error': 'gufi required'}), 400
    
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    
    # Get flight info
    cursor.execute("""
        SELECT callsign, departure, arrival, MIN(position_time) as first_seen
        FROM flights WHERE gufi = %s
        GROUP BY callsign, departure, arrival
    """, (gufi,))
    flight = cursor.fetchone()
    if not flight:
        conn.close()
        return jsonify({'error': 'Flight not found'}), 404
    
    # Get track points with derivatives
    cursor.execute("""
        SELECT position_time, latitude, longitude, altitude, speed, track, vertical_speed
        FROM flights WHERE gufi = %s ORDER BY position_time
    """, (gufi,))
    track = cursor.fetchall()
    track = calculate_derivatives(track)
    
    # Get aircraft info
    cursor.execute("SELECT model FROM aircraft WHERE n_number = %s", (flight['callsign'],))
    ac = cursor.fetchone()
    ac_type = ac['model'] if ac else None
    
    # Get aircraft speeds
    aircraft_speeds = None
    if ac_type:
        cursor.execute("SELECT * FROM aircraft_speeds WHERE ac_type = %s", (ac_type,))
        aircraft_speeds = cursor.fetchone()
    
    # Get runway data
    arr = flight['arrival']
    cursor.execute("SELECT * FROM v_runway_lookup WHERE icao_id = %s", (arr,))
    rwy_rows = cursor.fetchall()
    
    if not rwy_rows:
        conn.close()
        return jsonify({'error': f'No runway data for {arr}'}), 404
    
    # Find best runway based on final track
    last_track = None
    for p in reversed(track):
        if p.get('track'):
            last_track = float(p['track'])
            break
    
    best_rwy = None
    best_diff = 360
    for row in rwy_rows:
        for end in ['be', 're']:
            lat = row.get(f'{end}_lat')
            lon = row.get(f'{end}_lon')
            opp_lat = row.get(f'{"re" if end == "be" else "be"}_lat')
            opp_lon = row.get(f'{"re" if end == "be" else "be"}_lon')
            
            if not lat or not lon:
                continue
            
            # Compute heading from threshold coords
            computed_hdg = row.get(f'{end}_true_hdg') or 0
            if opp_lat and opp_lon:
                computed_hdg = _bearing(lat, lon, opp_lat, opp_lon)
            
            if last_track:
                diff = abs(computed_hdg - last_track)
                if diff > 180:
                    diff = 360 - diff
                if diff < best_diff:
                    best_diff = diff
                    best_rwy = {
                        'runway_id': row.get(f'{end}_id'),
                        'heading': round(computed_hdg, 2),
                        'threshold_lat': lat,
                        'threshold_lon': lon,
                        'elevation': row.get(f'{end}_tdze') or row.get('airport_elevation')
                    }
    
    if not best_rwy:
        row = rwy_rows[0]
        best_rwy = {
            'runway_id': row.get('be_id'),
            'heading': row.get('be_true_hdg'),
            'threshold_lat': row.get('be_lat'),
            'threshold_lon': row.get('be_lon'),
            'elevation': row.get('be_tdze') or row.get('airport_elevation')
        }
    
    # Get closest METAR
    metar = None
    if flight['first_seen']:
        cursor.execute("""
            SELECT TOP 1 m.wind_dir_degrees, m.wind_speed_kt, m.wind_gust_kt
            FROM metar_observations m
            JOIN airports a ON m.airport_id = a.airport_id
            WHERE a.icao_code = %s AND m.observation_time <= %s
            ORDER BY m.observation_time DESC
        """, (arr, flight['first_seen']))
        metar = cursor.fetchone()
    
    # Calculate approach data points
    approach_pts = calc_approach_data(track, best_rwy, heading_filter=30)
    
    if not approach_pts:
        conn.close()
        return jsonify({'error': 'No approach points found (check heading filter)'}), 404
    
    # Calculate score using the standalone module
    score = calculate_approach_score(approach_pts, best_rwy, metar, aircraft_speeds)
    
    if not score:
        conn.close()
        return jsonify({'error': 'Could not calculate score'}), 500
    
    # Save to database if requested
    if save:
        cursor.execute("DELETE FROM approach_scores WHERE gufi = %s", (gufi,))
        cursor.execute("""
            INSERT INTO approach_scores (
                gufi, callsign, ac_type, arr_airport, runway_id, flight_date,
                total_score, max_score, percentage, grade,
                descent_score, descent_max, stabilized_score, stabilized_max,
                centerline_score, centerline_max, turn_to_final_score, turn_to_final_max,
                speed_control_score, speed_control_max, threshold_score, threshold_max,
                stabilized_distance_nm, max_bank_angle, max_crosstrack_ft, avg_speed_kt, threshold_agl_ft,
                severe_penalty_count, severe_penalties_json,
                wind_dir, wind_speed_kt, wind_gust_kt, crosswind_kt,
                score_details_json
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s,
                %s, %s, %s, %s,
                %s
            )
        """, (
            gufi, flight['callsign'], ac_type, arr, best_rwy['runway_id'],
            flight['first_seen'].date() if flight['first_seen'] else None,
            score['total'], score['maxTotal'], score['percentage'], score['grade'],
            score['scores']['descent']['score'], score['scores']['descent']['max'],
            score['scores']['stabilized']['score'], score['scores']['stabilized']['max'],
            score['scores']['centerline']['score'], score['scores']['centerline']['max'],
            score['scores']['turnToFinal']['score'], score['scores']['turnToFinal']['max'],
            score['scores']['speedControl']['score'], score['scores']['speedControl']['max'],
            score['scores']['thresholdCrossing']['score'], score['scores']['thresholdCrossing']['max'],
            score['metrics'].get('stabilizedDist'),
            score['metrics'].get('maxBank'),
            score['metrics'].get('maxCrosstrack'),
            score['metrics'].get('avgSpeed'),
            score['metrics'].get('thresholdAgl'),
            len(score['severePenalties']), json.dumps(score['severePenalties']),
            score['wind']['dir'], score['wind']['speed'], score['wind']['gust'], score['wind']['crosswind'],
            json.dumps(score)
        ))
    
    conn.close()
    
    return jsonify({
        'success': True,
        'gufi': gufi,
        'callsign': flight['callsign'],
        'ac_type': ac_type,
        'airport': arr,
        'runway': best_rwy['runway_id'],
        'score': score
    })


@app.route('/api/approach_rankings', methods=['GET'])
def get_approach_rankings():
    """Get approach score rankings and benchmarks"""
    ac_type = request.args.get('ac_type')
    airport = request.args.get('airport')
    limit = int(request.args.get('limit', 50))
    
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    
    # Build query with optional filters
    where_clauses = []
    params = []
    if ac_type:
        where_clauses.append("ac_type = %s")
        params.append(ac_type)
    if airport:
        where_clauses.append("arr_airport = %s")
        params.append(airport)
    
    where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    
    # Get rankings
    cursor.execute(f"""
        SELECT TOP {limit} gufi, callsign, ac_type, arr_airport, runway_id, flight_date,
               total_score, percentage, grade, severe_penalty_count
        FROM approach_scores
        {where_sql}
        ORDER BY percentage DESC, total_score DESC
    """, tuple(params))
    rankings = cursor.fetchall()
    
    # Get stats for the filtered set
    cursor.execute(f"""
        SELECT COUNT(*) as total_flights,
               AVG(CAST(percentage as FLOAT)) as avg_pct,
               MIN(percentage) as min_pct,
               MAX(percentage) as max_pct,
               SUM(CASE WHEN severe_penalty_count > 0 THEN 1 ELSE 0 END) as severe_count
        FROM approach_scores
        {where_sql}
    """, tuple(params))
    stats = cursor.fetchone()
    
    # Get benchmarks by ac_type
    cursor.execute("""
        SELECT ac_type, 
               COUNT(*) as flight_count, 
               AVG(CAST(percentage as FLOAT)) as avg_pct,
               MIN(percentage) as min_pct,
               MAX(percentage) as max_pct
        FROM approach_scores
        WHERE ac_type IS NOT NULL
        GROUP BY ac_type
        HAVING COUNT(*) >= 3
        ORDER BY avg_pct DESC
    """)
    benchmarks = cursor.fetchall()
    
    conn.close()
    
    # Format dates
    for r in rankings:
        if r.get('flight_date'):
            r['flight_date'] = r['flight_date'].isoformat()
    
    return jsonify({
        'stats': stats,
        'rankings': rankings,
        'benchmarks': benchmarks,
        'scoringVersion': SCORING_VERSION
    })


@app.route('/api/my_score_history', methods=['GET'])
def get_my_score_history():
    """Get score history for a specific callsign"""
    callsign = request.args.get('callsign')
    limit = int(request.args.get('limit', 20))
    
    if not callsign:
        return jsonify({'error': 'callsign required'}), 400
    
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    
    cursor.execute("""
        SELECT TOP %s gufi, arr_airport, runway_id, flight_date,
               total_score, percentage, grade, severe_penalty_count,
               descent_score, stabilized_score, centerline_score,
               turn_to_final_score, speed_control_score, threshold_score
        FROM approach_scores
        WHERE callsign = %s
        ORDER BY flight_date DESC
    """, (limit, callsign))
    history = cursor.fetchall()
    
    # Get personal stats
    cursor.execute("""
        SELECT COUNT(*) as total_flights,
               AVG(CAST(percentage as FLOAT)) as avg_pct,
               MAX(percentage) as best_pct,
               MIN(percentage) as worst_pct
        FROM approach_scores
        WHERE callsign = %s
    """, (callsign,))
    stats = cursor.fetchone()
    
    conn.close()
    
    for h in history:
        if h.get('flight_date'):
            h['flight_date'] = h['flight_date'].isoformat()
    
    return jsonify({
        'callsign': callsign,
        'stats': stats,
        'history': history
    })


@app.route('/api/aircraft_speeds', methods=['GET'])
def get_aircraft_speeds():
    ac_type = request.args.get('ac_type')
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    if ac_type:
        cursor.execute("SELECT * FROM aircraft_speeds WHERE ac_type = %s", (ac_type,))
        result = cursor.fetchone()
    else:
        cursor.execute("SELECT * FROM aircraft_speeds ORDER BY ac_type")
        result = cursor.fetchall()
    conn.close()
    return jsonify(result)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002, debug=True)
