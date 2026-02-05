"""
Approach Scoring Module v1.0
Standalone scoring algorithm for approach quality assessment.

Score Categories:
- descent (20 pts): Glideslope tracking, no climbing on approach
- stabilized (20 pts): Distance from threshold when stabilized
- centerline (20 pts): Lateral tracking with crosswind adjustment
- turnToFinal (15 pts): Bank angle control, no overshoots
- speedControl (15 pts): Speed discipline relative to target
- thresholdCrossing (10 pts): Height over threshold (target 50ft)

Severe Penalties:
- CFIT RISK: Below glideslope when <500ft AGL
- STALL RISK: Within 10kts of stall when >50ft AGL
"""

import math
import json
from datetime import datetime

SCORING_VERSION = "1.0"

# Score category definitions - change these to modify scoring
SCORE_CATEGORIES = {
    'descent': {'max': 20, 'description': 'Glideslope tracking quality'},
    'stabilized': {'max': 20, 'description': 'Stabilized approach distance'},
    'centerline': {'max': 20, 'description': 'Runway centerline tracking'},
    'turnToFinal': {'max': 15, 'description': 'Turn to final quality'},
    'speedControl': {'max': 15, 'description': 'Approach speed discipline'},
    'thresholdCrossing': {'max': 10, 'description': 'Threshold crossing height'}
}

SEVERE_PENALTY_TYPES = {
    'CFIT_RISK': {'penalty': 20, 'description': 'Below glideslope when low'},
    'STALL_RISK': {'penalty': 20, 'description': 'Near stall speed when high'}
}


def get_schema():
    """Return current scoring schema for database adaptation"""
    return {
        'version': SCORING_VERSION,
        'categories': SCORE_CATEGORIES,
        'severePenalties': SEVERE_PENALTY_TYPES,
        'maxTotal': sum(c['max'] for c in SCORE_CATEGORIES.values())
    }


def calc_bank_angle(turn_rate, speed_kts):
    """Calculate bank angle from turn rate and speed"""
    if not turn_rate or not speed_kts:
        return 0
    speed_fts = speed_kts * 1.687
    omega_rads = turn_rate * math.pi / 180
    return abs(math.degrees(math.atan(speed_fts * omega_rads / 32.2)))


def calc_crosswind(wind_dir, wind_speed, runway_hdg):
    """Calculate crosswind component"""
    if wind_dir is None or wind_speed is None:
        return 0
    wind_angle = abs(wind_dir - runway_hdg)
    if wind_angle > 180:
        wind_angle = 360 - wind_angle
    return abs(math.sin(math.radians(wind_angle)) * wind_speed)


