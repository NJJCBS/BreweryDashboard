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
// 1) Apps Script Web App URL (runs pullRecentSheets on the Master sheet)
// ─────────────────────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyNdtYSZ2flZliWUVM6az4G5WrjmjhM-80SqG1XAedkBYg8XV-v2Fc97F99G3TH6dPj/exec'

// Client‐only React wrapper for Chart.js
const Line = dynamic(
  () => import('react-chartjs-2').then((m) => m.Line),
  { ssr: false }
)

// Helper to produce an “empty” tile entry
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
  lastUpdate
})

export default function Home() {
  const [tankData, setTankData]     = useState([])
  const [error, setError]           = useState(false)
  const [modalChart, setModalChart] = useState(null)
  const [dexCounts, setDexCounts]   = useState({})
  const [fruitInputs, setFruitInputs]     = useState({})
  const [fruitVolumes, setFruitVolumes]   = useState({})
  const [loading, setLoading]       = useState(false)

  // ─── Register Chart.js on client only ─────────────────────────────────────
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

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const parseDate = (ds) => {
    if (!ds) return new Date(0)
    const [d, m, y] = ds.split(/[/\s:]+/).map((v, i) => (i < 3 ? +v : null))
    return new Date(y, m - 1, d)
  }
  const platoToSG = (p) =>
    1.00001 + 0.0038661 * p + 0.000013488 * p * p + 0.000000043074 * p * p * p
  const calcLegacy = (OE, AE) => {
    const num = OE - AE
    const den = 2.0665 - 0.010665 * OE
    if (!den) return null
    return num / den
  }
  const calcNew = (OE, AE) => {
    const OG = platoToSG(OE),
      FG = platoToSG(AE)
    const num = 76.08 * (OG - FG),
      den = 1.775 - OG
    if (!den) return null
    const abv = (num / den) * (FG / 0.794)
    return isFinite(abv) ? abv : null
  }

  // ─── Core: Fetch dashboard data (Sheets + Frigid + dedupe) ────────────────
  const fetchDashboardData = useCallback(async () => {
    try {
      // 1) Fetch from Google Sheets
      const sheetId = '1Ajtr8spY64ctRMjd6Z9mfYGTI1f0lJMgdIm8CeBnjm0'
      const range   = 'A1:ZZ1000'
      const apiKey  = 'AIzaSyDIcqb7GydD5J5H9O_psCdL1vmH5Lka4l8'
      const url     = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`

      const res  = await fetch(url)
      if (!res.ok) throw new Error(`Sheets API ${res.status}`)
      const json = await res.json()
      const rows = json.values
      if (!rows || rows.length < 2) throw new Error('No data in sheet')

      const headers = rows[0]
      const all = rows.slice(1).map(r => {
        const o = {}
        headers.forEach((h, i) => (o[h] = r[i] || ''))
        return o
      })

      // 2) Assemble per‐tank data
      const tanks = ['FV1','FV2','FV3','FV4','FV5','FV6','FV7','FV8','FV9','FV10','FVL1','FVL2','FVL3']
      const map = {}

      tanks.forEach(name => {
        // 2a) packaging → empty
        const ferRows = all.filter(e => e['Daily_Tank_Data.FVFerm'] === name)
        const packaging = ferRows.find(e =>
          e['What_are_you_filling_out_today_'].toLowerCase().includes('packaging data')
        )
        if (packaging) {
          map[name] = makeEmptyEntry(name, parseDate(packaging.DateFerm))
          return
        }

        // 2b) brewing‐day entries
        const brewRows = all
          .filter(e =>
            e['What_are_you_filling_out_today_']
              .toLowerCase()
              .includes('brewing day data') &&
            e['Brewing_Day_Data.FV_Tank'] === name
          )
          .map(e => ({ ...e, d: parseDate(e.DateFerm) }))

        let brewFallbackPH = null
        if (brewRows.length) {
          brewRows.sort((a, b) => b.d - a.d)
          brewFallbackPH = parseFloat(brewRows[0]['Brewing_Day_Data.Final_FV_pH']) || null
        }

        // 2c) transfer‐data entries
        const xferRows = all
          .filter(e =>
            e['What_are_you_filling_out_today_']
              .toLowerCase()
              .includes('transfer data') &&
            e['Transfer_Data.BTTrans'] === name
          )
          .map(e => ({ ...e, d: parseDate(e.DateFerm) }))

        // 2d) fermentation entries for sorting
        const ferSort = ferRows.map(e => ({ ...e, _type: 'fer', d: parseDate(e.DateFerm) }))
        const brewSort = brewRows.map(e => ({ ...e, _type: 'brew' }))
        const xferSort = xferRows.map(e => ({ ...e, _type: 'xfer' }))

        const candidates = [...ferSort, ...brewSort, ...xferSort]
        if (!candidates.length) {
          map[name] = makeEmptyEntry(name)
          return
        }
        candidates.sort((a, b) => b.d - a.d)
        const rec = candidates[0]
        const batch = rec.EX
        const sheetUrl = rec.EY || ''
        const lastUpdate = rec.d

        // Secondary packaging‐for‐batch check
        const packagingForBatch = all.find(e =>
          e.EX === batch &&
          e['What_are_you_filling_out_today_'].toLowerCase().includes('packaging data')
        )
        if (packagingForBatch) {
          map[name] = makeEmptyEntry(name, parseDate(packagingForBatch.DateFerm))
          return
        }

        // Build gravity history & baseAvgOE
        const history = all
          .filter(e => e.EX === batch && e['Daily_Tank_Data.GravityFerm'])
          .map(e => ({
            date: parseDate(e['DateFerm']),
            g: parseFloat(e['Daily_Tank_Data.GravityFerm']),
            rawDate: e['DateFerm'],
            person: e['BA'] || ''   // BA column = “person who filled it in”
          }))
          .filter(h => !isNaN(h.g))
          .sort((a, b) => a.date - b.date)

        const OEs = all
          .filter(e => e.EX === batch && e['Brewing_Day_Data.Original_Gravity'])
          .map(e => parseFloat(e['Brewing_Day_Data.Original_Gravity']))
          .filter(v => !isNaN(v))
        const baseAvgOE = OEs.length ? OEs.reduce((a, b) => a + b, 0) / OEs.length : null

        // pH history
        const pHHistory = all
          .filter(e => e.EX === batch && e['Daily_Tank_Data.pHFerm'])
          .map(e => ({
            date: parseDate(e['DateFerm']),
            p: parseFloat(e['Daily_Tank_Data.pHFerm'])
          }))
          .filter(h => !isNaN(h.p))
          .sort((a, b) => a.date - b.date)
        const lastPH = pHHistory.length ? pHHistory[pHHistory.length - 1].p : null

        // Defaults
        let stage = ''
        let pHValue = null
        let carb = null, dox = null
        let bbtVol = null
        let totalVolume = 0

        // a) transfer data → "Brite"
        if (rec._type === 'xfer') {
          stage = 'Brite'
          carb  = rec['Transfer_Data.Final_Tank_CO2_Carbonation'] || ''
          dox   = rec['Transfer_Data.Final_Tank_Dissolved_Oxygen'] || ''
          bbtVol = rec['Transfer_Data.Final_Tank_Volume'] || ''
          totalVolume = parseFloat(bbtVol) || 0
        }
        // b) brewing day
        else if (rec._type === 'brew') {
          stage = 'Brewing Day Data'
          const brewForBatch = brewRows.filter(e => e.EX === batch)
          totalVolume = brewForBatch.reduce(
            (sum, e) => sum + (parseFloat(e['Brewing_Day_Data.Volume_into_FV']) || 0),
            0
          )
          pHValue = brewFallbackPH
        }
        // c) fermentation / daily / crashed / D.H.
        else {
          const raw = rec['Daily_Tank_Data.What_Stage_in_the_Product_in_'] || ''
          stage = raw
          pHValue = lastPH !== null ? lastPH : brewFallbackPH

          if (raw.toLowerCase().includes('brite')) {
            carb  = rec['Daily_Tank_Data.Bright_Tank_CarbonationFerm'] || ''
            dox   = rec['Daily_Tank_Data.Bright_Tank_Dissolved_OxygenFerm'] || ''
            const t = all.find(e => e.EX === batch && e['Transfer_Data.Final_Tank_Volume'])
            bbtVol  = t ? t['Transfer_Data.Final_Tank_Volume'] : ''
            totalVolume = parseFloat(bbtVol) || 0
          } else {
            totalVolume = all
              .filter(e => e.EX === batch)
              .reduce((s, e) => s + (parseFloat(e['Brewing_Day_Data.Volume_into_FV']) || 0), 0)
          }
        }

        map[name] = {
          tank: name,
          batch,
          sheetUrl,
          stage,
          isEmpty: false,
          baseAvgOE,
          history,
          brewFallbackPH,
          pHValue,
          bbtVol,
          carb,
          dox,
          totalVolume,
          temperature: null,
          setPoint: null,
          lastUpdate
        }
      })

      // ─── Frigid: force any inactive tank → empty ─────────────────────────────
      try {
        const resp = await fetch('/api/frigid')
        if (!resp.ok) throw new Error(`frigid status ${resp.status}`)
        const json = await resp.json()
        const arr = Array.isArray(json) ? json : (json.data || json.batches || [])
        console.error('❄️ FRIGID RAW:', arr)

        arr.forEach(item => {
          // adjust these keys to your payload
          const tankName = item.fv || item.tank || item.name
          const isActive = item.active !== undefined
            ? item.active
            : item.enabled

          if (!tankName || !map[tankName]) return

          // if Frigid says “inactive” → empty
          if (isActive === false) {
            map[tankName].isEmpty = true
          }
          // parse actual temp
          if (item.temperature != null) {
            map[tankName].temperature = parseFloat(item.temperature)
          }
          // parse set-point
          if (item.setPoint != null) {
            map[tankName].setPoint = parseFloat(item.setPoint)
          } else if (item.targetTemp != null) {
            map[tankName].setPoint = parseFloat(item.targetTemp)
          }
        })
      } catch (e) {
        console.warn('⚠️ Frigid fetch failed:', e)
      }

      // ─── Remove duplicate batches ─────────────────────────────────────────────
      const byBatch = {}
      Object.values(map).forEach(e => {
        if (e.batch) {
          ;(byBatch[e.batch] ||= []).push(e)
        }
      })
      Object.values(byBatch).forEach(group => {
        if (group.length > 1) {
          group.sort((a, b) => b.lastUpdate - a.lastUpdate)
          group.slice(1).forEach(e => {
            map[e.tank] = makeEmptyEntry(e.tank, e.lastUpdate)
          })
        }
      })

      setTankData(Object.values(map))
      setError(false)

      // init controls once
      setDexCounts(dc =>
        Object.keys(dc).length
          ? dc
          : tanks.reduce((o, t) => ({ ...o, [t]: 0 }), {})
      )
      setFruitInputs(fi =>
        Object.keys(fi).length
          ? fi
          : tanks.reduce((o, t) => ({ ...o, [t]: '' }), {})
      )
      setFruitVolumes(fv =>
        Object.keys(fv).length
          ? fv
          : tanks.reduce((o, t) => ({ ...o, [t]: 0 }), {})
      )
    } catch (e) {
      console.error('❌ fetchDashboardData() caught:', e)
      setError(true)
    }
  }, [])

  // ─── “Refresh” button handler ──────────────────────────────────────────────
  const handleRefreshClick = async () => {
    setLoading(true)
    try {
      const r = await fetch(APPS_SCRIPT_URL)
      if (!r.ok) throw new Error(`Script ${r.status}`)
      const j = await r.json()
      if (j.status !== 'ok') throw new Error(j.message)
      await fetchDashboardData()
    } catch (e) {
      console.error('❌ handleRefreshClick() caught:', e)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  // ─── On mount & auto‐refresh every 3h ──────────────────────────────────────
  useEffect(() => {
    fetchDashboardData()
    const id = setInterval(fetchDashboardData, 3 * 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchDashboardData])

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleAddDex      = (tank) => setDexCounts(d => ({ ...d, [tank]: d[tank] + 1 }))
  const handleClear       = (tank) => {
    setDexCounts(d => ({ ...d, [tank]: 0 }))
    setFruitVolumes(fv => ({ ...fv, [tank]: 0 }))
    setFruitInputs(fi => ({ ...fi, [tank]: '' }))
    setTankData(td => td.map(e => e.tank === tank ? makeEmptyEntry(tank) : e))
  }
  const handleFruitChange = (tank, v) => setFruitInputs(fi => ({ ...fi, [tank]: v }))
  const handleAddFruit    = (tank) => {
    const v = parseFloat(fruitInputs[tank])
    if (!v || isNaN(v)) return
    setFruitVolumes(fv => ({ ...fv, [tank]: fv[tank] + v }))
    setFruitInputs(fi => ({ ...fi, [tank]: '' }))
  }

  if (error)
    return <p style={{ padding: 20, fontFamily: 'Calibri' }}>⚠️ Error loading data.</p>
  if (!tankData.length)
    return <p style={{ padding: 20, fontFamily: 'Calibri' }}>Loading…</p>

  // ─── Render ────────────────────────────────────────────────────────────────
  const totalTanks    = tankData.length
  const emptyCount    = tankData.filter(e => e.isEmpty).length
  const occupiedCount = totalTanks - emptyCount
  const totalVol      = tankData.filter(e => !e.isEmpty).reduce((s,e)=>s+(e.totalVolume||0),0)
  const totalVolStr   = totalVol.toLocaleString('en-AU')

  const baseTile = {
    position: 'relative',
    borderRadius: '8px',
    padding: '10px',
    background: '#fff',
    boxShadow: '0 6px 12px rgba(0,0,0,0.1)',
    transition: 'transform 0.2s'
  }

  return (
    <>
      {/* Detailed chart modal */}
      {modalChart && (
        <div style={{ position:'fixed',top:0,left:0,width:'100%',height:'100%',background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 }}>
          <div style={{ position:'relative',background:'#fff',padding:20,borderRadius:8,maxWidth:'90%',maxHeight:'90%',overflow:'auto' }}>
            <button onClick={()=>setModalChart(null)} style={{ position:'absolute',top:10,right:10,background:'transparent',border:'none',fontSize:16,cursor:'pointer' }}>✕</button>
            <Line
              data={{ labels: modalChart.labels, datasets:[{ label:'Gravity (°P)', data: modalChart.data, tension:0.4,fill:false }] }}
              options={{
                aspectRatio:2,
                plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>`${ctx.parsed.y.toFixed(1)} °P`}} },
                scales:{ x:{title:{display:true,text:'Date'},grid:{display:true}}, y:{beginAtZero:true,min:0,title:{display:true,text:'Gravity (°P)'},ticks:{callback:v=>v.toFixed(1)}} }
              }}
            />
          </div>
        </div>
      )}

      {/* Dashboard grid */}
      <div style={{ fontFamily:'Calibri, sans-serif',display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:'20px',padding:'20px' }}>
        {tankData.map(e => {
          const { tank,batch,sheetUrl,stage,isEmpty,baseAvgOE,history,brewFallbackPH,pHValue,bbtVol,carb,dox,totalVolume,temperature,setPoint } = e

          // ABV & volume logic… (unchanged)
          // Mini‐chart data…
          // Tile styling…

          return (
            <div key={tank} style={baseTile}
                 onMouseEnter={ev=>ev.currentTarget.style.transform='translateY(-4px)'}
                 onMouseLeave={ev=>ev.currentTarget.style.transform='translateY(0)'}>
              {/* Your existing tile JSX goes here, unchanged */}
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
          style={{ fontSize:'16px',padding:'10px 20px',borderRadius:'4px',cursor:'pointer' }}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </>
  )
}
