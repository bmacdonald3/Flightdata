#!/usr/bin/env python3
"""
METAR Collector for Raspberry Pi
Fetches weather observations from Aviation Weather Center API
and uploads to Azure SQL database.

Part of the BMAC3 flight data project.
https://github.com/bmacdonald3/Flightdata
"""

import os
import sys
import json
import time
import logging
import signal
from datetime import datetime, timezone
from pathlib import Path

import pymssql
import requests
from dotenv import load_dotenv

# =============================================================================
# Configuration
# =============================================================================

# Load environment variables
load_dotenv(Path.home() / '.env')

# Database settings
AZURE_SERVER = os.getenv('AZURE_SERVER', 'flight-data-server-macdonaldfamily.database.windows.net')
AZURE_DATABASE = os.getenv('AZURE_DATABASE', 'Flightdata')
AZURE_USER = os.getenv('AZURE_USER')
AZURE_PASSWORD = os.getenv('AZURE_PASSWORD')

# Collector settings
FETCH_INTERVAL_SECONDS = 300  # 5 minutes
STATE_FILE = Path.home() / 'metar_state.json'
LOG_FILE = Path.home() / 'metar.log'

# Aviation Weather Center API
AWC_API_URL = "https://aviationweather.gov/api/data/metar"

# =============================================================================
# Logging Setup
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# =============================================================================
# State Management
# =============================================================================

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
    """Load state from JSON file."""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, 'r') as f:
                state = json.load(f)
                # Ensure all keys exist
                for key, default in DEFAULT_STATE.items():
                    if key not in state:
                        state[key] = default
                return state
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"Could not load state file: {e}")
    return DEFAULT_STATE.copy()

def save_state(state):
    """Save state to JSON file."""
    state['updated_at'] = datetime.now(timezone.utc).isoformat()
    try:
        with open(STATE_FILE, 'w') as f:
            json.dump(state, f, indent=2)
    except IOError as e:
        logger.error(f"Could not save state file: {e}")

# =============================================================================
# Database Functions
# =============================================================================

def get_db_connection():
    """Create database connection."""
    return pymssql.connect(
        server=AZURE_SERVER,
        user=AZURE_USER,
        password=AZURE_PASSWORD,
        database=AZURE_DATABASE,
        tds_version='7.3',
        autocommit=True
    )

def get_airport_list(conn):
    """Fetch list of airports to query."""
    cursor = conn.cursor(as_dict=True)
    cursor.execute("""
        SELECT a.airport_id, a.icao_code 
        FROM airports a 
        WHERE a.icao_code IS NOT NULL
        ORDER BY a.icao_code
    """)
    airports = {row['icao_code']: row['airport_id'] for row in cursor.fetchall()}
    cursor.close()
    return airports

def insert_metar(conn, airport_id, metar_data):
    """
    Insert a METAR observation into the database.
    Returns True if inserted, False if duplicate.
    """
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            INSERT INTO metar_observations (
                airport_id, observation_time, temp_c, dewpoint_c,
                wind_direction, wind_speed_kt, wind_gust_kt,
                visibility_miles, altimeter_inhg, sea_level_pressure_mb,
                flight_category, cloud_coverage, wx_string,
                raw_text, metar_type, fetched_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, GETUTCDATE()
            )
        """, (
            airport_id,
            metar_data.get('obs_time'),
            safe_float(metar_data.get('temp')),
            safe_float(metar_data.get('dewp')),
            safe_int(metar_data.get('wdir')),  # Handles "VRB"
            safe_int(metar_data.get('wspd')),
            safe_int(metar_data.get('wgst')),
            safe_float(metar_data.get('visib')),  # Handles "10+"
            safe_float(metar_data.get('altim')),
            safe_float(metar_data.get('slp')),
            metar_data.get('fltCat'),  # Case sensitive!
            json.dumps(metar_data.get('clouds', [])),
            metar_data.get('wxString'),
            metar_data.get('rawOb'),
            metar_data.get('metarType')
        ))
        cursor.close()
        return True
    except pymssql.IntegrityError:
        # Duplicate - already have this observation
        cursor.close()
        return False
    except Exception as e:
        cursor.close()
        raise e

def log_fetch(conn, airports_queried, observations_inserted, success, error_message=None):
    """Log fetch operation to database."""
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO metar_fetch_log (
            fetch_time, airports_queried, observations_inserted, 
            success, error_message
        ) VALUES (
            GETUTCDATE(), %s, %s, %s, %s
        )
    """, (airports_queried, observations_inserted, success, error_message))
    cursor.close()

# =============================================================================
# Data Parsing Helpers
# =============================================================================

