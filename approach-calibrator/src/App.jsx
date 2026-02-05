import { useState, useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const API = 'http://192.168.42.13:5002/api'

const toInHg = (val) => {
  if (!val) return 29.92
  const v = parseFloat(val)
  return v > 100 ? v / 33.8639 : v
}

export default function App() {
  const [tab, setTab] = useState('data')
  const [staged, setStaged] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [aircraftSpeeds, setAircraftSpeeds] = useState(null)

  useEffect(() => { loadStaged() }, [])

  const loadStaged = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/staged`)
      if (!res.ok) {
        setError('No flight staged. Use Flight Data Prep to stage a flight.')
        setStaged(null)
      } else {
        const data = await res.json()
        setStaged(data)
        // Fetch aircraft speeds based on model
        if (data.flight?.model) {
          try {
            const speedRes = await fetch(`${API}/aircraft_speeds?ac_type=${encodeURIComponent(data.flight.model)}`)
            if (speedRes.ok) {
              const speeds = await speedRes.json()
              setAircraftSpeeds(speeds)
            }
          } catch (e) { console.log('No aircraft speeds found') }
        }
      }
    } catch (err) {
      setError('Failed to load: ' + err.message)
    }
    setLoading(false)
  }

  const font = { fontFamily: "'SF Mono', Consolas, Monaco, monospace" }
  const formatTime = (iso) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'
  const formatDateTime = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-'
  const statusColor = (s) => ({ Landed: '#8f8', Approach: '#ff8', Pattern: '#8ff', Departure: '#f8f', Enroute: '#88f' }[s] || '#888')
  const thStyle = { padding: 8, background: '#2a2a4a', whiteSpace: 'nowrap', textAlign: 'left' }
  const tdStyle = { padding: 6, borderBottom: '1px solid #252535' }
  const depMetars = staged?.metars?.filter(m => m.airport_icao === staged.flight.dep_airport) || []
  const arrMetars = staged?.metars?.filter(m => m.airport_icao === staged.flight.arr_airport) || []

  return (
    <div style={{ height: '100vh', ...font, fontSize: 13, background: '#1a1a2e', color: '#eee', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 12, borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 15 }}>
        <b style={{ fontSize: 18 }}>Approach Calibrator</b>
        <button onClick={loadStaged} style={{ padding: '6px 14px', background: '#333', color: '#eee', border: '1px solid #444', borderRadius: 4, ...font, fontSize: 13 }}>{loading ? '...' : 'Reload'}</button>
        <a href="http://192.168.42.13:5174" target="_blank" rel="noreferrer" style={{ padding: '6px 14px', background: '#06c', color: '#fff', textDecoration: 'none', borderRadius: 4, ...font, fontSize: 13 }}>← Flight Data Prep</a>
        {staged && <>
          <span style={{ marginLeft: 'auto', color: '#6cf', fontSize: 16 }}>{staged.flight.callsign} • {staged.flight.manufacturer} {staged.flight.model}</span>
          <span style={{ padding: '4px 12px', borderRadius: 4, background: '#333', color: statusColor(staged.flight.flight_status) }}>{staged.flight.flight_status || 'Unknown'}</span>
        </>}
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
        {['data', 'calibrator', 'visualization', 'map'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '12px 24px', background: tab === t ? '#2a2a4a' : 'transparent', color: tab === t ? '#6cf' : '#888', border: 'none', borderBottom: tab === t ? '2px solid #6cf' : '2px solid transparent', ...font, fontSize: 14, cursor: 'pointer', textTransform: 'capitalize' }}>
            {t === 'data' ? 'Data Set' : t === 'calibrator' ? 'Calibrator' : t === 'visualization' ? 'Profile' : 'Map'}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: tab === 'map' ? 0 : 20 }}>
        {loading ? <div style={{ textAlign: 'center', color: '#888', padding: 40 }}>Loading...</div>
          : error ? <div style={{ textAlign: 'center', padding: 40 }}><div style={{ color: '#f88', marginBottom: 20 }}>{error}</div><a href="http://192.168.42.13:5174" style={{ color: '#6cf' }}>Open Flight Data Prep →</a></div>
          : tab === 'data' ? <DataTab staged={staged} formatTime={formatTime} formatDateTime={formatDateTime} thStyle={thStyle} tdStyle={tdStyle} depMetars={depMetars} arrMetars={arrMetars} statusColor={statusColor} />
          : tab === 'calibrator' ? <CalibratorTab staged={staged} formatTime={formatTime} arrMetars={arrMetars} />
          : tab === 'visualization' ? <VisualizationTab staged={staged} arrMetars={arrMetars} aircraftSpeeds={aircraftSpeeds} />
          : <MapTab staged={staged} arrMetars={arrMetars} />}
      </div>
    </div>
  )
}

function DataTab({ staged, formatTime, formatDateTime, thStyle, tdStyle, depMetars, arrMetars, statusColor }) {
  const flight = staged.flight, track = staged.track || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ background: '#2a2a4a', padding: 16, borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#6cf' }}>{flight.callsign}</div>
            <div style={{ marginTop: 4 }}>{flight.manufacturer} {flight.model}</div>
            <div style={{ color: '#888', fontSize: 12 }}>{flight.aircraft_type}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20 }}><span style={{ color: '#8f8' }}>{flight.dep_airport || '?'}</span><span style={{ margin: '0 15px', color: '#888' }}>→</span><span style={{ color: '#f88' }}>{flight.arr_airport || '?'}</span></div>
            <div style={{ color: '#888', marginTop: 4 }}>{flight.flight_date}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ marginBottom: 8 }}><span style={{ padding: '4px 12px', borderRadius: 4, background: '#333', color: statusColor(flight.flight_status) }}>{flight.flight_status || 'Unknown'}</span></div>
            <div>{flight.duration_minutes} min • {track.length} points</div>
            <div style={{ color: '#888', fontSize: 12 }}>Last: {flight.last_altitude}ft @ {flight.last_speed}kts</div>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {[{ metars: depMetars, label: 'Departure', airport: flight.dep_airport, color: '#8f8' }, { metars: arrMetars, label: 'Arrival', airport: flight.arr_airport, color: '#f88' }].map(({ metars, label, airport, color }) => (
          <div key={label} style={{ flex: 1, minWidth: 400 }}>
            <h3 style={{ margin: '0 0 10px 0', color }}>{label} METARs - {airport}</h3>
            {metars.length > 0 ? (
              <div style={{ background: '#222238', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr><th style={thStyle}>Time</th><th style={thStyle}>Altimeter</th><th style={thStyle}>Temp</th><th style={thStyle}>Wind</th><th style={thStyle}>Vis</th></tr></thead>
                  <tbody>{metars.map((m, i) => (
                    <tr key={i}><td style={tdStyle}>{formatDateTime(m.observation_time)}</td><td style={tdStyle}>{toInHg(m.altimeter_inhg).toFixed(2)}"</td><td style={tdStyle}>{m.temp_c != null ? `${m.temp_c}°C` : '-'}</td><td style={tdStyle}>{m.wind_dir_degrees != null ? `${m.wind_dir_degrees}° @ ${m.wind_speed_kt}kt` : '-'}</td><td style={tdStyle}>{m.visibility_miles != null ? `${m.visibility_miles} SM` : '-'}</td></tr>
                  ))}</tbody>
                </table>
                <div style={{ padding: 8, fontSize: 10, color: '#666', maxHeight: 80, overflow: 'auto' }}>{metars.map((m, i) => <div key={i} style={{ marginBottom: 4 }}>{m.raw_text}</div>)}</div>
              </div>
            ) : <div style={{ color: '#888', padding: 20, background: '#222238', borderRadius: 8 }}>No METAR data</div>}
          </div>
        ))}
      </div>
      <div>
        <h3 style={{ margin: '0 0 10px 0' }}>Track Data ({track.length} points)</h3>
        <div style={{ background: '#222238', borderRadius: 8, overflow: 'hidden', maxHeight: 400, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0 }}>
              <tr><th style={thStyle}>#</th><th style={thStyle}>Time</th><th style={thStyle}>Lat</th><th style={thStyle}>Lon</th><th style={thStyle}>Alt</th><th style={thStyle}>Spd</th><th style={thStyle}>Trk</th><th style={thStyle}>V/S</th></tr>
            </thead>
            <tbody>{track.map((p, i) => (
              <tr key={i}><td style={{...tdStyle, color:'#555'}}>{i+1}</td><td style={tdStyle}>{formatTime(p.position_time)}</td><td style={tdStyle}>{p.latitude ? parseFloat(p.latitude).toFixed(5) : '-'}</td><td style={tdStyle}>{p.longitude ? parseFloat(p.longitude).toFixed(5) : '-'}</td><td style={tdStyle}>{p.altitude ?? '-'}</td><td style={tdStyle}>{p.speed ?? '-'}</td><td style={tdStyle}>{p.track ? parseFloat(p.track).toFixed(0) : '-'}</td><td style={{...tdStyle, color: p.vertical_speed < -500 ? '#f88' : 'inherit'}}>{p.vertical_speed ?? '-'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function findBestRunway(runways, track) {
  if (!runways.length) return null
  const lastWithTrack = [...track].reverse().find(p => p.track != null)
  if (!lastWithTrack) return runways[0]
  const finalTrack = parseFloat(lastWithTrack.track)
  let best = null, bestDiff = 360
  for (const rwy of runways) {
    const hdg = parseFloat(rwy.heading)
    let diff = Math.abs(hdg - finalTrack)
    if (diff > 180) diff = 360 - diff
    if (diff < bestDiff) { bestDiff = diff; best = rwy }
  }
  return best
}

function calcApproachData(track, runway, glideslopeAngle, tch, headingFilter = 30) {
  if (!runway || !track.length) return []
  const thLat = parseFloat(runway.threshold_lat), thLon = parseFloat(runway.threshold_lon)
  const hdg = parseFloat(runway.heading), elev = parseFloat(runway.elevation)
  const gs = parseFloat(glideslopeAngle)
  return track.map((p, idx) => {
    if (!p.latitude || !p.longitude) return null
    const pLat = parseFloat(p.latitude), pLon = parseFloat(p.longitude), R = 3440.065
    const dLat = (pLat - thLat) * Math.PI / 180, dLon = (pLon - thLon) * Math.PI / 180
    const a = Math.sin(dLat/2)**2 + Math.cos(thLat * Math.PI/180) * Math.cos(pLat * Math.PI/180) * Math.sin(dLon/2)**2
    const distNm = 2 * R * Math.asin(Math.sqrt(a))
    const y = Math.sin(dLon) * Math.cos(pLat * Math.PI/180)
    const x = Math.cos(thLat * Math.PI/180) * Math.sin(pLat * Math.PI/180) - Math.sin(thLat * Math.PI/180) * Math.cos(pLat * Math.PI/180) * Math.cos(dLon)
    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
    const inboundCourse = (hdg + 180) % 360
    let angleDiff = bearing - inboundCourse
    if (angleDiff > 180) angleDiff -= 360; if (angleDiff < -180) angleDiff += 360
    const alongTrackNm = distNm * Math.cos(angleDiff * Math.PI / 180)
    const crossTrackFt = distNm * Math.sin(angleDiff * Math.PI / 180) * 6076.12
    const alt = p.altitude || 0, agl = alt - elev
    const idealAlt = elev + tch + (alongTrackNm * 6076.12 * Math.tan(gs * Math.PI / 180))
    // Calculate bank angle from turn rate and speed: bank = atan(V * omega / g)
    // V in ft/s = speed * 1.687, omega in rad/s = turn_rate * pi/180, g = 32.2 ft/s²
    const turnRate = p.turn_rate || 0
    const speedFtS = (p.speed || 0) * 1.687
    const omegaRadS = turnRate * Math.PI / 180
    const bankAngle = Math.abs(Math.atan(speedFtS * omegaRadS / 32.2) * 180 / Math.PI)
    return { idx, distNm: alongTrackNm, crossTrackFt, altitude: alt, agl, idealAlt, gsDevFt: alt - idealAlt, speed: p.speed, vs: p.vertical_speed, track: p.track, time: p.position_time, lat: pLat, lon: pLon, turnRate, accel: p.accel, bankAngle }
  }).filter(p => {
    if (!p) return false
    const inbound = parseFloat(runway.heading)
    if (p.track != null) {
      let diff = Math.abs(parseFloat(p.track) - inbound)
      if (diff > 180) diff = 360 - diff
      if (diff > headingFilter) return false
    }
    return p.distNm > 0 && p.distNm < 10
  })
}

function CalibratorTab({ staged, formatTime, arrMetars }) {
  const runways = staged?.runways || [], track = staged?.track || [], flight = staged?.flight || {}
  const [selectedRunway, setSelectedRunway] = useState(null)
  const [glideslopeAngle, setGlideslopeAngle] = useState(3.0)
  const [tch, setTch] = useState(50)
  const latestMetar = arrMetars?.[arrMetars.length - 1]
  const windDir = latestMetar?.wind_dir_degrees, windSpd = latestMetar?.wind_speed_kt

  const finalTrack = useMemo(() => {
    const last = [...track].reverse().find(p => p.track != null)
    return last ? parseFloat(last.track) : null
  }, [track])

  useEffect(() => {
    const best = findBestRunway(runways, track)
    if (best) { setSelectedRunway(best); setGlideslopeAngle(parseFloat(best.glideslope) || 3.0); setTch(best.tch || 50) }
  }, [runways, track])

  const analyzedTrack = useMemo(() => calcApproachData(track, selectedRunway, glideslopeAngle, tch), [track, selectedRunway, glideslopeAngle, tch])
  const approachTrack = analyzedTrack.filter(p => p.distNm > 0 && p.distNm < 10)
  const inputStyle = { padding: 6, width: 80, background: '#2a2a4a', color: '#eee', border: '1px solid #444', borderRadius: 4, fontFamily: 'inherit' }

  // No runways - show message
  if (runways.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ background: '#422', padding: 20, borderRadius: 8, border: '1px solid #633' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#f88' }}>⚠ No Runway Data for {flight.arr_airport}</h3>
          <p style={{ margin: 0, color: '#caa' }}>
            The arrival airport <b>{flight.arr_airport}</b> is not in our runway database. 
            This may be a heliport, private airfield, or small airport not yet added.
          </p>
          <p style={{ margin: '10px 0 0 0', color: '#888', fontSize: 12 }}>
            The Map tab will still show the flight track. To enable approach analysis, 
            add runway data for this airport to the database.
          </p>
        </div>
        <div style={{ background: '#2a2a4a', padding: 16, borderRadius: 8 }}>
          <h4 style={{ margin: '0 0 10px 0' }}>Flight Info</h4>
          <div style={{ color: '#888' }}>
            {flight.callsign} | {flight.dep_airport} → {flight.arr_airport} | {track.length} track points
            {finalTrack != null && <span> | Final Track: {finalTrack.toFixed(0)}°</span>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: '#2a2a4a', padding: 16, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 20 }}>
        <div>
          <h3 style={{ margin: '0 0 10px 0' }}>Arrival: <span style={{ color: '#f88' }}>{flight.arr_airport || '?'}</span></h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Runway:</span>
            <select value={selectedRunway?.runway_id || ''} onChange={e => { const r = runways.find(x => x.runway_id === e.target.value); if (r) { setSelectedRunway(r); setGlideslopeAngle(parseFloat(r.glideslope) || 3.0); setTch(r.tch || 50) } }} style={{ ...inputStyle, width: 100 }}>
              {runways.map(r => <option key={r.runway_id} value={r.runway_id}>{r.runway_id} ({r.heading}°)</option>)}
            </select>
            {finalTrack != null && <span style={{ color: '#888', fontSize: 11 }}>A/C Final Track: {finalTrack.toFixed(0)}°</span>}
          </div>
        </div>
        {selectedRunway && <div style={{ background: '#1a1a2e', padding: 12, borderRadius: 6, fontSize: 12, color: '#aaa' }}><div style={{ fontWeight: 600, marginBottom: 8, color: '#eee' }}>Runway {selectedRunway.runway_id}</div><div>Heading: {selectedRunway.heading}° | TDZE: {selectedRunway.elevation} ft</div></div>}
        {latestMetar && <div style={{ background: '#1a1a2e', padding: 12, borderRadius: 6, fontSize: 12, color: '#aaa' }}><div style={{ fontWeight: 600, marginBottom: 8, color: '#eee' }}>Weather</div><div>Wind: {windDir}° @ {windSpd} kt | Alt: {toInHg(latestMetar.altimeter_inhg).toFixed(2)}"</div></div>}
      </div>
      <div style={{ background: '#2a2a4a', padding: 16, borderRadius: 8 }}>
        <h3 style={{ margin: '0 0 15px 0' }}>Calibration</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 100 }}>Glideslope:</span><input type="number" step="0.1" value={glideslopeAngle} onChange={e => setGlideslopeAngle(parseFloat(e.target.value) || 3.0)} style={inputStyle} /> °</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 100 }}>TCH:</span><input type="number" value={tch} onChange={e => setTch(parseInt(e.target.value) || 50)} style={inputStyle} /> ft</div>
        </div>
      </div>
      {approachTrack.length > 0 ? (
        <div>
          <h3 style={{ margin: '0 0 10px 0' }}>Approach Analysis ({approachTrack.length} points)</h3>
          <div style={{ background: '#222238', borderRadius: 8, overflow: 'hidden', maxHeight: 400, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0 }}><tr style={{ background: '#2a2a4a' }}><th style={{ padding: 8 }}>#</th><th style={{ padding: 8 }}>Time</th><th style={{ padding: 8 }}>Dist</th><th style={{ padding: 8 }}>Alt</th><th style={{ padding: 8 }}>AGL</th><th style={{ padding: 8 }}>GS Dev</th><th style={{ padding: 8 }}>Loc Dev</th><th style={{ padding: 8 }}>Spd</th><th style={{ padding: 8 }}>V/S</th></tr></thead>
              <tbody>{approachTrack.map((p, i) => {
                const gsC = Math.abs(p.gsDevFt) > 150 ? '#f88' : Math.abs(p.gsDevFt) > 75 ? '#ff8' : '#8f8'
                const locC = Math.abs(p.crossTrackFt) > 300 ? '#f88' : Math.abs(p.crossTrackFt) > 150 ? '#ff8' : '#8f8'
                return <tr key={i} style={{ borderBottom: '1px solid #252535' }}><td style={{ padding: 6, color: '#555' }}>{p.idx + 1}</td><td style={{ padding: 6 }}>{p.time?.split('T')[1]?.slice(0,8) || '-'}</td><td style={{ padding: 6 }}>{p.distNm?.toFixed(2)}</td><td style={{ padding: 6 }}>{p.altitude}</td><td style={{ padding: 6 }}>{p.agl?.toFixed(0)}</td><td style={{ padding: 6, color: gsC }}>{p.gsDevFt?.toFixed(0)}</td><td style={{ padding: 6, color: locC }}>{p.crossTrackFt?.toFixed(0)}</td><td style={{ padding: 6 }}>{p.speed ?? '-'}</td><td style={{ padding: 6 }}>{p.vs ?? '-'}</td></tr>
              })}</tbody>
            </table>
          </div>
        </div>
      ) : <div style={{ background: '#222238', padding: 40, borderRadius: 8, textAlign: 'center', color: '#888' }}>No approach data within 10nm of runway threshold</div>}
    </div>
  )
}

function VisualizationTab({ staged, arrMetars, aircraftSpeeds }) {
  const runways = staged?.runways || [], track = staged?.track || [], flight = staged?.flight || {}
  const [selectedRunway, setSelectedRunway] = useState(null)
  const [glideslopeAngle, setGlideslopeAngle] = useState(3.0)
  const [tch, setTch] = useState(50)
  const [approachSpeed, setApproachSpeed] = useState(80)
  const [hoveredPoint, setHoveredPoint] = useState(null)
  const [maxDist, setMaxDist] = useState(10)
  const [headingFilter, setHeadingFilter] = useState(30)

  const finalTrack = useMemo(() => {
    const last = [...track].reverse().find(p => p.track != null)
    return last ? parseFloat(last.track) : null
  }, [track])

  useEffect(() => {
    const best = findBestRunway(runways, track)
    if (best) { setSelectedRunway(best); setGlideslopeAngle(parseFloat(best.glideslope) || 3.0); setTch(best.tch || 50) }
  }, [runways, track])

  const inputStyle = { padding: 6, width: 70, background: '#2a2a4a', color: '#eee', border: '1px solid #444', borderRadius: 4, fontFamily: 'inherit' }

  // No runways - show basic altitude profile without runway reference
  if (runways.length === 0) {
    const W = 900, H = 320, PAD = 60
    const validTrack = track.filter(p => p.altitude != null)
    const minAlt = Math.min(...validTrack.map(p => p.altitude))
    const maxAlt = Math.max(...validTrack.map(p => p.altitude)) + 200
    const xScale = (i) => PAD + i / (validTrack.length - 1) * (W - PAD * 2)
    const yScale = (alt) => H - PAD - ((alt - minAlt) / (maxAlt - minAlt)) * (H - PAD * 2)
    const getPointColor = (p) => !p.vertical_speed ? '#888' : p.vertical_speed > 200 ? '#f8f' : p.vertical_speed < -700 ? '#f88' : Math.abs(p.vertical_speed) < 100 ? '#8f8' : '#ff8'
    const pathD = validTrack.length > 1 ? validTrack.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.altitude)}`).join(' ') : ''

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ background: '#422', padding: 16, borderRadius: 8, border: '1px solid #633' }}>
          <span style={{ color: '#f88' }}>⚠ No runway data for {flight.arr_airport}</span>
          <span style={{ color: '#888', marginLeft: 10 }}>Showing basic altitude profile (time-based, not distance-based)</span>
        </div>
        <div style={{ background: '#333', padding: 10, borderRadius: 6, fontSize: 12, minHeight: 20, visibility: hoveredPoint ? 'visible' : 'hidden' }}>
          {hoveredPoint ? <><b>Point {hoveredPoint.idx + 1}</b> | Alt: {hoveredPoint.altitude} ft | Spd: {hoveredPoint.speed} kts | VS: {hoveredPoint.vs} fpm</> : <span>&nbsp;</span>}
        </div>
        <div style={{ background: '#222238', borderRadius: 8, padding: 16 }}>
          <h3 style={{ margin: '0 0 10px 0' }}>Altitude Profile - {flight.callsign}</h3>
          <svg width={W} height={H} style={{ background: '#1a1a2e', borderRadius: 4 }}>
            {[0, 0.25, 0.5, 0.75, 1].map(f => {
              const alt = minAlt + f * (maxAlt - minAlt)
              return <g key={f}><line x1={PAD} y1={yScale(alt)} x2={W-PAD} y2={yScale(alt)} stroke="#333" strokeWidth={0.5}/><text x={PAD-5} y={yScale(alt)+4} fill="#666" fontSize={10} textAnchor="end">{Math.round(alt)}</text></g>
            })}
            {pathD && <path d={pathD} fill="none" stroke="#556" strokeWidth={1.5} opacity={0.7}/>}
            {validTrack.map((p, i) => <circle key={i} cx={xScale(i)} cy={yScale(p.altitude)} r={hoveredPoint?.idx===i?8:4} fill={getPointColor(p)} stroke={hoveredPoint?.idx===i?'#fff':'#000'} strokeWidth={1} style={{cursor:'pointer'}} onMouseEnter={()=>setHoveredPoint({...p, idx: i})} onMouseLeave={()=>setHoveredPoint(null)}/>)}
            <text x={W/2} y={H-5} fill="#888" fontSize={11} textAnchor="middle">Track Point #</text>
            <text x={15} y={H/2} fill="#888" fontSize={11} textAnchor="middle" transform={`rotate(-90,15,${H/2})`}>Altitude (ft)</text>
          </svg>
        </div>
        <div style={{ background: '#2a2a4a', padding: 12, borderRadius: 8, display: 'flex', gap: 20, fontSize: 12 }}>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#8f8', borderRadius: '50%', marginRight: 6 }}></span>Level</span>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#ff8', borderRadius: '50%', marginRight: 6 }}></span>Descending</span>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#f88', borderRadius: '50%', marginRight: 6 }}></span>Steep</span>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#f8f', borderRadius: '50%', marginRight: 6 }}></span>Climbing</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#f0f', borderRadius: '50%', marginRight: 6 }}></span>Bank &gt;30°</span>
          <span style={{ marginLeft: 'auto', color: '#666' }}>{validTrack.length} points</span>
        </div>
      </div>
    )
  }

  const approachData = useMemo(() => calcApproachData(track, selectedRunway, glideslopeAngle, tch, headingFilter), [track, selectedRunway, glideslopeAngle, tch, headingFilter])
  const approachPoints = approachData.filter(p => p.distNm > -0.5 && p.distNm < maxDist)

  // Approach metrics
  const metrics = useMemo(() => {
    if (approachPoints.length === 0) return null
    const first = approachPoints[0]
    const speeds = approachPoints.filter(p => p.speed != null).map(p => p.speed)
    const vSpeeds = approachPoints.filter(p => p.vs != null && p.vs < 0).map(p => p.vs)
    const crossTracks = approachPoints.map(p => Math.abs(p.crossTrackFt))
    const bankAngles = approachPoints.filter(p => p.bankAngle != null).map(p => p.bankAngle)
    const accels = approachPoints.filter(p => p.accel != null).map(p => Math.abs(p.accel))
    const steepBankCount = bankAngles.filter(b => b > 30).length
    const gsOutOfRange = speeds.length ? speeds.filter(s => Math.abs(s - speeds.reduce((a,b)=>a+b,0)/speeds.length) > 5).length : 0
    return {
      startDist: first.distNm,
      startAlt: first.altitude,
      startAgl: first.agl,
      avgGs: speeds.length ? Math.round(speeds.reduce((a,b) => a+b, 0) / speeds.length) : null,
      minGs: speeds.length ? Math.min(...speeds) : null,
      maxGs: speeds.length ? Math.max(...speeds) : null,
      avgVs: vSpeeds.length ? Math.round(vSpeeds.reduce((a,b) => a+b, 0) / vSpeeds.length) : null,
      minVs: vSpeeds.length ? Math.min(...vSpeeds) : null,
      maxVs: vSpeeds.length ? Math.max(...vSpeeds) : null,
      maxCrossTrack: crossTracks.length ? Math.round(Math.max(...crossTracks)) : null,
      maxBankAngle: bankAngles.length ? Math.round(Math.max(...bankAngles)) : null,
      steepBankCount,
      maxAccel: accels.length ? Math.max(...accels).toFixed(2) : null,
      gsOutOfRange,
      pointCount: approachPoints.length
    }
  }, [approachPoints])

  const fpmSlopeAlt = (distNm) => (selectedRunway?.elevation || 0) + tch + 500 * distNm / (approachSpeed / 60)

  const W = 900, H = 320, PAD = 60
  const tdze = selectedRunway?.elevation || 0
  const maxAltForZoom = tdze + Math.min(3000, maxDist * 350)
  const maxAlt = Math.max(tdze + 500, maxAltForZoom)
  const xScale = (d) => PAD + (maxDist - d) / maxDist * (W - PAD * 2)
  const yScaleVert = (alt) => H - PAD - ((Math.max(alt, tdze) - tdze) / (maxAlt - tdze)) * (H - PAD * 2)
  const crossTrackValues = approachPoints.map(p => Math.abs(p.crossTrackFt))
  const maxCross = Math.max(500, Math.min(5000, Math.max(...crossTrackValues) * 1.2)) || 1500
  const yScaleLat = (ft) => H/2 - (ft / maxCross) * (H/2 - PAD)
  const getPointColor = (p) => p.bankAngle > 30 ? '#f0f' : !p.vs ? '#888' : p.vs > 200 ? '#f8f' : p.vs < -700 ? '#f88' : Math.abs(p.vs) < 100 ? '#8f8' : '#ff8'

  const step = maxDist <= 2 ? 0.25 : maxDist <= 5 ? 0.5 : 1
  const distGridLines = []; for (let d = 0; d <= maxDist; d += step) distGridLines.push(d)
  const altStep = maxDist <= 2 ? 100 : maxDist <= 5 ? 250 : 500
  const altGridLines = []; for (let a = 0; a <= maxAlt - tdze; a += altStep) altGridLines.push(tdze + a)
  const crossStep = maxCross <= 500 ? 100 : maxCross <= 1000 ? 250 : 500
  const crossGridLines = []; for (let c = -maxCross; c <= maxCross; c += crossStep) crossGridLines.push(c)

  const sortedPoints = [...approachPoints].sort((a, b) => a.idx - b.idx)
  const vertPathD = sortedPoints.length > 1 ? sortedPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.distNm)} ${yScaleVert(p.altitude)}`).join(' ') : ''
  const latPathD = sortedPoints.length > 1 ? sortedPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.distNm)} ${yScaleLat(Math.max(-maxCross, Math.min(maxCross, p.crossTrackFt)))}`).join(' ') : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, position: 'relative' }}>
      <div style={{ background: '#333', padding: 10, borderRadius: 6, fontSize: 12, minHeight: 20, visibility: hoveredPoint ? 'visible' : 'hidden' }}>
        {hoveredPoint ? <><b>Point {hoveredPoint.idx + 1}</b> | Dist: {hoveredPoint.distNm.toFixed(2)} nm | Alt: {hoveredPoint.agl.toFixed(0)} AGL ({hoveredPoint.altitude} MSL) | Cross: {hoveredPoint.crossTrackFt.toFixed(0)}ft | Spd: {hoveredPoint.speed} kts | VS: {hoveredPoint.vs} fpm | Bank: <span style={{color: hoveredPoint.bankAngle > 30 ? '#f0f' : 'inherit'}}>{hoveredPoint.bankAngle?.toFixed(1) ?? '-'}°</span> | Turn: {hoveredPoint.turnRate?.toFixed(2) ?? '-'}°/s</> : <span>&nbsp;</span>}
      </div>

      <div style={{ background: '#2a2a4a', padding: 16, borderRadius: 8, display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Runway:</span>
          <select value={selectedRunway?.runway_id || ''} onChange={e => { const r = runways.find(x => x.runway_id === e.target.value); if (r) { setSelectedRunway(r); setGlideslopeAngle(parseFloat(r.glideslope) || 3.0); setTch(r.tch || 50) } }} style={{ ...inputStyle, width: 90 }}>
            {runways.map(r => <option key={r.runway_id} value={r.runway_id}>{r.runway_id} ({r.heading}°)</option>)}
          </select>
          {finalTrack != null && <span style={{ color: '#888', fontSize: 11 }}>A/C Track: {finalTrack.toFixed(0)}°</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>GS:</span><input type="number" step="0.1" value={glideslopeAngle} onChange={e => setGlideslopeAngle(parseFloat(e.target.value) || 3.0)} style={inputStyle} />°</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>Approach Spd:</span><input type="number" value={approachSpeed} onChange={e => setApproachSpeed(parseInt(e.target.value) || 80)} style={inputStyle} /> kts</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Zoom:</span>
          <input type="range" min="1" max="10" step="0.5" value={maxDist} onChange={e => setMaxDist(parseFloat(e.target.value))} style={{ width: 100 }} />
          <span style={{ color: '#6cf', minWidth: 45 }}>{maxDist} nm</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Track ±</span>
          <input type="number" min="5" max="90" value={headingFilter} onChange={e => setHeadingFilter(parseInt(e.target.value) || 30)} style={{ ...inputStyle, width: 50 }} />°
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#888' }}>{selectedRunway && `${flight.arr_airport} RWY ${selectedRunway.runway_id} | TDZE ${selectedRunway.elevation}ft | Hdg ${selectedRunway.heading}°`}</div>
      </div>
      {aircraftSpeeds && (
        <div style={{ background: '#1a2a1a', padding: 10, borderRadius: 6, display: 'flex', gap: 20, fontSize: 12, border: '1px solid #3a5a3a' }}>
          <span><b style={{ color: '#8f8' }}>{aircraftSpeeds.ac_type}</b></span>
          <span>Appr: <b>{aircraftSpeeds.appr_speed} kts</b></span>
          <span>Dirty Stall: <b>{aircraftSpeeds.dirty_stall} kts</b></span>
          <span>Clean Stall: <b>{aircraftSpeeds.clean_stall} kts</b></span>
          <span style={{ color: '#888' }}>Vref 1.3: <b>{Math.round(aircraftSpeeds.dirty_stall * 1.3)} kts</b></span>
        </div>
      )}

      {approachPoints.length === 0 ? (
        <div style={{ background: '#222238', padding: 40, borderRadius: 8, textAlign: 'center', color: '#888' }}>No approach data within {maxDist}nm</div>
      ) : (
        <>
          <div style={{ background: '#222238', borderRadius: 8, padding: 16 }}>
            <h3 style={{ margin: '0 0 10px 0' }}>Vertical Profile - {flight.arr_airport} RWY {selectedRunway?.runway_id}</h3>
            <svg width={W} height={H} style={{ background: '#1a1a2e', borderRadius: 4 }}>
              {distGridLines.map(d => <g key={d}><line x1={xScale(d)} y1={PAD} x2={xScale(d)} y2={H-PAD} stroke="#333" strokeWidth={d % (maxDist <= 2 ? 1 : 5) === 0 ? 1 : 0.5}/><text x={xScale(d)} y={H-PAD+15} fill="#666" fontSize={10} textAnchor="middle">{d}</text></g>)}
              {altGridLines.map(alt => <g key={alt}><line x1={PAD} y1={yScaleVert(alt)} x2={W-PAD} y2={yScaleVert(alt)} stroke="#333" strokeWidth={(alt - tdze) % 1000 === 0 ? 1 : 0.5}/><text x={PAD-5} y={yScaleVert(alt)+4} fill="#666" fontSize={10} textAnchor="end">{alt}</text></g>)}
              <line x1={xScale(0)} y1={yScaleVert(tdze+tch)} x2={xScale(maxDist)} y2={yScaleVert(tdze+tch+maxDist*6076.12*Math.tan(glideslopeAngle*Math.PI/180))} stroke="#4a4" strokeWidth={2} strokeDasharray="8,4"/>
              <line x1={xScale(0)} y1={yScaleVert(tdze+tch)} x2={xScale(maxDist)} y2={yScaleVert(fpmSlopeAlt(maxDist))} stroke="#48f" strokeWidth={2} strokeDasharray="4,4"/>
              <line x1={PAD} y1={yScaleVert(tdze)} x2={W-PAD} y2={yScaleVert(tdze)} stroke="#888" strokeWidth={2}/>
              <rect x={xScale(0)-8} y={yScaleVert(tdze)-3} width={16} height={6} fill="#fff"/>
              {vertPathD && <path d={vertPathD} fill="none" stroke="#556" strokeWidth={1.5} opacity={0.7}/>}
              {approachPoints.map((p,i) => <circle key={i} cx={xScale(p.distNm)} cy={yScaleVert(p.altitude)} r={hoveredPoint?.idx===p.idx?8:5} fill={getPointColor(p)} stroke={hoveredPoint?.idx===p.idx?'#fff':'#000'} strokeWidth={hoveredPoint?.idx===p.idx?2:1} style={{cursor:'pointer'}} onMouseEnter={()=>setHoveredPoint(p)} onMouseLeave={()=>setHoveredPoint(null)}/>)}
              <text x={W/2} y={H-5} fill="#888" fontSize={11} textAnchor="middle">Distance to Threshold (nm)</text>
              <text x={15} y={H/2} fill="#888" fontSize={11} textAnchor="middle" transform={`rotate(-90,15,${H/2})`}>Altitude MSL (ft)</text>
              <g transform={`translate(${W-180},15)`}><line x1={0} y1={0} x2={30} y2={0} stroke="#4a4" strokeWidth={2} strokeDasharray="8,4"/><text x={35} y={4} fill="#4a4" fontSize={10}>{glideslopeAngle}° GS</text><line x1={0} y1={15} x2={30} y2={15} stroke="#48f" strokeWidth={2} strokeDasharray="4,4"/><text x={35} y={19} fill="#48f" fontSize={10}>500fpm @ {approachSpeed}kt</text></g>
            </svg>
          </div>
          <div style={{ background: '#222238', borderRadius: 8, padding: 16 }}>
            <h3 style={{ margin: '0 0 10px 0' }}>Lateral View - {flight.arr_airport} RWY {selectedRunway?.runway_id} Extended Centerline</h3>
            <svg width={W} height={H} style={{ background: '#1a1a2e', borderRadius: 4 }}>
              {distGridLines.map(d => <g key={d}><line x1={xScale(d)} y1={PAD} x2={xScale(d)} y2={H-PAD} stroke="#333" strokeWidth={d % (maxDist <= 2 ? 1 : 5) === 0 ? 1 : 0.5}/><text x={xScale(d)} y={H-PAD+15} fill="#666" fontSize={10} textAnchor="middle">{d}</text></g>)}
              {crossGridLines.map(ft => <g key={ft}><line x1={PAD} y1={yScaleLat(ft)} x2={W-PAD} y2={yScaleLat(ft)} stroke={ft===0?'#4a4':'#333'} strokeWidth={ft===0?2:0.5}/><text x={PAD-5} y={yScaleLat(ft)+4} fill="#666" fontSize={10} textAnchor="end">{ft>0?'R':ft<0?'L':''}{Math.abs(ft)}</text></g>)}
              <line x1={xScale(maxDist)} y1={yScaleLat(Math.min(300, maxCross))} x2={xScale(0)} y2={yScaleLat(75)} stroke="#664" strokeWidth={1} strokeDasharray="5,5"/>
              <line x1={xScale(maxDist)} y1={yScaleLat(Math.max(-300, -maxCross))} x2={xScale(0)} y2={yScaleLat(-75)} stroke="#664" strokeWidth={1} strokeDasharray="5,5"/>
              <rect x={xScale(0)-8} y={yScaleLat(75)} width={16} height={yScaleLat(-75)-yScaleLat(75)} fill="#fff"/>
              {latPathD && <path d={latPathD} fill="none" stroke="#556" strokeWidth={1.5} opacity={0.7}/>}
              {approachPoints.map((p,i) => <circle key={i} cx={xScale(p.distNm)} cy={yScaleLat(Math.max(-maxCross, Math.min(maxCross, p.crossTrackFt)))} r={hoveredPoint?.idx===p.idx?8:5} fill={getPointColor(p)} stroke={hoveredPoint?.idx===p.idx?'#fff':'#000'} strokeWidth={hoveredPoint?.idx===p.idx?2:1} style={{cursor:'pointer'}} onMouseEnter={()=>setHoveredPoint(p)} onMouseLeave={()=>setHoveredPoint(null)}/>)}
              <text x={W/2} y={H-5} fill="#888" fontSize={11} textAnchor="middle">Distance to Threshold (nm)</text>
              <text x={15} y={H/2} fill="#888" fontSize={11} textAnchor="middle" transform={`rotate(-90,15,${H/2})`}>Offset from Centerline (ft)</text>
            </svg>
          </div>
          {metrics && (
            <div style={{ background: '#1a1a2e', padding: 16, borderRadius: 8, border: '1px solid #333' }}>
              <h4 style={{ margin: '0 0 12px 0', color: '#6cf' }}>Approach Metrics</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 13 }}>
                <div><span style={{ color: '#888' }}>First Point:</span> <b>{metrics.startDist?.toFixed(2)} nm</b></div>
                <div><span style={{ color: '#888' }}>Altitude:</span> <b>{metrics.startAlt} MSL</b> ({metrics.startAgl?.toFixed(0)} AGL)</div>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #333', paddingTop: 8, marginTop: 4 }}><span style={{ color: '#888' }}>Groundspeed</span></div>
                <div><span style={{ color: '#888' }}>Avg:</span> <b>{metrics.avgGs ?? '-'} kts</b></div>
                <div><span style={{ color: '#888' }}>Min/Max:</span> <b>{metrics.minGs ?? '-'} / {metrics.maxGs ?? '-'} kts</b></div>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #333', paddingTop: 8, marginTop: 4 }}><span style={{ color: '#888' }}>Vertical Speed</span></div>
                <div><span style={{ color: '#888' }}>Avg:</span> <b>{metrics.avgVs ?? '-'} fpm</b></div>
                <div><span style={{ color: '#888' }}>Min/Max:</span> <b>{metrics.minVs ?? '-'} / {metrics.maxVs ?? '-'} fpm</b></div>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #333', paddingTop: 8, marginTop: 4 }}><span style={{ color: '#888' }}>Lateral</span></div>
                <div><span style={{ color: '#888' }}>Max Deviation:</span> <b>{metrics.maxCrossTrack ?? '-'} ft</b></div>
                <div><span style={{ color: '#888' }}>Max Bank:</span> <b style={{ color: metrics.maxBankAngle > 30 ? '#f88' : 'inherit' }}>{metrics.maxBankAngle ?? '-'}°</b>{metrics.steepBankCount > 0 && <span style={{ color: '#f88' }}> ({metrics.steepBankCount} steep)</span>}</div>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #333', paddingTop: 8, marginTop: 4 }}><span style={{ color: '#888' }}>Stability</span></div>
                <div><span style={{ color: '#888' }}>GS ±5kt:</span> <b style={{ color: metrics.gsOutOfRange > 0 ? '#ff8' : '#8f8' }}>{metrics.gsOutOfRange} pts</b></div>
                <div><span style={{ color: '#888' }}>Max Accel:</span> <b>{metrics.maxAccel ?? '-'} kt/s</b></div>
                <div><span style={{ color: '#888' }}>Points:</span> <b>{metrics.pointCount}</b></div>
              </div>
            </div>
          )}
          <div style={{ background: '#2a2a4a', padding: 12, borderRadius: 8, display: 'flex', gap: 20, fontSize: 12, flexWrap: 'wrap' }}>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#8f8', borderRadius: '50%', marginRight: 6 }}></span>Level</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#ff8', borderRadius: '50%', marginRight: 6 }}></span>Descending</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#f88', borderRadius: '50%', marginRight: 6 }}></span>Steep</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#f8f', borderRadius: '50%', marginRight: 6 }}></span>Climbing</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#f0f', borderRadius: '50%', marginRight: 6 }}></span>Bank &gt;30°</span>
            <span style={{ marginLeft: 'auto', color: '#666' }}>{approachPoints.length} points</span>
          </div>
        </>
      )}
    </div>
  )
}

