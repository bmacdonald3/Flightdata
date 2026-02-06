"""
Approach Scoring Module v1.1
Scoring algorithm with configurable thresholds loaded from scoring_config table.
All thresholds now loaded from database via load_scoring_config().
"""

import math
import json
from datetime import datetime

SCORING_VERSION = "1.1"

DEFAULT_CONFIG = {
    'descent_max': 20, 'stabilized_max': 20, 'centerline_max': 20,
    'turn_to_final_max': 15, 'speed_control_max': 15, 'threshold_max': 10,
    'cfit_penalty': 20, 'stall_penalty': 20,
    'gs_dangerous_below': -200, 'gs_warning_below': -100, 'gs_high_above': 150,
    'climbing_threshold': 200,
    'stabilized_speed_tol': 10, 'stabilized_gs_tol': 150, 'stabilized_cl_tol': 300,
    'stabilized_critical_dist': 1.0, 'stabilized_late_dist': 2.0, 'stabilized_ideal_dist': 3.0,
    'cl_max_severe': 500, 'cl_max_warning': 300,
    'cl_avg_severe': 200, 'cl_avg_warning': 100, 'crosswind_allowance': 20,
    'bank_angle_steep': 30, 'cl_crossing_threshold': 50,
    'speed_base_tolerance': 5, 'speed_major_deviation': 15,
    'speed_minor_deviation': 10, 'speed_out_of_tol_pct': 30,
    'threshold_target': 50, 'threshold_dangerous_low': 20,
    'threshold_low': 35, 'threshold_high': 100, 'threshold_slightly_high': 75,
    'cfit_agl_threshold': 500, 'cfit_gs_below': -50,
    'stall_agl_threshold': 50, 'stall_margin': 10,
}


def load_scoring_config(conn=None):
    config = dict(DEFAULT_CONFIG)
    try:
        close_conn = False
        if conn is None:
            import pymssql
            import sys, os
            sys.path.insert(0, os.path.expanduser('~'))
            from config import AZURE_SERVER, AZURE_DATABASE, AZURE_USERNAME, AZURE_PASSWORD
            conn = pymssql.connect(server=AZURE_SERVER, user=AZURE_USERNAME,
                                   password=AZURE_PASSWORD, database=AZURE_DATABASE,
                                   tds_version='7.3')
            close_conn = True
        cursor = conn.cursor()
        cursor.execute("SELECT config_key, config_value FROM scoring_config")
        rows = cursor.fetchall()
        if close_conn:
            conn.close()
        if rows:
            for key, val in rows:
                try:
                    config[key] = float(val)
                except (ValueError, TypeError):
                    pass
            print(f"Loaded {len(rows)} scoring config values from database")
    except Exception as e:
        print(f"Warning: Could not load scoring_config, using defaults: {e}")
    return config


def _cfg(config):
    return config if config else dict(DEFAULT_CONFIG)


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


def get_schema(config=None):
    c = _cfg(config)
    cats = {
        'descent': {'max': int(c['descent_max']), 'description': 'Glideslope tracking quality'},
        'stabilized': {'max': int(c['stabilized_max']), 'description': 'Stabilized approach distance'},
        'centerline': {'max': int(c['centerline_max']), 'description': 'Runway centerline tracking'},
        'turnToFinal': {'max': int(c['turn_to_final_max']), 'description': 'Turn to final quality'},
        'speedControl': {'max': int(c['speed_control_max']), 'description': 'Approach speed discipline'},
        'thresholdCrossing': {'max': int(c['threshold_max']), 'description': 'Threshold crossing height'}
    }
    return {
        'version': SCORING_VERSION,
        'categories': cats,
        'severePenalties': {
            'CFIT_RISK': {'penalty': int(c['cfit_penalty']), 'description': 'Below glideslope when low'},
            'STALL_RISK': {'penalty': int(c['stall_penalty']), 'description': 'Near stall speed when high'}
        },
        'maxTotal': sum(cat['max'] for cat in cats.values())
    }


