"""
BMAC3 Flight Tracker - Central Configuration
Edit this file to change any settings.
Can be edited via GitHub without SSH access.
"""
import os
from dotenv import load_dotenv

load_dotenv()  # reads ~/.env (or .env in working directory)

# ─── PATHS ───────────────────────────────────────────
BASE_DIR                = os.path.expanduser("~")
RAW_XML_FILE            = os.path.join(BASE_DIR, "flight_stream.xml")
PROCESSED_MARKER_FILE   = os.path.join(BASE_DIR, "flight_stream.xml.offset")
LOG_FILE                = os.path.join(BASE_DIR, "bmac3.log")

# ─── FAA SWIM CREDENTIALS ────────────────────────────
SWIM_PROVIDER_URL       = "tcps://ems1.swim.faa.gov:55443"
SWIM_QUEUE              = "ben.bmac3.com.FDPS.6fcee934-3cd9-4cc2-b8aa-014705903c28.OUT"
SWIM_CONNECTION_FACTORY = "ben.bmac3.com.CF"
SWIM_USERNAME           = "ben.bmac3.com"
SWIM_PASSWORD           = os.getenv("SWIM_PASSWORD")
SWIM_VPN                = "FDPS"
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

# ─── XML NAMESPACES ──────────────────────────────────
NS = {
    "ns5": "http://www.faa.aero/nas/3.0",
    "ns2": "http://www.fixm.aero/base/3.0",
    "ns3": "http://www.fixm.aero/flight/3.0",
    "ns4": "http://www.fixm.aero/foundation/3.0",
}

# ─── PARSING SETTINGS ────────────────────────────────
PARSE_INTERVAL_SECONDS  = 10    # How often to check for new data
MAX_BATCH_SIZE          = 500   # Max flights to upload per cycle

# ─── HOME ASSISTANT ──────────────────────────────────
HA_STATE_FILE           = os.path.join(BASE_DIR, "bmac3_state.json")
