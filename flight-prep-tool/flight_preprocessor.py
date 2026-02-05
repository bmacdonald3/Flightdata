"""
Flight Preprocessor
Handles ghost flight detection, touch-and-go splitting, and data quality flags.
"""

import math
from datetime import datetime, timedelta

def get_airport_elevation(cursor, icao):
    """Get airport elevation from database"""
    cursor.execute("SELECT elevation FROM faa_airports WHERE icao_id = %s", (icao,))
    row = cursor.fetchone()
    return row['elevation'] if row else 0

def detect_ghost_flight(track, arrival_airport, airport_elevation=0):
    """
    Detect if a flight is a ghost (no real approach data).
    
    Returns:
        (is_ghost, reason) tuple
    """
    if not track or len(track) < 5:
        return True, "Too few track points"
    
    # Check if we have any low altitude points
    min_alt = min(p.get('altitude') or 99999 for p in track)
    max_alt = max(p.get('altitude') or 0 for p in track)
    
    # Calculate AGL for minimum altitude
    min_agl = min_alt - airport_elevation
    
    # Ghost detection rules:
    # 1. Never got below 3000ft AGL - probably lost radar before descent
    if min_agl > 3000:
        return True, f"Never below 3000ft AGL (min: {min_agl:.0f}ft AGL)"
    
    # 2. No significant altitude change - might be overflight
    alt_range = max_alt - min_alt
    if alt_range < 500:
        return True, f"No descent (alt range only {alt_range:.0f}ft)"
    
    # 3. Last point still too high - lost radar before approach
    last_alt = track[-1].get('altitude') or 99999
    last_agl = last_alt - airport_elevation
    if last_agl > 2000:
        return True, f"Last point too high ({last_agl:.0f}ft AGL)"
    
    # 4. Check if speeds are reasonable for landing
    last_speeds = [p.get('speed') for p in track[-5:] if p.get('speed')]
    if last_speeds and min(last_speeds) > 200:
        return True, f"Final speeds too high ({min(last_speeds)}kts) - jet not slowing"
    
    return False, None


def detect_touch_and_goes(track, runway, airport_elevation=0):
    """
    Detect touch-and-go patterns by finding altitude cycles.
    
    Returns:
        List of (start_idx, end_idx, leg_type) tuples
        leg_type: 'full_stop', 'touch_and_go', 'low_approach'
    """
    if not track or len(track) < 10:
        return [(0, len(track) - 1, 'unknown')]
    
    legs = []
    
    # Find altitude valleys (potential touchdowns)
    altitudes = [p.get('altitude') or 0 for p in track]
    agls = [alt - airport_elevation for alt in altitudes]
    
    # Smooth the altitude data (3-point moving average)
    smoothed = []
    for i in range(len(agls)):
        start = max(0, i - 1)
        end = min(len(agls), i + 2)
        smoothed.append(sum(agls[start:end]) / (end - start))
    
    # Find local minima (valleys) below 500ft AGL
    valleys = []
    for i in range(2, len(smoothed) - 2):
        if smoothed[i] < 500:  # Below 500ft AGL
            if smoothed[i] <= smoothed[i-1] and smoothed[i] <= smoothed[i+1]:
                if smoothed[i] <= smoothed[i-2] and smoothed[i] <= smoothed[i+2]:
                    valleys.append(i)
    
    # Merge valleys that are too close together (within 30 seconds)
    merged_valleys = []
    for v in valleys:
        if not merged_valleys:
            merged_valleys.append(v)
        else:
            last_v = merged_valleys[-1]
            try:
                t1 = track[last_v].get('position_time')
                t2 = track[v].get('position_time')
                if isinstance(t1, str):
                    t1 = datetime.fromisoformat(t1.replace('Z', '+00:00'))
                if isinstance(t2, str):
                    t2 = datetime.fromisoformat(t2.replace('Z', '+00:00'))
                if (t2 - t1).total_seconds() > 60:
                    merged_valleys.append(v)
                else:
                    # Keep the lower one
                    if smoothed[v] < smoothed[last_v]:
                        merged_valleys[-1] = v
            except:
                merged_valleys.append(v)
    
    # If no valleys or only one, it's a single approach
    if len(merged_valleys) <= 1:
        leg_type = 'full_stop' if merged_valleys else 'unknown'
        return [(0, len(track) - 1, leg_type)]
    
    # Multiple valleys = touch-and-goes
    # First leg: start to first valley
    legs.append((0, merged_valleys[0], 'touch_and_go'))
    
    # Middle legs: valley to valley
    for i in range(len(merged_valleys) - 1):
        # Check if there's a significant climb between valleys
        start_idx = merged_valleys[i]
        end_idx = merged_valleys[i + 1]
        max_between = max(smoothed[start_idx:end_idx+1])
        
        if max_between > smoothed[start_idx] + 300:  # Climbed at least 300ft
            legs.append((start_idx, end_idx, 'touch_and_go'))
        else:
            # Extend previous leg
            if legs:
                legs[-1] = (legs[-1][0], end_idx, legs[-1][2])
    
    # Last leg: last valley to end
    last_valley = merged_valleys[-1]
    # Check if there's a climb after the last valley
    if last_valley < len(smoothed) - 5:
        max_after = max(smoothed[last_valley:])
        if max_after > smoothed[last_valley] + 300:
            legs.append((last_valley, len(track) - 1, 'touch_and_go'))
        else:
            legs.append((last_valley, len(track) - 1, 'full_stop'))
    else:
        legs.append((last_valley, len(track) - 1, 'full_stop'))
    
    return legs


