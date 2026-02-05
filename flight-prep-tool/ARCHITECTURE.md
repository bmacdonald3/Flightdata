# Flight Data System Architecture

## Overview

A comprehensive aviation data platform for collecting FAA flight data, weather observations, and analyzing approach quality for general aviation flights.

**Last Updated:** February 2026  
**Primary Infrastructure:** Raspberry Pi (192.168.42.13)  
**Cloud Database:** Azure SQL  

---

## System Components

### 1. Data Collection Layer

#### BMAC3 SWIM Flight Data Pipeline
- **Service:** `bmac3-swim.service`
- **Location:** `~/bmac3-swim/`
- **Function:** Connects to FAA SWIM (System Wide Information Management) feed to collect real-time flight position data
- **Data:** FDPS/FIXM messages containing callsign, position, altitude, speed, track, vertical speed
- **Output:** Writes to Azure SQL `flights` table
- **Frequency:** Continuous streaming

#### METAR Weather Collection
- **Service:** `metar-collector.service`
- **Location:** `~/metar-collector/`
- **Function:** Fetches METAR observations from aviation weather sources
- **Data:** Wind, altimeter, temperature, visibility, cloud layers
- **Output:** Writes to Azure SQL `metar_observations` table
- **Frequency:** Every 5-10 minutes

---

### 2. Data Storage Layer (Azure SQL)

**Server:** `flight-data-server-macdonaldfamily.database.windows.net`  
**Database:** `Flightdata`  
**Connection:** pymssql with TDS 7.3

#### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `flights` | Raw flight position data | gufi, callsign, position_time, lat, lon, altitude, speed, track, vertical_speed |
| `aircraft` | FAA aircraft registry | n_number, manufacturer, model, aircraft_type |
| `airports` | Airport reference data | airport_id, icao_code, name, lat, lon, elevation |
| `metar_observations` | Weather observations | airport_id, observation_time, wind_dir, wind_speed, wind_gust, altimeter |

#### FAA NASR Runway Data

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `faa_airports` | Airport details from NASR | site_number, faa_id, icao_id, facility_name, lat, lon, elevation |
| `faa_runways` | Runway threshold coordinates | site_number, runway_id, be/re_lat, be/re_lon, be/re_true_hdg, be/re_tdze |
| `v_runway_lookup` | View joining airports + runways | icao_id, runway_id, threshold coords, headings, elevations |

#### Staging Tables (for analysis)

| Table | Purpose |
|-------|---------|
| `staged_flights` | Currently staged flight for analysis |
| `staged_track_points` | Track points for staged flight |
| `staged_metars` | Relevant METARs for staged flight |

#### Scoring & Reference Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `aircraft_speeds` | Approach speeds by type | ac_type, appr_speed, dirty_stall, clean_stall |
| `approach_scores` | Scored approach results | gufi, callsign, ac_type, percentage, grade, category scores, metrics |

---

### 3. API Layer

#### Flight Prep API
- **Service:** `flight-prep-api.service`
- **Location:** `~/flight-prep-tool/api.py`
- **Port:** 5002
- **Framework:** Flask + CORS

##### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/flights` | GET | List flights with optional date filter |
| `/api/track` | GET | Get track points for a gufi |
| `/api/runways` | GET | Get runway data for airport (from FAA NASR) |
| `/api/stage` | POST | Stage a flight for analysis |
| `/api/staged` | GET | Get currently staged flight with track, metars, runways |
| `/api/aircraft_speeds` | GET | Get approach speeds for aircraft type |
| `/api/score_approach` | POST | Score an approach and save to database |
| `/api/scoring_schema` | GET | Get current scoring algorithm schema |
| `/api/approach_rankings` | GET | Get rankings and benchmarks |
| `/api/my_score_history` | GET | Get score history for a callsign |

---

### 4. Analysis Layer

#### Approach Scoring Module
- **Location:** `~/flight-prep-tool/approach_scoring.py`
- **Version:** 1.0
- **Function:** Standalone scoring algorithm for approach quality

##### Score Categories (100 pts total)

| Category | Max | Description |
|----------|-----|-------------|
| Descent | 20 | Glideslope tracking, no climbing on approach |
| Stabilized | 20 | Distance from threshold when stabilized |
| Centerline | 20 | Lateral tracking with crosswind adjustment |
| Turn to Final | 15 | Bank angle control (<30 deg), no overshoots |
| Speed Control | 15 | Speed discipline relative to target +/- gust/2 |
| Threshold Crossing | 10 | Height over threshold (target 50ft AGL) |

