# Flightdata# BMAC3 Flight Tracker

Real-time FAA SWIM flight data collection, parsing, and storage for Boston Center (ZBW) airspace.

## Architecture

```
FAA SWIM → [Collector] → flight_stream.xml → [Parser] → Azure SQL → Excel
                                                  ↑
                                          [HA Integration]
                                       (start/stop/monitor)
```

## Files

|File                 |Purpose                                                    |
|---------------------|-----------------------------------------------------------|
|`config.py`          |**All settings live here** - credentials, paths, intervals |
|`collector.py`       |Connects to FAA SWIM, captures raw XML to file             |
|`parser.py`          |Reads XML, parses flights, uploads to Azure, cleans up file|
|`ha_integration.py`  |HTTP API for Home Assistant control & monitoring           |
|`home_assistant.yaml`|Home Assistant config (sensors, commands, dashboard)       |
|`setup.sh`           |One-time setup script - creates systemd services           |

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_GITHUB/bmac3.git ~/bmac3

# 2. Edit config.py with your credentials
nano ~/bmac3/config.py

# 3. Run setup (creates systemd services)
chmod +x ~/bmac3/setup.sh
~/bmac3/setup.sh
```

## Configuration

Edit `config.py` to change:

- Azure SQL credentials
- SWIM connection details
- Parse intervals
- File paths

## Control

### Via Home Assistant

- Use the Start/Stop buttons on the Flight Tracker dashboard
- Monitor row counts, errors, and status live

### Via Command Line

```bash
# Check status
curl http://localhost:8123/state

# Start
curl -X POST http://localhost:8123/enable

# Stop
curl -X POST http://localhost:8123/disable

# Systemd
sudo systemctl status bmac3-collector
sudo systemctl status bmac3-parser
sudo systemctl status bmac3-ha
```

### Check Logs

```bash
sudo journalctl -u bmac3-collector -f
sudo journalctl -u bmac3-parser -f
cat ~/bmac3.log
```

## Editing the Parser

The parsing logic is isolated in the `parse_flight()` function in `parser.py`.
Edit this function to adjust how fields are extracted from the XML.
Changes can be pushed via GitHub and pulled to the Pi without SSH.

## Azure SQL Schema

```sql
CREATE TABLE flights (
    id INT IDENTITY(1,1) PRIMARY KEY,
    timestamp DATETIME2,
    callsign VARCHAR(10),
    aircraft_type VARCHAR(10),
    registration VARCHAR(20),
    departure VARCHAR(4),
    arrival VARCHAR(4),
    latitude DECIMAL(10,6),
    longitude DECIMAL(11,6),
    altitude INT,
    speed INT,
    heading INT,
    status VARCHAR(20),
    operator VARCHAR(10),
    center VARCHAR(10),
    gufi VARCHAR(100)
);
```