def preprocess_flight(track, arrival_airport, cursor=None):
    """
    Main preprocessing function.
    
    Returns:
        {
            'is_ghost': bool,
            'ghost_reason': str or None,
            'legs': list of leg dicts,
            'flags': list of processing flags,
            'original_point_count': int
        }
    """
    result = {
        'is_ghost': False,
        'ghost_reason': None,
        'legs': [],
        'flags': [],
        'original_point_count': len(track) if track else 0
    }
    
    if not track:
        result['is_ghost'] = True
        result['ghost_reason'] = "No track data"
        return result
    
    # Get airport elevation
    airport_elevation = 0
    if cursor and arrival_airport:
        airport_elevation = get_airport_elevation(cursor, arrival_airport) or 0
    
    # Check for ghost flight
    is_ghost, ghost_reason = detect_ghost_flight(track, arrival_airport, airport_elevation)
    if is_ghost:
        result['is_ghost'] = True
        result['ghost_reason'] = ghost_reason
        result['flags'].append(f"GHOST: {ghost_reason}")
        return result
    
    # Detect touch-and-goes
    legs_info = detect_touch_and_goes(track, None, airport_elevation)
    
    if len(legs_info) > 1:
        result['flags'].append(f"PATTERN: {len(legs_info)} legs detected")
    
    for start_idx, end_idx, leg_type in legs_info:
        leg_track = track[start_idx:end_idx + 1]
        
        # Get time range for this leg
        try:
            start_time = leg_track[0].get('position_time')
            end_time = leg_track[-1].get('position_time')
            if isinstance(start_time, str):
                start_time = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
            if isinstance(end_time, str):
                end_time = datetime.fromisoformat(end_time.replace('Z', '+00:00'))
        except:
            start_time = end_time = None
        
        # Calculate leg stats
        leg_alts = [p.get('altitude') or 0 for p in leg_track]
        
        result['legs'].append({
            'start_idx': start_idx,
            'end_idx': end_idx,
            'leg_type': leg_type,
            'point_count': len(leg_track),
            'track': leg_track,
            'min_alt': min(leg_alts),
            'max_alt': max(leg_alts),
            'start_time': start_time.isoformat() if start_time else None,
            'end_time': end_time.isoformat() if end_time else None
        })
    
    return result


def truncate_to_approach(track, runway, max_distance_nm=15, airport_elevation=0):
    """
    Truncate track to only include approach segment.
    Removes cruise/enroute portions.
    
    Returns:
        (truncated_track, flags)
    """
    if not track or not runway:
        return track, []
    
    flags = []
    
    th_lat = float(runway.get('threshold_lat') or 0)
    th_lon = float(runway.get('threshold_lon') or 0)
    
    # Calculate distance from threshold for each point
    distances = []
    for p in track:
        if not p.get('latitude') or not p.get('longitude'):
            distances.append(9999)
            continue
        
        p_lat = float(p['latitude'])
        p_lon = float(p['longitude'])
        
        # Haversine distance
        R = 3440.065
        d_lat = math.radians(p_lat - th_lat)
        d_lon = math.radians(p_lon - th_lon)
        a = math.sin(d_lat/2)**2 + math.cos(math.radians(th_lat)) * math.cos(math.radians(p_lat)) * math.sin(d_lon/2)**2
        dist_nm = 2 * R * math.asin(math.sqrt(a))
        distances.append(dist_nm)
    
    # Find where aircraft enters approach zone (within max_distance_nm)
    start_idx = 0
    for i, d in enumerate(distances):
        if d <= max_distance_nm:
            start_idx = i
            break
    
    if start_idx > 0:
        flags.append(f"TRUNCATED: Removed {start_idx} cruise points (>{max_distance_nm}nm)")
    
    # Also remove points that are too high (above 5000ft AGL) at start
    for i in range(start_idx, len(track)):
        alt = track[i].get('altitude') or 0
        agl = alt - airport_elevation
        if agl <= 5000:
            if i > start_idx:
                flags.append(f"TRUNCATED: Removed {i - start_idx} high-altitude points (>5000ft AGL)")
            start_idx = i
            break
    
    return track[start_idx:], flags


if __name__ == '__main__':
    # Test with sample data
    print("Flight Preprocessor module loaded successfully")
    print("Functions: detect_ghost_flight, detect_touch_and_goes, preprocess_flight, truncate_to_approach")