##### Severe Penalties

| Penalty | Points | Trigger |
|---------|--------|---------|
| CFIT RISK | -20 | Below glideslope when <500ft AGL |
| STALL RISK | -20 | Within 10kts of stall when >50ft AGL |

##### Key Calculations

- **Bank Angle:** `atan(V * omega / g)` where V=speed(ft/s), omega=turn_rate(rad/s), g=32.2
- **Crosswind:** `sin(wind_angle) * wind_speed`
- **Glideslope Deviation:** `actual_alt - (TDZE + TCH + dist * tan(3 deg))`
- **Cross-track:** Great circle lateral deviation from extended centerline

---

### 5. Presentation Layer

#### Approach Calibrator UI
- **Service:** `approach-calibrator.service`
- **Location:** `~/approach-calibrator/`
- **Port:** 5173
- **Framework:** React + Vite
- **Map:** Leaflet with ESRI imagery

##### Tabs

1. **Data Set** - Flight info, METARs, raw track data
2. **Calibrator** - Approach analysis table with GS/LOC deviations
3. **Profile** - Vertical/lateral profile charts, metrics, scoring
4. **Map** - Track visualization with centerline overlay

##### Features

- Runway auto-selection based on final track heading
- Computed runway headings from threshold coordinates
- Aircraft speeds lookup (Vref, stall speeds)
- Real-time metrics: bank angle, turn rate, acceleration
- Approach scoring with transparent deductions
- Severe penalty warnings (CFIT/stall risk)

---

### 6. Monitoring Layer

#### Home Assistant Integration
- **Dashboard:** Flight data pipeline status
- **Sensors:** Service status, database connectivity, data freshness
- **Alerts:** Pipeline failures, data gaps

---

## Data Flow Diagram
```
FAA SWIM (FDPS/FIXM)          Weather APIs (METARs)
        |                              |
        v                              v
  bmac3-swim.service           metar-collector.service
   (Raspberry Pi)                 (Raspberry Pi)
        |                              |
        +-------->  Azure SQL  <-------+
                   (Flightdata)
                        |
          +-------------+-------------+
          |                           |
          v                           v
   flight-prep-api.service     Batch Scoring
      (Port 5002)                (Future)
          |
          v
   approach-calibrator.service
      (Port 5173)
```

---

## File Locations (Raspberry Pi)
```
~/
├── config.py                    # Azure credentials
├── .env                         # Environment variables
│
├── bmac3-swim/                  # SWIM data collector
│
├── metar-collector/             # METAR collector
│
├── flight-prep-tool/            # API and scoring
│   ├── api.py                   # Flask API
│   └── approach_scoring.py      # Scoring module
│
├── approach-calibrator/         # React UI
│   ├── src/App.jsx              # Main application
│   └── dist/                    # Built assets
│
├── flight-data-system/          # Documentation
│   └── ARCHITECTURE.md          # This file
│
└── APT.txt                      # FAA NASR airport data
```

---

## Service Management
```bash
# Check status
sudo systemctl status flight-prep-api approach-calibrator

# Restart services
sudo systemctl restart flight-prep-api
sudo systemctl restart approach-calibrator

# View logs
sudo journalctl -u flight-prep-api -f
sudo journalctl -u approach-calibrator -f
```

---

## Database Queries

### Check recent flights
```sql
SELECT TOP 10 gufi, callsign, departure, arrival, 
       MIN(position_time) as start, MAX(position_time) as end
FROM flights 
WHERE callsign LIKE 'N%'
GROUP BY gufi, callsign, departure, arrival
ORDER BY MIN(position_time) DESC
```

### Check runway data
```sql
SELECT * FROM v_runway_lookup WHERE icao_id = 'KBVY'
```

### Check approach scores
```sql
SELECT callsign, ac_type, arr_airport, percentage, grade, severe_penalty_count
FROM approach_scores
ORDER BY scored_at DESC
```

### Benchmark by aircraft type
```sql
SELECT ac_type, COUNT(*) as flights, AVG(percentage) as avg_score
FROM approach_scores
GROUP BY ac_type
HAVING COUNT(*) >= 5
ORDER BY avg_score DESC
```

