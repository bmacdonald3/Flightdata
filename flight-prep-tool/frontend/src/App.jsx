import { useState, useEffect, useMemo } from 'react'

const API = 'http://192.168.42.13:5002/api'

export default function App() {
  const [flights, setFlights] = useState([])
  const [selectedGufi, setSelectedGufi] = useState(null)
  const [selectedFlight, setSelectedFlight] = useState(null)
  const [selectedTrack, setSelectedTrack] = useState([])
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split('T')[0])
  const [modelFilter, setModelFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingTrack, setLoadingTrack] = useState(false)
  const [staged, setStaged] = useState(null)
  const [message, setMessage] = useState('')
  const [sortField, setSortField] = useState('point_count')
  const [sortDir, setSortDir] = useState('desc')

  const loadFlights = async (date) => {
    setLoading(true)
    setMessage('')
    setSelectedGufi(null)
    setSelectedFlight(null)
    setSelectedTrack([])
    try {
      const res = await fetch(`${API}/flights?date=${date}`)
      const data = await res.json()
      setFlights(data.slice(0, 300))
    } catch (err) {
      setMessage('Error loading flights: ' + err.message)
    }
    setLoading(false)
  }

  const loadTrack = async (gufi) => {
    setLoadingTrack(true)
    setSelectedTrack([])
    try {
      const res = await fetch(`${API}/track?gufi=${encodeURIComponent(gufi)}`)
      const data = await res.json()
      setSelectedTrack(data.points || [])
    } catch (err) {
      console.error('Failed to load track', err)
      setSelectedTrack([])
    }
    setLoadingTrack(false)
  }

  const models = useMemo(() => {
    const modelList = [...new Set(flights.map(f => f.model).filter(Boolean))]
    return modelList.sort()
  }, [flights])

  const statuses = useMemo(() => {
    const statusList = [...new Set(flights.map(f => f.flight_status).filter(Boolean))]
    return statusList.sort()
  }, [flights])

  const filteredFlights = useMemo(() => {
    let result = flights
    if (modelFilter) {
      result = result.filter(f => f.model && f.model.toLowerCase().includes(modelFilter.toLowerCase()))
    }
    if (statusFilter) {
      result = result.filter(f => f.flight_status === statusFilter)
    }
    return result.sort((a, b) => {
      let aVal = a[sortField], bVal = b[sortField]
      if (aVal == null) aVal = ''
      if (bVal == null) bVal = ''
      if (typeof aVal === 'string') aVal = aVal.toLowerCase()
      if (typeof bVal === 'string') bVal = bVal.toLowerCase()
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [flights, modelFilter, statusFilter, sortField, sortDir])

  const handleSort = (field) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const SortHeader = ({ field, children }) => (
    <th onClick={() => handleSort(field)} style={{padding:8, cursor:'pointer', background:'#2a2a4a', whiteSpace:'nowrap'}}>
      {children} {sortField === field ? (sortDir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )

  const selectFlight = (f) => { setSelectedGufi(f.gufi); setSelectedFlight(f); loadTrack(f.gufi) }

  const stageSelected = async () => {
    if (!selectedGufi) return
    setLoading(true)
    try {
      const res = await fetch(`${API}/stage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({gufi:selectedGufi}) })
      const data = await res.json()
      if (data.success) { setStaged(data); setMessage(`✓ Staged: ${data.callsign} (${data.flight_status})`) }
      else setMessage('Error: ' + (data.error || 'Unknown'))
    } catch (err) { setMessage('Error: ' + err.message) }
    setLoading(false)
  }

  useEffect(() => { loadFlights(dateFilter) }, [])
  const handleDateChange = (e) => { setDateFilter(e.target.value); loadFlights(e.target.value) }
  const formatDuration = (m) => m ? `${Math.floor(m/60)}h ${m%60}m` : '-'
  const formatTime = (iso) => { try { return new Date(iso).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) } catch { return '-' }}
  const font = { fontFamily: "'SF Mono', Consolas, Monaco, monospace" }

  const statusColor = (status) => {
    switch(status) {
      case 'Landed': return '#8f8'
      case 'Approach': return '#ff8'
      case 'Pattern': return '#8ff'
      case 'Enroute': return '#88f'
      default: return '#888'
    }
  }

  const accelColor = (val) => {
    if (val == null) return 'inherit'
    if (val > 0.5) return '#8f8'
    if (val < -0.5) return '#f88'
    return 'inherit'
  }
  const turnColor = (val) => {
    if (val == null) return 'inherit'
    if (Math.abs(val) > 3) return '#ff8'
    return 'inherit'
  }

  const thStyle = {padding:8, background:'#2a2a4a', whiteSpace:'nowrap'}
  const unitStyle = {padding:4, background:'#222238', color:'#888', fontSize:10, whiteSpace:'nowrap'}

  return (
    <div style={{height:'100vh', ...font, fontSize:13, background:'#1a1a2e', color:'#eee', display:'flex', flexDirection:'column'}}>
      <div style={{padding:12, borderBottom:'1px solid #333', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap'}}>
        <b style={{fontSize:18}}>Flight Data Prep</b>
        <input type="date" value={dateFilter} onChange={handleDateChange} style={{padding:6, background:'#2a2a4a', color:'#eee', border:'1px solid #444', borderRadius:4, ...font, fontSize:13}}/>
        <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} style={{padding:6, background:'#2a2a4a', color:'#eee', border:'1px solid #444', borderRadius:4, ...font, fontSize:13, minWidth:120}}>
          <option value="">All Models</option>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{padding:6, background:'#2a2a4a', color:'#eee', border:'1px solid #444', borderRadius:4, ...font, fontSize:13, minWidth:100}}>
          <option value="">All Status</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => loadFlights(dateFilter)} style={{padding:'6px 14px', background:'#333', color:'#eee', border:'1px solid #444', borderRadius:4, ...font, fontSize:13}}>{loading ? '...' : 'Refresh'}</button>
        <button onClick={stageSelected} disabled={!selectedGufi} style={{padding:'6px 14px', background:selectedGufi?'#06c':'#444', color:'#fff', border:'none', borderRadius:4, ...font, fontSize:13}}>Stage</button>
        <span style={{color:'#888'}}>{filteredFlights.length} / {flights.length} flights</span>
        {message && <span style={{color:message[0]==='✓'?'#6f6':'#f66'}}>{message}</span>}
        <a href="http://192.168.42.13:5173" target="_blank" rel="noreferrer" style={{marginLeft:'auto', padding:'6px 14px', background:'#06c', color:'#fff', textDecoration:'none', borderRadius:4, ...font, fontSize:13}}>Open Calibrator →</a>
      </div>
      <div style={{flex:1, overflow:'hidden', display:'flex'}}>
        <div style={{width:500, borderRight:'1px solid #333', overflowY:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead style={{position:'sticky', top:0}}>
              <tr>
                <th style={{width:30, background:'#2a2a4a'}}></th>
                <SortHeader field="callsign">N-Num</SortHeader>
                <SortHeader field="model">Model</SortHeader>
                <SortHeader field="departure">From</SortHeader>
                <SortHeader field="arrival">To</SortHeader>
                <SortHeader field="flight_status">Status</SortHeader>
                <SortHeader field="point_count">Pts</SortHeader>
              </tr>
            </thead>
            <tbody>
              {filteredFlights.map(f => (
                <tr key={f.gufi} onClick={() => selectFlight(f)} style={{cursor:'pointer', background:selectedGufi===f.gufi?'#2a4a6a':'transparent', borderBottom:'1px solid #252535'}}>
                  <td style={{padding:6}}><input type="radio" checked={selectedGufi===f.gufi} readOnly/></td>
                  <td style={{padding:6, color:'#6cf', fontWeight:600}}>{f.callsign}</td>
                  <td style={{padding:6, fontSize:11, color:'#aaa'}}>{f.model || '-'}</td>
                  <td style={{padding:6}}>{f.departure||'-'}</td>
                  <td style={{padding:6}}>{f.arrival||'-'}</td>
                  <td style={{padding:6, color: statusColor(f.flight_status), fontSize:11}}>{f.flight_status || '-'}</td>
                  <td style={{padding:6, textAlign:'right'}}>{f.point_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden'}}>
          {selectedFlight ? (<>
            <div style={{padding:14, background:'#2a2a4a', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div>
                <b style={{fontSize:22, color:'#6cf'}}>{selectedFlight.callsign}</b>
                <span style={{marginLeft:15, fontSize:14}}>{selectedFlight.manufacturer} {selectedFlight.model}</span>
                <span style={{marginLeft:15, padding:'2px 8px', borderRadius:4, fontSize:11, background:'#333', color: statusColor(selectedFlight.flight_status)}}>{selectedFlight.flight_status}</span>
              </div>
              <div style={{fontSize:14}}>{selectedFlight.departure} → {selectedFlight.arrival} <span style={{color:'#888', marginLeft:15}}>{formatDuration(selectedFlight.duration_minutes)}</span></div>
            </div>
            <div style={{flex:1, overflow:'auto', background:'#12121f'}}>
              {loadingTrack ? <div style={{padding:40, textAlign:'center', color:'#888'}}>Loading...</div> :
               selectedTrack.length > 0 ? (
                <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                  <thead style={{position:'sticky', top:0}}>
                    <tr>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>Time</th>
                      <th style={thStyle}>Lat</th>
                      <th style={thStyle}>Lon</th>
                      <th style={thStyle}>Alt</th>
                      <th style={thStyle}>Spd</th>
                      <th style={thStyle}>Trk</th>
                      <th style={thStyle}>VS</th>
                      <th style={thStyle}>Accel</th>
                      <th style={thStyle}>Turn</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Center</th>
                      <th style={thStyle}>ModeS</th>
                    </tr>
                    <tr>
                      <th style={unitStyle}></th>
                      <th style={unitStyle}>UTC</th>
                      <th style={unitStyle}>deg</th>
                      <th style={unitStyle}>deg</th>
                      <th style={unitStyle}>ft</th>
                      <th style={unitStyle}>kts</th>
                      <th style={unitStyle}>deg</th>
                      <th style={unitStyle}>fpm</th>
                      <th style={unitStyle}>kts/s</th>
                      <th style={unitStyle}>°/s</th>
                      <th style={unitStyle}></th>
                      <th style={unitStyle}></th>
                      <th style={unitStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedTrack.map((p, i) => (
                      <tr key={i} style={{borderBottom:'1px solid #252535'}}>
                        <td style={{padding:6, color:'#555'}}>{i+1}</td>
                        <td style={{padding:6}}>{formatTime(p.position_time)}</td>
                        <td style={{padding:6}}>{p.latitude?parseFloat(p.latitude).toFixed(5):'-'}</td>
                        <td style={{padding:6}}>{p.longitude?parseFloat(p.longitude).toFixed(5):'-'}</td>
                        <td style={{padding:6}}>{p.altitude??'-'}</td>
                        <td style={{padding:6}}>{p.speed??'-'}</td>
                        <td style={{padding:6}}>{p.track?parseFloat(p.track).toFixed(0):'-'}</td>
                        <td style={{padding:6, color:p.vertical_speed<-500?'#f88':'inherit'}}>{p.vertical_speed??'-'}</td>
                        <td style={{padding:6, color:accelColor(p.accel)}}>{p.accel!=null?p.accel.toFixed(2):'-'}</td>
                        <td style={{padding:6, color:turnColor(p.turn_rate)}}>{p.turn_rate!=null?p.turn_rate.toFixed(1):'-'}</td>
                        <td style={{padding:6}}>{p.status||'-'}</td>
                        <td style={{padding:6}}>{p.center||'-'}</td>
                        <td style={{padding:6}}>{p.mode_s||'-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div style={{padding:40, textAlign:'center', color:'#555'}}>No track data</div>}
            </div>
            <div style={{padding:10, background:'#2a2a4a', color:'#888', fontSize:12, display:'flex', gap:20}}>
              <span>{selectedTrack.length} points</span>
              <span>Last: {selectedFlight.last_altitude}ft @ {selectedFlight.last_speed}kts</span>
            </div>
          </>) : <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#555'}}>Select a flight</div>}
        </div>
      </div>
    </div>
  )
}
