import { useState, useEffect } from 'react'

const API = 'http://192.168.42.13:5002/api'

export default function App() {
  const [tab, setTab] = useState('data')
  const [staged, setStaged] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadStaged()
  }, [])

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
      }
    } catch (err) {
      setError('Failed to load staged data: ' + err.message)
    }
    setLoading(false)
  }

  const font = { fontFamily: "'SF Mono', Consolas, Monaco, monospace" }
  const formatTime = (iso) => {
    if (!iso) return '-'
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch { return '-' }
  }
  const formatDateTime = (iso) => {
    if (!iso) return '-'
    try {
      const d = new Date(iso)
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + 
             d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    } catch { return '-' }
  }
  const statusColor = (status) => {
    switch(status) {
      case 'Landed': return '#8f8'
      case 'Approach': return '#ff8'
      case 'Pattern': return '#8ff'
      case 'Enroute': return '#88f'
      default: return '#888'
    }
  }

  const thStyle = { padding: 8, background: '#2a2a4a', whiteSpace: 'nowrap', textAlign: 'left' }
  const unitStyle = { padding: 4, background: '#222238', color: '#888', fontSize: 10, whiteSpace: 'nowrap' }
  const tdStyle = { padding: 6, borderBottom: '1px solid #252535' }

  const depMetars = staged?.metars?.filter(m => m.airport_icao === staged.flight.dep_airport) || []
  const arrMetars = staged?.metars?.filter(m => m.airport_icao === staged.flight.arr_airport) || []

  return (
    <div style={{ height: '100vh', ...font, fontSize: 13, background: '#1a1a2e', color: '#eee', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: 12, borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 15 }}>
        <b style={{ fontSize: 18 }}>Approach Calibrator</b>
        <button onClick={loadStaged} style={{ padding: '6px 14px', background: '#333', color: '#eee', border: '1px solid #444', borderRadius: 4, ...font, fontSize: 13 }}>
          {loading ? '...' : 'Reload'}
        </button>
        <a href="http://192.168.42.13:5174" target="_blank" rel="noreferrer" style={{ padding: '6px 14px', background: '#06c', color: '#fff', textDecoration: 'none', borderRadius: 4, ...font, fontSize: 13 }}>
          ← Flight Data Prep
        </a>
        {staged && (
          <>
            <span style={{ marginLeft: 'auto', color: '#6cf', fontSize: 16 }}>
              {staged.flight.callsign} • {staged.flight.manufacturer} {staged.flight.model}
            </span>
            <span style={{ padding: '4px 12px', borderRadius: 4, background: '#333', color: statusColor(staged.flight.flight_status) }}>
              {staged.flight.flight_status || 'Unknown'}
            </span>
          </>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
        <button onClick={() => setTab('data')} style={{ padding: '12px 24px', background: tab === 'data' ? '#2a2a4a' : 'transparent', color: tab === 'data' ? '#6cf' : '#888', border: 'none', borderBottom: tab === 'data' ? '2px solid #6cf' : '2px solid transparent', ...font, fontSize: 14, cursor: 'pointer' }}>
          Data Set
        </button>
        <button onClick={() => setTab('calibrator')} style={{ padding: '12px 24px', background: tab === 'calibrator' ? '#2a2a4a' : 'transparent', color: tab === 'calibrator' ? '#6cf' : '#888', border: 'none', borderBottom: tab === 'calibrator' ? '2px solid #6cf' : '2px solid transparent', ...font, fontSize: 14, cursor: 'pointer' }}>
          Calibrator
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#888', padding: 40 }}>Loading...</div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ color: '#f88', marginBottom: 20 }}>{error}</div>
            <a href="http://192.168.42.13:5174" style={{ color: '#6cf' }}>Open Flight Data Prep to stage a flight →</a>
          </div>
        ) : tab === 'data' ? (
          <DataTab staged={staged} formatTime={formatTime} formatDateTime={formatDateTime} thStyle={thStyle} unitStyle={unitStyle} tdStyle={tdStyle} depMetars={depMetars} arrMetars={arrMetars} statusColor={statusColor} />
        ) : (
          <CalibratorTab staged={staged} formatTime={formatTime} arrMetars={arrMetars} />
        )}
      </div>
    </div>
  )
}

