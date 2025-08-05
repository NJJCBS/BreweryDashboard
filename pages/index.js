// pages/index.js
import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'

// ─────────────────────────────────────────────────────────────────────────────
// 1) Apps Script URL
// ─────────────────────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyNdtYSZ2flZliWUVM6az4G5WrjmjhM-80SqG1XAedkBYg8XV-v2Fc97F99G3TH6dPj/exec'

// Client‐only React wrapper for Chart.js
const Line = dynamic(() => import('react-chartjs-2').then(m => m.Line), {
  ssr: false
})

// Date formatting helpers
const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const monNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function formatFillDate(ds) {
  if (!ds) return ''
  let dt
  if (typeof ds === 'string') {
    const [d,m,y] = ds.split(/[/\s:]+/).map((v,i)=> i<3? +v : null)
    dt = new Date(y, m-1, d)
  } else if (ds instanceof Date) {
    dt = ds
  } else {
    return ''
  }
  return `${dayNames[dt.getDay()]}-${dt.getDate()}-${monNames[dt.getMonth()]}`
}

// “Empty” tile factory
const makeEmptyEntry = (tankName, lastUpdate = new Date()) => ({
  tank: tankName,
  batch: '',
  sheetUrl: '',
  stage: '',
  isEmpty: true,
  baseAvgOE: null,
  history: [],
  brewFallbackPH: null,
  pHValue: null,
  bbtVol: null,
  carb: null,
  dox: null,
  totalVolume: 0,
  temperature: null,
  setPoint: null,
  // NEW: store rawDate & person even for empty tiles (optional)
  rawDate: null,
  person: '',
  lastUpdate
})

