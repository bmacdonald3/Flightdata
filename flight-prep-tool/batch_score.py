#!/usr/bin/env python3
"""
Batch Approach Scoring
Scores historical flights and logs all attempts (success/failure).
"""

import pymssql
import sys
import os
import time
from datetime import datetime, timedelta

sys.path.insert(0, os.path.expanduser('~'))
from config import AZURE_SERVER, AZURE_DATABASE, AZURE_USERNAME, AZURE_PASSWORD
from approach_scoring import calculate_approach_score, calc_approach_data
from flight_preprocessor import preprocess_flight, truncate_to_approach
import json
import math

def get_conn():
    return pymssql.connect(
        server=AZURE_SERVER, user=AZURE_USERNAME, password=AZURE_PASSWORD,
        database=AZURE_DATABASE, tds_version='7.3', autocommit=True
    )

def _bearing(lat1, lon1, lat2, lon2):
    """Compute initial bearing from point 1 to point 2."""
    lat1, lon1, lat2, lon2 = (math.radians(x) for x in (lat1, lon1, lat2, lon2))
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return math.degrees(math.atan2(x, y)) % 360

def calculate_derivatives(points):
    """Add turn_rate, accel to track points"""
    if len(points) < 2:
        return points
    for i in range(len(points)):
        points[i]['accel'] = None
        points[i]['turn_rate'] = None
        if i == 0:
            continue
        prev, curr = points[i-1], points[i]
        try:
            t1 = prev['position_time'] if isinstance(prev['position_time'], datetime) else datetime.fromisoformat(prev['position_time'].replace('Z', '+00:00'))
            t2 = curr['position_time'] if isinstance(curr['position_time'], datetime) else datetime.fromisoformat(curr['position_time'].replace('Z', '+00:00'))
            dt = (t2 - t1).total_seconds()
        except:
            continue
        if dt <= 0 or dt > 120:
            continue
        if prev.get('speed') is not None and curr.get('speed') is not None:
            curr['accel'] = round((curr['speed'] - prev['speed']) / dt, 2)
        if prev.get('track') is not None and curr.get('track') is not None:
            try:
                diff = float(curr['track']) - float(prev['track'])
                if diff > 180: diff -= 360
                elif diff < -180: diff += 360
                curr['turn_rate'] = round(diff / dt, 2)
            except:
                pass
    return points

def get_best_runway(cursor, airport, last_track):
    """Find best runway for approach based on final track"""
    cursor.execute("SELECT * FROM v_runway_lookup WHERE icao_id = %s", (airport,))
    rwy_rows = cursor.fetchall()
    if not rwy_rows:
        return None
    
    best_rwy, best_diff = None, 360
    for row in rwy_rows:
        for end in ['be', 're']:
            lat, lon = row.get(f'{end}_lat'), row.get(f'{end}_lon')
            opp_lat = row.get(f'{"re" if end == "be" else "be"}_lat')
            opp_lon = row.get(f'{"re" if end == "be" else "be"}_lon')
            if not lat or not lon:
                continue
            hdg = _bearing(lat, lon, opp_lat, opp_lon) if opp_lat and opp_lon else (row.get(f'{end}_true_hdg') or 0)
            if last_track is not None:
                diff = abs(hdg - last_track)
                if diff > 180: diff = 360 - diff
                if diff < best_diff:
                    best_diff = diff
                    best_rwy = {
                        'runway_id': row.get(f'{end}_id'),
                        'heading': round(hdg, 2),
                        'threshold_lat': lat,
                        'threshold_lon': lon,
                        'elevation': row.get(f'{end}_tdze') or row.get('airport_elevation')
                    }
    if not best_rwy and rwy_rows:
        row = rwy_rows[0]
        best_rwy = {
            'runway_id': row.get('be_id'),
            'heading': row.get('be_true_hdg'),
            'threshold_lat': row.get('be_lat'),
            'threshold_lon': row.get('be_lon'),
            'elevation': row.get('be_tdze') or row.get('airport_elevation')
        }
    return best_rwy

