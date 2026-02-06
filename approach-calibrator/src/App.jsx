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
        {['data', 'calibrator', 'visualization', 'map', 'attempts'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '12px 24px', background: tab === t ? '#2a2a4a' : 'transparent', color: tab === t ? '#6cf' : '#888', border: 'none', borderBottom: tab === t ? '2px solid #6cf' : '2px solid transparent', ...font, fontSize: 14, cursor: 'pointer', textTransform: 'capitalize' }}>
            {t === 'data' ? 'Data Set' : t === 'calibrator' ? 'Calibrator' : t === 'visualization' ? 'Profile' : t === 'map' ? 'Map' : 'Scoreboard'}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: (tab === 'map' || tab === 'attempts') ? 0 : 20 }}>
        {loading ? <div style={{ textAlign: 'center', color: '#888', padding: 40 }}>Loading...</div>
          : error ? <div style={{ textAlign: 'center', padding: 40 }}><div style={{ color: '#f88', marginBottom: 20 }}>{error}</div><a href="http://192.168.42.13:5174" style={{ color: '#6cf' }}>Open Flight Data Prep →</a></div>
          : tab === 'data' ? <DataTab staged={staged} formatTime={formatTime} formatDateTime={formatDateTime} thStyle={thStyle} tdStyle={tdStyle} depMetars={depMetars} arrMetars={arrMetars} statusColor={statusColor} />
          : tab === 'calibrator' ? <CalibratorTab staged={staged} formatTime={formatTime} arrMetars={arrMetars} />
          : tab === 'visualization' ? <VisualizationTab staged={staged} arrMetars={arrMetars} aircraftSpeeds={aircraftSpeeds} />
          : tab === 'map' ? <MapTab staged={staged} arrMetars={arrMetars} />
          : tab === 'attempts' ? <AttemptsTab onLoadFlight={loadStaged} />
          : null}
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

