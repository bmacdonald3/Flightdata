import React, { useState, useMemo, useEffect } from 'react';

const API = 'http://192.168.42.13:5002/api';

// Utility functions
const toRadians = (deg) => deg * Math.PI / 180;
const toDegrees = (rad) => rad * 180 / Math.PI;

const haversineNm = (lat1, lon1, lat2, lon2) => {
  const R = 3440.065;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat/2) ** 2 + 
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * 
            Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const calculateBearing = (lat1, lon1, lat2, lon2) => {
  const dLon = toRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRadians(lat2));
  const x = Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
            Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
};

const crossTrackDistanceFt = (pointLat, pointLon, thresholdLat, thresholdLon, runwayHeading) => {
  const bearingToPoint = calculateBearing(thresholdLat, thresholdLon, pointLat, pointLon);
  const distanceNm = haversineNm(thresholdLat, thresholdLon, pointLat, pointLon);
  const angleDiff = toRadians(bearingToPoint - (runwayHeading + 180));
  const crossTrackNm = distanceNm * Math.sin(angleDiff);
  return crossTrackNm * 6076.12;
};

const alongTrackDistanceNm = (pointLat, pointLon, thresholdLat, thresholdLon, runwayHeading) => {
  const bearingToPoint = calculateBearing(thresholdLat, thresholdLon, pointLat, pointLon);
  const distanceNm = haversineNm(thresholdLat, thresholdLon, pointLat, pointLon);
  const angleDiff = toRadians(bearingToPoint - (runwayHeading + 180));
  return distanceNm * Math.cos(angleDiff);
};

