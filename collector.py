#!/usr/bin/env python3
"""
BMAC3 Flight Tracker - SWIM Collector
Captures raw XML from FAA SWIM and writes to file.
Controlled via bmac3_state.json (start/stop from Home Assistant)
"""
import subprocess
import sys
import os
import json
import time
import logging

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import *

logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format="%(asctime)s [COLLECTOR] %(message)s"
)

def get_state():
    """Read state file to check if we should be running"""
    try:
        with open(HA_STATE_FILE, "r") as f:
            return json.load(f)
    except:
        return {"collector_enabled": True}

def save_state(state):
    """Save state"""
    with open(HA_STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def main():
    logging.info("Collector starting...")

    # Initialize state file if not exists
    if not os.path.exists(HA_STATE_FILE):
        save_state({
            "collector_enabled": True,
            "collector_running": False,
            "parser_running": False,
            "total_rows_uploaded": 0,
            "last_upload_time": None,
            "last_upload_count": 0,
            "error": None
        })

    while True:
        state = get_state()

        if not state.get("collector_enabled", True):
            state["collector_running"] = False
            save_state(state)
            logging.info("Collector disabled via state file. Waiting...")
            time.sleep(5)
            continue

        # Mark as running
        state["collector_running"] = True
        state["error"] = None
        save_state(state)

        logging.info("Starting SWIM connection...")

        cmd = [
            SWIM_RUN_CMD,
            f"-DproviderUrl={SWIM_PROVIDER_URL}",
            f"-Dqueue={SWIM_QUEUE}",
            f"-DconnectionFactory={SWIM_CONNECTION_FACTORY}",
            f"-Dusername={SWIM_USERNAME}",
            f"-Dpassword={SWIM_PASSWORD}",
            f"-Dvpn={SWIM_VPN}",
            "-Doutput=com.harris.cinnato.outputs.StdoutOutput"
        ]

        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )

            with open(RAW_XML_FILE, "a") as f:
                for line in process.stdout:
                    state = get_state()
                    if not state.get("collector_enabled", True):
                        logging.info("Stop requested. Terminating SWIM process...")
                        process.terminate()
                        break

                    # Skip Java logging lines, write everything else
                    if "INFO:" not in line and "type=METER" not in line:
                        f.write(line)
                        f.flush()

        except Exception as e:
            logging.error(f"Collector error: {e}")
            state = get_state()
            state["error"] = str(e)
            state["collector_running"] = False
            save_state(state)
            time.sleep(10)

if __name__ == "__main__":
    main()
