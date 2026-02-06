import { useState, useEffect, useCallback } from 'react'

const API = 'http://192.168.42.13:5002/api'

const CATEGORIES = [
  { key: 'category_weights', label: 'Category Weights', icon: '⚖️', color: '#3b82f6', desc: 'Point allocation per category (must total 100)' },
  { key: 'descent', label: 'Descent / Glideslope', icon: '📐', color: '#10b981', desc: 'Glideslope tracking thresholds' },
  { key: 'stabilized', label: 'Stabilized Approach', icon: '🎯', color: '#f59e0b', desc: 'Stabilization distance criteria' },
  { key: 'centerline', label: 'Centerline Tracking', icon: '↔️', color: '#8b5cf6', desc: 'Lateral deviation limits' },
  { key: 'turn_to_final', label: 'Turn to Final', icon: '↩️', color: '#ec4899', desc: 'Bank angle and overshoot thresholds' },
  { key: 'speed_control', label: 'Speed Control', icon: '💨', color: '#06b6d4', desc: 'Approach speed tolerance' },
  { key: 'threshold', label: 'Threshold Crossing', icon: '🛬', color: '#f97316', desc: 'Height criteria at runway threshold' },
  { key: 'severe_penalties', label: 'Severe Penalties', icon: '⚠️', color: '#ef4444', desc: 'CFIT and stall risk configuration' },
]

const WEIGHT_KEYS = ['descent_max','stabilized_max','centerline_max','turn_to_final_max','speed_control_max','threshold_max']

const STEP_MAP = { 'stabilized_critical_dist':0.1, 'stabilized_late_dist':0.1, 'stabilized_ideal_dist':0.1, 'speed_out_of_tol_pct':5 }

const UNIT_MAP = {
  'descent_max':'pts','stabilized_max':'pts','centerline_max':'pts','turn_to_final_max':'pts','speed_control_max':'pts','threshold_max':'pts',
  'cfit_penalty':'pts','stall_penalty':'pts','gs_dangerous_below':'ft','gs_warning_below':'ft','gs_high_above':'ft','climbing_threshold':'fpm',
  'stabilized_speed_tol':'kt','stabilized_gs_tol':'ft','stabilized_cl_tol':'ft',
  'stabilized_critical_dist':'nm','stabilized_late_dist':'nm','stabilized_ideal_dist':'nm',
  'cl_max_severe':'ft','cl_max_warning':'ft','cl_avg_severe':'ft','cl_avg_warning':'ft','crosswind_allowance':'ft/kt',
  'bank_angle_steep':'deg','cl_crossing_threshold':'ft',
  'speed_base_tolerance':'kt','speed_major_deviation':'kt','speed_minor_deviation':'kt','speed_out_of_tol_pct':'%',
  'threshold_target':'ft','threshold_dangerous_low':'ft','threshold_low':'ft','threshold_high':'ft','threshold_slightly_high':'ft',
  'cfit_agl_threshold':'ft','cfit_gs_below':'ft','stall_agl_threshold':'ft','stall_margin':'kt',
}

