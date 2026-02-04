import { useState, useEffect, useMemo } from 'react'

const API = 'http://192.168.42.13:5002/api'

export default function App() {
  const [flights, setFlights] = useState([])
  const [selectedGufi, setSelectedGufi] = useState(null)
  const [selectedFlight, setSelectedFlight] = useState(null)
  const [selectedTrack, setSelectedTrack] = useState([])
  const [dateFilter, setDateFilter] = useState('2026-02-04')
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
      setFlights(data.slice(0, 200))
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

  const sortedFlights = useMemo(() => {
    return [...flights].sort((a, b) => {
      let aVal = a[sortField], bVal = b[sortField]
      if (aVal == null) aVal = ''
      if (bVal == null) bVal = ''
      if (typeof aVal === 'string') aVal = aVal.toLowerCase()
      if (typeof bVal === 'string') bVal = bVal.toLowerCase()
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [flights, sortField, sortDir])

  const handleSort = (field) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const SortHeader = ({ field, children }) => (
    <th onClick={() => handleSort(field)} style={{padding:10, cursor:'pointer', background:'#2a2a4a', whiteSpace:'nowrap'}}>
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
      if (data.success) { setStaged(data); setMessage(`✓ Staged: ${data.callsign}`) }
      else setMessage('Error: ' + (data.error || 'Unknown'))
    } catch (err) { setMessage('Error: ' + err.message) }
    setLoading(false)
  }

  useEffect(() => { loadFlights(dateFilter) }, [])
  const handleDateChange = (e) => { setDateFilter(e.target.value); loadFlights(e.target.value) }
  const formatDuration = (m) => m ? `${Math.floor(m/60)}h ${m%60}m` : '-'
  const formatTime = (iso) => { try { return new Date(iso).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) } catch { return '-' }}
  const font = { fontFamily: "'SF Mono', Consolas, Monaco, monospace" }

  return (
    <div style={{height:'100vh', ...font, fontSize:13, background:'#1a1a2e', color:'#eee', display:'flex', flexDirection:'column'}}>
      <div style={{padding:12, borderBottom:'1px solid #333', display:'flex', alignItems:'center', gap:12}}>
        <b style={{fontSize:18}}>Flight Data Prep</b>
        <input type="date" value={dateFilter} onChange={handleDateChange} style={{padding:6, background:'#2a2a4a', color:'#eee', border:'1px solid #444', borderRadius:4, ...font, fontSize:13}}/>
        <button onClick={() => loadFlights(dateFilter)} style={{padding:'6px 14px', background:'#333', color:'#eee', border:'1px solid #444', borderRadius:4, ...font, fontSize:13}}>{loading ? '...' : 'Refresh'}</button>
        <button onClick={stageSelected} disabled={!selectedGufi} style={{padding:'6px 14px', background:selectedGufi?'#06c':'#444', color:'#fff', border:'none', borderRadius:4, ...font, fontSize:13}}>Stage</button>
        <span style={{color:'#888'}}>{flights.length} flights</span>
        {message && <span style={{color:message[0]==='✓'?'#6f6':'#f66'}}>{message}</span>}
        {staged && <a href="http://192.168.42.13:5173" target="_blank" style={{marginLeft:'auto', padding:'6px 14px', background:'#0a0', color:'#fff', textDecoration:'none', borderRadius:4, ...font, fontSize:13}}>Open Calibrator →</a>}
      </div>
      <div style={{flex:1, overflow:'hidden', display:'flex'}}>
        <div style={{width:420, borderRight:'1px solid #333', overflowY:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead style={{position:'sticky', top:0}}>
              <tr>
                <th style={{width:30, background:'#2a2a4a'}}></th>
                <SortHeader field="callsign">N-Num</SortHeader>
                <SortHeader field="aircraft_type">Type</SortHeader>
                <SortHeader field="departure">From</SortHeader>
                <SortHeader field="arrival">To</SortHeader>
                <SortHeader field="point_count">Pts</SortHeader>
              </tr>
            </thead>
            <tbody>
              {sortedFlights.map(f => (
                <tr key={f.gufi} onClick={() => selectFlight(f)} style={{cursor:'pointer', background:selectedGufi===f.gufi?'#2a4a6a':'transparent', borderBottom:'1px solid #252535'}}>
                  <td style={{padding:8}}><input type="radio" checked={selectedGufi===f.gufi} readOnly/></td>
                  <td style={{padding:8, color:'#6cf', fontWeight:600}}>{f.callsign}</td>
                  <td style={{padding:8, fontSize:11, color:'#888'}}>{f.aircraft_type?.replace('Fixed wing ','').replace('single engine','SE').replace('multi engine','ME')||'-'}</td>
                  <td style={{padding:8}}>{f.departure||'-'}</td>
                  <td style={{padding:8}}>{f.arrival||'-'}</td>
                  <td style={{padding:8, textAlign:'right'}}>{f.point_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden'}}>
          {selectedFlight ? (<>
            <div style={{padding:14, background:'#2a2a4a', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div><b style={{fontSize:22, color:'#6cf'}}>{selectedFlight.callsign}</b> <span style={{marginLeft:15, fontSize:14}}>{selectedFlight.manufacturer} {selectedFlight.model}</span></div>
              <div style={{fontSize:14}}>{selectedFlight.departure} → {selectedFlight.arrival} <span style={{color:'#888', marginLeft:15}}>{formatDuration(selectedFlight.duration_minutes)}</span></div>
            </div>
            <div style={{flex:1, overflow:'auto', background:'#12121f'}}>
              {loadingTrack ? <div style={{padding:40, textAlign:'center', color:'#888'}}>Loading...</div> :
               selectedTrack.length > 0 ? (
                <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
                  <thead style={{position:'sticky', top:0, background:'#2a2a4a'}}>
                    <tr>
                      <th style={{padding:10, minWidth:40}}>#</th>
                      <th style={{padding:10, minWidth:100}}>Time</th>
                      <th style={{padding:10, minWidth:90}}>Lat</th>
                      <th style={{padding:10, minWidth:100}}>Lon</th>
                      <th style={{padding:10, minWidth:60}}>Alt</th>
                      <th style={{padding:10, minWidth:50}}>Spd</th>
                      <th style={{padding:10, minWidth:50}}>Trk</th>
                      <th style={{padding:10, minWidth:60}}>VS</th>
                      <th style={{padding:10, minWidth:70}}>Status</th>
                      <th style={{padding:10, minWidth:70}}>AsgnAlt</th>
                      <th style={{padding:10, minWidth:60}}>Center</th>
                      <th style={{padding:10, minWidth:70}}>Sector</th>
                      <th style={{padding:10, minWidth:60}}>Unit</th>
                      <th style={{padding:10, minWidth:80}}>ModeS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedTrack.map((p, i) => (
                      <tr key={i} style={{borderBottom:'1px solid #252535'}}>
                        <td style={{padding:8, color:'#555'}}>{i+1}</td>
                        <td style={{padding:8}}>{formatTime(p.position_time)}</td>
                        <td style={{padding:8}}>{p.latitude?parseFloat(p.latitude).toFixed(5):'-'}</td>
                        <td style={{padding:8}}>{p.longitude?parseFloat(p.longitude).toFixed(5):'-'}</td>
                        <td style={{padding:8}}>{p.altitude??'-'}</td>
                        <td style={{padding:8}}>{p.speed??'-'}</td>
                        <td style={{padding:8}}>{p.track?parseFloat(p.track).toFixed(0):'-'}</td>
                        <td style={{padding:8, color:p.vertical_speed<-500?'#f88':'inherit'}}>{p.vertical_speed??'-'}</td>
                        <td style={{padding:8}}>{p.status||'-'}</td>
                        <td style={{padding:8}}>{p.assigned_altitude??'-'}</td>
                        <td style={{padding:8}}>{p.center||'-'}</td>
                        <td style={{padding:8}}>{p.controlling_sector||'-'}</td>
                        <td style={{padding:8}}>{p.controlling_unit||'-'}</td>
                        <td style={{padding:8}}>{p.mode_s||'-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div style={{padding:40, textAlign:'center', color:'#555'}}>No track data</div>}
            </div>
            <div style={{padding:10, background:'#2a2a4a', color:'#888', fontSize:13}}>{selectedTrack.length} points</div>
          </>) : <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#555'}}>Select a flight</div>}
        </div>
      </div>
    </div>
  )
}