def safe_float(value):
    """Safely convert to float, handling special cases like '10+'."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        # Handle "10+" visibility format
        value = value.replace('+', '')
        try:
            return float(value)
        except ValueError:
            return None
    return None

def safe_int(value):
    """Safely convert to int, handling special cases like 'VRB'."""
    if value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        # Handle "VRB" wind direction
        if value.upper() == 'VRB':
            return None  # Variable wind direction
        try:
            return int(value)
        except ValueError:
            return None
    return None

def parse_observation_time(obs_time_str):
    """Parse observation time from API response."""
    if not obs_time_str:
        return None
    try:
        # API returns ISO format: "2024-01-15T14:53:00Z"
        return datetime.fromisoformat(obs_time_str.replace('Z', '+00:00'))
    except ValueError:
        return None

# =============================================================================
# METAR Fetching
# =============================================================================

def fetch_metars(icao_codes):
    """
    Fetch METARs from Aviation Weather Center API.
    
    Args:
        icao_codes: List of ICAO airport codes
        
    Returns:
        List of METAR dictionaries, or empty list on error
    """
    if not icao_codes:
        return []
    
    # API accepts comma-separated list
    ids_param = ','.join(icao_codes)
    
    try:
        response = requests.get(
            AWC_API_URL,
            params={'ids': ids_param, 'format': 'json'},
            timeout=30
        )
        response.raise_for_status()
        
        data = response.json()
        
        # API returns list of METAR objects
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

# =============================================================================
# Main Collection Loop
# =============================================================================

def run_fetch_cycle(state):
    """
    Execute one fetch cycle.
    
    Returns:
        Tuple of (success, observations_inserted, error_message)
    """
    conn = None
    try:
        conn = get_db_connection()
        
        # Get airport list
        airports = get_airport_list(conn)
        state['airports_count'] = len(airports)
        
        if not airports:
            return False, 0, "No airports configured"
        
        logger.info(f"Fetching METARs for {len(airports)} airports...")
        
        # Fetch METARs (API handles batching internally)
        icao_codes = list(airports.keys())
        metars = fetch_metars(icao_codes)
        
        if not metars:
            return False, 0, "No METAR data returned from API"
        
        logger.info(f"Received {len(metars)} METAR observations")
        
        # Insert observations
        inserted = 0
        duplicates = 0
        
        for metar in metars:
            icao = metar.get('icaoId')
            if not icao or icao not in airports:
                continue
            
            airport_id = airports[icao]
            
            # Parse observation time
            obs_time = parse_observation_time(metar.get('obsTime'))
            if not obs_time:
                continue
            
            metar['obs_time'] = obs_time
            
            if insert_metar(conn, airport_id, metar):
                inserted += 1
            else:
                duplicates += 1
        
        # Log the fetch
        log_fetch(conn, len(airports), inserted, True)
        
        logger.info(f"Inserted {inserted} new observations ({duplicates} duplicates)")
        
        return True, inserted, None
        
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Fetch cycle failed: {error_msg}")
        
        # Try to log the error
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
    """Main collector loop."""
    state = load_state()
    state['collector_running'] = True
    state['session_fetches'] = 0
    state['session_observations'] = 0
    save_state(state)
    
    logger.info("METAR Collector started")
    logger.info(f"Fetch interval: {FETCH_INTERVAL_SECONDS} seconds")
    
    # Graceful shutdown handler
    shutdown_requested = False
    
    def handle_signal(signum, frame):
        nonlocal shutdown_requested
        logger.info(f"Received signal {signum}, shutting down...")
        shutdown_requested = True
    
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    
    while not shutdown_requested:
        # Reload state to check if enabled
        state = load_state()
        state['collector_running'] = True
        
        if not state.get('collector_enabled', True):
            logger.info("Collector disabled, waiting...")
            save_state(state)
            time.sleep(10)
            continue
        
        # Run fetch cycle
        success, observations, error = run_fetch_cycle(state)
        
        # Update state
        state['last_fetch_time'] = datetime.now(timezone.utc).isoformat()
        state['last_fetch_success'] = success
        state['last_error'] = error
        
        if success:
            state['total_fetches'] = state.get('total_fetches', 0) + 1
            state['total_observations'] = state.get('total_observations', 0) + observations
            state['session_fetches'] = state.get('session_fetches', 0) + 1
            state['session_observations'] = state.get('session_observations', 0) + observations
        
        save_state(state)
        
        # Wait for next cycle
        if not shutdown_requested:
            logger.debug(f"Sleeping for {FETCH_INTERVAL_SECONDS} seconds...")
            time.sleep(FETCH_INTERVAL_SECONDS)
    
    # Clean shutdown
    state = load_state()
    state['collector_running'] = False
    save_state(state)
    logger.info("METAR Collector stopped")

# =============================================================================
# Entry Point
# =============================================================================

if __name__ == '__main__':
    # Validate environment
    if not AZURE_USER or not AZURE_PASSWORD:
        logger.error("Missing database credentials in .env file")
        logger.error("Required: AZURE_USER, AZURE_PASSWORD")
        sys.exit(1)
    
    main_loop()