export default function SettingsTab() {
  const [grouped, setGrouped] = useState(null)
  const [editValues, setEditValues] = useState({})
  const [origValues, setOrigValues] = useState({})
  const [dirtyKeys, setDirtyKeys] = useState(new Set())
  const [collapsed, setCollapsed] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [rescoring, setRescoring] = useState(false)
  const [weightSum, setWeightSum] = useState(100)
  const [searchTerm, setSearchTerm] = useState('')

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const res = await fetch(`${API}/scoring_config`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setGrouped(data.grouped)
      const vals = {}
      ;(data.configs || []).forEach(c => { vals[c.config_key] = c.config_value })
      setEditValues({...vals}); setOrigValues({...vals}); setDirtyKeys(new Set())
      setWeightSum(WEIGHT_KEYS.reduce((s,k) => s + parseFloat(vals[k]||0), 0))
    } catch (e) { setError('Load failed: ' + e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(null), 4000); return () => clearTimeout(t) } }, [success])

  const handleChange = (key, rawValue) => {
    setEditValues(prev => {
      const next = {...prev, [key]: rawValue}
      if (WEIGHT_KEYS.includes(key)) setWeightSum(WEIGHT_KEYS.reduce((s,k) => s + parseFloat(next[k]||0), 0))
      return next
    })
    setDirtyKeys(prev => { const n = new Set(prev); if (rawValue !== origValues[key]) n.add(key); else n.delete(key); return n })
  }

  const handleSave = async () => {
    if (dirtyKeys.size === 0) return
    const changes = {}; dirtyKeys.forEach(k => { changes[k] = editValues[k] })
    try {
      setSaving(true); setError(null)
      const res = await fetch(`${API}/scoring_config`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(changes) })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (data.status !== 'ok') throw new Error(data.message || 'Save failed')
      setSuccess('Saved ' + data.updated + ' setting' + (data.updated !== 1 ? 's' : '')); await loadConfig()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const handleReset = async () => {
    if (!window.confirm('Reset ALL scoring settings to original defaults?')) return
    try {
      setSaving(true)
      const res = await fetch(`${API}/scoring_config/reset`, {method:'POST'})
      const data = await res.json()
      if (data.status !== 'ok') throw new Error(data.message)
      setSuccess('All settings reset to defaults'); await loadConfig()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const handleRescore = async () => {
    if (!window.confirm('This will DELETE all existing scores and re-score every flight.\n\nThis may take several minutes. Continue?')) return
    try {
      setRescoring(true)
      const res = await fetch(`${API}/rescore_all`, {method:'POST'})
      const data = await res.json()
      if (data.status === 'started') setSuccess('Rescoring started - check Scoreboard for progress.')
      else throw new Error(data.message || 'Failed')
    } catch (e) { setError(e.message) } finally { setTimeout(() => setRescoring(false), 3000) }
  }

  const handleDiscard = () => {
    setEditValues({...origValues}); setDirtyKeys(new Set())
    setWeightSum(WEIGHT_KEYS.reduce((s,k) => s + parseFloat(origValues[k]||0), 0))
  }

  const filterItems = (items) => {
    if (!searchTerm) return items
    const term = searchTerm.toLowerCase()
    return items.filter(c => c.config_key.toLowerCase().includes(term) || (c.description||'').toLowerCase().includes(term))
  }

  const weightsValid = Math.abs(weightSum - 100) < 0.01
  const hasWeightChanges = [...dirtyKeys].some(k => WEIGHT_KEYS.includes(k))
  const canSave = dirtyKeys.size > 0 && !saving && (!hasWeightChanges || weightsValid)

  if (loading) return <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>Loading scoring configuration...</div>

  return (
    <div style={{padding: 20, paddingBottom: dirtyKeys.size > 0 ? 80 : 20}}>

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14,flexWrap:'wrap',gap:10}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:600,color:'#e2e8f0',margin:0}}>Scoring Settings</h2>
          <p style={{fontSize:13,color:'#64748b',margin:'4px 0 0'}}>Configure all scoring thresholds and weights</p>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={handleReset} disabled={saving} style={{padding:'7px 14px',borderRadius:6,border:'1px solid #7f1d1d44',background:'transparent',color:'#f87171',fontSize:13,cursor:saving?'not-allowed':'pointer',opacity:saving?0.5:1}}>Reset Defaults</button>
          <button onClick={handleRescore} disabled={rescoring||dirtyKeys.size>0} style={{padding:'7px 14px',borderRadius:6,border:'none',background:rescoring?'#334155':'#f59e0b',color:rescoring?'#94a3b8':'#000',fontSize:13,fontWeight:500,cursor:(rescoring||dirtyKeys.size>0)?'not-allowed':'pointer',opacity:(rescoring||dirtyKeys.size>0)?0.5:1}}>{rescoring?'Rescoring...':'Rescore All Flights'}</button>
        </div>
      </div>

      <input type="text" placeholder="Search settings..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid #334155',background:'#0f172a',color:'#e2e8f0',fontSize:13,boxSizing:'border-box',marginBottom:12,outline:'none'}}/>

      {error && <div style={{padding:'10px 14px',borderRadius:6,marginBottom:12,fontSize:13,background:'#7f1d1d33',color:'#fca5a5',border:'1px solid #7f1d1d',display:'flex',justifyContent:'space-between'}}><span>{error}</span><span onClick={()=>setError(null)} style={{cursor:'pointer',opacity:0.7}}>X</span></div>}
      {success && <div style={{padding:'10px 14px',borderRadius:6,marginBottom:12,fontSize:13,background:'#14532d33',color:'#86efac',border:'1px solid #14532d'}}>{success}</div>}
      {hasWeightChanges && !weightsValid && <div style={{padding:'10px 14px',borderRadius:6,marginBottom:12,fontSize:13,background:'#78350f33',color:'#fcd34d',border:'1px solid #78350f'}}>Category weights must total 100 - currently {weightSum}</div>}

      {grouped && grouped['category_weights'] && (
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',background:'#0f172a',borderRadius:6,marginBottom:14,border:'1px solid #1e293b'}}>
          <span style={{fontSize:12,color:'#64748b',whiteSpace:'nowrap'}}>Weights:</span>
          <div style={{flex:1,height:6,borderRadius:3,background:'#1e293b',overflow:'hidden'}}>
            <div style={{height:6,borderRadius:3,width:Math.min(weightSum,100)+'%',background:weightsValid?'#10b981':weightSum>100?'#ef4444':'#f59e0b',transition:'all 0.2s'}}/>
          </div>
          <span style={{fontSize:13,fontWeight:600,color:weightsValid?'#10b981':'#f59e0b',minWidth:55,textAlign:'right'}}>{weightSum} / 100</span>
        </div>
      )}

      {grouped && CATEGORIES.map(cat => {
        const items = grouped[cat.key]; if (!items) return null
        const filtered = filterItems(items)
        if (searchTerm && filtered.length === 0) return null
        const isCollapsed = collapsed.has(cat.key) && !searchTerm
        const dirtyCount = filtered.filter(c => dirtyKeys.has(c.config_key)).length
        return (
          <div key={cat.key} style={{marginBottom:10,borderRadius:8,border:'1px solid '+cat.color+'22',background:'#1e293b',overflow:'hidden'}}>
            <div onClick={()=>setCollapsed(prev=>{const n=new Set(prev);if(n.has(cat.key))n.delete(cat.key);else n.add(cat.key);return n})} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',cursor:'pointer',userSelect:'none',background:cat.color+'08',borderBottom:isCollapsed?'none':'1px solid '+cat.color+'15'}}>
              <span style={{fontSize:16}}>{cat.icon}</span>
              <span style={{fontSize:14,fontWeight:600,color:'#e2e8f0'}}>{cat.label}</span>
              {dirtyCount>0 && <span style={{fontSize:11,padding:'1px 6px',borderRadius:10,background:'#3b82f6',color:'#fff'}}>{dirtyCount} changed</span>}
              <span style={{marginLeft:'auto',fontSize:12,color:'#475569',marginRight:8}}>{filtered.length}</span>
              <span style={{fontSize:11,color:'#475569',transition:'transform 0.2s',transform:isCollapsed?'rotate(-90deg)':'rotate(0deg)'}}>V</span>
            </div>
            {!isCollapsed && <div>
              <div style={{padding:'6px 14px 2px',fontSize:11,color:'#475569'}}>{cat.desc}</div>
              {filtered.map(item => {
                const isDirty = dirtyKeys.has(item.config_key)
                return (
                  <div key={item.config_key} style={{display:'grid',gridTemplateColumns:'1fr 100px 40px',alignItems:'center',gap:8,padding:'7px 14px',borderTop:'1px solid #ffffff06'}}>
                    <div>
                      <div style={{fontSize:13,color:isDirty?'#93c5fd':'#cbd5e1',display:'flex',alignItems:'center',gap:6}}>
                        {item.description || item.config_key}
                        {isDirty && <span style={{fontSize:9,color:'#3b82f6'}}>*</span>}
                      </div>
                      <div style={{fontSize:11,color:'#475569',marginTop:1,fontFamily:'monospace'}}>{item.config_key}</div>
                    </div>
                    <input type="number" step={STEP_MAP[item.config_key]||1}
                      value={editValues[item.config_key]||''} onChange={e=>handleChange(item.config_key,e.target.value)}
                      style={{width:'100%',padding:'5px 8px',borderRadius:4,border:'1px solid '+(isDirty?'#3b82f6':'#334155'),background:'#0f172a',color:'#e2e8f0',fontSize:13,textAlign:'right',boxSizing:'border-box',outline:'none'}}/>
                    <span style={{fontSize:11,color:'#475569'}}>{UNIT_MAP[item.config_key]||''}</span>
                  </div>
                )
              })}
            </div>}
          </div>
        )
      })}

      {dirtyKeys.size > 0 && (
        <div style={{position:'fixed',bottom:0,left:0,right:0,padding:'10px 16px',background:'#0f172aee',borderTop:'1px solid #334155',display:'flex',justifyContent:'space-between',alignItems:'center',zIndex:100}}>
          <span style={{fontSize:13,color:'#94a3b8'}}>
            {dirtyKeys.size} unsaved change{dirtyKeys.size!==1?'s':''}
            {hasWeightChanges && !weightsValid && <span style={{color:'#f59e0b'}}> - weights must = 100</span>}
          </span>
          <div style={{display:'flex',gap:8}}>
            <button onClick={handleDiscard} style={{padding:'7px 14px',borderRadius:6,border:'1px solid #475569',background:'#334155',color:'#cbd5e1',fontSize:13,cursor:'pointer'}}>Discard</button>
            <button onClick={handleSave} disabled={!canSave} style={{padding:'7px 14px',borderRadius:6,border:'none',background:canSave?'#3b82f6':'#334155',color:canSave?'#fff':'#64748b',fontSize:13,fontWeight:500,cursor:canSave?'pointer':'not-allowed'}}>{saving?'Saving...':'Save Changes'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
