# Approach Analysis Calibrator - Project Documentation

## Overview

This project analyzes aircraft approach data from FAA SWIM feeds to compare actual flight tracks against ideal approach profiles (glideslope and localizer/centerline).

## Current Architecture

### Data Pipeline
```
FAA SWIM STDDS Feed → stdds_parser.py → Azure SQL (flights table)
                                              ↓
                                    Flight Data Prep Tool (port 5174)
                                              ↓
                                    Staged Tables (Azure SQL)
                                              ↓
                                    Approach Calibrator (port 5173)
```

### Components

#### 1. Flight Data Prep Tool (Complete)
- **Location:** `~/flight-prep-tool/`
- **API:** Port 5002 (`api.py`)
- **Frontend:** Port 5174 (`frontend/src/App.jsx`)
- **Features:**
  - Browse flights by date
  - Filter by aircraft model
  - View full track data with calculated fields:
    - Horizontal acceleration (kts/s)
    - Turn rate (°/s)
    - Vertical speed (fpm)
  - Stage selected flight for analysis

#### 2. Approach Calibrator (In Progress)
- **Location:** `~/approach-calibrator/`
- **Frontend:** Port 5173
- **Current State:** Basic framework, reads from staged tables
- **Needs:** Full implementation

## Azure SQL Schema

### flights table (source data)
| Column | Type | Description |
|--------|------|-------------|
| gufi | VARCHAR | Globally Unique Flight Identifier |
| callsign | VARCHAR | N-number (e.g., N12345) |
| position_time | DATETIME | Timestamp of position report |
| latitude | DECIMAL | Degrees |
| longitude | DECIMAL | Degrees |
| altitude | INT | Feet MSL |
| speed | INT | Ground speed in knots |
| track | DECIMAL | Track heading in degrees |
| vertical_speed | INT | Feet per minute |
| departure | VARCHAR | Departure airport ICAO |
| arrival | VARCHAR | Arrival airport ICAO |
| status | VARCHAR | Flight status |
| center | VARCHAR | ATC facility |
| mode_s | VARCHAR | Mode S transponder code |

### staged_flights table
| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key |
| gufi | VARCHAR | Flight identifier |
| callsign | VARCHAR | N-number |
| aircraft_type | VARCHAR | Type designation |
| manufacturer | VARCHAR | Aircraft manufacturer |
| model | VARCHAR | Aircraft model |
| dep_airport | VARCHAR | Departure ICAO |
| arr_airport | VARCHAR | Arrival ICAO |
| flight_date | DATE | Date of flight |
| duration_minutes | INT | Flight duration |
| staged_at | DATETIME | When staged |

### staged_track_points table
| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key |
| staged_flight_id | INT | FK to staged_flights |
| position_time | DATETIME | Timestamp |
| latitude | DECIMAL(9,6) | Degrees |
| longitude | DECIMAL(10,6) | Degrees |
| altitude | INT | Feet MSL |
| speed | INT | Knots |
| track | DECIMAL(5,2) | Degrees |
| vertical_speed | INT | FPM |

### staged_metars table
| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key |
| staged_flight_id | INT | FK to staged_flights |
| airport_icao | VARCHAR(4) | Airport code |
| observation_time | DATETIME | METAR time |
| altimeter_inhg | DECIMAL(6,2) | Altimeter setting |
| temp_c | DECIMAL(5,1) | Temperature |
| wind_dir_degrees | INT | Wind direction |
| wind_speed_kt | INT | Wind speed |
| visibility_miles | DECIMAL(6,2) | Visibility |
| raw_text | VARCHAR(500) | Raw METAR |

## Approach Calibrator - Next Phase Requirements

### Core Features Needed

