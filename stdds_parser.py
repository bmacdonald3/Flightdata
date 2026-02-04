#!/usr/bin/env python3
"""
BMAC3 STDDS Track Parser
Parses FAA SWIM STDDS (Terminal Automation) track/flight plan data.
Uploads to existing flights table in Azure SQL.
"""
import re
import sys
import os
import json
import time
import math
import logging
import xml.etree.ElementTree as ET
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stdds_config import *

try:
    import pyodbc
except ImportError:
    print("pyodbc not installed. Run: pip install pyodbc --break-system-packages")
    sys.exit(1)

logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format="%(asctime)s [STDDS-PARSE] %(message)s"
)

def get_state():
    """Read Home Assistant state file"""
    try:
        with open(HA_STATE_FILE, "r") as f:
            return json.load(f)
    except:
        return {"collector_enabled": True}

def save_state(state):
    """Write Home Assistant state file"""
    with open(HA_STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def connect_azure():
    """Connect to Azure SQL"""
    try:
        conn = pyodbc.connect(AZURE_CONN_STR)
        logging.info("Connected to Azure SQL")
        return conn
    except Exception as e:
        logging.error(f"Azure connection failed: {e}")
        return None

def compute_ground_speed(vx, vy):
    """
    Compute ground speed in knots from vx/vy components.
    """
    if vx is None or vy is None:
        return None
    try:
        # vx/vy appear to be in ~0.22 knot units based on typical values
        # scale removed - vx/vy already in knots
        speed = math.sqrt(vx**2 + vy**2)
        return round(speed)
    except:
        return None

def compute_heading(vx, vy):
    """
    Compute track heading in degrees from vx/vy components.
    Returns 0-360 degrees, 0 = North.
    """
    if vx is None or vy is None or (vx == 0 and vy == 0):
        return None
    try:
        heading = math.degrees(math.atan2(vx, vy)) % 360
        return round(heading, 1)
    except:
        return None

def get_text(element, tag, default=None):
    """Safely get text from a child element"""
    el = element.find(tag)
    if el is not None and el.text:
        return el.text.strip()
    return default

def get_int(element, tag, default=None):
    """Safely get integer from a child element"""
    text = get_text(element, tag)
    if text:
        try:
            return int(text)
        except ValueError:
            return default
    return default

def get_float(element, tag, default=None):
    """Safely get float from a child element"""
    text = get_text(element, tag)
    if text:
        try:
            return float(text)
        except ValueError:
            return default
    return default

def parse_record(record, facility):
    """
    Parse a single <record> element containing track and optional flight plan data.
    Returns a dict mapped to flights table columns, or None if invalid/filtered.
    """
    try:
        track = record.find('track')
        if track is None:
            return None
        
        # Get basic track data
        mrt_time = get_text(track, 'mrtTime')
        latitude = get_float(track, 'lat')
        longitude = get_float(track, 'lon')
        
        # Skip if missing required fields
        if latitude is None or longitude is None or mrt_time is None:
            return None
        
        # Get Mode S address
        ac_address = get_text(track, 'acAddress')
        if ac_address == '000000':
            ac_address = None
            
        # Compute velocity
        vx = get_int(track, 'vx')
        vy = get_int(track, 'vy')
        
        # Build data dict mapped to flights table columns
        data = {
            'source': 'STDDS',
            'timestamp': mrt_time,
            'position_time': mrt_time,
            'latitude': latitude,
            'longitude': longitude,
            'altitude': get_int(track, 'reportedAltitude'),
            'speed': compute_ground_speed(vx, vy),
            'track': compute_heading(vx, vy),
            'vertical_speed': get_int(track, 'vVert'),
            'mode_s': ac_address,
            'center': facility,  # Using center field for TRACON facility
            'status': get_text(track, 'status'),
        }
        
        # Parse flight plan if present
        flight_plan = record.find('flightPlan')
        if flight_plan is not None:
            data['callsign'] = get_text(flight_plan, 'acid')
            data['ac_type'] = get_text(flight_plan, 'acType')
            
            assigned_alt = get_int(flight_plan, 'assignedAltitude')
            if assigned_alt and assigned_alt > 0:
                data['assigned_altitude'] = assigned_alt
                data['assigned_altitude_type'] = 'IFR'
        
        # Parse enhanced data if present
        enhanced = record.find('enhancedData')
        if enhanced is not None:
            data['gufi'] = get_text(enhanced, 'sfdpsGufi')
            data['departure'] = get_text(enhanced, 'departureAirport')
            data['arrival'] = get_text(enhanced, 'destinationAirport')
        
        return data
        
    except Exception as e:
        logging.error(f"Parse error: {e}")
        return None

def parse_message(xml_string):
    """
    Parse a complete TATrackAndFlightPlan message.
    Returns a list of flight records.
    """
    try:
        root = ET.fromstring(xml_string)
        
        # Get facility from <src> element
        src = root.find('src')
        if src is None or not src.text:
            return []
        facility = src.text.strip()
        
        # Apply facility filter
        if FACILITY_FILTER and facility not in FACILITY_FILTER:
            return []
        
        records = []
        for record in root.findall('record'):
            data = parse_record(record, facility)
            if data:
                # Apply GA filter - only keep N-numbers
                if GA_ONLY:
                    callsign = data.get('callsign')
                    if not callsign or not callsign.startswith('N'):
                        continue
                        
                records.append(data)
        
        return records
        
    except ET.ParseError as e:
        logging.error(f"XML parse error: {e}")
        return []
    except Exception as e:
        logging.error(f"Message parse error: {e}")
        return []

def upload_batch(conn, flights):
    """Upload a batch of flight records to Azure SQL flights table"""
    if not flights:
        return 0
    
    cursor = conn.cursor()
    count = 0
    skipped = 0
    
    try:
        for f in flights:
            try:
                cursor.execute('''
                    INSERT INTO flights
                    (source, timestamp, callsign, gufi, departure, arrival,
                     latitude, longitude, altitude, speed, track,
                     assigned_altitude, assigned_altitude_type,
                     vertical_speed, position_time,
                     status, center, mode_s, ac_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    f.get('source'),
                    f.get('timestamp'),
                    f.get('callsign'),
                    f.get('gufi'),
                    f.get('departure'),
                    f.get('arrival'),
                    f.get('latitude'),
                    f.get('longitude'),
                    f.get('altitude'),
                    f.get('speed'),
                    f.get('track'),
                    f.get('assigned_altitude'),
                    f.get('assigned_altitude_type'),
                    f.get('vertical_speed'),
                    f.get('position_time'),
                    f.get('status'),
                    f.get('center'),
                    f.get('mode_s'),
                    f.get('ac_type'),
                ))
                count += 1
            except (pyodbc.IntegrityError, pyodbc.OperationalError, pyodbc.DatabaseError) as e:
                skipped += 1
                logging.warning(f"Skipped row ({f.get('callsign', 'unknown')}): {e}")
                continue
        
        conn.commit()
        if count > 0:
            logging.info(f"Uploaded {count} flights, skipped {skipped}")
        return count
        
    except Exception as e:
        logging.error(f"Upload error: {e}")
        conn.rollback()
        return 0

def process_file(conn):
    """
    Read raw XML file, extract messages, parse and upload.
    Then truncate the file to free disk space.
    """
    if not os.path.exists(RAW_XML_FILE):
        return 0
    
    with open(RAW_XML_FILE, "r") as f:
        content = f.read()
    
    if not content.strip():
        return 0
    
    # Find all TATrackAndFlightPlan messages
    pattern = r'(<(?:ns2:)?TATrackAndFlightPlan[^>]*>.*?</(?:ns2:)?TATrackAndFlightPlan>)'
    messages = re.findall(pattern, content, re.DOTALL)
    
    if not messages:
        return 0
    
    logging.info(f"Found {len(messages)} STDDS messages to process")
    
    # Parse all messages
    all_flights = []
    for msg in messages:
        flights = parse_message(msg)
        all_flights.extend(flights)
    
    logging.info(f"Parsed {len(all_flights)} GA flight records")
    
    # Upload in batches
    uploaded = 0
    for i in range(0, len(all_flights), MAX_BATCH_SIZE):
        chunk = all_flights[i:i+MAX_BATCH_SIZE]
        if conn is None:
            conn = connect_azure()
            if conn is None:
                logging.error("Reconnect failed mid-batch")
                break
        result = upload_batch(conn, chunk)
        if result == 0 and len(chunk) > 0:
            try:
                conn.close()
            except:
                pass
            conn = None
        uploaded += result
        
        # Update state after each batch
        if result > 0:
            state = get_state()
            state["total_rows_uploaded"] = state.get("total_rows_uploaded", 0) + result
            state["last_upload_count"] = result
            state["last_upload_time"] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_state(state)
    
    # Truncate processed data
    if uploaded > 0:
        last_msg_end = content.rfind('</TATrackAndFlightPlan>')
        if last_msg_end == -1:
            last_msg_end = content.rfind('</ns2:TATrackAndFlightPlan>')
            if last_msg_end != -1:
                last_msg_end += len('</ns2:TATrackAndFlightPlan>')
        else:
            last_msg_end += len('</TATrackAndFlightPlan>')
        
        if last_msg_end > 0:
            remaining = content[last_msg_end:]
            with open(RAW_XML_FILE, "w") as f:
                f.write(remaining)
            logging.info(f"Trimmed processed data from {RAW_XML_FILE}")
    
    return uploaded

def main():
    logging.info("STDDS Parser starting...")
    
    while True:
        state = get_state()
        
        if not state.get("collector_enabled", True):
            time.sleep(PARSE_INTERVAL_SECONDS)
            continue
        
        conn = connect_azure()
        if not conn:
            state = get_state()
            state["error"] = "Failed to connect to Azure SQL"
            state["parser_running"] = False
            save_state(state)
            time.sleep(30)
            continue
        
        state = get_state()
        state["parser_running"] = True
        state["error"] = None
        save_state(state)
        
        try:
            while True:
                state = get_state()
                if not state.get("collector_enabled", True):
                    break
                
                uploaded = process_file(conn)
                
                time.sleep(PARSE_INTERVAL_SECONDS)
                
        except Exception as e:
            logging.error(f"Parser error: {e}")
            state = get_state()
            state["error"] = str(e)
            state["parser_running"] = False
            save_state(state)
        finally:
            try:
                if conn:
                    conn.close()
            except:
                pass
            time.sleep(10)

if __name__ == "__main__":
    main()