def score_descent(sorted_pts, **kwargs):
    """Score descent quality - glideslope tracking"""
    result = {'score': 20, 'max': 20, 'details': [], 'deductions': []}
    
    gs_devs = [p.get('gsDevFt') for p in sorted_pts if p.get('gsDevFt') is not None]
    if not gs_devs:
        result['details'].append("No glideslope data")
        return result
    
    avg_gs_dev = sum(gs_devs) / len(gs_devs)
    below_gs = len([d for d in gs_devs if d < -100])
    way_below = len([d for d in gs_devs if d < -200])
    above_gs = len([d for d in gs_devs if d > 150])
    
    # Being below glideslope is worse than above
    if way_below > 0:
        deduct = min(10, way_below * 2)
        result['score'] -= deduct
        result['deductions'].append(f"-{deduct}: {way_below} pts >200ft below GS (dangerous)")
    if below_gs > way_below:
        deduct = min(5, below_gs - way_below)
        result['score'] -= deduct
        result['deductions'].append(f"-{deduct}: {below_gs - way_below} pts 100-200ft below GS")
    if above_gs > 3:
        deduct = min(3, (above_gs - 3) // 2)
        result['score'] -= deduct
        result['deductions'].append(f"-{deduct}: {above_gs} pts >150ft above GS")
    
    # Check for climbing during approach
    climbing = len([p for p in sorted_pts if p.get('vs') and p.get('vs') > 200])
    if climbing > 0:
        deduct = min(5, climbing)
        result['score'] -= deduct
        result['deductions'].append(f"-{deduct}: {climbing} pts climbing on approach")
    
    result['score'] = max(0, result['score'])
    result['details'].append(f"Avg GS dev: {avg_gs_dev:.0f}ft, Below: {below_gs}, Above: {above_gs}")
    return result


def score_stabilized(sorted_pts, target_speed=70, **kwargs):
    """Score stabilized approach distance"""
    result = {'score': 20, 'max': 20, 'details': [], 'deductions': []}
    
    stabilized_dist = 0
    for p in sorted_pts:
        on_speed = p.get('speed') and abs(p.get('speed') - target_speed) <= 10
        on_gs = p.get('gsDevFt') is not None and abs(p.get('gsDevFt')) < 150
        on_cl = abs(p.get('crossTrackFt', 999)) < 300
        if on_speed and on_gs and on_cl:
            stabilized_dist = p.get('distNm', 0)
            break
    
    result['details'].append(f"Stabilized at {stabilized_dist:.2f}nm")
    result['metrics'] = {'stabilizedDist': stabilized_dist}
    
    if stabilized_dist < 1:
        result['score'] -= 15
        result['deductions'].append("-15: Not stabilized until <1nm (go-around criteria)")
    elif stabilized_dist < 2:
        result['score'] -= 10
        result['deductions'].append(f"-10: Stabilized late ({stabilized_dist:.1f}nm)")
    elif stabilized_dist < 3:
        result['score'] -= 5
        result['deductions'].append(f"-5: Stabilized at {stabilized_dist:.1f}nm (ideal >3nm)")
    
    result['score'] = max(0, result['score'])
    return result


def score_centerline(sorted_pts, crosswind=0, **kwargs):
    """Score centerline tracking with crosswind adjustment"""
    result = {'score': 20, 'max': 20, 'details': [], 'deductions': []}
    
    xw_margin = crosswind * 20  # ~20ft per kt crosswind allowance
    cross_tracks = [abs(p.get('crossTrackFt', 0)) for p in sorted_pts]
    
    if not cross_tracks:
        result['details'].append("No crosstrack data")
        return result
    
    avg_cross = sum(cross_tracks) / len(cross_tracks)
    max_cross = max(cross_tracks)
    adj_max = max(0, max_cross - xw_margin)
    
    if adj_max > 500:
        result['score'] -= 10
        result['deductions'].append(f"-10: Max deviation {max_cross:.0f}ft")
    elif adj_max > 300:
        result['score'] -= 5
        result['deductions'].append(f"-5: Max deviation {max_cross:.0f}ft")
    
    if avg_cross > 200:
        result['score'] -= 5
        result['deductions'].append(f"-5: Avg deviation {avg_cross:.0f}ft")
    elif avg_cross > 100:
        result['score'] -= 2
        result['deductions'].append(f"-2: Avg deviation {avg_cross:.0f}ft")
    
    result['score'] = max(0, result['score'])
    result['details'].append(f"Avg: {avg_cross:.0f}ft, Max: {max_cross:.0f}ft, XW adj: {xw_margin:.0f}ft")
    result['metrics'] = {'avgCrosstrack': int(avg_cross), 'maxCrosstrack': int(max_cross)}
    return result


def score_turn_to_final(sorted_pts, **kwargs):
    """Score turn to final - bank angle and overshoots"""
    result = {'score': 15, 'max': 15, 'details': [], 'deductions': []}
    
    banks = [calc_bank_angle(p.get('turn_rate'), p.get('speed')) for p in sorted_pts]
    max_bank = max(banks) if banks else 0
    steep_banks = len([b for b in banks if b > 30])
    
    if steep_banks > 0:
        deduct = min(10, steep_banks * 2)
        result['score'] -= deduct
        result['deductions'].append(f"-{deduct}: {steep_banks} pts with bank >30° (max {max_bank:.1f}°)")
    
    # Check for centerline crossings (S-turns/overshoots)
    crossings = 0
    prev_side = None
    for p in sorted_pts:
        ct = p.get('crossTrackFt', 0)
        side = 'R' if ct > 50 else 'L' if ct < -50 else None
        if side and prev_side and side != prev_side:
            crossings += 1
        if side:
            prev_side = side
    
    if crossings > 1:
        deduct = min(5, (crossings - 1) * 2)
        result['score'] -= deduct
        result['deductions'].append(f"-{deduct}: {crossings} centerline crossings (S-turns)")
    
    result['score'] = max(0, result['score'])
    result['details'].append(f"Max bank: {max_bank:.1f}°, CL crossings: {crossings}")
    result['metrics'] = {'maxBank': round(max_bank, 1), 'clCrossings': crossings}
    return result


def score_speed_control(sorted_pts, target_speed=70, gust=0, **kwargs):
    """Score speed control relative to target"""
    result = {'score': 15, 'max': 15, 'details': [], 'deductions': []}
    
    gust_margin = gust / 2 if gust > 0 else 0
    speed_tol = 5 + gust_margin
    speeds = [p.get('speed') for p in sorted_pts if p.get('speed') is not None]
    
    if not speeds:
        result['details'].append("No speed data")
        return result
    
    avg_speed = sum(speeds) / len(speeds)
    speed_devs = [abs(s - target_speed) for s in speeds]
    max_speed_dev = max(speed_devs) if speed_devs else 0
    out_of_tol = len([s for s in speeds if abs(s - target_speed) > speed_tol])
    
    if max_speed_dev > 15:
        result['score'] -= 8
        result['deductions'].append(f"-8: Speed varied {max_speed_dev:.0f}kt from target")
    elif max_speed_dev > 10:
        result['score'] -= 4
        result['deductions'].append(f"-4: Speed varied {max_speed_dev:.0f}kt from target")
    
    if out_of_tol > len(speeds) * 0.3:
        result['score'] -= 4
        result['deductions'].append(f"-4: {out_of_tol}/{len(speeds)} pts outside ±{speed_tol:.0f}kt")
    
    result['score'] = max(0, result['score'])
    result['details'].append(f"Target: {target_speed}kt ±{speed_tol:.1f}kt, Avg: {avg_speed:.0f}kt")
    result['metrics'] = {'avgSpeed': int(avg_speed), 'maxSpeedDev': int(max_speed_dev)}
    return result


def score_threshold_crossing(sorted_pts, **kwargs):
    """Score threshold crossing height (target 50ft AGL)"""
    result = {'score': 10, 'max': 10, 'details': [], 'deductions': []}
    
    near_threshold = [p for p in sorted_pts if p.get('distNm', 99) < 0.15]
    threshold_agl = near_threshold[-1].get('agl') if near_threshold else None
    
    if threshold_agl is not None:
        result['details'].append(f"Crossed at {threshold_agl:.0f}ft AGL (target 50ft)")
        result['metrics'] = {'thresholdAgl': int(threshold_agl)}
        
        if threshold_agl < 20:
            result['score'] -= 8
            result['deductions'].append(f"-8: Too low! {threshold_agl:.0f}ft AGL (dangerous)")
        elif threshold_agl < 35:
            result['score'] -= 4
            result['deductions'].append(f"-4: Low crossing {threshold_agl:.0f}ft AGL")
        elif threshold_agl > 100:
            result['score'] -= 5
            result['deductions'].append(f"-5: High crossing {threshold_agl:.0f}ft (long landing)")
        elif threshold_agl > 75:
            result['score'] -= 2
            result['deductions'].append(f"-2: Slightly high {threshold_agl:.0f}ft")
    else:
        result['score'] = 0
        result['details'].append("No data near threshold")
        result['deductions'].append("-10: No threshold crossing data")
        result['metrics'] = {'thresholdAgl': None}
    
    result['score'] = max(0, result['score'])
    return result


def check_severe_penalties(sorted_pts, dirty_stall=45, **kwargs):
    """Check for severe safety penalties"""
    penalties = []
    
    # CFIT RISK: Below glideslope when <500ft AGL
    below_gs_low = [p for p in sorted_pts if p.get('agl', 999) < 500 and p.get('gsDevFt', 0) < -50]
    if below_gs_low:
        worst = min(p.get('gsDevFt', 0) for p in below_gs_low)
        penalties.append({
            'type': 'CFIT_RISK',
            'description': 'Below glideslope when low',
            'detail': f"{len(below_gs_low)} pts below GS when <500ft AGL (worst: {worst:.0f}ft)",
            'penalty': SEVERE_PENALTY_TYPES['CFIT_RISK']['penalty']
        })
    
    # STALL RISK: Within 10kts of stall when >50ft AGL
    near_stall = [p for p in sorted_pts if p.get('agl', 0) > 50 and p.get('speed') and p.get('speed') < dirty_stall + 10]
    if near_stall:
        lowest = min(p.get('speed') for p in near_stall)
        margin = lowest - dirty_stall
        penalties.append({
            'type': 'STALL_RISK',
            'description': 'Near stall speed when high',
            'detail': f"{len(near_stall)} pts within 10kts of stall ({lowest}kt, Vs {dirty_stall}kt, margin {margin:.0f}kt)",
            'penalty': SEVERE_PENALTY_TYPES['STALL_RISK']['penalty']
        })
    
    return penalties


def calculate_approach_score(approach_points, runway, metar=None, aircraft_speeds=None):
    """
    Main scoring function.
    
    Args:
        approach_points: List of approach data points (filtered for heading)
        runway: Dict with heading, elevation, threshold_lat/lon
        metar: Dict with wind_dir_degrees, wind_speed_kt, wind_gust_kt (optional)
        aircraft_speeds: Dict with appr_speed, dirty_stall, clean_stall (optional)
    
    Returns:
        Dict with scores, penalties, total, grade, and audit details
    """
    if not approach_points or not runway:
        return None
    
    # Extract parameters
    rwy_hdg = float(runway.get('heading') or 0)
    wind_dir = metar.get('wind_dir_degrees') if metar else None
    wind_spd = metar.get('wind_speed_kt') or 0 if metar else 0
    wind_gust = metar.get('wind_gust_kt') or 0 if metar else 0
    target_speed = aircraft_speeds.get('appr_speed') or 70 if aircraft_speeds else 70
    dirty_stall = aircraft_speeds.get('dirty_stall') or 45 if aircraft_speeds else 45
    
    crosswind = calc_crosswind(wind_dir, wind_spd, rwy_hdg)
    
    # Sort points by distance (far to near)
    sorted_pts = sorted(approach_points, key=lambda p: -p.get('distNm', 0))
    
    # Common kwargs for all scoring functions
    score_kwargs = {
        'target_speed': target_speed,
        'dirty_stall': dirty_stall,
        'crosswind': crosswind,
        'gust': wind_gust
    }
    
    # Calculate each category score
    scores = {
        'descent': score_descent(sorted_pts, **score_kwargs),
        'stabilized': score_stabilized(sorted_pts, **score_kwargs),
        'centerline': score_centerline(sorted_pts, **score_kwargs),
        'turnToFinal': score_turn_to_final(sorted_pts, **score_kwargs),
        'speedControl': score_speed_control(sorted_pts, **score_kwargs),
        'thresholdCrossing': score_threshold_crossing(sorted_pts, **score_kwargs)
    }
    
    # Check severe penalties
    severe_penalties = check_severe_penalties(sorted_pts, **score_kwargs)
    
    # Calculate totals
    total = sum(s['score'] for s in scores.values())
    max_total = sum(s['max'] for s in scores.values())
    severe_total = sum(p['penalty'] for p in severe_penalties)
    total = max(0, total - severe_total)
    
    pct = round(total / max_total * 100)
    grade = 'A' if total >= 90 else 'B' if total >= 80 else 'C' if total >= 70 else 'D' if total >= 60 else 'F'
    
    # Collect metrics from all categories
    metrics = {}
    for cat, data in scores.items():
        if 'metrics' in data:
            metrics.update(data['metrics'])
    
    return {
        'version': SCORING_VERSION,
        'scores': scores,
        'severePenalties': severe_penalties,
        'total': total,
        'maxTotal': max_total,
        'percentage': pct,
        'grade': grade,
        'metrics': metrics,
        'wind': {
            'dir': wind_dir,
            'speed': wind_spd,
            'gust': wind_gust,
            'crosswind': int(crosswind)
        },
        'aircraftData': {
            'targetSpeed': target_speed,
            'dirtyStall': dirty_stall
        },
        'scoredAt': datetime.utcnow().isoformat()
    }


def calc_approach_data(track, runway, heading_filter=30):
    """
    Calculate approach data points from raw track data.
    
    Args:
        track: List of track points with lat, lon, altitude, speed, etc.
        runway: Dict with threshold_lat, threshold_lon, heading, elevation
        heading_filter: Only include points within ±N degrees of runway heading
    
    Returns:
        List of processed approach points
    """
    if not runway or not track:
        return []
    
    th_lat = float(runway.get('threshold_lat') or 0)
    th_lon = float(runway.get('threshold_lon') or 0)
    hdg = float(runway.get('heading') or 0)
    elev = float(runway.get('elevation') or 0)
    gs_angle = 3.0
    tch = 50
    
    results = []
    for idx, p in enumerate(track):
        if not p.get('latitude') or not p.get('longitude'):
            continue
        
        p_lat = float(p['latitude'])
        p_lon = float(p['longitude'])
        R = 3440.065  # Earth radius in nm
        
        # Haversine distance
        d_lat = math.radians(p_lat - th_lat)
        d_lon = math.radians(p_lon - th_lon)
        a = math.sin(d_lat/2)**2 + math.cos(math.radians(th_lat)) * math.cos(math.radians(p_lat)) * math.sin(d_lon/2)**2
        dist_nm = 2 * R * math.asin(math.sqrt(a))
        
        # Bearing from threshold to point
        y = math.sin(d_lon) * math.cos(math.radians(p_lat))
        x = math.cos(math.radians(th_lat)) * math.sin(math.radians(p_lat)) - math.sin(math.radians(th_lat)) * math.cos(math.radians(p_lat)) * math.cos(d_lon)
        bearing = (math.degrees(math.atan2(y, x)) + 360) % 360
        
        # Along-track and cross-track components
        inbound = hdg
        angle_diff = bearing - ((hdg + 180) % 360)
        if angle_diff > 180:
            angle_diff -= 360
        if angle_diff < -180:
            angle_diff += 360
        
        along_track = dist_nm * math.cos(math.radians(angle_diff))
        cross_track = dist_nm * math.sin(math.radians(angle_diff)) * 6076.12  # to feet
        
        alt = p.get('altitude') or 0
        agl = alt - elev
        ideal_alt = elev + tch + (along_track * 6076.12 * math.tan(math.radians(gs_angle)))
        gs_dev = alt - ideal_alt
        
        # Heading filter - only include points roughly aligned with runway
        track_hdg = p.get('track')
        if track_hdg is not None:
            diff = abs(float(track_hdg) - inbound)
            if diff > 180:
                diff = 360 - diff
            if diff > heading_filter:
                continue
        
        # Only include points on approach (positive distance, within 10nm)
        if along_track <= 0 or along_track > 10:
            continue
        
        results.append({
            'idx': idx,
            'distNm': along_track,
            'crossTrackFt': cross_track,
            'altitude': alt,
            'agl': agl,
            'gsDevFt': gs_dev,
            'speed': p.get('speed'),
            'vs': p.get('vertical_speed'),
            'track': track_hdg,
            'turn_rate': p.get('turn_rate'),
            'accel': p.get('accel')
        })
    
    return results