export default function ApproachCalibrator() {
  // Data from API
  const [flightData, setFlightData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Calibration parameters
  const [glideslope, setGlideslope] = useState(3.0);
  const [altimeterSetting, setAltimeterSetting] = useState(29.92);
  const [thresholdCrossingHeight, setThresholdCrossingHeight] = useState(50);
  const [lateralOffset, setLateralOffset] = useState(0);
  const [headingCorrection, setHeadingCorrection] = useState(0);
  
  // Runway (manual for now - could add runway database later)
  const [runwayHeading, setRunwayHeading] = useState(239);
  const [thresholdLat, setThresholdLat] = useState(41.1910);
  const [thresholdLon, setThresholdLon] = useState(-73.0380);
  const [runwayElev, setRunwayElev] = useState(439);

  // Fetch staged data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`${API}/staged`);
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setFlightData(data);
          // Auto-set altimeter from METAR if available
          if (data.metars && data.metars.length > 0) {
            const lastMetar = data.metars[data.metars.length - 1];
            if (lastMetar.altimeter_inhg) {
              setAltimeterSetting(parseFloat(lastMetar.altimeter_inhg));
            }
          }
        }
      } catch (err) {
        setError('Failed to fetch: ' + err.message);
      }
      setLoading(false);
    };
    fetchData();
  }, []);

  // Convert track data
  const track = useMemo(() => {
    if (!flightData?.track) return [];
    return flightData.track.map(p => ({
      time: p.position_time,
      lat: parseFloat(p.latitude),
      lon: parseFloat(p.longitude),
      alt_baro: p.altitude,
      heading: parseFloat(p.track) || 0,
      speed: p.speed,
      vertical_speed: p.vertical_speed
    }));
  }, [flightData]);

  // Calculate approach data
  const approachData = useMemo(() => {
    if (track.length === 0) return [];
    
    const pressureCorrection = (29.92 - altimeterSetting) * 1000;
    
    return track.map(point => {
      const correctedAlt = point.alt_baro - pressureCorrection;
      const distanceNm = alongTrackDistanceNm(point.lat, point.lon, thresholdLat, thresholdLon, runwayHeading + headingCorrection);
      const crossTrackFt = crossTrackDistanceFt(point.lat, point.lon, thresholdLat, thresholdLon, runwayHeading + headingCorrection) + lateralOffset;
      
      // Expected altitude on glideslope
      const expectedAlt = runwayElev + thresholdCrossingHeight + (distanceNm * Math.tan(toRadians(glideslope)) * 6076.12);
      const verticalDev = correctedAlt - expectedAlt;
      
      return {
        ...point,
        correctedAlt,
        distanceNm,
        crossTrackFt,
        expectedAlt,
        verticalDev
      };
    });
  }, [track, altimeterSetting, glideslope, thresholdCrossingHeight, lateralOffset, headingCorrection, thresholdLat, thresholdLon, runwayElev, runwayHeading]);

  if (loading) return <div style={{padding: 40, textAlign: 'center'}}>Loading staged flight data...</div>;
  
  if (error) return (
    <div style={{padding: 40, textAlign: 'center'}}>
      <h2>No Flight Staged</h2>
      <p style={{color: '#666'}}>{error}</p>
      <p>Go to <a href="http://192.168.42.13:5174">Flight Data Prep</a> to stage a flight.</p>
    </div>
  );

  const flight = flightData?.flight;
  const metars = flightData?.metars || [];

  return (
    <div style={{padding: 20, fontFamily: 'system-ui', maxWidth: 1400, margin: '0 auto'}}>
      <h1>Approach Calibrator</h1>
      
      {/* Flight Info */}
      <div style={{background: '#f0f8ff', padding: 15, borderRadius: 8, marginBottom: 20}}>
        <strong>{flight?.callsign}</strong> | {flight?.dep_airport} → {flight?.arr_airport} | 
        {flight?.manufacturer} {flight?.model} | {track.length} points
        {metars.length > 0 && ` | ${metars.length} METARs`}
      </div>

      <div style={{display: 'flex', gap: 20}}>
        {/* Left: Controls */}
        <div style={{width: 300}}>
          <h3>Glideslope</h3>
          <label>Angle: {glideslope.toFixed(1)}°</label>
          <input type="range" min="2" max="4.5" step="0.1" value={glideslope} onChange={e => setGlideslope(parseFloat(e.target.value))} style={{width: '100%'}} />
          
          <label>TCH: {thresholdCrossingHeight} ft</label>
          <input type="range" min="30" max="80" step="5" value={thresholdCrossingHeight} onChange={e => setThresholdCrossingHeight(parseInt(e.target.value))} style={{width: '100%'}} />

          <h3>Pressure</h3>
          <label>Altimeter: {altimeterSetting.toFixed(2)}" Hg</label>
          <input type="range" min="28.5" max="31" step="0.01" value={altimeterSetting} onChange={e => setAltimeterSetting(parseFloat(e.target.value))} style={{width: '100%'}} />
          
          <h3>Runway</h3>
          <label>Heading: {runwayHeading + headingCorrection}°</label>
          <input type="range" min="-5" max="5" step="0.5" value={headingCorrection} onChange={e => setHeadingCorrection(parseFloat(e.target.value))} style={{width: '100%'}} />
          
          <label>Threshold Lat: {thresholdLat.toFixed(4)}</label>
          <input type="number" step="0.0001" value={thresholdLat} onChange={e => setThresholdLat(parseFloat(e.target.value))} style={{width: '100%'}} />
          
          <label>Threshold Lon: {thresholdLon.toFixed(4)}</label>
          <input type="number" step="0.0001" value={thresholdLon} onChange={e => setThresholdLon(parseFloat(e.target.value))} style={{width: '100%'}} />
          
          <label>Elevation: {runwayElev} ft</label>
          <input type="number" value={runwayElev} onChange={e => setRunwayElev(parseInt(e.target.value))} style={{width: '100%'}} />

          <label>Lateral Offset: {lateralOffset} ft</label>
          <input type="range" min="-200" max="200" step="10" value={lateralOffset} onChange={e => setLateralOffset(parseInt(e.target.value))} style={{width: '100%'}} />

          {/* METARs */}
          {metars.length > 0 && (
            <>
              <h3>METARs</h3>
              <div style={{fontSize: 12, maxHeight: 150, overflowY: 'auto'}}>
                {metars.map((m, i) => (
                  <div key={i} style={{marginBottom: 8, padding: 5, background: '#f5f5f5', borderRadius: 4}}>
                    <strong>{m.airport_icao}</strong> {new Date(m.observation_time).toLocaleTimeString()}<br/>
                    {m.altimeter_inhg && <span>Alt: {parseFloat(m.altimeter_inhg).toFixed(2)}" </span>}
                    {m.wind_dir_degrees && <span>Wind: {m.wind_dir_degrees}° @ {m.wind_speed_kt}kt</span>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right: Data Table */}
        <div style={{flex: 1, overflowX: 'auto'}}>
          <h3>Approach Analysis</h3>
          <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}}>
            <thead>
              <tr style={{background: '#f0f0f0'}}>
                <th style={{padding: 8, textAlign: 'left'}}>Time</th>
                <th style={{padding: 8, textAlign: 'right'}}>Dist (nm)</th>
                <th style={{padding: 8, textAlign: 'right'}}>Alt</th>
                <th style={{padding: 8, textAlign: 'right'}}>Expected</th>
                <th style={{padding: 8, textAlign: 'right'}}>Vert Dev</th>
                <th style={{padding: 8, textAlign: 'right'}}>Lateral</th>
                <th style={{padding: 8, textAlign: 'right'}}>GS</th>
                <th style={{padding: 8, textAlign: 'right'}}>VS</th>
              </tr>
            </thead>
            <tbody>
              {approachData.filter(p => p.distanceNm > 0 && p.distanceNm < 15).map((p, i) => (
                <tr key={i} style={{borderBottom: '1px solid #eee'}}>
                  <td style={{padding: 6}}>{new Date(p.time).toLocaleTimeString()}</td>
                  <td style={{padding: 6, textAlign: 'right'}}>{p.distanceNm.toFixed(2)}</td>
                  <td style={{padding: 6, textAlign: 'right'}}>{p.correctedAlt?.toFixed(0)}</td>
                  <td style={{padding: 6, textAlign: 'right'}}>{p.expectedAlt?.toFixed(0)}</td>
                  <td style={{padding: 6, textAlign: 'right', color: Math.abs(p.verticalDev) > 200 ? 'red' : 'inherit'}}>{p.verticalDev?.toFixed(0)}</td>
                  <td style={{padding: 6, textAlign: 'right', color: Math.abs(p.crossTrackFt) > 500 ? 'orange' : 'inherit'}}>{p.crossTrackFt?.toFixed(0)}</td>
                  <td style={{padding: 6, textAlign: 'right'}}>{p.speed}</td>
                  <td style={{padding: 6, textAlign: 'right'}}>{p.vertical_speed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