def calc_bank_angle(turn_rate, speed_kts):
    if not turn_rate or not speed_kts:
        return 0
    speed_fts = speed_kts * 1.687
    omega_rads = turn_rate * math.pi / 180
    return abs(math.degrees(math.atan(speed_fts * omega_rads / 32.2)))


def calc_crosswind(wind_dir, wind_speed, runway_hdg):
    if wind_dir is None or wind_speed is None:
        return 0
    wind_angle = abs(wind_dir - runway_hdg)
    if wind_angle > 180:
        wind_angle = 360 - wind_angle
    return abs(math.sin(math.radians(wind_angle)) * wind_speed)


def score_descent(sorted_pts, config=None, **kwargs):
    c = _cfg(config)
    max_pts = int(c['descent_max'])
    result = {'score': max_pts, 'max': max_pts, 'details': [], 'deductions': []}
    gs_devs = [p.get('gsDevFt') for p in sorted_pts if p.get('gsDevFt') is not None]
    if not gs_devs:
        result['details'].append("No glideslope data")
        return result
    avg_gs_dev = sum(gs_devs) / len(gs_devs)
    below_gs = len([d for d in gs_devs if d < c['gs_warning_below']])
    way_below = len([d for d in gs_devs if d < c['gs_dangerous_below']])
    above_gs = len([d for d in gs_devs if d > c['gs_high_above']])
    if way_below > 0:
        deduct = min(10, way_below * 2)
        result['score'] -= deduct
        result['deductions'].append(f"-{deduct}: {way_below} pts >{abs(c['gs_dangerous_below'])}ft below GS (dangerous)")
    if below_gs > way_below:
        deduct = min(5, below_gs - way_below)
        result['score'] -= deduct
        result['deductions'].append(f"-{deduct}: {below_gs - way_below} pts {abs(c['gs_warning_below'])}-{abs(c['gs_dangerous_below'])}ft below GS")
    if above_gs > 3:
        deduct = min(3, (above_gs - 3) // 2)
        result['score'] -= deduct
        result['deductions'].append(f"-{deduct}: {above_gs} pts >{c['gs_high_above']}ft above GS")
    climbing = len([p for p in sorted_pts if p.get('vs') and p.get('vs') > c['climbing_threshold']])
    if climbing > 0:
        deduct = min(5, climbing)
        result['score'] -= deduct
        result['deductions'].append(f"-{deduct}: {climbing} pts climbing on approach")
    result['score'] = max(0, result['score'])
    result['details'].append(f"Avg GS dev: {avg_gs_dev:.0f}ft, Below: {below_gs}, Above: {above_gs}")
    return result


def score_stabilized(sorted_pts, target_speed=70, config=None, **kwargs):
    c = _cfg(config)
    max_pts = int(c['stabilized_max'])
    result = {'score': max_pts, 'max': max_pts, 'details': [], 'deductions': []}
    stabilized_dist = 0
    for p in sorted_pts:
        on_speed = p.get('speed') and abs(p.get('speed') - target_speed) <= c['stabilized_speed_tol']
        on_gs = p.get('gsDevFt') is not None and abs(p.get('gsDevFt')) < c['stabilized_gs_tol']
        on_cl = abs(p.get('crossTrackFt', 999)) < c['stabilized_cl_tol']
        if on_speed and on_gs and on_cl:
            stabilized_dist = p.get('distNm', 0)
            break
    result['details'].append(f"Stabilized at {stabilized_dist:.2f}nm")
    result['metrics'] = {'stabilizedDist': stabilized_dist}
    if stabilized_dist < c['stabilized_critical_dist']:
        result['score'] -= 15
        result['deductions'].append(f"-15: Not stabilized until <{c['stabilized_critical_dist']}nm (go-around criteria)")
    elif stabilized_dist < c['stabilized_late_dist']:
        result['score'] -= 10
        result['deductions'].append(f"-10: Stabilized late ({stabilized_dist:.1f}nm)")
    elif stabilized_dist < c['stabilized_ideal_dist']:
        result['score'] -= 5
        result['deductions'].append(f"-5: Stabilized at {stabilized_dist:.1f}nm (ideal >{c['stabilized_ideal_dist']}nm)")
    result['score'] = max(0, result['score'])
    return result


def score_centerline(sorted_pts, crosswind=0, config=None, **kwargs):
    c = _cfg(config)
    max_pts = int(c['centerline_max'])
    result = {'score': max_pts, 'max': max_pts, 'details': [], 'deductions': []}
    xw_margin = crosswind * c['crosswind_allowance']
    cross_tracks = [abs(p.get('crossTrackFt', 0)) for p in sorted_pts]
    if not cross_tracks:
        result['details'].append("No crosstrack data")
        return result
    avg_cross = sum(cross_tracks) / len(cross_tracks)
    max_cross = max(cross_tracks)
    adj_max = max(0, max_cross - xw_margin)
    if adj_max > c['cl_max_severe']:
        result['score'] -= 10
        result['deductions'].append(f"-10: Max deviation {max_cross:.0f}ft")
    elif adj_max > c['cl_max_warning']:
        result['score'] -= 5
        result['deductions'].append(f"-5: Max deviation {max_cross:.0f}ft")
    if avg_cross > c['cl_avg_severe']:
        result['score'] -= 5
        result['deductions'].append(f"-5: Avg deviation {avg_cross:.0f}ft")
    elif avg_cross > c['cl_avg_warning']:
        result['score'] -= 2
        result['deductions'].append(f"-2: Avg deviation {avg_cross:.0f}ft")
    result['score'] = max(0, result['score'])
    result['details'].append(f"Avg: {avg_cross:.0f}ft, Max: {max_cross:.0f}ft, XW adj: {xw_margin:.0f}ft")
    result['metrics'] = {'avgCrosstrack': int(avg_cross), 'maxCrosstrack': int(max_cross)}
    return result


def score_turn_to_final(sorted_pts, config=None, **kwargs):
    c = _cfg(config)
    max_pts = int(c['turn_to_final_max'])
    result = {'score': max_pts, 'max': max_pts, 'details': [], 'deductions': []}
    banks = [calc_bank_angle(p.get('turn_rate'), p.get('speed')) for p in sorted_pts]
    max_bank = max(banks) if banks else 0
    steep_banks = len([b for b in banks if b > c['bank_angle_steep']])
    if steep_banks > 0:
        deduct = min(10, steep_banks * 2)
        result['score'] -= deduct
        result['deductions'].append(f"-{deduct}: {steep_banks} pts with bank >{c['bank_angle_steep']}deg (max {max_bank:.1f}deg)")
    crossings = 0
    prev_side = None
    dz = c['cl_crossing_threshold']
    for p in sorted_pts:
        ct = p.get('crossTrackFt', 0)
        side = 'R' if ct > dz else 'L' if ct < -dz else None
        if side and prev_side and side != prev_side:
            crossings += 1
        if side:
            prev_side = side
    if crossings > 1:
        deduct = min(5, (crossings - 1) * 2)
        result['score'] -= deduct
        result['deductions'].append(f"-{deduct}: {crossings} centerline crossings (S-turns)")
    result['score'] = max(0, result['score'])
    result['details'].append(f"Max bank: {max_bank:.1f}deg, CL crossings: {crossings}")
    result['metrics'] = {'maxBank': round(max_bank, 1), 'clCrossings': crossings}
    return result


def score_speed_control(sorted_pts, target_speed=70, gust=0, config=None, **kwargs):
    c = _cfg(config)
    max_pts = int(c['speed_control_max'])
    result = {'score': max_pts, 'max': max_pts, 'details': [], 'deductions': []}
    gust_margin = gust / 2 if gust > 0 else 0
    speed_tol = c['speed_base_tolerance'] + gust_margin
    speeds = [p.get('speed') for p in sorted_pts if p.get('speed') is not None]
    if not speeds:
        result['details'].append("No speed data")
        return result
    avg_speed = sum(speeds) / len(speeds)
    speed_devs = [abs(s - target_speed) for s in speeds]
    max_speed_dev = max(speed_devs) if speed_devs else 0
    out_of_tol = len([s for s in speeds if abs(s - target_speed) > speed_tol])
    if max_speed_dev > c['speed_major_deviation']:
        result['score'] -= 8
        result['deductions'].append(f"-8: Speed varied {max_speed_dev:.0f}kt from target")
    elif max_speed_dev > c['speed_minor_deviation']:
        result['score'] -= 4
        result['deductions'].append(f"-4: Speed varied {max_speed_dev:.0f}kt from target")
    oot_pct = c['speed_out_of_tol_pct'] / 100.0
    if out_of_tol > len(speeds) * oot_pct:
        result['score'] -= 4
        result['deductions'].append(f"-4: {out_of_tol}/{len(speeds)} pts outside +/-{speed_tol:.0f}kt")
    result['score'] = max(0, result['score'])
    result['details'].append(f"Target: {target_speed}kt +/-{speed_tol:.1f}kt, Avg: {avg_speed:.0f}kt")
    result['metrics'] = {'avgSpeed': int(avg_speed), 'maxSpeedDev': int(max_speed_dev)}
    return result


def score_threshold_crossing(sorted_pts, config=None, **kwargs):
    c = _cfg(config)
    max_pts = int(c['threshold_max'])
    result = {'score': max_pts, 'max': max_pts, 'details': [], 'deductions': []}
    near_threshold = [p for p in sorted_pts if p.get('distNm', 99) < 0.15]
    threshold_agl = near_threshold[-1].get('agl') if near_threshold else None
    if threshold_agl is not None:
        result['details'].append(f"Crossed at {threshold_agl:.0f}ft AGL (target {c['threshold_target']}ft)")
        result['metrics'] = {'thresholdAgl': int(threshold_agl)}
        if threshold_agl < c['threshold_dangerous_low']:
            result['score'] -= 8
            result['deductions'].append(f"-8: Too low! {threshold_agl:.0f}ft AGL (dangerous)")
        elif threshold_agl < c['threshold_low']:
            result['score'] -= 4
            result['deductions'].append(f"-4: Low crossing {threshold_agl:.0f}ft AGL")
        elif threshold_agl > c['threshold_high']:
            result['score'] -= 5
            result['deductions'].append(f"-5: High crossing {threshold_agl:.0f}ft (long landing)")
        elif threshold_agl > c['threshold_slightly_high']:
            result['score'] -= 2
            result['deductions'].append(f"-2: Slightly high {threshold_agl:.0f}ft")
    else:
        result['score'] = 0
        result['details'].append("No data near threshold")
        result['deductions'].append(f"-{max_pts}: No threshold crossing data")
        result['metrics'] = {'thresholdAgl': None}
    result['score'] = max(0, result['score'])
    return result


def check_severe_penalties(sorted_pts, dirty_stall=45, config=None, **kwargs):
    c = _cfg(config)
    penalties = []
    below_gs_low = [p for p in sorted_pts
                    if p.get('agl', 999) < c['cfit_agl_threshold']
                    and p.get('gsDevFt', 0) < c['cfit_gs_below']]
    if below_gs_low:
        worst = min(p.get('gsDevFt', 0) for p in below_gs_low)
        penalties.append({
            'type': 'CFIT_RISK',
            'description': 'Below glideslope when low',
            'detail': f"{len(below_gs_low)} pts below GS when <{c['cfit_agl_threshold']}ft AGL (worst: {worst:.0f}ft)",
            'penalty': int(c['cfit_penalty'])
        })
    near_stall = [p for p in sorted_pts
                  if p.get('agl', 0) > c['stall_agl_threshold']
                  and p.get('speed')
                  and p.get('speed') < dirty_stall + c['stall_margin']]
    if near_stall:
        lowest = min(p.get('speed') for p in near_stall)
        margin = lowest - dirty_stall
        penalties.append({
            'type': 'STALL_RISK',
            'description': 'Near stall speed when high',
            'detail': f"{len(near_stall)} pts within {c['stall_margin']}kts of stall ({lowest}kt, Vs {dirty_stall}kt, margin {margin:.0f}kt)",
            'penalty': int(c['stall_penalty'])
        })
    return penalties


def calculate_approach_score(approach_points, runway, metar=None, aircraft_speeds=None, config=None):
    if not approach_points or not runway:
        return None
    c = _cfg(config)
    rwy_hdg = float(runway.get('heading') or 0)
    wind_dir = metar.get('wind_dir_degrees') if metar else None
    wind_spd = metar.get('wind_speed_kt') or 0 if metar else 0
    wind_gust = metar.get('wind_gust_kt') or 0 if metar else 0
    target_speed = aircraft_speeds.get('appr_speed') or 70 if aircraft_speeds else 70
    dirty_stall = aircraft_speeds.get('dirty_stall') or 45 if aircraft_speeds else 45
    crosswind = calc_crosswind(wind_dir, wind_spd, rwy_hdg)
    sorted_pts = sorted(approach_points, key=lambda p: -p.get('distNm', 0))
    score_kwargs = {
        'target_speed': target_speed,
        'dirty_stall': dirty_stall,
        'crosswind': crosswind,
        'gust': wind_gust,
        'config': c,
    }
    scores = {
        'descent': score_descent(sorted_pts, **score_kwargs),
        'stabilized': score_stabilized(sorted_pts, **score_kwargs),
        'centerline': score_centerline(sorted_pts, **score_kwargs),
        'turnToFinal': score_turn_to_final(sorted_pts, **score_kwargs),
        'speedControl': score_speed_control(sorted_pts, **score_kwargs),
        'thresholdCrossing': score_threshold_crossing(sorted_pts, **score_kwargs)
    }
    severe_penalties = check_severe_penalties(sorted_pts, **score_kwargs)
    total = sum(s['score'] for s in scores.values())
    max_total = sum(s['max'] for s in scores.values())
    severe_total = sum(p['penalty'] for p in severe_penalties)
    total = max(0, total - severe_total)
    pct = round(total / max_total * 100)
    grade = 'A' if total >= 90 else 'B' if total >= 80 else 'C' if total >= 70 else 'D' if total >= 60 else 'F'
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
        'wind': {'dir': wind_dir, 'speed': wind_spd, 'gust': wind_gust, 'crosswind': int(crosswind)},
        'aircraftData': {'targetSpeed': target_speed, 'dirtyStall': dirty_stall},
        'scoredAt': datetime.utcnow().isoformat()
    }