#### 1. Runway Database
Create Azure table for runway data:
```sql
CREATE TABLE runways (
    id INT IDENTITY PRIMARY KEY,
    airport_icao VARCHAR(4) NOT NULL,
    runway_id VARCHAR(4) NOT NULL,  -- e.g., '16', '34L'
    threshold_lat DECIMAL(9,6) NOT NULL,
    threshold_lon DECIMAL(10,6) NOT NULL,
    heading DECIMAL(5,2) NOT NULL,  -- magnetic heading
    elevation INT NOT NULL,  -- threshold elevation ft
    glideslope DECIMAL(3,1) DEFAULT 3.0,  -- degrees
    tch INT DEFAULT 50,  -- threshold crossing height ft
    length_ft INT,
    width_ft INT,
    ils_freq DECIMAL(5,2),  -- if equipped
    UNIQUE(airport_icao, runway_id)
);
```

#### 2. Approach Analysis Calculations

**Along-track distance (nm to threshold):**
```javascript
const alongTrackNm = (pointLat, pointLon, thresholdLat, thresholdLon, runwayHeading) => {
  const bearingToPoint = calculateBearing(thresholdLat, thresholdLon, pointLat, pointLon);
  const distanceNm = haversineNm(thresholdLat, thresholdLon, pointLat, pointLon);
  const angleDiff = toRadians(bearingToPoint - (runwayHeading + 180));  // inbound course
  return distanceNm * Math.cos(angleDiff);
};
```

**Cross-track deviation (ft from centerline):**
```javascript
const crossTrackFt = (pointLat, pointLon, thresholdLat, thresholdLon, runwayHeading) => {
  const bearingToPoint = calculateBearing(thresholdLat, thresholdLon, pointLat, pointLon);
  const distanceNm = haversineNm(thresholdLat, thresholdLon, pointLat, pointLon);
  const angleDiff = toRadians(bearingToPoint - (runwayHeading + 180));
  return distanceNm * Math.sin(angleDiff) * 6076.12;  // nm to ft
};
```

**Glideslope deviation (ft from ideal path):**
```javascript
const glideslopeDevFt = (altitude, distanceNm, thresholdElev, tch, glideslopeAngle) => {
  const idealAlt = thresholdElev + tch + (distanceNm * 6076.12 * Math.tan(toRadians(glideslopeAngle)));
  return altitude - idealAlt;
};
```

**Pressure altitude correction:**
```javascript
const correctedAlt = (indicatedAlt, altimeterSetting) => {
  // 1" Hg = ~1000 ft
  return indicatedAlt + (29.92 - altimeterSetting) * 1000;
};
```

#### 3. Visualization Requirements

**Profile View (Side View):**
- X-axis: Distance to threshold (nm), 0 at threshold, increasing outbound
- Y-axis: Altitude AGL (ft)
- Show: Actual track, ideal glideslope line, ±1 dot boundaries
- Color code: Green (on GS), Yellow (1/2-1 dot), Red (>1 dot)

**Plan View (Top Down):**
- Show extended runway centerline
- Show actual ground track
- Show localizer-like boundaries (±2.5° full scale)
- Color code deviations

**Data Table:**
| Dist (nm) | Alt (ft) | GS Dev (ft) | LOC Dev (ft) | Speed | VS | Status |
|-----------|----------|-------------|--------------|-------|-----|--------|

#### 4. Stability Assessment

**Stabilized Approach Criteria (typical):**
- On glideslope: ±75 ft (1 dot)
- On localizer: ±300 ft at threshold
- Speed: Vref to Vref+10
- Descent rate: 500-1000 fpm (typical)
- Configuration: Gear down, flaps set
- By: 1000 ft AGL (IMC) or 500 ft AGL (VMC)

**Assessment Output:**
- "STABILIZED" / "UNSTABILIZED"
- Gate altitude where stabilized (if applicable)
- Deviations at key altitudes (1000, 500, 200 ft AGL)

