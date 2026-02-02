#!/usr/bin/env python3
"""
METAR Collector for Raspberry Pi
Fetches weather observations from Aviation Weather Center API
and uploads to Azure SQL database.
"""

import os
import sys
import json
import time
import logging
import signal
from datetime import datetime, timezone
from pathlib import Path

import pyodbc
import requests

# Configuration
AZURE_SERVER = "flight-data-server-macdonaldfamily.database.windows.net"
AZURE_DATABASE = "Flightdata"
AZURE_USERNAME = "flightadmin"
AZURE_PASSWORD = os.getenv("AZURE_PASSWORD")

AZURE_CONN_STR = (
    f"DRIVER={{ODBC Driver 18 for SQL Server}};"
    f"SERVER={AZURE_SERVER};"
    f"DATABASE={AZURE_DATABASE};"
    f"UID={AZURE_USERNAME};"
    f"PWD={AZURE_PASSWORD};"
    f"Encrypt=yes;"
    f"TrustServerCertificate=no;"
    f"Connection Timeout=30;"
)

FETCH_INTERVAL_SECONDS = 300
STATE_FILE = Path.home() / 'metar_state.json'
LOG_FILE = Path.home() / 'metar.log'
AWC_API_URL = "https://aviationweather.gov/api/data/metar"

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

DEFAULT_STATE = {
    "collector_enabled": True,
    "collector_running": False,
    "last_fetch_time": None,
    "last_fetch_success": None,
    "last_error": None,
    "total_fetches": 0,
    "total_observations": 0,
    "session_fetches": 0,
    "session_observations": 0,
    "airports_count": 0,
    "updated_at": None
}

def load_state():
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, 'r') as f:
                state = json.load(f)
                for key, default in DEFAULT_STATE.items():
                    if key not in state:
                        state[key] = default
                return state
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"Could not load state file: {e}")
    return DEFAULT_STATE.copy()

def save_state(state):
    state['updated_at'] = datetime.now(timezone.utc).isoformat()
    try:
        with open(STATE_FILE, 'w') as f:
            json.dump(state, f, indent=2)
    except IOError as e:
        logger.error(f"Could not save state file: {e}")

def get_db_connection():
    return pyodbc.connect(AZURE_CONN_STR)

def get_airport_list(conn):
    cursor = conn.cursor()
    cursor.execute("""
        SELECT a.airport_id, a.icao_code 
        FROM airports a 
        WHERE a.icao_code IS NOT NULL
        ORDER BY a.icao_code
    """)
    airports = {row.icao_code: row.airport_id for row in cursor.fetchall()}
    cursor.close()
    return airports

def safe_float(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        value = value.replace('+', '')
        try:
            return float(value)
        except ValueError:
            return None
    return None

def safe_int(value):
    if value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        if value.upper() == 'VRB':
            return None
        try:
            return int(value)
        except ValueError:
            return None
    return None

def parse_observation_time(obs_time_val):
    if obs_time_val is None:
        return None
    try:
        # Handle integer timestamp (Unix epoch)
        if isinstance(obs_time_val, (int, float)):
            return datetime.fromtimestamp(obs_time_val, tz=timezone.utc)
        # Handle ISO format string
        if isinstance(obs_time_val, str):
            return datetime.fromisoformat(obs_time_val.replace('Z', '+00:00'))
    except (ValueError, OSError) as e:
        logger.debug(f"Could not parse observation time {obs_time_val}: {e}")
    return None


def insert_metar(conn, airport_id, metar_data):
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO metar_observations (
                airport_id, observation_time, temp_c, dewpoint_c,
                wind_dir_degrees, wind_speed_kt, wind_gust_kt,
                visibility_miles, altimeter_inhg, sea_level_pressure_mb,
                flight_category, cloud_layers, weather_phenomena,
                raw_text, metar_type, fetched_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETUTCDATE())
        """, (
            airport_id,
            metar_data.get('obs_time'),
            safe_float(metar_data.get('temp')),
            safe_float(metar_data.get('dewp')),
            safe_int(metar_data.get('wdir')),
            safe_int(metar_data.get('wspd')),
            safe_int(metar_data.get('wgst')),
            safe_float(metar_data.get('visib')),
            safe_float(metar_data.get('altim')),
            safe_float(metar_data.get('slp')),
            metar_data.get('fltCat'),
            json.dumps(metar_data.get('clouds', [])),
            metar_data.get('wxString'),
            metar_data.get('rawOb'),
            metar_data.get('metarType')
        ))


        conn.commit()
        cursor.close()
        return True
    except pyodbc.IntegrityError:
        conn.rollback()
        cursor.close()
        return False
    except Exception as e:
        conn.rollback()
        cursor.close()
        raise e

def log_fetch(conn, airports_queried, observations_inserted, error_message, success=None):
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO metar_fetch_log (
            fetch_start, airports_requested, observations_inserted, 
            error_message, success
        ) VALUES (GETUTCDATE(), ?, ?, ?, ?)
    """, (airports_queried, observations_inserted, error_message, success))
    conn.commit()
    cursor.close()