export default function Home() {
  const [tankData, setTankData]     = useState([])
  const [error, setError]           = useState(false)
  const [modalChart, setModalChart] = useState(null)
  const [dexCounts, setDexCounts]   = useState({})
  const [fruitInputs, setFruitInputs]   = useState({})
  const [fruitVolumes, setFruitVolumes] = useState({})
  const [loading, setLoading]       = useState(false)

  // ─── Register Chart.js on client ──────────────────────────────────────────
  useEffect(() => {
    ChartJS.register(
      CategoryScale,
      LinearScale,
      PointElement,
      LineElement,
      Title,
      Tooltip,
      Legend
    )
  }, [])

  // ─── Parsers & ABV calcs ───────────────────────────────────────────────────
  const parseDate = ds => {
    if (!ds) return new Date(0)
    const [d, m, y] = ds.split(/[/\s:]+/).map((v,i)=> i<3? +v : null)
    return new Date(y, m-1, d)
  }
  const platoToSG = p =>
    1.00001 + 0.0038661*p + 0.000013488*p*p + 0.000000043074*p*p*p
  const calcLegacy = (OE,AE) => {
    const num = OE - AE
    const den = 2.0665 - 0.010665*OE
    if (!den) return null
    return num/den
  }
  const calcNew = (OE,AE) => {
    const OG = platoToSG(OE), FG = platoToSG(AE)
    const num = 76.08*(OG-FG), den = 1.775-OG
    if (!den) return null
    const abv = (num/den)*(FG/0.794)
    return isFinite(abv) ? abv : null
  }

  // ─── Core: Fetch Sheets → Build per-tank → Frigid → Dedupe → setTankData ──
  const fetchDashboardData = useCallback(async () => {
    try {
      // 1) Fetch Master sheet
      const sheetId = '1Ajtr8spY64ctRMjd6Z9mfYGTI1f0lJMgdIm8CeBnjm0'
      const range   = 'A1:ZZ1000'
      const apiKey  = 'AIzaSyDIcqb7GydD5J5H9O_psCdL1vmH5Lka4l8'
      const url     = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`

      const res  = await fetch(url)
      if (!res.ok) throw new Error(`Sheets API ${res.status}`)
      const json = await res.json()
      const rows = json.values
      if (!rows || rows.length < 2) throw new Error('No sheet data')

      const headers = rows[0]
      const all = rows.slice(1).map(r => {
        const o = {}
        headers.forEach((h,i)=> o[h]=r[i]||'')
        return o
      })

      // 2) Build map for each tank
      const tanks = [
        'FV1','FV2','FV3','FV4','FV5','FV6','FV7',
        'FV8','FV9','FV10','FVL1','FVL2','FVL3'
      ]
      const map = {}

      tanks.forEach(name => {
        // A) Packaging → empty immediately
        const ferRows = all.filter(e=> e['Daily_Tank_Data.FVFerm']===name)
        const pkg = ferRows.find(e=>
          e['What_are_you_filling_out_today_']
            .toLowerCase().includes('packaging data')
        )
        if (pkg) {
          map[name] = makeEmptyEntry(name, parseDate(pkg.DateFerm))
          return
        }

        // B) Brewing-day rows
        const brewRows = all
          .filter(e=>
            e['What_are_you_filling_out_today_']
              .toLowerCase().includes('brewing day data') &&
            e['Brewing_Day_Data.FV_Tank']===name
          )
          .map(e=>({
            rawDate: e['DateFerm'],
            person:  e['Daily_Tank_Data.Signed_off_by']||'',
            date:    parseDate(e['DateFerm']),
            ...e
          }))
        let brewFallbackPH = null
        if (brewRows.length) {
          brewRows.sort((a,b)=>b.date - a.date)
          brewFallbackPH = parseFloat(brewRows[0]['Brewing_Day_Data.Final_FV_pH'])||null
        }

        // C) Transfer-data rows
        const xferRows = all
          .filter(e=>
            e['What_are_you_filling_out_today_']
              .toLowerCase().includes('transfer data') &&
            e['Transfer_Data.BTTrans']===name
          )
          .map(e=>({...e, date: parseDate(e.DateFerm)}))

        // D) Fermentation rows for sort
        const ferRowsForSort = ferRows.map(e=>({
          ...e,
          _type: 'fer',
          date: parseDate(e['DateFerm'])
        }))

        // E) Merge & pick newest
        const candidates = [
          ...ferRowsForSort,
          ...brewRows.map(r=>({...r,_type:'brew'})),
          ...xferRows.map(r=>({...r,_type:'xfer'}))
        ]
        if (!candidates.length) {
          map[name] = makeEmptyEntry(name)
          return
        }
        candidates.sort((a,b)=>b.date - a.date)
        const rec = candidates[0]

        const batch     = rec.EX
        const sheetUrl  = rec.EY||''
        const lastUpdate= rec.date

        // Secondary packaging-by-batch check
        if (all.find(e=>
          e.EX===batch &&
          e['What_are_you_filling_out_today_']
            .toLowerCase().includes('packaging data')
        )) {
          const pkg2 = all.find(e=>
            e.EX===batch &&
            e['What_are_you_filling_out_today_']
              .toLowerCase().includes('packaging data')
          )
          map[name] = makeEmptyEntry(name, parseDate(pkg2.DateFerm))
          return
        }

        // Gravity history & baseAvgOE
        const history = all
          .filter(e=> e.EX===batch && e['Daily_Tank_Data.GravityFerm'])
          .map(e=>({
            rawDate: e['DateFerm'],
            person:  e['Daily_Tank_Data.Signed_off_by']||'',
            date:    parseDate(e['DateFerm']),
            g:       parseFloat(e['Daily_Tank_Data.GravityFerm'])
          }))
          .filter(h=>!isNaN(h.g))
          .sort((a,b)=>a.date - b.date)

        const OEs = all
          .filter(e=> e.EX===batch && e['Brewing_Day_Data.Original_Gravity'])
          .map(e=>parseFloat(e['Brewing_Day_Data.Original_Gravity']))
          .filter(v=>!isNaN(v))
        const baseAvgOE = OEs.length
          ? OEs.reduce((a,b)=>a+b,0)/OEs.length
          : null

        // pH history
        const pHHistory = all
          .filter(e=> e.EX===batch && e['Daily_Tank_Data.pHFerm'])
          .map(e=>({
            date: parseDate(e['DateFerm']),
            p:    parseFloat(e['Daily_Tank_Data.pHFerm'])
          }))
          .filter(h=>!isNaN(h.p))
          .sort((a,b)=>a.date - b.date)
        const lastPH = pHHistory.length
          ? pHHistory[pHHistory.length-1].p
          : null

        // Defaults
        let stage = '', pHValue = null, carb = '', dox = '', bbtVol = '', totalVolume = 0

        if (rec._type==='xfer') {
          stage       = 'Brite'
          carb        = rec['Transfer_Data.Final_Tank_CO2_Carbonation']||''
          dox         = rec['Transfer_Data.Final_Tank_Dissolved_Oxygen']||''
          bbtVol      = rec['Transfer_Data.Final_Tank_Volume']||''
          totalVolume = parseFloat(bbtVol)||0
        }
        else if (rec._type==='brew') {
          stage       = 'Brewing Day Data'
          const same  = brewRows.filter(r=>r.EX===batch)
          totalVolume = same.reduce((s,e)=>
            s + (parseFloat(e['Brewing_Day_Data.Volume_into_FV'])||0),
            0
          )
          pHValue     = brewFallbackPH
        }
        else {
          const raw = rec['Daily_Tank_Data.What_Stage_in_the_Product_in_']||''
          stage   = raw
          pHValue = lastPH !== null ? lastPH : brewFallbackPH

          if (raw.toLowerCase().includes('brite')) {
            carb        = rec['Daily_Tank_Data.Bright_Tank_CarbonationFerm']||''
            dox         = rec['Daily_Tank_Data.Bright_Tank_Dissolved_OxygenFerm']||''
            const t     = all.find(e=>e.EX===batch && e['Transfer_Data.Final_Tank_Volume'])
            bbtVol      = t? t['Transfer_Data.Final_Tank_Volume'] : ''
            totalVolume = parseFloat(bbtVol)||0
          } else {
            totalVolume = all
              .filter(e=>e.EX===batch)
              .reduce((s,e)=>
                s + (parseFloat(e['Brewing_Day_Data.Volume_into_FV'])||0),
                0
              )
          }
        }

        // Build the tile object, capturing rawDate & person from rec:
        map[name] = {
          tank:        name,
          batch,
          sheetUrl,
          stage,
          isEmpty:     false,
          baseAvgOE,
          history,
          brewFallbackPH,
          pHValue,
          bbtVol,
          carb,
          dox,
          totalVolume,
          temperature: null,
          setPoint:    null,
          lastUpdate,
          // ← These two ensure footer shows the exact rec used:
          let person = ''  
          if (rec._type === 'brew') {

            // Brewing Day Data → use AH column

            person = rec['Brewing_Day_Data.Signed_off_by'] || ''

          } else if (rec._type === 'xfer') {

            // Transfer Data → use BX column

            person = rec['Transfer_Data.Signed_off_by'] || ''
          } else {

            // Fermentation → use Daily_Tank_Data column

            person = rec['Daily_Tank_Data.Signed_off_by'] || ''
          }

        map[name] = {

          // … all the other props you already have …

          rawDate: rec.DateFerm,

          person
        }
      })

// ─── Final Frigid check (runs last) ─────────────────────────────────────
try {
  const resp = await fetch('/api/frigid')
  if (resp.ok) {
    let json = await resp.json()
    // Normalize into an array
    const list = Array.isArray(json)
      ? json
      : json.data   || json.batches || []

    // Build a set of all tanks Frigid knows about
    const frigidTanks = new Set(list.map(item => item.tank))

    // First, mark any tank **not** in Frigid as empty
    Object.keys(map).forEach(tankName => {
      if (!frigidTanks.has(tankName)) {
        map[tankName].isEmpty = true
        map[tankName].batch   = ''
      }
    })

    // Then apply each Frigid item
    list.forEach(item => {
      const t = item.tank
      if (!t || !map[t]) return

      // If Frigid says “inactive” → empty
      if (item.active === false) {
        map[t].isEmpty = true
        map[t].batch   = ''
      } else {
        // If it *is* active, we leave whatever the sheet logic set
      }

      // Parse temperature & setPoint as before
      if (item.temperature != null) {
        map[t].temperature = parseFloat(item.temperature)
      }
      if (item.setPoint != null) {
        try {
          const j = JSON.parse(item.setPoint)
          map[t].setPoint = j.value !== undefined
            ? parseFloat(j.value)
            : parseFloat(item.setPoint)
        } catch {
          map[t].setPoint = parseFloat(item.setPoint)
        }
      }
    })
  }
} catch (e) {
  console.warn('⚠️ Frigid fetch failed:', e)
}

      // ─── Deduplicate any duplicate batches ──────────────────────────────────
      const byBatch = {}
      Object.values(map).forEach(e => {
        if (e.batch) {
          byBatch[e.batch] = byBatch[e.batch]||[]
          byBatch[e.batch].push(e)
        }
      })
      Object.values(byBatch).forEach(group => {
        if (group.length>1) {
          group.sort((a,b)=>b.lastUpdate - a.lastUpdate)
          group.slice(1).forEach(old => {
            map[old.tank] = makeEmptyEntry(old.tank, old.lastUpdate)
          })
        }
      })

      // Set state
      setTankData(Object.values(map))
      setError(false)
      // Init controls only once
      setDexCounts(dc=> Object.keys(dc).length
        ? dc
        : tanks.reduce((o,t)=>({...o,[t]:0}),{})
      )
      setFruitInputs(fi=> Object.keys(fi).length
        ? fi
        : tanks.reduce((o,t)=>({...o,[t]:''}),{})
      )
      setFruitVolumes(fv=> Object.keys(fv).length
        ? fv
        : tanks.reduce((o,t)=>({...o,[t]:0}),{})
      )
    }
    catch(e) {
      console.error('❌ fetchDashboardData:', e)
      setError(true)
    }
  }, [])

  // ─── Refresh button handler ───────────────────────────────────────────────
  const handleRefreshClick = async () => {
    setLoading(true)
    try {
      const r = await fetch(APPS_SCRIPT_URL)
      if (!r.ok) throw new Error(`Script ${r.status}`)
      const j = await r.json()
      if (j.status !== 'ok') throw new Error(j.message)
      await fetchDashboardData()
    } catch(e) {
      console.error('❌ handleRefresh:', e)
      setError(true)
    }
    setLoading(false)
  }

  // ─── On-mount & 3-hour auto-refresh ─────────────────────────────────────
  useEffect(()=>{
    fetchDashboardData()
    const id = setInterval(fetchDashboardData, 3*60*60*1000)
    return ()=>clearInterval(id)
  },[fetchDashboardData])

  // ─── Handlers for Dex & Fruit ────────────────────────────────────────────
  const handleAddDex      = tank=> setDexCounts(d=>({...d,[tank]:d[tank]+1}))
  const handleClear       = tank=>{
    setDexCounts(d=>({...d,[tank]:0}))
    setFruitVolumes(fv=>({...fv,[tank]:0}))
    setFruitInputs(fi=>({...fi,[tank]:''}))
    setTankData(td=> td.map(e=> e.tank===tank ? makeEmptyEntry(tank) : e))
  }
  const handleFruitChange = (t,v)=> setFruitInputs(fi=>({...fi,[t]:v}))
  const handleAddFruit    = tank=>{
    const v = parseFloat(fruitInputs[tank])
    if (!v||isNaN(v)) return
    setFruitVolumes(fv=>({...fv,[tank]:fv[tank]+v}))
    setFruitInputs(fi=>({...fi,[tank]:''}))
  }

  // ─── Error & Loading states ───────────────────────────────────────────────
  if (error)
    return <p style={{padding:20,fontFamily:'Calibri'}}>⚠️ Error loading data.</p>
  if (!tankData.length)
    return <p style={{padding:20,fontFamily:'Calibri'}}>Loading…</p>

  // ─── Summary counts ───────────────────────────────────────────────────────
  const totalTanks    = tankData.length
  const emptyCount    = tankData.filter(e=>e.isEmpty).length
  const occupiedCount = totalTanks - emptyCount
  const totalVol      = tankData
    .filter(e=>!e.isEmpty)
    .reduce((sum,e)=> sum + (e.totalVolume||0), 0)
  const totalVolStr   = totalVol.toLocaleString('en-AU')

  const baseTile = {
    position:'relative',
    borderRadius:'8px',
    padding:'10px',
    background:'#fff',
    boxShadow:'0 6px 12px rgba(0,0,0,0.1)',
    transition:'transform 0.2s'
  }

  return (
    <>
      {/* Modal for detailed chart */}
      {modalChart && (
        <div style={{
          position:'fixed',top:0,left:0,
          width:'100%',height:'100%',
          background:'rgba(0,0,0,0.5)',
          display:'flex',alignItems:'center',justifyContent:'center',
          zIndex:1000
        }}>
          <div style={{
            position:'relative',background:'#fff',padding:20,
            borderRadius:8,maxWidth:'90%',maxHeight:'90%',overflow:'auto'
          }}>
            <button onClick={()=>setModalChart(null)} style={{
              position:'absolute',top:10,right:10,
              background:'transparent',border:'none',
              fontSize:16,cursor:'pointer'
            }}>✕</button>
            <Line
              data={{
                labels: modalChart.labels,
                datasets:[{
                  label:'Gravity (°P)',
                  data: modalChart.data,
                  tension:0.4,fill:false
                }]
              }}
              options={{
                aspectRatio:2,
                plugins:{
                  legend:{display:false},
                  tooltip:{callbacks:{label:ctx=>`${ctx.parsed.y.toFixed(1)} °P`}}
                },
                scales:{
                  x:{title:{display:true,text:'Date'},grid:{display:true}},
                  y:{beginAtZero:true,min:0,title:{display:true,text:'Gravity (°P)'},ticks:{callback:v=>v.toFixed(1)}}
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Dashboard grid */}
      <div style={{
        fontFamily:'Calibri, sans-serif',
        display:'grid',
        gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',
        gap:'20px',padding:'20px'
      }}>
        {tankData.map(e=>{
          const {
            tank,batch,sheetUrl,stage,isEmpty,
            baseAvgOE,history,brewFallbackPH,
            pHValue,bbtVol,carb,dox,totalVolume,
            temperature,setPoint,rawDate,person
          } = e

          // ABV calc
          const dex   = dexCounts[tank]||0
          const HL    = (totalVolume||0)/1000
          const incOE = baseAvgOE!==null
            ? baseAvgOE + (HL>0?1.3/HL*dex:0)
            : null
          const curAE     = history.length? history[history.length-1].g : null
          const displayAE = curAE!==null? curAE : baseAvgOE
          const leg       = incOE!==null&&displayAE!==null? calcLegacy(incOE,displayAE):null
          const neu       = incOE!==null&&displayAE!==null? calcNew(incOE,displayAE):null
          const dexABV    = leg!==null&&neu!==null? ((leg+neu)/2).toFixed(1):null

          // Fruit & volume
          const fv    = fruitVolumes[tank]||0
          const eff   = fv*0.9
          const baseV = stage.toLowerCase().includes('brite')
            ? parseFloat(bbtVol)||0
            : totalVolume||0
          const dispV = baseV + eff
          const finalABV = dexABV!==null
            ? ((dexABV/100*baseV)/dispV*100).toFixed(1)
            : null

          // Mini-chart data
          const labels = incOE!==null
            ? ['OG',...history.map(h=>h.date.toLocaleDateString('en-AU'))]
            : history.map(h=>h.date.toLocaleDateString('en-AU'))
          const pts = incOE!==null
            ? [incOE,...history.map(h=>h.g)]
            : history.map(h=>h.g)

          // Tile styling
          const style = {...baseTile}
          const s = (stage||'').toLowerCase()
          if (isEmpty)                            { style.background='#fff'; style.border='1px solid #e0e0e0' }
          else if (s.includes('crashed'))         { style.background='rgba(30,144,255,0.1)'; style.border='1px solid darkblue' }
          else if (/d\.h|clean fusion/.test(s))   { style.background='rgba(34,139,34,0.1)'; style.border='1px solid darkgreen' }
          else if (s.includes('fermentation'))    { style.background='rgba(210,105,30,0.1)'; style.border='1px solid maroon' }
          else if (s.includes('brite'))           { style.background='#f0f0f0'; style.border='1px solid darkgrey' }
          else                                     { style.border='1px solid #ccc' }

          const volLabel = s.includes('brite')? 'BBT Vol:' : 'Tank Vol:'

          return (
            <div key={tank}
                 style={style}
                 onMouseEnter={e=>e.currentTarget.style.transform='translateY(-4px)'}
                 onMouseLeave={e=>e.currentTarget.style.transform='translateY(0)'}
            >
              {/* Clear‐tile button */}
              <button onClick={()=>handleClear(tank)}
                      style={{
                        position:'absolute',top:'4px',right:'4px',
                        background:'transparent',border:'none',
                        fontSize:'8px',cursor:'pointer'
                      }}>❌</button>

              {/* Header */}
              <h3 style={{marginTop:0}}>
                {tank}
                {!isEmpty && batch && (
                  <> – <a href={sheetUrl}
                         target="_blank"
                         rel="noopener noreferrer"
                         style={{color:'#4A90E2',textDecoration:'none'}}>
                    {batch.substring(0,25)}
                  </a></>
                )}
              </h3>

              {isEmpty
                ? <p><strong>Empty</strong></p>
                : <>
                    <p><strong>Stage:</strong> {stage||'N/A'}</p>

                    {s.includes('brite') ? (
                      <>
                        <p><strong>Carb:</strong> {carb?`${parseFloat(carb).toFixed(2)} vols`:''}</p>
                        <p><strong>D.O.:</strong> {dox?`${parseFloat(dox).toFixed(1)} ppb`:''}</p>
                      </>
                    ) : s==='brewing day data' ? (
                      <>
                        <p><strong>Gravity:</strong> {baseAvgOE!=null?`${baseAvgOE.toFixed(1)} °P`:''}</p>
                        {brewFallbackPH!=null && <p><strong>pH:</strong> {brewFallbackPH.toFixed(1)} pH</p>}
                      </>
                    ) : (
                      <>
                        <p><strong>Gravity:</strong> {displayAE!=null?`${displayAE.toFixed(1)} °P`:''}</p>
                        {pHValue!=null && <p><strong>pH:</strong> {pHValue.toFixed(1)} pH</p>}
                      </>
                    )}

                    <p><strong>{volLabel}</strong> {dispV.toFixed(1)} L</p>
                    {finalABV && <p><strong>ABV:</strong> {finalABV}%</p>}

                    {/* Temp & set-point */}
                    {typeof temperature==='number' && typeof setPoint==='number' && (
                      <p>
                        <a href="https://app.frigid.cloud/app/dashboard"
                           target="_blank"
                           rel="noopener noreferrer"
                           style={{fontWeight:'bold',color:'black',textDecoration:'none'}}>
                          Actual Temp:
                        </a>{' '}
                        {temperature.toFixed(1)}°C{'  '}
                        <a href="https://app.frigid.cloud/app/dashboard"
                           target="_blank"
                           rel="noopener noreferrer"
                           style={{fontWeight:'bold',color:'black',textDecoration:'none'}}>
                          Set:
                        </a>{' '}
                        {setPoint.toFixed(1)}°C
                      </p>
                    )}

                    {/* Controls */}
                    <div style={{
                      display:'flex',alignItems:'center',gap:'4px',marginTop:'8px'
                    }}>
                      <button onClick={()=>handleAddDex(tank)}
                              style={{height:'28px',minWidth:'60px',fontSize:'12px',padding:'0 4px'}}>
                        Add Dex
                      </button>
                      <span style={{
                        display:'inline-block',height:'28px',minWidth:'24px',
                        lineHeight:'28px',textAlign:'center',fontSize:'12px'
                      }}>
                        {dexCounts[tank]||0}
                      </span>
                      <button onClick={()=>{
                          setDexCounts(dc=>({...dc,[tank]:0}))
                          setFruitVolumes(fv=>({...fv,[tank]:0}))
                        }}
                        style={{
                          height:'28px',width:'28px',
                          background:'transparent',border:'none',
                          fontSize:'14px',cursor:'pointer'
                        }}>
                        🗑️
                      </button>
                      <input type="text"
                             placeholder="fruit"
                             value={fruitInputs[tank]||''}
                             onChange={e=>handleFruitChange(tank,e.target.value)}
                             style={{
                               height:'28px',width:'50px',fontSize:'12px',padding:'0 4px'
                             }}/>
                      <button onClick={()=>handleAddFruit(tank)}
                              style={{
                                height:'28px',width:'28px',fontSize:'12px',padding:'0'
                              }}>
                        +
                      </button>
                    </div>

                    {/* Mini-chart */}
                    {pts.length>1 && (
                      <Line
                        data={{
                          labels,
                          datasets:[{label:'Gravity (°P)',data:pts,tension:0.4,fill:false}]
                        }}
                        options={{
                          aspectRatio:2,
                          plugins:{
                            legend:{display:false},
                            tooltip:{callbacks:{label:ctx=>`${ctx.parsed.y.toFixed(1)} °P`}}
                          },
                          scales:{
                            x:{ticks:{display:false},grid:{display:true}},
                            y:{beginAtZero:true,min:0,max:pts[0],ticks:{callback:v=>v.toFixed(1)}}
                          }
                        }}
                        height={150}
                        onClick={()=>setModalChart({labels,data:pts})}
                      />
                    )}

                    {/* ─── Footer with exact rec date & person ────────────────────── */}
                    {rawDate && (
                      <p style={{fontSize:'10px',opacity:0.4,marginTop:'4px'}}>
                        {formatFillDate(rawDate)} — {person}
                      </p>
                    )}
                  </>
              }
            </div>
          )
        })}
      </div>

      {/* Summary */}
      <div style={{
        fontFamily:'Calibri, sans-serif',
        padding:'0 20px 10px'
      }}>
        <p>Empty tanks: {emptyCount}/{totalTanks}</p>
        <p>Occupied tanks: {occupiedCount}/{totalTanks}</p>
        <p>Total volume on site: {totalVolStr} L</p>
      </div>

      {/* Refresh Button */}
      <div style={{textAlign:'center',padding:'10px 0 20px'}}>
        <button
          onClick={handleRefreshClick}
          disabled={loading}
          style={{
            fontSize:'16px',
            padding:'10px 20px',
            borderRadius:'4px',
            cursor: loading ? 'wait' : 'pointer'
          }}
        >
          {loading ? '⏳ Refreshing…' : '🔄 Refresh'}
        </button>
      </div>
    </>
  )
}
