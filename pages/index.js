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

// ─── Apps Script trigger URL ─────────────────────────────────────────────────
const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/…/exec'

// ─── Client‐only React wrapper for Chart.js ───────────────────────────────────
const Line = dynamic(
  () => import('react-chartjs-2').then(m => m.Line),
  { ssr: false }
)

// ─── Date formatter for “Tue-5-Aug” ───────────────────────────────────────────
const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const monNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function formatFillDate(ds) {
  if (!ds) return ''
  const [d,m,y] = ds.split(/[/\s:]+/).map((v,i)=> i<3 ? +v : null)
  const dt = new Date(y,m-1,d)
  return `${dayNames[dt.getDay()]}-${dt.getDate()}-${monNames[dt.getMonth()]}`
}

// ─── Factory for an “empty” tile ─────────────────────────────────────────────
const makeEmptyEntry = (tankName, lastUpdate = new Date()) => ({
  tank:        tankName,
  batch:       '',
  sheetUrl:    '',
  stage:       '',
  isEmpty:     true,
  baseAvgOE:   null,
  history:     [],
  brewFallbackPH: null,
  pHValue:     null,
  bbtVol:      null,
  carb:        null,
  dox:         null,
  totalVolume: 0,
  temperature: null,
  setPoint:    null,
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

  // ─── Register Chart.js once on the client ─────────────────────────────────
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

  // ─── Parsers & ABV calcs ────────────────────────────────────────────────────
  const parseDate = ds => {
    if (!ds) return new Date(0)
    const [d,m,y] = ds.split(/[/\s:]+/).map((v,i)=> i<3 ? +v : null)
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
    return isFinite(abv)?abv:null
  }

  // ─── Core: Fetch from Sheets, then Frigid, then dedupe ─────────────────────
  const fetchDashboardData = useCallback(async () => {
    try {
      // 1) Pull master sheet via Google Sheets API
      const sheetId = '1Ajtr8spY64ctRMjd6Z9mfYGTI1f0lJMgdIm8CeBnjm0'
      const range   = 'A1:ZZ1000'
      const apiKey  = 'AIzaSyDIcqb7GydD5J5H9O_psCdL1vmH5Lka4l8'
      const url     = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`

      const res  = await fetch(url)
      if (!res.ok) throw new Error(`Sheets API ${res.status}`)
      const json = await res.json()
      const rows = json.values
      if (!rows || rows.length < 2) throw new Error('No data returned by Sheets')

      const headers = rows[0]
      const all = rows.slice(1).map(r => {
        const o = {}
        headers.forEach((h,i) => o[h] = r[i]||'')
        return o
      })

      // 2) Build a map for each tank
      const tanks = [
        'FV1','FV2','FV3','FV4','FV5','FV6','FV7',
        'FV8','FV9','FV10','FVL1','FVL2','FVL3'
      ]
      const map = {}
      tanks.forEach(name => {
        // a) packaging → empty
        const ferRows = all.filter(e => e['Daily_Tank_Data.FVFerm'] === name)
        if (ferRows.find(e =>
          e['What_are_you_filling_out_today_']
            .toLowerCase()
            .includes('packaging data')
        )) {
          const pkgRow = ferRows.find(e =>
            e['What_are_you_filling_out_today_']
              .toLowerCase()
              .includes('packaging data')
          )
          map[name] = makeEmptyEntry(name, parseDate(pkgRow.DateFerm))
          return
        }

        // b) brewing-day entries
        const brewRows = all.filter(e =>
          e['What_are_you_filling_out_today_']
            .toLowerCase()
            .includes('brewing day data') &&
          e['Brewing_Day_Data.FV_Tank'] === name
        ).map(e => ({ ...e, d: parseDate(e.DateFerm) }))

        let brewFallbackPH = null
        if (brewRows.length) {
          brewRows.sort((a,b)=>b.d - a.d)
          brewFallbackPH = parseFloat(brewRows[0]['Brewing_Day_Data.Final_FV_pH'])||null
        }

        // c) transfer-data entries
        const xferRows = all.filter(e =>
          e['What_are_you_filling_out_today_']
            .toLowerCase()
            .includes('transfer data') &&
          e['Transfer_Data.BTTrans'] === name
        ).map(e => ({ ...e, d: parseDate(e.DateFerm) }))

        // d) fermentation / daily / crashed / D.H.
        const ferForSort = ferRows.map(e=>({
          ...e, _type:'fer', d: parseDate(e.DateFerm)
        }))
        const brewForSort = brewRows.map(e=>({...e,_type:'brew'}))
        const xferForSort = xferRows.map(e=>({...e,_type:'xfer'}))

        const candidates = [...ferForSort, ...brewForSort, ...xferForSort]
        if (!candidates.length) {
          map[name] = makeEmptyEntry(name)
          return
        }
        candidates.sort((a,b)=>b.d - a.d)
        const rec = candidates[0]
        const batch = rec.EX
        const sheetUrl = rec.EY||''
        const lastUpdate = rec.d

        // Secondary packaging check for that batch
        if (all.find(e=>
          e.EX === batch &&
          e['What_are_you_filling_out_today_']
            .toLowerCase()
            .includes('packaging data')
        )) {
          const pkg2 = all.find(e=>
            e.EX === batch &&
            e['What_are_you_filling_out_today_']
              .toLowerCase()
              .includes('packaging data')
          )
          map[name] = makeEmptyEntry(name, parseDate(pkg2.DateFerm))
          return
        }

        // Build history & baseAvgOE
        const history = all
          .filter(e=>e.EX===batch && e['Daily_Tank_Data.GravityFerm'])
          .map(e=>({
            rawDate: e.DateFerm,
            date:    parseDate(e.DateFerm),
            g:       parseFloat(e['Daily_Tank_Data.GravityFerm']),
            person:  e.BA   // <--- Person who filled it in
          }))
          .filter(h=>!isNaN(h.g))
          .sort((a,b)=>a.date - b.date)

        const OEs = all
          .filter(e=>e.EX===batch && e['Brewing_Day_Data.Original_Gravity'])
          .map(e=>parseFloat(e['Brewing_Day_Data.Original_Gravity']))
          .filter(v=>!isNaN(v))
        const baseAvgOE = OEs.length
          ? OEs.reduce((a,b)=>a+b,0)/OEs.length
          : null

        // Build pH history
        const pHHistory = all
          .filter(e=>e.EX===batch && e['Daily_Tank_Data.pHFerm'])
          .map(e=>({
            date: parseDate(e.DateFerm),
            p:    parseFloat(e['Daily_Tank_Data.pHFerm'])
          }))
          .filter(h=>!isNaN(h.p))
          .sort((a,b)=>a.date-b.date)
        const lastPH = pHHistory.length
          ? pHHistory[pHHistory.length-1].p
          : null

        // Defaults
        let stage    = ''
        let pHValue  = null
        let carb     = null, dox = null
        let bbtVol   = null
        let totalVol = 0

        if (rec._type === 'xfer') {
          // Transfer → treat as “Brite”
          stage      = 'Brite'
          carb       = rec['Transfer_Data.Final_Tank_CO2_Carbonation']||''
          dox        = rec['Transfer_Data.Final_Tank_Dissolved_Oxygen']||''
          bbtVol     = rec['Transfer_Data.Final_Tank_Volume']||''
          totalVol   = parseFloat(bbtVol)||0
        } else if (rec._type === 'brew') {
          // Brewing day
          stage      = 'Brewing Day Data'
          totalVol   = brewRows
            .filter(e=>e.EX===batch)
            .reduce((s,e)=>s + (parseFloat(e['Brewing_Day_Data.Volume_into_FV'])||0),0)
          pHValue    = brewFallbackPH
        } else {
          // Fermentation / daily / crashed / D.H.
          const raw = rec['Daily_Tank_Data.What_Stage_in_the_Product_in_']||''
          stage   = raw
          pHValue = lastPH !== null ? lastPH : brewFallbackPH

          if (raw.toLowerCase().includes('brite')) {
            carb     = rec['Daily_Tank_Data.Bright_Tank_CarbonationFerm']||''
            dox      = rec['Daily_Tank_Data.Bright_Tank_Dissolved_OxygenFerm']||''
            const t  = all.find(e=>e.EX===batch && e['Transfer_Data.Final_Tank_Volume'])
            bbtVol   = t? t['Transfer_Data.Final_Tank_Volume'] : ''
            totalVol = parseFloat(bbtVol)||0
          } else {
            totalVol = all
              .filter(e=>e.EX===batch)
              .reduce((s,e)=>s+(parseFloat(e['Brewing_Day_Data.Volume_into_FV'])||0),0)
          }
        }

        map[name] = {
          tank:            name,
          batch,
          sheetUrl,
          stage,
          isEmpty:         false,
          baseAvgOE,
          history,
          brewFallbackPH,
          pHValue,
          bbtVol,
          carb,
          dox,
          totalVolume:     totalVol,
          temperature:     null,
          setPoint:        null,
          lastUpdate
        }
      })

      // ─── Frigid proxy: mark any inactive FV as empty ──────────────────────
      try {
        const resp = await fetch('/api/frigid')
        if (!resp.ok) throw new Error(`Frigid status ${resp.status}`)
        const arr = await resp.json()
        console.log('❄️ FRIGID RAW:', arr)

        arr.forEach(item => {
          // adjust “fv” below to whatever your Frigid JSON actually uses:
          const tankName = item.fv || item.tank || item.FV || item.name
          if (!tankName || !map[tankName]) return

          // adjust “active” below to your actual flag:
          const isActive = item.active !== undefined
            ? item.active
            : (item.enabled !== undefined ? item.enabled : true)
          if (isActive === false) {
            map[tankName].isEmpty = true
          }

          if (item.temperature != null) {
            map[tankName].temperature = parseFloat(item.temperature)
          }
          if (item.setPoint != null) {
            map[tankName].setPoint = parseFloat(item.setPoint)
          } else if (item.targetTemp != null) {
            map[tankName].setPoint = parseFloat(item.targetTemp)
          }
        })
      } catch(e) {
        console.warn('⚠️ Frigid fetch failed:', e)
      }

      // ─── Remove duplicate batches (keep the newest) ───────────────────────
      const byBatch = {}
      Object.values(map).forEach(e => {
        if (e.batch) {
          byBatch[e.batch] = byBatch[e.batch] || []
          byBatch[e.batch].push(e)
        }
      })
      Object.values(byBatch).forEach(group => {
        if (group.length > 1) {
          group.sort((a,b)=>b.lastUpdate - a.lastUpdate)
          group.slice(1).forEach(old => {
            map[old.tank] = makeEmptyEntry(old.tank, old.lastUpdate)
          })
        }
      })

      setTankData(Object.values(map))
      setError(false)

      // initialize controls once
      setDexCounts(dc =>
        Object.keys(dc).length
          ? dc
          : tanks.reduce((o,t)=>({...o,[t]:0}),{})
      )
      setFruitInputs(fi =>
        Object.keys(fi).length
          ? fi
          : tanks.reduce((o,t)=>({...o,[t]:''}),{})
      )
      setFruitVolumes(fv =>
        Object.keys(fv).length
          ? fv
          : tanks.reduce((o,t)=>({...o,[t]:0}),{})
      )

    } catch(err) {
      console.error('❌ fetchDashboardData error:', err)
      setError(true)
    }
  }, [])

  // ─── “Refresh” button: call Apps Script then re-fetch ────────────────────
  const handleRefreshClick = async () => {
    setLoading(true)
    try {
      const r = await fetch(APPS_SCRIPT_URL)
      if (!r.ok) throw new Error(`Script ${r.status}`)
      const j = await r.json()
      if (j.status !== 'ok') throw new Error(j.message)
      await fetchDashboardData()
    } catch(e) {
      console.error('❌ handleRefreshClick error:', e)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  // ─── On mount + 3h auto-refresh ─────────────────────────────────────────
  useEffect(()=>{
    fetchDashboardData()
    const id = setInterval(fetchDashboardData, 3*60*60*1000)
    return ()=>clearInterval(id)
  },[fetchDashboardData])

  // ─── Dex / Fruit Handlers ───────────────────────────────────────────────
  const handleAddDex      = tank => setDexCounts(d=>({...d,[tank]:d[tank]+1}))
  const handleClear       = tank => {
    setDexCounts(d=>({...d,[tank]:0}))
    setFruitVolumes(fv=>({...fv,[tank]:0}))
    setFruitInputs(fi=>({...fi,[tank]:''}))
    setTankData(td=> td.map(e=> e.tank===tank ? makeEmptyEntry(tank) : e))
  }
  const handleFruitChange = (t,v)   => setFruitInputs(fi=>({...fi,[t]:v}))
  const handleAddFruit    = tank      => {
    const v = parseFloat(fruitInputs[tank])
    if (!v||isNaN(v)) return
    setFruitVolumes(fv=>({...fv,[tank]:fv[tank]+v}))
    setFruitInputs(fi=>({...fi,[tank]:''}))
  }

  if (error)    return <p style={{padding:20,fontFamily:'Calibri'}}>⚠️ Error loading data.</p>
  if (!tankData.length) return <p style={{padding:20,fontFamily:'Calibri'}}>Loading…</p>

  // ─── Compute summary counts ──────────────────────────────────────────────
  const totalTanks    = tankData.length
  const emptyCount    = tankData.filter(e=>e.isEmpty).length
  const occupiedCount = totalTanks - emptyCount
  const totalVol      = tankData
    .filter(e=>!e.isEmpty)
    .reduce((s,e)=> s + (e.totalVolume||0), 0)
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
      {/* Modal for large chart */}
      {modalChart && (
        <div style={{/*…overlay styles…*/}}>
          <div style={{/*…container styles…*/}}>
            <button onClick={()=>setModalChart(null)}>✕</button>
            <Line
              data={{ labels:modalChart.labels, datasets:[{ data:modalChart.data, tension:0.4, fill:false }] }}
              options={{ /*…*/ }}
            />
          </div>
        </div>
      )}

      {/* Dashboard grid */}
      <div style={{
        fontFamily:'Calibri, sans-serif',
        display:'grid',
        gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',
        gap:'20px',
        padding:'20px'
      }}>
        {tankData.map(e=>{
          const {
            tank, batch, sheetUrl, stage, isEmpty,
            baseAvgOE, history, brewFallbackPH,
            pHValue, bbtVol, carb, dox, totalVolume,
            temperature, setPoint
          } = e

          // Calculate displayed ABV, volumes etc… same as before…

          // Mini‐chart data
          const labels = history.map(h=>h.date.toLocaleDateString('en-AU'))
          const pts    = history.map(h=>h.g)

          // Tile styling based on stage…
          const style = { ...baseTile }
          const s = stage.toLowerCase()
          if (isEmpty)                   { style.background='#fff'; style.border='1px solid #e0e0e0' }
          else if (s.includes('crashed')) { style.background='rgba(30,144,255,0.1)'; style.border='1px solid darkblue' }
          else if (/d\.h|clean fusion/.test(s)) { style.background='rgba(34,139,34,0.1)'; style.border='1px solid darkgreen' }
          else if (s.includes('fermentation'))  { style.background='rgba(210,105,30,0.1)'; style.border='1px solid maroon' }
          else if (s.includes('brite'))         { style.background='#f0f0f0'; style.border='1px solid darkgrey' }
          else                                   { style.border='1px solid #ccc' }

          return (
            <div key={tank}
                 style={style}
                 onMouseEnter={e=>e.currentTarget.style.transform='translateY(-4px)'}
                 onMouseLeave={e=>e.currentTarget.style.transform='translateY(0)'}>
              {/* small clear‐tile button */}
              <button onClick={()=>handleClear(tank)}
                      style={{
                        position:'absolute',top:'4px',right:'4px',
                        background:'transparent',border:'none',
                        fontSize:'8px',cursor:'pointer'
                      }}>❌</button>

              <h3 style={{marginTop:0}}>
                {tank}
                {batch && (
                  <> – <a href={sheetUrl} target="_blank" rel="noopener noreferrer"
                         style={{color:'#4A90E2',textDecoration:'none'}}>
                      {batch.substring(0,25)}
                    </a>
                  </>
                )}
              </h3>

              {isEmpty
                ? <p><strong>Empty</strong></p>
                : (
                  <>
                    {/* … your Stage / Gravity / pH / Vol / ABV / Temp lines … */}

                    {/* ─── Mini‐chart ────────────────────────────────────────────── */}
                    {pts.length>1 && (
                      <Line
                        data={{ labels, datasets:[{ data:pts, tension:0.4, fill:false }] }}
                        options={{
                          aspectRatio:2,
                          plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>`${ctx.parsed.y.toFixed(1)} °P`}} },
                          scales:{ x:{ticks:{display:false},grid:{display:true}}, y:{beginAtZero:true,min:0,max:pts[0],ticks:{callback:v=>v.toFixed(1)}} }
                        }}
                        height={150}
                        onClick={()=>setModalChart({labels,data:pts})}
                      />
                    )}

                    {/* ─── Single date+person under chart ───────────────────────── */}
                    {history.length>0 && (
                      <p style={{fontSize:'10px',opacity:.4,marginTop:'4px'}}>
                        {formatFillDate(history[history.length-1].rawDate)} — {history[history.length-1].person}
                      </p>
                    )}

                    {/* ─── Controls: Add Dex, count, trash, fruit, + ───────────── */}
                    {/* … same as before … */}
                  </>
                )
              }
            </div>
          )
        })}
      </div>

      {/* Summary */}
      <div style={{fontFamily:'Calibri, sans-serif',padding:'0 20px 10px'}}>
        <p>Empty tanks: {emptyCount}/{totalTanks}</p>
        <p>Occupied tanks: {occupiedCount}/{totalTanks}</p>
        <p>Total volume on site: {totalVolStr} L</p>
      </div>

      {/* Refresh Button */}
      <div style={{textAlign:'center',padding:'10px 0 20px'}}>
        <button
          onClick={handleRefreshClick}
          disabled={loading}
          style={{fontSize:'16px',padding:'10px 20px',borderRadius:'4px',cursor:'pointer'}}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </>
  )
}