// Approach Scoring System
function calculateApproachScore(approachPoints, runway, metar, aircraftSpeeds) {
  if (!approachPoints.length || !runway) return null
  
  const scores = {
    descent: { score: 0, max: 20, details: [], deductions: [] },
    stabilized: { score: 0, max: 20, details: [], deductions: [] },
    centerline: { score: 0, max: 20, details: [], deductions: [] },
    turnToFinal: { score: 0, max: 15, details: [], deductions: [] },
    speedControl: { score: 0, max: 15, details: [], deductions: [] },
    thresholdCrossing: { score: 0, max: 10, details: [], deductions: [] }
  }
  
  const severePenalties = []
  
  const tdze = parseFloat(runway.elevation) || 0
  const rwyHdg = parseFloat(runway.heading)
  const windDir = metar?.wind_dir_degrees
  const windSpd = metar?.wind_speed_kt || 0
  const windGust = metar?.wind_gust_kt || 0
  const targetSpeed = aircraftSpeeds?.appr_speed || 70
  const dirtyStall = aircraftSpeeds?.dirty_stall || 45
  
  // Calculate crosswind component
  let crosswindComponent = 0
  if (windDir != null) {
    const windAngle = Math.abs(windDir - rwyHdg)
    const adjustedAngle = windAngle > 180 ? 360 - windAngle : windAngle
    crosswindComponent = Math.abs(Math.sin(adjustedAngle * Math.PI / 180) * windSpd)
  }
  
  // Sort points by distance (far to near)
  const sorted = [...approachPoints].sort((a, b) => b.distNm - a.distNm)
  const lastPoint = sorted[sorted.length - 1]
  
  // ============ SEVERE PENALTY CHECKS ============
  // Below glidepath when below 500ft AGL
  const belowGsBelow500 = sorted.filter(p => p.agl < 500 && p.gsDevFt < -50)
  if (belowGsBelow500.length > 0) {
    const worstDev = Math.min(...belowGsBelow500.map(p => p.gsDevFt))
    severePenalties.push({
      type: 'CFIT RISK',
      detail: `${belowGsBelow500.length} pts below glideslope when <500ft AGL (worst: ${worstDev.toFixed(0)}ft low)`,
      penalty: 20
    })
  }
  
  // Within 10kts of stall speed when above 50ft AGL
  const nearStall = sorted.filter(p => p.agl > 50 && p.speed != null && p.speed < dirtyStall + 10)
  if (nearStall.length > 0) {
    const lowestSpeed = Math.min(...nearStall.map(p => p.speed))
    const margin = lowestSpeed - dirtyStall
    severePenalties.push({
      type: 'STALL RISK',
      detail: `${nearStall.length} pts within 10kts of stall (${lowestSpeed}kt, Vs ${dirtyStall}kt, margin ${margin.toFixed(0)}kt)`,
      penalty: 20
    })
  }
  
  // 1. DESCENT QUALITY (20 pts)
  scores.descent.score = 20
  const gsDeviations = sorted.filter(p => p.gsDevFt != null).map(p => p.gsDevFt)
  const avgGsDev = gsDeviations.length ? gsDeviations.reduce((a,b) => a+b, 0) / gsDeviations.length : 0
  const belowGsCount = gsDeviations.filter(d => d < -100).length
  const wayBelowCount = gsDeviations.filter(d => d < -200).length
  const aboveGsCount = gsDeviations.filter(d => d > 150).length
  
  if (wayBelowCount > 0) {
    const deduct = Math.min(10, wayBelowCount * 2)
    scores.descent.score -= deduct
    scores.descent.deductions.push(`-${deduct}: ${wayBelowCount} pts >200ft below GS (dangerous)`)
  }
  if (belowGsCount > wayBelowCount) {
    const deduct = Math.min(5, (belowGsCount - wayBelowCount))
    scores.descent.score -= deduct
    scores.descent.deductions.push(`-${deduct}: ${belowGsCount - wayBelowCount} pts 100-200ft below GS`)
  }
  if (aboveGsCount > 3) {
    const deduct = Math.min(3, Math.floor((aboveGsCount - 3) / 2))
    scores.descent.score -= deduct
    scores.descent.deductions.push(`-${deduct}: ${aboveGsCount} pts >150ft above GS`)
  }
  
  const climbingPts = sorted.filter(p => p.vs != null && p.vs > 200).length
  if (climbingPts > 0) {
    const deduct = Math.min(5, climbingPts)
    scores.descent.score -= deduct
    scores.descent.deductions.push(`-${deduct}: ${climbingPts} pts climbing on approach`)
  }
  scores.descent.details.push(`Avg GS dev: ${avgGsDev.toFixed(0)}ft, Below: ${belowGsCount}, Above: ${aboveGsCount}`)
  scores.descent.score = Math.max(0, scores.descent.score)
  
  // 2. STABILIZED APPROACH (20 pts)
  scores.stabilized.score = 20
  let stabilizedDist = 0
  for (const p of sorted) {
    const onSpeed = p.speed && Math.abs(p.speed - targetSpeed) <= 10
    const onGs = p.gsDevFt != null && Math.abs(p.gsDevFt) < 150
    const onCenterline = Math.abs(p.crossTrackFt) < 300
    if (onSpeed && onGs && onCenterline) {
      stabilizedDist = p.distNm
      break
    }
  }
  scores.stabilized.details.push(`Stabilized at ${stabilizedDist.toFixed(2)} nm`)
  if (stabilizedDist < 1) {
    scores.stabilized.score -= 15
    scores.stabilized.deductions.push(`-15: Not stabilized until <1nm (go-around criteria)`)
  } else if (stabilizedDist < 2) {
    scores.stabilized.score -= 10
    scores.stabilized.deductions.push(`-10: Stabilized late (${stabilizedDist.toFixed(1)}nm)`)
  } else if (stabilizedDist < 3) {
    scores.stabilized.score -= 5
    scores.stabilized.deductions.push(`-5: Stabilized at ${stabilizedDist.toFixed(1)}nm (ideal >3nm)`)
  }
  scores.stabilized.score = Math.max(0, scores.stabilized.score)
  
  // 3. CENTERLINE TRACKING (20 pts)
  scores.centerline.score = 20
  const crosswindMargin = crosswindComponent * 20
  const crossTracks = sorted.map(p => Math.abs(p.crossTrackFt))
  const avgCross = crossTracks.reduce((a,b) => a+b, 0) / crossTracks.length
  const maxCross = Math.max(...crossTracks)
  const adjustedMax = Math.max(0, maxCross - crosswindMargin)
  
  if (adjustedMax > 500) {
    scores.centerline.score -= 10
    scores.centerline.deductions.push(`-10: Max deviation ${maxCross.toFixed(0)}ft`)
  } else if (adjustedMax > 300) {
    scores.centerline.score -= 5
    scores.centerline.deductions.push(`-5: Max deviation ${maxCross.toFixed(0)}ft`)
  }
  if (avgCross > 200) {
    scores.centerline.score -= 5
    scores.centerline.deductions.push(`-5: Avg deviation ${avgCross.toFixed(0)}ft`)
  } else if (avgCross > 100) {
    scores.centerline.score -= 2
    scores.centerline.deductions.push(`-2: Avg deviation ${avgCross.toFixed(0)}ft`)
  }
  scores.centerline.details.push(`Avg: ${avgCross.toFixed(0)}ft, Max: ${maxCross.toFixed(0)}ft, XW adj: ${crosswindMargin.toFixed(0)}ft`)
  scores.centerline.score = Math.max(0, scores.centerline.score)
  
  // 4. TURN TO FINAL (15 pts)
  scores.turnToFinal.score = 15
  const steepBanks = sorted.filter(p => p.bankAngle > 30)
  const maxBank = sorted.length ? Math.max(...sorted.map(p => p.bankAngle || 0)) : 0
  
  if (steepBanks.length > 0) {
    const deduct = Math.min(10, steepBanks.length * 2)
    scores.turnToFinal.score -= deduct
    scores.turnToFinal.deductions.push(`-${deduct}: ${steepBanks.length} pts with bank >30° (max ${maxBank.toFixed(1)}°)`)
  }
  
  let crossings = 0
  let prevSide = null
  for (const p of sorted) {
    const side = p.crossTrackFt > 50 ? 'R' : p.crossTrackFt < -50 ? 'L' : null
    if (side && prevSide && side !== prevSide) crossings++
    if (side) prevSide = side
  }
  if (crossings > 1) {
    const deduct = Math.min(5, (crossings - 1) * 2)
    scores.turnToFinal.score -= deduct
    scores.turnToFinal.deductions.push(`-${deduct}: ${crossings} centerline crossings (S-turns)`)
  }
  scores.turnToFinal.details.push(`Max bank: ${maxBank.toFixed(1)}°, CL crossings: ${crossings}`)
  scores.turnToFinal.score = Math.max(0, scores.turnToFinal.score)
  
  // 5. SPEED CONTROL (15 pts)
  scores.speedControl.score = 15
  const gustMargin = windGust > 0 ? windGust / 2 : 0
  const speedTolerance = 5 + gustMargin
  const speeds = sorted.filter(p => p.speed != null).map(p => p.speed)
  const avgSpeed = speeds.length ? speeds.reduce((a,b) => a+b, 0) / speeds.length : targetSpeed
  const speedDevs = speeds.map(s => Math.abs(s - targetSpeed))
  const maxSpeedDev = speedDevs.length ? Math.max(...speedDevs) : 0
  const outOfTolerance = speeds.filter(s => Math.abs(s - targetSpeed) > speedTolerance).length
  
  if (maxSpeedDev > 15) {
    scores.speedControl.score -= 8
    scores.speedControl.deductions.push(`-8: Speed varied ${maxSpeedDev.toFixed(0)}kt from target`)
  } else if (maxSpeedDev > 10) {
    scores.speedControl.score -= 4
    scores.speedControl.deductions.push(`-4: Speed varied ${maxSpeedDev.toFixed(0)}kt from target`)
  }
  if (outOfTolerance > speeds.length * 0.3) {
    scores.speedControl.score -= 4
    scores.speedControl.deductions.push(`-4: ${outOfTolerance}/${speeds.length} pts outside ±${speedTolerance.toFixed(0)}kt`)
  }
  scores.speedControl.details.push(`Target: ${targetSpeed}kt ±${speedTolerance.toFixed(1)}kt, Avg: ${avgSpeed.toFixed(0)}kt`)
  scores.speedControl.score = Math.max(0, scores.speedControl.score)
  
  // 6. THRESHOLD CROSSING (10 pts)
  scores.thresholdCrossing.score = 10
  const nearThreshold = sorted.filter(p => p.distNm < 0.15)
  const thresholdAgl = nearThreshold.length ? nearThreshold[nearThreshold.length - 1].agl : null
  
  if (thresholdAgl != null) {
    scores.thresholdCrossing.details.push(`Crossed at ${thresholdAgl.toFixed(0)}ft AGL (target 50ft)`)
    if (thresholdAgl < 20) {
      scores.thresholdCrossing.score -= 8
      scores.thresholdCrossing.deductions.push(`-8: Too low! ${thresholdAgl.toFixed(0)}ft AGL`)
    } else if (thresholdAgl < 35) {
      scores.thresholdCrossing.score -= 4
      scores.thresholdCrossing.deductions.push(`-4: Low crossing ${thresholdAgl.toFixed(0)}ft AGL`)
    } else if (thresholdAgl > 100) {
      scores.thresholdCrossing.score -= 5
      scores.thresholdCrossing.deductions.push(`-5: High crossing ${thresholdAgl.toFixed(0)}ft (long landing)`)
    } else if (thresholdAgl > 75) {
      scores.thresholdCrossing.score -= 2
      scores.thresholdCrossing.deductions.push(`-2: Slightly high ${thresholdAgl.toFixed(0)}ft`)
    }
  } else {
    scores.thresholdCrossing.details.push(`No data near threshold`)
    scores.thresholdCrossing.score = 0
    scores.thresholdCrossing.deductions.push(`-10: No threshold crossing data`)
  }
  scores.thresholdCrossing.score = Math.max(0, scores.thresholdCrossing.score)
  
  // Calculate total with severe penalties
  let total = Object.values(scores).reduce((sum, s) => sum + s.score, 0)
  const maxTotal = Object.values(scores).reduce((sum, s) => sum + s.max, 0)
  const severePenaltyTotal = severePenalties.reduce((sum, p) => sum + p.penalty, 0)
  total = Math.max(0, total - severePenaltyTotal)
  
  return {
    scores,
    severePenalties,
    total,
    maxTotal,
    percentage: Math.round(total / maxTotal * 100),
    grade: total >= 90 ? 'A' : total >= 80 ? 'B' : total >= 70 ? 'C' : total >= 60 ? 'D' : 'F',
    wind: { dir: windDir, speed: windSpd, gust: windGust, crosswind: crosswindComponent.toFixed(0) },
    aircraftData: { targetSpeed, dirtyStall }
  }
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
  const [benchmark, setBenchmark] = useState(null)
  
  // Fetch benchmark for this aircraft type
  useEffect(() => {
    if (aircraftSpeeds?.ac_type) {
      fetch(`${API}/benchmarks?type=ac_type&key=${encodeURIComponent(aircraftSpeeds.ac_type)}`)
        .then(r => r.json())
        .then(data => setBenchmark(data))
        .catch(() => setBenchmark(null))
    }
  }, [aircraftSpeeds?.ac_type])
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

  // Calculate approach score
  const latestMetar = arrMetars?.[arrMetars.length - 1]
  const approachScore = useMemo(() => 
    calculateApproachScore(approachPoints, selectedRunway, latestMetar, aircraftSpeeds),
    [approachPoints, selectedRunway, latestMetar, aircraftSpeeds]
  )

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
          {approachScore && (
            <div style={{ background: '#1a1a2e', padding: 16, borderRadius: 8, border: approachScore.severePenalties.length > 0 ? '2px solid #f44' : '1px solid #444' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, color: '#6cf' }}>Approach Score</h4>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: approachScore.severePenalties.length > 0 ? '#f44' : approachScore.percentage >= 80 ? '#8f8' : approachScore.percentage >= 60 ? '#ff8' : '#f88' }}>
                  {approachScore.total}/{approachScore.maxTotal} ({approachScore.percentage}%) <span style={{ fontSize: 18 }}>{approachScore.grade}</span>
                </div>
              </div>
              {approachScore.severePenalties.length > 0 && (
                <div style={{ background: '#400', padding: 10, borderRadius: 6, marginBottom: 12, border: '1px solid #f44' }}>
                  <div style={{ color: '#f88', fontWeight: 'bold', marginBottom: 6 }}>⚠️ SEVERE PENALTIES</div>
                  {approachScore.severePenalties.map((p, i) => (
                    <div key={i} style={{ color: '#faa', fontSize: 12, marginBottom: 4 }}>
                      <b>{p.type}:</b> {p.detail} <span style={{ color: '#f66' }}>(-{p.penalty} pts)</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                Wind: {approachScore.wind.dir ?? '-'}° @ {approachScore.wind.speed}kt {approachScore.wind.gust > 0 ? `G${approachScore.wind.gust}` : ''} | XW: {approachScore.wind.crosswind}kt | Target: {approachScore.aircraftData.targetSpeed}kt | Vs: {approachScore.aircraftData.dirtyStall}kt
              </div>
              <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
                {Object.entries(approachScore.scores).map(([key, data]) => (
                  <div key={key} style={{ background: '#252540', padding: 8, borderRadius: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <span style={{ color: data.score === data.max ? '#8f8' : data.score >= data.max * 0.7 ? '#ff8' : '#f88' }}>
                        {data.score}/{data.max}
                      </span>
                    </div>
                    <div style={{ color: '#888', fontSize: 10 }}>{data.details.join(' | ')}</div>
                    {data.deductions.length > 0 && (
                      <div style={{ color: '#f88', fontSize: 10, marginTop: 4 }}>
                        {data.deductions.map((d, i) => <div key={i}>{d}</div>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {benchmark && benchmark.flight_count > 0 && (
                <div style={{ marginTop: 12, padding: 10, background: '#252550', borderRadius: 6, border: '1px solid #446' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ color: '#8cf', fontWeight: 600 }}>vs {aircraftSpeeds?.ac_type} Fleet</span>
                    <span style={{ color: '#888', fontSize: 11 }}>{benchmark.flight_count} flights scored</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, fontSize: 11 }}>
                    <div>
                      <div style={{ color: '#888' }}>Fleet Avg</div>
                      <div style={{ fontSize: 16, fontWeight: 'bold' }}>{parseFloat(benchmark.avg_percentage).toFixed(0)}%</div>
                    </div>
                    <div>
                      <div style={{ color: '#888' }}>Your Score</div>
                      <div style={{ fontSize: 16, fontWeight: 'bold', color: approachScore.percentage >= parseFloat(benchmark.avg_percentage) ? '#8f8' : '#f88' }}>
                        {approachScore.percentage}%
                        <span style={{ fontSize: 11, marginLeft: 4 }}>
                          ({approachScore.percentage >= parseFloat(benchmark.avg_percentage) ? '+' : ''}{(approachScore.percentage - parseFloat(benchmark.avg_percentage)).toFixed(0)})
                        </span>
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#888' }}>Range</div>
                      <div style={{ fontSize: 14 }}>{benchmark.min_percentage}% - {benchmark.max_percentage}%</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, fontSize: 10 }}>
                    <span style={{ color: '#8f8' }}>A: {benchmark.grade_a}</span>
                    <span style={{ color: '#8f8' }}>B: {benchmark.grade_b}</span>
                    <span style={{ color: '#ff8' }}>C: {benchmark.grade_c}</span>
                    <span style={{ color: '#fa8' }}>D: {benchmark.grade_d}</span>
                    <span style={{ color: '#f88' }}>F: {benchmark.grade_f}</span>
                  </div>
                </div>
              )}
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

function AttemptsTab({ onLoadFlight }) {
  const [attempts, setAttempts] = useState([])
  const [stats, setStats] = useState(null)
  const [filter, setFilter] = useState('all') // all, success, failed
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    fetchAttempts()
  }, [filter])
  
  const fetchAttempts = async () => {
    setLoading(true)
    let url = `${API}/scoring_attempts?limit=200`
    if (filter === 'success') url += '&success=true'
    if (filter === 'failed') url += '&failed=true'
    try {
      const res = await fetch(url)
      const data = await res.json()
      setAttempts(data.attempts || [])
      setStats(data.stats)
    } catch (e) {
      console.error('Failed to fetch attempts:', e)
    }
    setLoading(false)
  }
  
  const loadFlight = async (gufi) => {
    try {
      await fetch(`${API}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gufi })
      })
      onLoadFlight()
    } catch (e) {
      alert('Failed to stage flight: ' + e.message)
    }
  }
  
  const gradeColor = (g) => ({ A: '#8f8', B: '#8f8', C: '#ff8', D: '#fa8', F: '#f88' }[g] || '#888')
  
  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', gap: 20, marginBottom: 16, alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Scoring Attempts</h3>
        {stats && (
          <span style={{ color: '#888' }}>
            Total: {stats.total} | Scored: <span style={{ color: '#8f8' }}>{stats.succeeded}</span> | 
            Failed: <span style={{ color: '#f88' }}>{stats.failed}</span>
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => setFilter('all')} style={{ padding: '6px 12px', background: filter === 'all' ? '#4a4a6a' : '#2a2a4a', border: '1px solid #444', color: '#eee', borderRadius: 4, cursor: 'pointer' }}>All</button>
          <button onClick={() => setFilter('success')} style={{ padding: '6px 12px', background: filter === 'success' ? '#4a6a4a' : '#2a2a4a', border: '1px solid #444', color: '#eee', borderRadius: 4, cursor: 'pointer' }}>Scored</button>
          <button onClick={() => setFilter('failed')} style={{ padding: '6px 12px', background: filter === 'failed' ? '#6a4a4a' : '#2a2a4a', border: '1px solid #444', color: '#eee', borderRadius: 4, cursor: 'pointer' }}>Failed</button>
          <button onClick={fetchAttempts} style={{ padding: '6px 12px', background: '#2a2a4a', border: '1px solid #444', color: '#eee', borderRadius: 4, cursor: 'pointer' }}>↻ Refresh</button>
        </div>
      </div>
      
      {loading ? (
        <div style={{ color: '#888', padding: 20 }}>Loading...</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#2a2a4a', textAlign: 'left' }}>
              <th style={{ padding: 8 }}>Date</th>
              <th style={{ padding: 8 }}>Callsign</th>
              <th style={{ padding: 8 }}>Type</th>
              <th style={{ padding: 8 }}>Airport</th>
              <th style={{ padding: 8 }}>Score</th>
              <th style={{ padding: 8 }}>Grade</th>
              <th style={{ padding: 8 }}>Alt Range</th>
              <th style={{ padding: 8 }}>Points</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a, i) => (
              <tr key={i} style={{ background: i % 2 ? '#1a1a2e' : '#252540', borderBottom: '1px solid #333' }}>
                <td style={{ padding: 6 }}>{a.flight_date || '-'}</td>
                <td style={{ padding: 6, fontWeight: 'bold' }}>{a.callsign}</td>
                <td style={{ padding: 6, color: '#888' }}>{a.ac_type || '-'}</td>
                <td style={{ padding: 6 }}>{a.arr_airport}</td>
                <td style={{ padding: 6 }}>{a.score_percentage != null ? `${a.score_percentage}%` : '-'}</td>
                <td style={{ padding: 6 }}><span style={{ color: gradeColor(a.score_grade), fontWeight: 'bold' }}>{a.score_grade || '-'}</span></td>
                <td style={{ padding: 6, color: '#888' }}>{a.min_altitude}-{a.max_altitude}ft</td>
                <td style={{ padding: 6, color: '#888' }}>{a.track_points}</td>
                <td style={{ padding: 6 }}>
                  {a.success ? (
                    <span style={{ color: '#8f8' }}>✓ Scored</span>
                  ) : (
                    <span style={{ color: '#f88' }} title={a.failure_reason}>✗ {a.failure_reason?.substring(0, 20)}...</span>
                  )}
                </td>
                <td style={{ padding: 6 }}>
                  <button 
                    onClick={() => loadFlight(a.gufi)} 
                    style={{ padding: '4px 8px', background: '#4a4a6a', border: 'none', color: '#eee', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                  >
                    Load
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