def calc_approach_data(track, runway, heading_filter=30):
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
        R = 3440.065
        d_lat = math.radians(p_lat - th_lat)
        d_lon = math.radians(p_lon - th_lon)
        a = math.sin(d_lat/2)**2 + math.cos(math.radians(th_lat)) * math.cos(math.radians(p_lat)) * math.sin(d_lon/2)**2
        dist_nm = 2 * R * math.asin(math.sqrt(a))
        y = math.sin(d_lon) * math.cos(math.radians(p_lat))
        x = math.cos(math.radians(th_lat)) * math.sin(math.radians(p_lat)) - math.sin(math.radians(th_lat)) * math.cos(math.radians(p_lat)) * math.cos(d_lon)
        bearing = (math.degrees(math.atan2(y, x)) + 360) % 360
        inbound = hdg
        angle_diff = bearing - ((hdg + 180) % 360)
        if angle_diff > 180:
            angle_diff -= 360
        if angle_diff < -180:
            angle_diff += 360
        along_track = dist_nm * math.cos(math.radians(angle_diff))
        cross_track = dist_nm * math.sin(math.radians(angle_diff)) * 6076.12
        alt = p.get('altitude') or 0
        agl = alt - elev
        ideal_alt = elev + tch + (along_track * 6076.12 * math.tan(math.radians(gs_angle)))
        gs_dev = alt - ideal_alt
        track_hdg = p.get('track')
        if track_hdg is not None:
            diff = abs(float(track_hdg) - inbound)
            if diff > 180:
                diff = 360 - diff
            if diff > heading_filter:
                continue
        if along_track <= 0 or along_track > 10:
            continue
        results.append({
            'idx': idx, 'distNm': along_track, 'crossTrackFt': cross_track,
            'altitude': alt, 'agl': agl, 'gsDevFt': gs_dev,
            'speed': p.get('speed'), 'vs': p.get('vertical_speed'),
            'track': track_hdg, 'turn_rate': p.get('turn_rate'), 'accel': p.get('accel')
        })
    return results