def log_attempt(cursor, gufi, callsign, ac_type, arrival, flight_date, 
                success, percentage=None, grade=None, failure_reason=None,
                min_alt=None, max_alt=None, track_points=None, leg_num=None, 
                leg_type=None, flags=None):
    """Log a scoring attempt"""
    # For T&G legs, create unique gufi
    log_gufi = f"{gufi}#leg{leg_num}" if leg_num and leg_num > 1 else gufi
    
    cursor.execute("DELETE FROM scoring_attempts WHERE gufi = %s", (log_gufi,))
    
    # Add flags to failure_reason if present
    reason_with_flags = failure_reason
    if flags:
        flag_str = " | ".join(flags)
        if reason_with_flags:
            reason_with_flags = f"{reason_with_flags} [{flag_str}]"
        else:
            reason_with_flags = f"[{flag_str}]"
    
    cursor.execute("""
        INSERT INTO scoring_attempts 
        (gufi, callsign, ac_type, arr_airport, flight_date, success, 
         score_percentage, score_grade, failure_reason, min_altitude, max_altitude, track_points)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (log_gufi, callsign, ac_type, arrival, flight_date, success,
          percentage, grade, reason_with_flags, min_alt, max_alt, track_points))

def score_flight(cursor, gufi, verbose=False):
    """Score a single flight (or multiple legs for T&G), log attempts"""
    # Get flight info with min/max altitude
    cursor.execute("""
        SELECT callsign, departure, arrival, 
               MIN(position_time) as first_seen,
               MIN(altitude) as min_alt,
               MAX(altitude) as max_alt,
               COUNT(*) as point_count
        FROM flights WHERE gufi = %s
        GROUP BY callsign, departure, arrival
    """, (gufi,))
    flight = cursor.fetchone()
    
    if not flight:
        return None, "Flight not found"
    
    callsign = flight['callsign']
    arrival = flight['arrival']
    flight_date = flight['first_seen'].date() if flight['first_seen'] else None
    
    # Get aircraft type early for logging
    cursor.execute("SELECT model FROM aircraft WHERE n_number = %s", (callsign,))
    ac = cursor.fetchone()
    ac_type = ac['model'] if ac else None
    
    if not arrival:
        log_attempt(cursor, gufi, callsign, ac_type, arrival, flight_date,
                   False, failure_reason="No arrival airport",
                   min_alt=flight['min_alt'], max_alt=flight['max_alt'], 
                   track_points=flight['point_count'])
        return None, "No arrival airport"
    
    # Get track points
    cursor.execute("""
        SELECT position_time, latitude, longitude, altitude, speed, track, vertical_speed
        FROM flights WHERE gufi = %s ORDER BY position_time
    """, (gufi,))
    track = cursor.fetchall()
    
    # Preprocess the flight
    preprocess_result = preprocess_flight(track, arrival, cursor)
    
    if preprocess_result['is_ghost']:
        log_attempt(cursor, gufi, callsign, ac_type, arrival, flight_date,
                   False, failure_reason=f"Ghost: {preprocess_result['ghost_reason']}",
                   min_alt=flight['min_alt'], max_alt=flight['max_alt'], 
                   track_points=len(track), flags=preprocess_result['flags'])
        return None, f"Ghost: {preprocess_result['ghost_reason']}"
    
    # Process each leg
    legs = preprocess_result['legs']
    if not legs:
        log_attempt(cursor, gufi, callsign, ac_type, arrival, flight_date,
                   False, failure_reason="No valid legs found",
                   min_alt=flight['min_alt'], max_alt=flight['max_alt'], 
                   track_points=len(track), flags=preprocess_result['flags'])
        return None, "No valid legs found"
    
    scores = []
    for leg_num, leg in enumerate(legs, 1):
        leg_track = leg['track']
        leg_type = leg['leg_type']
        
        if len(leg_track) < 5:
            if verbose:
                print(f"    Leg {leg_num}/{len(legs)} ({leg_type}): Too few points ({len(leg_track)})")
            continue
        
        # Calculate derivatives for this leg
        leg_track = calculate_derivatives(leg_track)
        
        # Get last track heading
        last_track = None
        for p in reversed(leg_track):
            if p.get('track'):
                last_track = float(p['track'])
                break
        
        # Get runway
        best_rwy = get_best_runway(cursor, arrival, last_track)
        if not best_rwy:
            log_attempt(cursor, gufi, callsign, ac_type, arrival, flight_date,
                       False, failure_reason=f"No runway data for {arrival}",
                       min_alt=leg['min_alt'], max_alt=leg['max_alt'],
                       track_points=len(leg_track), leg_num=leg_num, leg_type=leg_type,
                       flags=preprocess_result['flags'])
            continue
        
        # Truncate to approach segment
        airport_elev = best_rwy.get('elevation') or 0
        leg_track, truncate_flags = truncate_to_approach(leg_track, best_rwy, 15, airport_elev)
        all_flags = preprocess_result['flags'] + truncate_flags
        
        if len(leg_track) < 5:
            if verbose:
                print(f"    Leg {leg_num}/{len(legs)} ({leg_type}): Too few points after truncation")
            continue
        
        # Get aircraft speeds
        aircraft_speeds = None
        if ac_type:
            cursor.execute("SELECT * FROM aircraft_speeds WHERE ac_type = %s", (ac_type,))
            aircraft_speeds = cursor.fetchone()
        
        # Get METAR
        metar = None
        if flight['first_seen']:
            cursor.execute("""
                SELECT TOP 1 m.wind_dir_degrees, m.wind_speed_kt, m.wind_gust_kt
                FROM metar_observations m
                JOIN airports a ON m.airport_id = a.airport_id
                WHERE a.icao_code = %s AND m.observation_time <= %s
                ORDER BY m.observation_time DESC
            """, (arrival, flight['first_seen']))
            metar = cursor.fetchone()
        
        # Calculate approach data
        approach_pts = calc_approach_data(leg_track, best_rwy, heading_filter=30)
        
        if not approach_pts:
            log_attempt(cursor, gufi, callsign, ac_type, arrival, flight_date,
                       False, failure_reason="No approach points (heading filter)",
                       min_alt=leg['min_alt'], max_alt=leg['max_alt'],
                       track_points=len(leg_track), leg_num=leg_num, leg_type=leg_type,
                       flags=all_flags)
            continue
        
        # Calculate score
        score = calculate_approach_score(approach_pts, best_rwy, metar, aircraft_speeds)
        
        if not score:
            log_attempt(cursor, gufi, callsign, ac_type, arrival, flight_date,
                       False, failure_reason="Scoring calculation failed",
                       min_alt=leg['min_alt'], max_alt=leg['max_alt'],
                       track_points=len(leg_track), leg_num=leg_num, leg_type=leg_type,
                       flags=all_flags)
            continue
        
        # Save score (with leg suffix for T&G)
        score_gufi = f"{gufi}#leg{leg_num}" if len(legs) > 1 else gufi
        cursor.execute("DELETE FROM approach_scores WHERE gufi = %s", (score_gufi,))
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
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
        """, (
            score_gufi, callsign, ac_type, arrival, best_rwy['runway_id'], flight_date,
            score['total'], score['maxTotal'], score['percentage'], score['grade'],
            score['scores']['descent']['score'], score['scores']['descent']['max'],
            score['scores']['stabilized']['score'], score['scores']['stabilized']['max'],
            score['scores']['centerline']['score'], score['scores']['centerline']['max'],
            score['scores']['turnToFinal']['score'], score['scores']['turnToFinal']['max'],
            score['scores']['speedControl']['score'], score['scores']['speedControl']['max'],
            score['scores']['thresholdCrossing']['score'], score['scores']['thresholdCrossing']['max'],
            score['metrics'].get('stabilizedDist'), score['metrics'].get('maxBank'),
            score['metrics'].get('maxCrosstrack'), score['metrics'].get('avgSpeed'),
            score['metrics'].get('thresholdAgl'),
            len(score['severePenalties']), json.dumps(score['severePenalties']),
            score['wind']['dir'], score['wind']['speed'], score['wind']['gust'], score['wind']['crosswind'],
            json.dumps(score)
        ))
        
        # Log success
        log_attempt(cursor, gufi, callsign, ac_type, arrival, flight_date,
                   True, percentage=score['percentage'], grade=score['grade'],
                   min_alt=leg['min_alt'], max_alt=leg['max_alt'],
                   track_points=len(leg_track), leg_num=leg_num if len(legs) > 1 else None, 
                   leg_type=leg_type, flags=all_flags)
        
        scores.append(score)
        
        if verbose and len(legs) > 1:
            print(f"    Leg {leg_num}/{len(legs)} ({leg_type}): {score['percentage']}% ({score['grade']})")
    
    if scores:
        return scores[0] if len(scores) == 1 else scores, None
    else:
        return None, "No legs scored successfully"


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Batch score approach flights')
    parser.add_argument('--days', type=int, default=30, help='Days to look back')
    parser.add_argument('--limit', type=int, default=1000, help='Max flights')
    parser.add_argument('--rescore', action='store_true', help='Rescore existing')
    parser.add_argument('--callsign', type=str, help='Filter by callsign')
    parser.add_argument('--min-alt', type=int, default=2000, help='Max min-altitude to consider')
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()
    
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    
    cutoff = datetime.utcnow() - timedelta(days=args.days)
    
    where_clauses = [
        "f.callsign LIKE 'N%'",
        "f.arrival IS NOT NULL",
        f"f.position_time >= '{cutoff.strftime('%Y-%m-%d')}'"
    ]
    
    if args.callsign:
        where_clauses.append(f"f.callsign = '{args.callsign}'")
    
    if not args.rescore:
        where_clauses.append("NOT EXISTS (SELECT 1 FROM scoring_attempts s WHERE s.gufi = f.gufi)")
    
    where_sql = " AND ".join(where_clauses)
    
    cursor.execute(f"""
        SELECT DISTINCT TOP {args.limit} f.gufi, f.callsign, f.arrival,
               MIN(f.position_time) as first_seen,
               MIN(f.altitude) as min_alt
        FROM flights f
        WHERE {where_sql}
        GROUP BY f.gufi, f.callsign, f.arrival
        HAVING COUNT(*) >= 10 AND MIN(f.altitude) < {args.min_alt}
        ORDER BY MIN(f.position_time) DESC
    """)
    flights = cursor.fetchall()
    
    print(f"Found {len(flights)} flights to score")
    print(f"Filters: {args.days} days, min_alt<{args.min_alt}, limit {args.limit}")
    print("-" * 60)
    
    scored, failed = 0, 0
    errors = {}
    
    for i, flight in enumerate(flights):
        score, error = score_flight(cursor, flight['gufi'], args.verbose)
        
        if score:
            scored += 1
            if args.verbose:
                print(f"[{i+1}/{len(flights)}] {flight['callsign']} -> {flight['arrival']}: {score['percentage']}% ({score['grade']})")
        else:
            failed += 1
            errors[error] = errors.get(error, 0) + 1
            if args.verbose:
                print(f"[{i+1}/{len(flights)}] {flight['callsign']} -> {flight['arrival']}: FAILED - {error}")
        
        if not args.verbose and (i + 1) % 25 == 0:
            print(f"Progress: {i+1}/{len(flights)} ({scored} scored, {failed} failed)")
    
    conn.close()
    
    print("-" * 60)
    print(f"Complete: {scored} scored, {failed} failed")
    if errors:
        print("\nFailure reasons:")
        for reason, count in sorted(errors.items(), key=lambda x: -x[1]):
            print(f"  {count:4d}: {reason}")
    
    # Show summary
    conn = get_conn()
    cursor = conn.cursor(as_dict=True)
    cursor.execute("""
        SELECT COUNT(*) as total,
               AVG(CAST(percentage as FLOAT)) as avg_pct,
               SUM(CASE WHEN grade = 'A' THEN 1 ELSE 0 END) as a,
               SUM(CASE WHEN grade = 'B' THEN 1 ELSE 0 END) as b,
               SUM(CASE WHEN grade = 'C' THEN 1 ELSE 0 END) as c,
               SUM(CASE WHEN grade = 'D' THEN 1 ELSE 0 END) as d,
               SUM(CASE WHEN grade = 'F' THEN 1 ELSE 0 END) as f
        FROM approach_scores
    """)
    stats = cursor.fetchone()
    conn.close()
    
    if stats['total']:
        print(f"\nOverall: {stats['total']} scored, avg {stats['avg_pct']:.1f}%")
        print(f"Grades: A={stats['a']} B={stats['b']} C={stats['c']} D={stats['d']} F={stats['f']}")

if __name__ == '__main__':
    main()