function DataTab({ staged, formatTime, formatDateTime, thStyle, unitStyle, tdStyle, depMetars, arrMetars, statusColor }) {
  const flight = staged.flight
  const track = staged.track || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Flight Info */}
      <div style={{ background: '#2a2a4a', padding: 16, borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#6cf' }}>{flight.callsign}</div>
            <div style={{ marginTop: 4 }}>{flight.manufacturer} {flight.model}</div>
            <div style={{ color: '#888', fontSize: 12 }}>{flight.aircraft_type}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20 }}>
              <span style={{ color: '#8f8' }}>{flight.dep_airport || '?'}</span>
              <span style={{ margin: '0 15px', color: '#888' }}>→</span>
              <span style={{ color: '#f88' }}>{flight.arr_airport || '?'}</span>
            </div>
            <div style={{ color: '#888', marginTop: 4 }}>{flight.flight_date}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ padding: '4px 12px', borderRadius: 4, background: '#333', color: statusColor(flight.flight_status) }}>
                {flight.flight_status || 'Unknown'}
              </span>
            </div>
            <div>{flight.duration_minutes} min • {track.length} points</div>
            <div style={{ color: '#888', fontSize: 12 }}>Last: {flight.last_altitude}ft @ {flight.last_speed}kts</div>
          </div>
        </div>
      </div>

      {/* METARs Section */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {/* Departure METARs */}
        <div style={{ flex: 1, minWidth: 400 }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#8f8' }}>Departure METARs - {flight.dep_airport}</h3>
          {depMetars.length > 0 ? (
            <div style={{ background: '#222238', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Time</th>
                    <th style={thStyle}>Altimeter</th>
                    <th style={thStyle}>Temp</th>
                    <th style={thStyle}>Wind</th>
                    <th style={thStyle}>Vis</th>
                  </tr>
                </thead>
                <tbody>
                  {depMetars.map((m, i) => (
                    <tr key={i}>
                      <td style={tdStyle}>{formatDateTime(m.observation_time)}</td>
                      <td style={tdStyle}>{m.altimeter_inhg ? parseFloat(m.altimeter_inhg).toFixed(2) : '-'}"</td>
                      <td style={tdStyle}>{m.temp_c != null ? `${m.temp_c}°C` : '-'}</td>
                      <td style={tdStyle}>{m.wind_dir_degrees != null ? `${m.wind_dir_degrees}° @ ${m.wind_speed_kt}kt` : '-'}</td>
                      <td style={tdStyle}>{m.visibility_miles != null ? `${m.visibility_miles} SM` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: 8, fontSize: 10, color: '#666', maxHeight: 80, overflow: 'auto' }}>
                {depMetars.map((m, i) => <div key={i} style={{ marginBottom: 4 }}>{m.raw_text}</div>)}
              </div>
            </div>
          ) : (
            <div style={{ color: '#888', padding: 20, background: '#222238', borderRadius: 8 }}>No METAR data available</div>
          )}
        </div>

        {/* Arrival METARs */}
        <div style={{ flex: 1, minWidth: 400 }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#f88' }}>Arrival METARs - {flight.arr_airport}</h3>
          {arrMetars.length > 0 ? (
            <div style={{ background: '#222238', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Time</th>
                    <th style={thStyle}>Altimeter</th>
                    <th style={thStyle}>Temp</th>
                    <th style={thStyle}>Wind</th>
                    <th style={thStyle}>Vis</th>
                  </tr>
                </thead>
                <tbody>
                  {arrMetars.map((m, i) => (
                    <tr key={i}>
                      <td style={tdStyle}>{formatDateTime(m.observation_time)}</td>
                      <td style={tdStyle}>{m.altimeter_inhg ? parseFloat(m.altimeter_inhg).toFixed(2) : '-'}"</td>
                      <td style={tdStyle}>{m.temp_c != null ? `${m.temp_c}°C` : '-'}</td>
                      <td style={tdStyle}>{m.wind_dir_degrees != null ? `${m.wind_dir_degrees}° @ ${m.wind_speed_kt}kt` : '-'}</td>
                      <td style={tdStyle}>{m.visibility_miles != null ? `${m.visibility_miles} SM` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: 8, fontSize: 10, color: '#666', maxHeight: 80, overflow: 'auto' }}>
                {arrMetars.map((m, i) => <div key={i} style={{ marginBottom: 4 }}>{m.raw_text}</div>)}
              </div>
            </div>
          ) : (
            <div style={{ color: '#888', padding: 20, background: '#222238', borderRadius: 8 }}>No METAR data available</div>
          )}
        </div>
      </div>

      {/* Track Data Table */}
      <div>
        <h3 style={{ margin: '0 0 10px 0' }}>Track Data ({track.length} points)</h3>
        <div style={{ background: '#222238', borderRadius: 8, overflow: 'hidden', maxHeight: 400, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0 }}>
              <tr>
                <th style={thStyle}>#</th>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Latitude</th>
                <th style={thStyle}>Longitude</th>
                <th style={thStyle}>Altitude</th>
                <th style={thStyle}>Speed</th>
                <th style={thStyle}>Track</th>
                <th style={thStyle}>V/S</th>
              </tr>
              <tr>
                <th style={{ ...thStyle, padding: 4, background: '#1a1a2e', color: '#666', fontSize: 10 }}></th>
                <th style={{ ...thStyle, padding: 4, background: '#1a1a2e', color: '#666', fontSize: 10 }}>UTC</th>
                <th style={{ ...thStyle, padding: 4, background: '#1a1a2e', color: '#666', fontSize: 10 }}>deg</th>
                <th style={{ ...thStyle, padding: 4, background: '#1a1a2e', color: '#666', fontSize: 10 }}>deg</th>
                <th style={{ ...thStyle, padding: 4, background: '#1a1a2e', color: '#666', fontSize: 10 }}>ft</th>
                <th style={{ ...thStyle, padding: 4, background: '#1a1a2e', color: '#666', fontSize: 10 }}>kts</th>
                <th style={{ ...thStyle, padding: 4, background: '#1a1a2e', color: '#666', fontSize: 10 }}>deg</th>
                <th style={{ ...thStyle, padding: 4, background: '#1a1a2e', color: '#666', fontSize: 10 }}>fpm</th>
              </tr>
            </thead>
            <tbody>
              {track.map((p, i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, color: '#555' }}>{i + 1}</td>
                  <td style={tdStyle}>{formatTime(p.position_time)}</td>
                  <td style={tdStyle}>{p.latitude ? parseFloat(p.latitude).toFixed(5) : '-'}</td>
                  <td style={tdStyle}>{p.longitude ? parseFloat(p.longitude).toFixed(5) : '-'}</td>
                  <td style={tdStyle}>{p.altitude ?? '-'}</td>
                  <td style={tdStyle}>{p.speed ?? '-'}</td>
                  <td style={tdStyle}>{p.track ? parseFloat(p.track).toFixed(0) : '-'}</td>
                  <td style={{ ...tdStyle, color: p.vertical_speed < -500 ? '#f88' : 'inherit' }}>{p.vertical_speed ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function CalibratorTab({ staged, formatTime, arrMetars }) {
  const [runwayHeading, setRunwayHeading] = useState(0)
  const [thresholdLat, setThresholdLat] = useState('')
  const [thresholdLon, setThresholdLon] = useState('')
  const [thresholdElev, setThresholdElev] = useState(0)
  const [glideslopeAngle, setGlideslopeAngle] = useState(3.0)
  const [tch, setTch] = useState(50)
  const [altimeterSetting, setAltimeterSetting] = useState(29.92)

  useEffect(() => {
    if (arrMetars && arrMetars.length > 0) {
      const latest = arrMetars[arrMetars.length - 1]
      if (latest.altimeter_inhg) {
        setAltimeterSetting(parseFloat(latest.altimeter_inhg))
      }
    }
  }, [arrMetars])

  const track = staged?.track || []

  const calculateDeviations = () => {
    if (!thresholdLat || !thresholdLon) return []

    const thLat = parseFloat(thresholdLat)
    const thLon = parseFloat(thresholdLon)
    const hdg = parseFloat(runwayHeading)
    const elev = parseFloat(thresholdElev)
    const gs = parseFloat(glideslopeAngle)
    const alt = parseFloat(altimeterSetting)

    return track.map((p, i) => {
      if (!p.latitude || !p.longitude) return { ...p, distNm: null, crossTrackFt: null, gsDevFt: null }

      const pLat = parseFloat(p.latitude)
      const pLon = parseFloat(p.longitude)

      const R = 3440.065
      const dLat = (pLat - thLat) * Math.PI / 180
      const dLon = (pLon - thLon) * Math.PI / 180
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(thLat * Math.PI / 180) * Math.cos(pLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
      const distNm = 2 * R * Math.asin(Math.sqrt(a))

      const y = Math.sin((pLon - thLon) * Math.PI / 180) * Math.cos(pLat * Math.PI / 180)
      const x = Math.cos(thLat * Math.PI / 180) * Math.sin(pLat * Math.PI / 180) - Math.sin(thLat * Math.PI / 180) * Math.cos(pLat * Math.PI / 180) * Math.cos((pLon - thLon) * Math.PI / 180)
      const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360

      const inboundCourse = (hdg + 180) % 360
      let angleDiff = bearing - inboundCourse
      if (angleDiff > 180) angleDiff -= 360
      if (angleDiff < -180) angleDiff += 360

      const alongTrackNm = distNm * Math.cos(angleDiff * Math.PI / 180)
      const crossTrackFt = distNm * Math.sin(angleDiff * Math.PI / 180) * 6076.12

      const correctedAlt = (p.altitude || 0) + (29.92 - alt) * 1000

      const idealAlt = elev + tch + (alongTrackNm * 6076.12 * Math.tan(gs * Math.PI / 180))
      const gsDevFt = correctedAlt - idealAlt

      return { ...p, distNm: alongTrackNm, crossTrackFt, gsDevFt, correctedAlt }
    })
  }

  const analyzedTrack = calculateDeviations()
  const approachTrack = analyzedTrack.filter(p => p.distNm !== null && p.distNm > 0 && p.distNm < 10)

  const inputStyle = { padding: 6, width: 80, background: '#2a2a4a', color: '#eee', border: '1px solid #444', borderRadius: 4, fontFamily: 'inherit' }
  const labelStyle = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: '#2a2a4a', padding: 16, borderRadius: 8 }}>
        <h3 style={{ margin: '0 0 15px 0' }}>Runway Configuration</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          <div>
            <div style={labelStyle}>
              <span style={{ width: 120 }}>Threshold Lat:</span>
              <input type="number" step="0.0001" value={thresholdLat} onChange={e => setThresholdLat(e.target.value)} style={inputStyle} placeholder="41.0703" />
            </div>
            <div style={labelStyle}>
              <span style={{ width: 120 }}>Threshold Lon:</span>
              <input type="number" step="0.0001" value={thresholdLon} onChange={e => setThresholdLon(e.target.value)} style={inputStyle} placeholder="-73.7076" />
            </div>
            <div style={labelStyle}>
              <span style={{ width: 120 }}>Runway Heading:</span>
              <input type="number" value={runwayHeading} onChange={e => setRunwayHeading(e.target.value)} style={inputStyle} /> °
            </div>
          </div>
          <div>
            <div style={labelStyle}>
              <span style={{ width: 120 }}>Threshold Elev:</span>
              <input type="number" value={thresholdElev} onChange={e => setThresholdElev(e.target.value)} style={inputStyle} /> ft
            </div>
            <div style={labelStyle}>
              <span style={{ width: 120 }}>Glideslope:</span>
              <input type="number" step="0.1" value={glideslopeAngle} onChange={e => setGlideslopeAngle(e.target.value)} style={inputStyle} /> °
            </div>
            <div style={labelStyle}>
              <span style={{ width: 120 }}>TCH:</span>
              <input type="number" value={tch} onChange={e => setTch(e.target.value)} style={inputStyle} /> ft
            </div>
          </div>
          <div>
            <div style={labelStyle}>
              <span style={{ width: 120 }}>Altimeter:</span>
              <input type="number" step="0.01" value={altimeterSetting} onChange={e => setAltimeterSetting(e.target.value)} style={inputStyle} /> "Hg
            </div>
            <div style={{ color: '#888', fontSize: 11, marginTop: 10 }}>
              {arrMetars && arrMetars.length > 0 && `From METAR: ${parseFloat(arrMetars[arrMetars.length - 1]?.altimeter_inhg).toFixed(2)}"`}
            </div>
          </div>
        </div>
      </div>

      {thresholdLat && thresholdLon ? (
        <div>
          <h3 style={{ margin: '0 0 10px 0' }}>Approach Analysis ({approachTrack.length} points within 10nm)</h3>
          <div style={{ background: '#222238', borderRadius: 8, overflow: 'hidden', maxHeight: 400, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0 }}>
                <tr style={{ background: '#2a2a4a' }}>
                  <th style={{ padding: 8 }}>#</th>
                  <th style={{ padding: 8 }}>Time</th>
                  <th style={{ padding: 8 }}>Dist</th>
                  <th style={{ padding: 8 }}>Alt</th>
                  <th style={{ padding: 8 }}>GS Dev</th>
                  <th style={{ padding: 8 }}>Loc Dev</th>
                  <th style={{ padding: 8 }}>Speed</th>
                  <th style={{ padding: 8 }}>V/S</th>
                </tr>
                <tr style={{ background: '#1a1a2e' }}>
                  <th style={{ padding: 4, color: '#666', fontSize: 10 }}></th>
                  <th style={{ padding: 4, color: '#666', fontSize: 10 }}>UTC</th>
                  <th style={{ padding: 4, color: '#666', fontSize: 10 }}>nm</th>
                  <th style={{ padding: 4, color: '#666', fontSize: 10 }}>ft</th>
                  <th style={{ padding: 4, color: '#666', fontSize: 10 }}>ft</th>
                  <th style={{ padding: 4, color: '#666', fontSize: 10 }}>ft</th>
                  <th style={{ padding: 4, color: '#666', fontSize: 10 }}>kts</th>
                  <th style={{ padding: 4, color: '#666', fontSize: 10 }}>fpm</th>
                </tr>
              </thead>
              <tbody>
                {approachTrack.map((p, i) => {
                  const gsColor = Math.abs(p.gsDevFt) > 150 ? '#f88' : Math.abs(p.gsDevFt) > 75 ? '#ff8' : '#8f8'
                  const locColor = Math.abs(p.crossTrackFt) > 300 ? '#f88' : Math.abs(p.crossTrackFt) > 150 ? '#ff8' : '#8f8'
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #252535' }}>
                      <td style={{ padding: 6, color: '#555' }}>{i + 1}</td>
                      <td style={{ padding: 6 }}>{formatTime(p.position_time)}</td>
                      <td style={{ padding: 6 }}>{p.distNm?.toFixed(2)}</td>
                      <td style={{ padding: 6 }}>{p.correctedAlt?.toFixed(0)}</td>
                      <td style={{ padding: 6, color: gsColor }}>{p.gsDevFt?.toFixed(0)}</td>
                      <td style={{ padding: 6, color: locColor }}>{p.crossTrackFt?.toFixed(0)}</td>
                      <td style={{ padding: 6 }}>{p.speed ?? '-'}</td>
                      <td style={{ padding: 6, color: p.vertical_speed < -500 ? '#f88' : 'inherit' }}>{p.vertical_speed ?? '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: '#888', display: 'flex', gap: 20 }}>
            <span>GS Dev: <span style={{ color: '#8f8' }}>±75ft</span> | <span style={{ color: '#ff8' }}>±150ft</span> | <span style={{ color: '#f88' }}>&gt;150ft</span></span>
            <span>Loc Dev: <span style={{ color: '#8f8' }}>±150ft</span> | <span style={{ color: '#ff8' }}>±300ft</span> | <span style={{ color: '#f88' }}>&gt;300ft</span></span>
          </div>
        </div>
      ) : (
        <div style={{ background: '#222238', padding: 40, borderRadius: 8, textAlign: 'center', color: '#888' }}>
          Enter runway threshold coordinates to calculate approach deviations
        </div>
      )}
    </div>
  )
}
