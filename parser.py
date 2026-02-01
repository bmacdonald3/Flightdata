#!/usr/bin/env python3
"""
BMAC3 Flight Tracker - Parser & Uploader
Reads raw XML file, parses flight data, uploads to Azure SQL.
Deletes processed data from the XML file to save disk space.
Controlled via bmac3_state.json (start/stop from Home Assistant)
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
from config import *

try:
    import pyodbc
except ImportError:
    print("pyodbc not installed. Run: pip install pyodbc --break-system-packages")
    sys.exit(1)

logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format="%(asctime)s [PARSER] %(message)s"
)

def get_state():
    try:
        with open(HA_STATE_FILE, "r") as f:
            return json.load(f)
    except:
        return {"collector_enabled": True}

def save_state(state):
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

def get_namevalue(flight, name):
    """Helper to pull a value from supplementalData nameValue pairs"""
    for nv in flight.findall('.//nameValue'):
        if nv.get('name') == name:
            return nv.get('value')
    return None

def parse_flight(xml_string):
    """
    Parse a single <message> block and extract flight data.

    THIS IS THE PARSING LOGIC - edit this function to adjust
    how flight data is extracted from the XML.

    NOTE: Despite the ns5/ns2 namespace declarations in the raw XML,
    ElementTree resolves child elements to bare tag names after parsing.
    All lookups use unprefixed paths.
    """
    try:
        wrapped = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<ns5:MessageCollection xmlns:ns5="http://www.faa.aero/nas/3.0" '
            'xmlns:ns2="http://www.fixm.aero/base/3.0" '
            'xmlns:ns3="http://www.fixm.aero/flight/3.0" '
            'xmlns:ns4="http://www.fixm.aero/foundation/3.0" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            + xml_string +
            '</ns5:MessageCollection>'
        )

        root = ET.fromstring(wrapped)
        flight = root.find('.//flight')
        if flight is None:
            return None

        data = {}

        # ── Timestamp & Center ──
        data['timestamp'] = flight.get('timestamp')
        data['center'] = flight.get('centre')

        # ── Flight Identification ──
        flight_id = flight.find('.//flightIdentification')
        if flight_id is not None:
            data['callsign'] = flight_id.get('aircraftIdentification')
            data['computer_id'] = flight_id.get('computerId')

        # ── GUFI ──
        gufi = flight.find('.//gufi')
        if gufi is not None:
            data['gufi'] = gufi.text

        # ── Departure ──
        departure = flight.find('.//departure')
        if departure is not None:
            data['departure'] = departure.get('departurePoint')
            dep_actual = departure.find('.//runwayTime/actual')
            if dep_actual is not None:
                data['departure_actual_time'] = dep_actual.get('time')

        # ── Arrival ──
        arrival = flight.find('.//arrival')
        if arrival is not None:
            data['arrival'] = arrival.get('arrivalPoint')
            arr_est = arrival.find('.//runwayTime/estimated')
            if arr_est is not None:
                data['arrival_estimated_time'] = arr_est.get('time')

        # ── Flight Status ──
        status = flight.find('.//flightStatus')
        if status is not None:
            data['status'] = status.get('fdpsFlightStatus')

        # ── Operator ──
        org = flight.find('.//operator/operatingOrganization/organization')
        if org is not None:
            data['operator'] = org.get('name')

        # ── Controlling Unit ──
        cu = flight.find('.//controllingUnit')
        if cu is not None:
            data['controlling_unit'] = cu.get('unitIdentifier')
            data['controlling_sector'] = cu.get('sectorIdentifier')

        # ── Flight Plan ID ──
        fp = flight.find('.//flightPlan')
        if fp is not None:
            data['flight_plan_id'] = fp.get('identifier')

        # ── Assigned Altitude ──
        aa_simple = flight.find('.//assignedAltitude/simple')
        aa_vfr    = flight.find('.//assignedAltitude/vfr')
        aa_vfrp   = flight.find('.//assignedAltitude/vfrPlus')
        if aa_simple is not None and aa_simple.text:
            data['assigned_altitude'] = int(float(aa_simple.text))
            data['assigned_altitude_type'] = 'IFR'
        elif aa_vfrp is not None and aa_vfrp.text:
            data['assigned_altitude'] = int(float(aa_vfrp.text))
            data['assigned_altitude_type'] = 'VFR+'
        elif aa_vfr is not None:
            data['assigned_altitude'] = None
            data['assigned_altitude_type'] = 'VFR'

        # ── Position Block ──
        pos_block = flight.find('.//enRoute/position')
        if pos_block is not None:
            data['position_time'] = pos_block.get('positionTime')

            inner_pos = pos_block.find('position')
            if inner_pos is not None:
                pos_el = inner_pos.find('.//pos')
                if pos_el is not None and pos_el.text:
                    coords = pos_el.text.strip().split()
                    if len(coords) == 2:
                        data['latitude'] = float(coords[0])
                        data['longitude'] = float(coords[1])

            altitude = pos_block.find('altitude')
            if altitude is not None and altitude.text:
                data['altitude'] = int(float(altitude.text))

            speed = pos_block.find('.//actualSpeed/surveillance')
            if speed is not None and speed.text:
                data['speed'] = int(float(speed.text))

            tv = pos_block.find('trackVelocity')
            if tv is not None:
                x_el = tv.find('x')
                y_el = tv.find('y')
                if x_el is not None and y_el is not None and x_el.text and y_el.text:
                    x = float(x_el.text)
                    y = float(y_el.text)
                    track = math.degrees(math.atan2(x, y)) % 360
                    data['track'] = round(track, 1)

        # ── Mode S ──
        mode_s = get_namevalue(flight, 'ADSB_02M_52B')
        if mode_s:
            if '-' in mode_s:
                mode_s = mode_s.split('-')[-1]
            data['mode_s'] = mode_s

        return data if data.get('callsign') else None

    except Exception as e:
        logging.error(f"Parse error: {e}")
        return None

def calculate_vertical_speed(conn, gufi, current_alt, current_time):
    """
    Calculate vertical speed (FPM) by comparing current altitude
    to the most recent previous position for the same GUFI.
    """
    if not gufi or current_alt is None or current_time is None:
        return None

    try:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT TOP 1 altitude, position_time
            FROM flights
            WHERE gufi = ? AND altitude IS NOT NULL AND position_time IS NOT NULL
            ORDER BY position_time DESC
        ''', (gufi,))
        row = cursor.fetchone()

        if row is None:
            return None

        prev_alt = row[0]
        prev_time_str = str(row[1])

        if prev_alt is None or not prev_time_str:
            return None

        fmt_z   = "%Y-%m-%dT%H:%M:%SZ"
        fmt_sql = "%Y-%m-%d %H:%M:%S"
        try:
            t_current = datetime.strptime(current_time, fmt_z)
        except ValueError:
            return None
        try:
            t_prev = datetime.strptime(prev_time_str, fmt_z)
        except ValueError:
            try:
                t_prev = datetime.strptime(prev_time_str, fmt_sql)
            except ValueError:
                return None

        elapsed_seconds = (t_current - t_prev).total_seconds()
        if elapsed_seconds <= 0:
            return None

        alt_change = current_alt - prev_alt
        vsp = (alt_change / elapsed_seconds) * 60
        return round(vsp)

    except Exception as e:
        logging.error(f"Vertical speed calc error: {e}")
        return None

def upload_batch(conn, flights):
    """Upload a batch of parsed flights to Azure SQL"""
    if not flights:
        return 0

    cursor = conn.cursor()
    count = 0
    skipped = 0

    try:
        for f in flights:
            # Calculate vertical speed before inserting
            # f['vertical_speed'] = calculate_vertical_speed(
            f['vertical_speed'] = None

            try:
                cursor.execute('''
                    INSERT INTO flights
                    (timestamp, callsign, computer_id, gufi, departure, arrival,
                     departure_actual_time, arrival_estimated_time,
                     latitude, longitude, altitude, speed, track,
                     assigned_altitude, assigned_altitude_type,
                     vertical_speed, position_time,
                     status, operator, center,
                     controlling_unit, controlling_sector,
                     flight_plan_id, mode_s)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    f.get('timestamp'),
                    f.get('callsign'),
                    f.get('computer_id'),
                    f.get('gufi'),
                    f.get('departure'),
                    f.get('arrival'),
                    f.get('departure_actual_time'),
                    f.get('arrival_estimated_time'),
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
                    f.get('operator'),
                    f.get('center'),
                    f.get('controlling_unit'),
                    f.get('controlling_sector'),
                    f.get('flight_plan_id'),
                    f.get('mode_s'),
                ))
                count += 1
            except pyodbc.IntegrityError:
                skipped += 1
                conn.rollback()
                continue

        conn.commit()
        logging.info(f"Uploaded {count} flights, skipped {skipped} duplicates")
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

    pattern = r'(<message\s[^>]*>.*?</message>)'
    messages = re.findall(pattern, content, re.DOTALL)

    if not messages:
        return 0

    logging.info(f"Found {len(messages)} messages to process")

    flights = []
    for msg in messages:
        flight = parse_flight(msg)
        if flight:
            flights.append(flight)

    logging.info(f"Parsed {len(flights)} valid flights")

    uploaded = upload_batch(conn, flights)

    if uploaded > 0:
        last_msg_end = content.rfind('</message>') + len('</message>')
        remaining = content[last_msg_end:]

        with open(RAW_XML_FILE, "w") as f:
            f.write(remaining)

        logging.info(f"Trimmed processed data from {RAW_XML_FILE}")

    return uploaded

def main():
    logging.info("Parser starting...")

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

                if uploaded > 0:
                    state = get_state()
                    state["total_rows_uploaded"] = state.get("total_rows_uploaded", 0) + uploaded
                    state["last_upload_count"] = uploaded
                    state["last_upload_time"] = time.strftime("%Y-%m-%d %H:%M:%S")
                    save_state(state)

                time.sleep(PARSE_INTERVAL_SECONDS)

        except Exception as e:
            logging.error(f"Parser error: {e}")
            state = get_state()
            state["error"] = str(e)
            state["parser_running"] = False
            save_state(state)
        finally:
            if conn:
                conn.close()
            time.sleep(10)

if __name__ == "__main__":
    main()
