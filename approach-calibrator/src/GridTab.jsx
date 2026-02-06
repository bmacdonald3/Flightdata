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

export default function GridTab() {
  const [grid, setGrid] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('alpha')
  const [minFlights, setMinFlights] = useState(1)

  useEffect(() => {
    fetch(`${API}/score_grid`)
      .then(r => r.json())
      .then(data => { setGrid(data.grid || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div style={{padding:40,textAlign:'center',color:'#888'}}>Loading grid...</div>
  if (!grid.length) return <div style={{padding:40,textAlign:'center',color:'#888'}}>No scored flights yet</div>

  // Build dates and ac_types
  const dates = [...new Set(grid.map(r => r.flight_date))].sort()
  const acMap = {}
  grid.forEach(r => {
    if (!acMap[r.ac_type]) acMap[r.ac_type] = { total: 0, sum: 0, dates: {} }
    acMap[r.ac_type].dates[r.flight_date] = r
    acMap[r.ac_type].total += r.flights
    acMap[r.ac_type].sum += r.avg_score * r.flights
  })

  let acTypes = Object.keys(acMap).filter(ac => acMap[ac].total >= minFlights)

  if (sortBy === 'alpha') {
    acTypes.sort()
  } else if (sortBy === 'score') {
    acTypes.sort((a, b) => (acMap[b].sum / acMap[b].total) - (acMap[a].sum / acMap[a].total))
  } else if (sortBy === 'flights') {
    acTypes.sort((a, b) => acMap[b].total - acMap[a].total)
  }

  const cellW = Math.max(70, Math.min(100, Math.floor(800 / dates.length)))

  return (
    <div style={{padding:20,height:'100%',overflow:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:10}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:600,color:'#e2e8f0',margin:0}}>Score Grid</h2>
          <p style={{fontSize:13,color:'#64748b',margin:'4px 0 0'}}>{acTypes.length} aircraft types across {dates.length} days</p>
        </div>
        <div style={{display:'flex',gap:10,alignItems:'center'}}>
          <label style={{fontSize:12,color:'#888'}}>Min flights:
            <input type="number" min={1} max={50} value={minFlights} onChange={e => setMinFlights(parseInt(e.target.value)||1)}
              style={{width:50,marginLeft:6,padding:'4px 6px',background:'#0f172a',border:'1px solid #334155',color:'#e2e8f0',borderRadius:4,fontSize:12,textAlign:'center'}}/>
          </label>
          <label style={{fontSize:12,color:'#888'}}>Sort:
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              style={{marginLeft:6,padding:'4px 8px',background:'#0f172a',border:'1px solid #334155',color:'#e2e8f0',borderRadius:4,fontSize:12}}>
              <option value="alpha">A-Z</option>
              <option value="score">Best Score</option>
              <option value="flights">Most Flights</option>
            </select>
          </label>
        </div>
      </div>

      <div style={{overflow:'auto',maxHeight:'calc(100vh - 180px)'}}>
        <table style={{borderCollapse:'collapse',fontSize:12,whiteSpace:'nowrap'}}>
          <thead>
            <tr>
              <th style={{position:'sticky',left:0,zIndex:2,background:'#1a1a2e',padding:'8px 12px',textAlign:'left',borderBottom:'2px solid #334155',color:'#94a3b8',fontWeight:600}}>AC Type</th>
              <th style={{padding:'8px 8px',textAlign:'center',borderBottom:'2px solid #334155',color:'#94a3b8',fontWeight:600}}>Avg</th>
              <th style={{padding:'8px 8px',textAlign:'center',borderBottom:'2px solid #334155',color:'#94a3b8',fontWeight:600}}>#</th>
              {dates.map(d => (
                <th key={d} style={{padding:'8px 6px',textAlign:'center',borderBottom:'2px solid #334155',color:'#94a3b8',fontWeight:500,minWidth:cellW}}>
                  {d.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {acTypes.map(ac => {
              const info = acMap[ac]
              const overall = Math.round(info.sum / info.total)
              return (
                <tr key={ac}>
                  <td style={{position:'sticky',left:0,zIndex:1,background:'#1a1a2e',padding:'6px 12px',borderBottom:'1px solid #222',color:'#e2e8f0',fontWeight:500,fontFamily:'monospace'}}>{ac}</td>
                  <td style={{padding:'6px 8px',textAlign:'center',borderBottom:'1px solid #222',fontWeight:600,color:scoreColor(overall)}}>{overall}</td>
                  <td style={{padding:'6px 8px',textAlign:'center',borderBottom:'1px solid #222',color:'#64748b'}}>{info.total}</td>
                  {dates.map(d => {
                    const cell = info.dates[d]
                    if (!cell) return <td key={d} style={{padding:'6px',borderBottom:'1px solid #222',textAlign:'center',color:'#333'}}>-</td>
                    return (
                      <td key={d} style={{padding:'4px',borderBottom:'1px solid #222',textAlign:'center'}}>
                        <div style={{background:scoreColor(cell.avg_score),color:textColor(cell.avg_score),borderRadius:4,padding:'4px 6px',fontWeight:600,fontSize:12,lineHeight:1}}>
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