def fetch_metars(icao_codes):
    if not icao_codes:
        return []
    ids_param = ','.join(icao_codes)
    try:
        response = requests.get(
            AWC_API_URL,
            params={'ids': ids_param, 'format': 'json'},
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        if isinstance(data, list):
            return data
        else:
            logger.warning(f"Unexpected API response format: {type(data)}")
            return []
    except requests.RequestException as e:
        logger.error(f"API request failed: {e}")
        return []
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse API response: {e}")
        return []

def run_fetch_cycle(state):
    conn = None
    try:
        conn = get_db_connection()
        airports = get_airport_list(conn)
        state['airports_count'] = len(airports)
        if not airports:
            return False, 0, "No airports configured"
        logger.info(f"Fetching METARs for {len(airports)} airports...")
        icao_codes = list(airports.keys())
        metars = fetch_metars(icao_codes)
        if not metars:
            return False, 0, "No METAR data returned from API"
        logger.info(f"Received {len(metars)} METAR observations")
        inserted = 0
        duplicates = 0
        for metar in metars:
            icao = metar.get('icaoId')
            if not icao or icao not in airports:
                continue
            airport_id = airports[icao]
            obs_time = parse_observation_time(metar.get('obsTime'))
            if not obs_time:
                continue
            metar['obs_time'] = obs_time
            if insert_metar(conn, airport_id, metar):
                inserted += 1
            else:
                duplicates += 1
        log_fetch(conn, len(airports), inserted, True)
        logger.info(f"Inserted {inserted} new observations ({duplicates} duplicates)")
        return True, inserted, None
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Fetch cycle failed: {error_msg}")
        if conn:
            try:
                log_fetch(conn, 0, 0, False, error_msg[:500])
            except:
                pass
        return False, 0, error_msg
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass

def main_loop():
    state = load_state()
    state['collector_running'] = True
    state['session_fetches'] = 0
    state['session_observations'] = 0
    save_state(state)
    logger.info("METAR Collector started")
    logger.info(f"Fetch interval: {FETCH_INTERVAL_SECONDS} seconds")
    shutdown_requested = False
    def handle_signal(signum, frame):
        nonlocal shutdown_requested
        logger.info(f"Received signal {signum}, shutting down...")
        shutdown_requested = True
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    while not shutdown_requested:
        state = load_state()
        state['collector_running'] = True
        if not state.get('collector_enabled', True):
            logger.info("Collector disabled, waiting...")
            save_state(state)
            time.sleep(10)
            continue
        success, observations, error = run_fetch_cycle(state)
        state['last_fetch_time'] = datetime.now(timezone.utc).isoformat()
        state['last_fetch_success'] = success
        state['last_error'] = error
        if success:
            state['total_fetches'] = state.get('total_fetches', 0) + 1
            state['total_observations'] = state.get('total_observations', 0) + observations
            state['session_fetches'] = state.get('session_fetches', 0) + 1
            state['session_observations'] = state.get('session_observations', 0) + observations
        save_state(state)
        if not shutdown_requested:
            time.sleep(FETCH_INTERVAL_SECONDS)
    state = load_state()
    state['collector_running'] = False
    save_state(state)
    logger.info("METAR Collector stopped")

if __name__ == '__main__':
    if not AZURE_PASSWORD:
        logger.error("Missing AZURE_PASSWORD environment variable")
        sys.exit(1)
    main_loop()