---

## Test Flights

| Callsign | Route | Purpose |
|----------|-------|---------|
| N509FG | KTTN -> KRDG | Centerline alignment testing |
| N616SJ | KLWM -> KFOK | Touch-and-go pattern testing |
| N136HF | KISP -> KNP1 | Missing runway/heliport handling |

---

## Future Enhancements

1. **Batch Scoring** - Score all historical flights
2. **Trend Analysis** - Track improvement over time per pilot
3. **Weather Correlation** - Score adjustments for conditions
4. **Pattern Analysis** - Detect common error patterns
5. **Instructor Dashboard** - Multi-student tracking
6. **Mobile App** - Post-flight debrief on phone

---

## Troubleshooting

### API Not Responding
```bash
sudo systemctl status flight-prep-api
sudo journalctl -u flight-prep-api -n 50
```

### UI Blank Page
```bash
cd ~/approach-calibrator && npm run build 2>&1 | tail -20
```

### Database Connection Issues
```bash
python3 -c "
import pymssql, os, sys
sys.path.insert(0, os.path.expanduser('~'))
from config import AZURE_SERVER, AZURE_DATABASE, AZURE_USERNAME, AZURE_PASSWORD
conn = pymssql.connect(server=AZURE_SERVER, user=AZURE_USERNAME, password=AZURE_PASSWORD,
    database=AZURE_DATABASE, tds_version='7.3')
print('Connected!')
conn.close()
"
```

### No Runway Data for Airport
```bash
curl -s "http://localhost:5002/api/runways?airport=KXXX" | python3 -m json.tool
```

---

## Version History

| Date | Change |
|------|--------|
| Feb 2026 | Initial SWIM pipeline |
| Feb 2026 | Added FAA NASR runway data with computed headings |
| Feb 2026 | Approach scoring system v1.0 |
| Feb 2026 | Bank angle and turn rate calculations |
| Feb 2026 | Severe penalty system (CFIT/stall risk) |
| Feb 2026 | Standalone scoring module for batch processing |

---

## Flight Preprocessing

### Ghost Flight Detection (`flight_preprocessor.py`)

Filters out flights where radar/ADS-B data is incomplete:

| Check | Threshold | Reason |
|-------|-----------|--------|
| Min AGL | > 3000ft | Never descended to approach altitude |
| Alt Range | < 500ft | No significant descent (overflight) |
| Last Point AGL | > 2000ft | Lost radar before approach |
| Final Speeds | > 200kts | Jet not slowing for approach |

### Touch-and-Go Detection

Identifies pattern work by finding altitude valleys:
1. Smooth altitude data (3-point moving average)
2. Find local minima below 500ft AGL
3. Merge valleys within 60 seconds
4. Split into separate legs if climb >300ft between valleys

Each leg is scored independently with gufi suffix (`gufi#leg1`, `gufi#leg2`, etc.)

### Track Truncation

Removes non-approach portions:
- Points > 15nm from threshold
- Points > 5000ft AGL at start
- Flags added: `[TRUNCATED: Removed N cruise points]`

### Preprocessing Flags

All preprocessing actions are logged in `scoring_attempts.failure_reason`:
- `GHOST: <reason>` - Flight filtered as ghost
- `PATTERN: N legs detected` - Touch-and-go split
- `TRUNCATED: Removed N points` - Cruise/high altitude removed

---

## Batch Scoring

### Usage
```bash
cd ~/flight-prep-tool

# Score last 7 days, up to 100 flights
python3 batch_score.py --days 7 --limit 100

# Verbose output
python3 batch_score.py --days 7 --limit 50 --verbose

# Rescore already-scored flights
python3 batch_score.py --days 30 --rescore

# Filter by callsign
python3 batch_score.py --callsign N831PM --days 90

# Adjust ghost detection threshold
python3 batch_score.py --min-alt 1500
```

### Database Tables

| Table | Purpose |
|-------|---------|
| `scoring_attempts` | Logs all scoring attempts (success + failure with reasons) |
| `approach_scores` | Stores successful scores with full breakdown |

### Performance Notes

- Ghost detection is fast (altitude checks only)
- T&G detection scans altitude array once
- Preprocessing is redone each run (no persistent cache yet)
- `--rescore` flag forces reprocessing of already-attempted flights