### UI Layout Proposal
```
+----------------------------------------------------------+
|  Approach Calibrator                    [Runway: ▼ KHPN 16]|
+----------------------------------------------------------+
|  N12345 | C172 | KBDR → KHPN | 2024-02-04                 |
+----------------------------------------------------------+
|                                                           |
|  PROFILE VIEW                                             |
|  Alt                                                      |
|  (ft)  .                                                  |
|  1500 |     .    * * *                                   |
|  1000 |        .  *   * *                                |
|   500 |           .      * * *                           |
|     0 +------------------------------- Dist (nm)          |
|       5    4    3    2    1    0                          |
|                                                           |
+----------------------------------------------------------+
|                                                           |
|  PLAN VIEW                                                |
|        |         |                                        |
|        |    *    |                                        |
|        |   *     |                                        |
|        |  *      |                                        |
|        | *       |                                        |
|        |*        |                                        |
|        +=========+ RWY                                    |
|                                                           |
+----------------------------------------------------------+
|  CALIBRATION              |  ANALYSIS                     |
|  Altimeter: [29.92] inHg  |  Stabilized: YES @ 1200 AGL   |
|  GS Angle:  [3.0]°        |  GS Dev @ 500: +45 ft         |
|  TCH:       [50] ft       |  LOC Dev @ 500: -120 ft       |
|  Hdg Adj:   [0]°          |  Avg Descent: 680 fpm         |
+----------------------------------------------------------+
```

### Sample Runway Data (CT/NY Area)
```sql
INSERT INTO runways (airport_icao, runway_id, threshold_lat, threshold_lon, heading, elevation, glideslope, tch) VALUES
('KHPN', '16', 41.0703, -73.7076, 159, 439, 3.0, 55),
('KHPN', '34', 41.0573, -73.6926, 339, 439, 3.0, 50),
('KBDR', '6', 41.1633, -73.1283, 63, 10, 3.0, 50),
('KBDR', '24', 41.1700, -73.1183, 243, 10, 3.0, 50),
('KBDR', '11', 41.1650, -73.1317, 108, 10, 3.0, 50),
('KBDR', '29', 41.1617, -73.1200, 288, 10, 3.0, 50),
('KDXR', '8', 41.3717, -73.4833, 80, 457, 3.0, 50),
('KDXR', '26', 41.3733, -73.4700, 260, 457, 3.0, 50),
('KOXC', '18', 41.4833, -73.1350, 180, 726, 3.0, 50),
('KGON', '5', 41.3267, -72.0550, 50, 10, 3.0, 50),
('KGON', '23', 41.3350, -72.0467, 230, 10, 3.0, 50),
('KHVN', '2', 41.2650, -72.8900, 20, 14, 3.0, 50),
('KHVN', '20', 41.2717, -72.8867, 200, 14, 3.0, 50);
```

### API Endpoints

**GET /api/runways**
Returns all runways, optionally filtered by airport

**GET /api/runways?airport=KHPN**
Returns runways for specific airport

**GET /api/staged** (existing)
Returns staged flight data

### Implementation Steps

1. **Phase 1: Runway Database**
   - Create runways table in Azure
   - Add API endpoint
   - Populate with local airport data

2. **Phase 2: Basic Calibrator UI**
   - Runway selector dropdown
   - Load staged flight
   - Calculate deviations
   - Display data table

3. **Phase 3: Profile View**
   - SVG or Canvas chart
   - Actual track plot
   - Ideal glideslope overlay
   - Deviation coloring

4. **Phase 4: Plan View**
   - Top-down track display
   - Centerline overlay
   - Localizer boundaries

5. **Phase 5: Stability Analysis**
   - Implement criteria checking
   - Display assessment
   - Historical comparison

## Services Summary

| Service | Port | systemd Unit |
|---------|------|--------------|
| Flight Data Prep API | 5002 | flight-prep-api.service |
| Flight Data Prep UI | 5174 | flight-prep-ui.service |
| Approach Calibrator | 5173 | approach-calibrator.service |
| STDDS Parser | - | bmac3-stdds-parser.service |

## File Locations
```
~/flight-prep-tool/
├── api.py                 # Flask API
└── frontend/
    └── src/App.jsx        # React frontend

~/approach-calibrator/
└── src/App.jsx            # React frontend (needs implementation)

~/stdds_parser.py          # STDDS data parser
~/config.py                # Azure credentials
```

## Repository

GitHub: https://github.com/bmacdonald3/Flightdata