function MapTab({ staged, arrMetars }) {
  const runways = staged?.runways || [], track = staged?.track || [], flight = staged?.flight || {}
  const [selectedRunway, setSelectedRunway] = useState(null)

  const finalTrack = useMemo(() => {
    const last = [...track].reverse().find(p => p.track != null)
    return last ? parseFloat(last.track) : null
  }, [track])

  useEffect(() => {
    const best = findBestRunway(runways, track)
    if (best) setSelectedRunway(best)
  }, [runways, track])

  const trackCoords = track.filter(p => p.latitude && p.longitude).map(p => [parseFloat(p.latitude), parseFloat(p.longitude)])
  
  const extendedCenterline = useMemo(() => {
    if (!selectedRunway) return []
    const thLat = parseFloat(selectedRunway.threshold_lat), thLon = parseFloat(selectedRunway.threshold_lon)
    const hdg = parseFloat(selectedRunway.heading), inbound = (hdg + 180) % 360
    const points = []
    for (let nm = 0; nm <= 10; nm += 0.5) {
      const dist = nm / 60
      const lat = thLat + dist * Math.cos(inbound * Math.PI / 180)
      const lon = thLon + dist * Math.sin(inbound * Math.PI / 180) / Math.cos(thLat * Math.PI / 180)
      points.push([lat, lon])
    }
    return points
  }, [selectedRunway])

  // Center on last track point if no runway, otherwise runway threshold
  const center = selectedRunway 
    ? [parseFloat(selectedRunway.threshold_lat), parseFloat(selectedRunway.threshold_lon)] 
    : trackCoords.length > 0 
      ? trackCoords[trackCoords.length - 1]
      : [40.84, -72.62]

  const inputStyle = { padding: 6, width: 90, background: '#2a2a4a', color: '#eee', border: '1px solid #444', borderRadius: 4, fontFamily: 'inherit' }
  const getPointColor = (p) => !p.vertical_speed ? '#888' : p.vertical_speed > 200 ? '#f8f' : p.vertical_speed < -700 ? '#f88' : Math.abs(p.vertical_speed) < 100 ? '#8f8' : '#ff8'

  const calcBankAngle = (p) => {
    const turnRate = p.turn_rate || 0
    const speedFtS = (p.speed || 0) * 1.687
    const omegaRadS = turnRate * Math.PI / 180
    return Math.abs(Math.atan(speedFtS * omegaRadS / 32.2) * 180 / Math.PI)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#2a2a4a', padding: 12, display: 'flex', flexWrap: 'wrap', gap: 15, alignItems: 'center' }}>
        {runways.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Runway:</span>
            <select value={selectedRunway?.runway_id || ''} onChange={e => { const r = runways.find(x => x.runway_id === e.target.value); if (r) setSelectedRunway(r) }} style={inputStyle}>
              {runways.map(r => <option key={r.runway_id} value={r.runway_id}>{r.runway_id} ({r.heading}°)</option>)}
            </select>
          </div>
        ) : (
          <span style={{ color: '#f88' }}>⚠ No runway data for {flight.arr_airport}</span>
        )}
        <span style={{ color: '#888', fontSize: 12 }}>{flight.arr_airport} | {track.length} points</span>
        {selectedRunway && <span style={{ color: '#888', fontSize: 12 }}>RWY {selectedRunway.runway_id} Hdg {selectedRunway.heading}°</span>}
        {finalTrack != null && <span style={{ color: '#6cf', fontSize: 12 }}>A/C Final Track: {finalTrack.toFixed(0)}°</span>}
      </div>
      <div style={{ flex: 1 }}>
        <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution='&copy; Esri'/>
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}" attribution='' opacity={0.5}/>
          {extendedCenterline.length > 0 && <Polyline positions={extendedCenterline} color="#0f0" weight={2} dashArray="10,10" opacity={0.7} />}
          {trackCoords.length > 1 && <Polyline positions={trackCoords} color="#6cf" weight={2} opacity={0.8} />}
          {track.filter(p => p.latitude && p.longitude).map((p, i) => {
            const bank = calcBankAngle(p)
            const isSteepBank = bank > 30
            return (
              <CircleMarker key={i} center={[parseFloat(p.latitude), parseFloat(p.longitude)]} radius={isSteepBank ? 7 : 4} fillColor={isSteepBank ? '#f0f' : getPointColor(p)} color={isSteepBank ? '#fff' : '#000'} weight={isSteepBank ? 2 : 1} fillOpacity={0.9}>
                <Popup><div style={{ fontFamily: 'monospace', fontSize: 11 }}><b>Point {i + 1}</b><br/>Alt: {p.altitude} ft<br/>Spd: {p.speed} kts<br/>Trk: {p.track ? parseFloat(p.track).toFixed(0) : '-'}°<br/>VS: {p.vertical_speed} fpm<br/>Bank: <span style={{color: isSteepBank ? '#f0f' : 'inherit'}}>{bank.toFixed(1)}°</span><br/>Turn: {p.turn_rate?.toFixed(2) ?? '-'}°/s</div></Popup>
              </CircleMarker>
            )
          })}
          {selectedRunway && <CircleMarker center={[parseFloat(selectedRunway.threshold_lat), parseFloat(selectedRunway.threshold_lon)]} radius={8} fillColor="#fff" color="#000" weight={2} fillOpacity={1}><Popup><div style={{ fontFamily: 'monospace', fontSize: 11 }}><b>RWY {selectedRunway.runway_id}</b><br/>Hdg: {selectedRunway.heading}°<br/>TDZE: {selectedRunway.elevation} ft</div></Popup></CircleMarker>}
          <MapUpdater center={center} />
        </MapContainer>
      </div>
    </div>
  )
}

function MapUpdater({ center }) {
  const map = useMap()
  useEffect(() => { map.setView(center, map.getZoom()) }, [center, map])
  return null
}
