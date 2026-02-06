import { useState, useEffect } from 'react'

const API = 'http://192.168.42.13:5002/api'

function scoreColor(score) {
  if (score == null) return 'transparent'
  if (score >= 90) return '#22c55e'
  if (score >= 80) return '#4ade80'
  if (score >= 70) return '#facc15'
  if (score >= 60) return '#fb923c'
  return '#ef4444'
}

function textColor(score) {
  if (score == null) return '#666'
  if (score >= 70) return '#000'
  return '#fff'
}

function getMonthOptions(dates) {
  const months = new Set()
  dates.forEach(d => months.add(d.slice(0, 7)))
  return [...months].sort().reverse()
}

export default function GridTab({ setAcTypeFilter, setAirportFilter, setDateFrom, setDateTo, setTab }) {
  const [grid, setGrid] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('alpha')
  const [sortDir, setSortDir] = useState(1)
  const [sortDate, setSortDate] = useState(null)
  const [minFlights, setMinFlights] = useState(1)
  const [selectedMonth, setSelectedMonth] = useState('')

  useEffect(() => {
    fetch(`${API}/score_grid`)
      .then(r => r.json())
      .then(data => {
        setGrid(data.grid || [])
        const allDates = [...new Set((data.grid || []).map(r => r.flight_date))].sort()
        if (allDates.length > 0) {
          setSelectedMonth(allDates[allDates.length - 1].slice(0, 7))
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleCellClick = (acType, date) => {
    if (setAcTypeFilter) setAcTypeFilter(acType)
    if (setAirportFilter) setAirportFilter('')
    if (setDateFrom) setDateFrom(date)
    if (setDateTo) setDateTo(date)
    if (setTab) setTab('attempts')
  }

  const handleAcClick = (acType) => {
    if (setAcTypeFilter) setAcTypeFilter(acType)
    if (setAirportFilter) setAirportFilter('')
    if (setDateFrom) setDateFrom('')
    if (setDateTo) setDateTo('')
    if (setTab) setTab('attempts')
  }

  if (loading) return <div style={{padding:40,textAlign:'center',color:'#888'}}>Loading grid...</div>
  if (!grid.length) return <div style={{padding:40,textAlign:'center',color:'#888'}}>No scored flights yet</div>

  const allDates = [...new Set(grid.map(r => r.flight_date))].sort()
  const monthOptions = getMonthOptions(allDates)
  const filtered = selectedMonth === 'all' ? grid : grid.filter(r => r.flight_date.startsWith(selectedMonth))
  const dates = [...new Set(filtered.map(r => r.flight_date))].sort()
  const acMap = {}
  filtered.forEach(r => {
    if (!acMap[r.ac_type]) acMap[r.ac_type] = { total: 0, sum: 0, dates: {} }
    acMap[r.ac_type].dates[r.flight_date] = r
    acMap[r.ac_type].total += r.flights
    acMap[r.ac_type].sum += r.avg_score * r.flights
  })

  let acTypes = Object.keys(acMap).filter(ac => acMap[ac].total >= minFlights)

  const handleHeaderClick = (type, date) => {
    if (type === sortBy && date === sortDate) {
      setSortDir(d => d * -1)
    } else {
      setSortBy(type)
      setSortDate(date || null)
      setSortDir(type === 'alpha' ? 1 : -1)
    }
  }

  const sortArrow = (type, date) => {
    if (sortBy !== type || sortDate !== (date || null)) return ''
    return sortDir === 1 ? ' ▲' : ' ▼'
  }

  if (sortBy === 'alpha') {
    acTypes.sort((a, b) => a.localeCompare(b) * sortDir)
  } else if (sortBy === 'score') {
    acTypes.sort((a, b) => ((acMap[b].sum / acMap[b].total) - (acMap[a].sum / acMap[a].total)) * sortDir)
  } else if (sortBy === 'flights') {
    acTypes.sort((a, b) => (acMap[b].total - acMap[a].total) * sortDir)
  } else if (sortBy === 'date') {
    acTypes.sort((a, b) => {
      const aScore = acMap[a].dates[sortDate] ? acMap[a].dates[sortDate].avg_score : -1
      const bScore = acMap[b].dates[sortDate] ? acMap[b].dates[sortDate].avg_score : -1
      return (bScore - aScore) * sortDir
    })
  }

  const thStyle = {padding:'8px 6px',textAlign:'center',borderBottom:'2px solid #334155',color:'#94a3b8',fontWeight:600,cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}

  const monthLabel = (m) => {
    if (m === 'all') return 'All Time'
    const [y, mo] = m.split('-')
    const names = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return names[parseInt(mo)] + ' ' + y
  }

  return (
    <div style={{padding:20,height:'100%',overflow:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:10}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:600,color:'#e2e8f0',margin:0}}>Score Grid</h2>
          <p style={{fontSize:13,color:'#64748b',margin:'4px 0 0'}}>{acTypes.length} aircraft types across {dates.length} days — click any cell to view flights</p>
        </div>
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <label style={{fontSize:12,color:'#888'}}>Month:
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              style={{marginLeft:6,padding:'4px 8px',background:'#0f172a',border:'1px solid #334155',color:'#e2e8f0',borderRadius:4,fontSize:12}}>
              {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              <option value="all">All Time</option>
            </select>
          </label>
          <label style={{fontSize:12,color:'#888'}}>Min flights:
            <input type="number" min={1} max={50} value={minFlights} onChange={e => setMinFlights(parseInt(e.target.value)||1)}
              style={{width:50,marginLeft:6,padding:'4px 6px',background:'#0f172a',border:'1px solid #334155',color:'#e2e8f0',borderRadius:4,fontSize:12,textAlign:'center'}}/>
          </label>
        </div>
      </div>

      <div style={{overflow:'auto',maxHeight:'calc(100vh - 180px)'}}>
        <table style={{borderCollapse:'collapse',fontSize:12,whiteSpace:'nowrap'}}>
          <thead>
            <tr>
              <th onClick={() => handleHeaderClick('alpha')} style={{...thStyle,position:'sticky',left:0,zIndex:2,background:'#1a1a2e',textAlign:'left',paddingLeft:12}}>
                AC Type{sortArrow('alpha')}
              </th>
              <th onClick={() => handleHeaderClick('score')} style={thStyle}>
                Avg{sortArrow('score')}
              </th>
              <th onClick={() => handleHeaderClick('flights')} style={thStyle}>
                #{sortArrow('flights')}
              </th>
              {dates.map(d => (
                <th key={d} onClick={() => handleHeaderClick('date', d)} style={{...thStyle,minWidth:70}}>
                  {d.slice(5)}{sortArrow('date', d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {acTypes.map(ac => {
              const info = acMap[ac]
              const overall = Math.round(info.sum / info.total)
              return (
                <tr key={ac} style={{transition:'background 0.1s'}} onMouseEnter={e=>e.currentTarget.style.background='#ffffff08'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <td onClick={() => handleAcClick(ac)} style={{position:'sticky',left:0,zIndex:1,background:'#1a1a2e',padding:'6px 12px',borderBottom:'1px solid #222',color:'#6cf',fontWeight:500,fontFamily:'monospace',cursor:'pointer'}} title={'View all ' + ac + ' flights'}>{ac}</td>
                  <td style={{padding:'6px 8px',textAlign:'center',borderBottom:'1px solid #222',fontWeight:600,color:scoreColor(overall)}}>{overall}</td>
                  <td style={{padding:'6px 8px',textAlign:'center',borderBottom:'1px solid #222',color:'#64748b'}}>{info.total}</td>
                  {dates.map(d => {
                    const cell = info.dates[d]
                    if (!cell) return <td key={d} style={{padding:'6px',borderBottom:'1px solid #222',textAlign:'center',color:'#333'}}>-</td>
                    return (
                      <td key={d} onClick={() => handleCellClick(ac, d)} style={{padding:'4px',borderBottom:'1px solid #222',textAlign:'center',cursor:'pointer'}} title={ac + ' on ' + d + ': ' + cell.flights + ' flights, avg ' + cell.avg_score}>
                        <div style={{background:scoreColor(cell.avg_score),color:textColor(cell.avg_score),borderRadius:4,padding:'4px 6px',fontWeight:600,fontSize:12,lineHeight:1,transition:'filter 0.1s'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.2)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>
                          {cell.avg_score}
                        </div>
                        <div style={{fontSize:10,color:'#64748b',marginTop:2}}>{cell.flights}f</div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
