"""
BMAC3 STDDS Track Parser - Configuration
Parses FAA SWIM STDDS (Terminal Automation) track data.
"""
import os
from dotenv import load_dotenv

load_dotenv()

# ─── PATHS ───────────────────────────────────────────
BASE_DIR                = os.path.expanduser("~")
RAW_XML_FILE            = os.path.join(BASE_DIR, "stdds_stream.xml")
LOG_FILE                = os.path.join(BASE_DIR, "stdds.log")

# ─── FAA SWIM CREDENTIALS (STDDS) ────────────────────
SWIM_PROVIDER_URL       = "tcps://ems1.swim.faa.gov:55443"
SWIM_QUEUE              = "ben.bmac3.com.STDDS.e855c1d2-38a8-4dd0-b015-c058ffa8faa5.OUT"
SWIM_CONNECTION_FACTORY = "ben.bmac3.com.CF"
SWIM_USERNAME           = "ben.bmac3.com"
SWIM_PASSWORD           = os.getenv("SWIM_PASSWORD")
SWIM_VPN                = "STDDS"
SWIM_RUN_CMD            = os.path.join(BASE_DIR, "bin", "run")

# ─── AZURE SQL ───────────────────────────────────────
AZURE_SERVER            = "flight-data-server-macdonaldfamily.database.windows.net"
AZURE_DATABASE          = "Flightdata"
AZURE_USERNAME          = "flightadmin"
AZURE_PASSWORD          = os.getenv("AZURE_PASSWORD")
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

# ─── PARSING SETTINGS ────────────────────────────────
PARSE_INTERVAL_SECONDS  = 5     # Check more frequently due to higher data rate
MAX_BATCH_SIZE          = 5000  # Larger batches for high-volume data

# ─── FILTERING ───────────────────────────────────────
# Only process data from these facilities (empty list = all)
FACILITY_FILTER         = ["A90", "N90"]

# Only store GA traffic (callsigns starting with 'N')
# If True, skips records without a callsign OR with non-N callsign
GA_ONLY                 = True

# ─── HOME ASSISTANT ──────────────────────────────────
HA_STATE_FILE           = os.path.join(BASE_DIR, "stdds_state.json")
