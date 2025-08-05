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

// Client-only React wrapper for Chart.js
const Line = dynamic(() => import('react-chartjs-2').then(m => m.Line), {
  ssr: false
})

// Date-formatting helpers
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
  rawDate: null,
  person: '',
  lastUpdate
})

export default function Home() {
  const [tankData, setTankData]       = useState([])
  const [error, setError]             = useState(null)
  const [modalChart, setModalChart]   = useState(null)
  const [dexCounts, setDexCounts]     = useState({})
  const [fruitInputs, setFruitInputs] = useState({})
  const [fruitVolumes, setFruitVolumes] = useState({})
  const [loading, setLoading]         = useState(false)

  // Register Chart.js on client only
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

  // Parsers & ABV calcs
  const parseDate = ds => {
    if (!ds) return new Date(0)
    const [d,m,y] = ds.split(/[/\s:]+/).map((v,i)=> i<3? +v : null)
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

  // ─── Core: fetch & assemble dashboard data ────────────────────────────────
  const fetchDashboardData = useCallback(async () => {
    try {
      // 1) Sheets
      const sheetId = '1Ajtr8spY64ctRMjd6Z9mfYGTI1f0lJMgdIm8CeBnjm0'
      const range   = 'A1:ZZ1000'
      const apiKey  = 'AIzaSyDIcqb7GydD5J5H9O_psCdL1vmH5Lka4l8'
      const url     = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`

      const res = await fetch(url)
      if (!res.ok) throw new Error(`Sheets API ${res.status}`)
      const { values: rows } = await res.json()
      if (!rows || rows.length < 2) throw new Error('No sheet data')

      const headers = rows[0]
      const all = rows.slice(1).map(r => {
        const o = {}
        headers.forEach((h,i)=> o[h] = r[i]||'')
        return o
      })

      // 2) Build per-tank map
      const tanks = [
        'FV1','FV2','FV3','FV4','FV5','FV6','FV7',
        'FV8','FV9','FV10','FVL1','FVL2','FVL3'
      ]
      const map = {}

      tanks.forEach(name => {
        // A) packaging → empty
        const ferRows = all.filter(e=> e['Daily_Tank_Data.FVFerm']===name)
        const pkg = ferRows.find(e =>
          e['What_are_you_filling_out_today_']
            .toLowerCase().includes('packaging data')
        )
        if (pkg) {
          map[name] = makeEmptyEntry(name, parseDate(pkg.DateFerm))
          return
        }

        // B) brewing-day rows
        const brewRows = all
          .filter(e=>
            e['What_are_you_filling_out_today_']
              .toLowerCase().includes('brewing day data') &&
            e['Brewing_Day_Data.FV_Tank']===name
          )
          .map(e=>({
            ...e,
            rawDate: e.DateFerm,
            person:  e['Brewing_Day_Data.Signed_off_by']||'',
            date:    parseDate(e.DateFerm)
          }))
        let brewFallbackPH = null
        if (brewRows.length) {
          brewRows.sort((a,b)=>b.date - a.date)
          brewFallbackPH = parseFloat(brewRows[0]['Brewing_Day_Data.Final_FV_pH'])||null
        }

        // C) transfer-data rows
        const xferRows = all
          .filter(e=>
            e['What_are_you_filling_out_today_']
              .toLowerCase().includes('transfer data') &&
            e['Transfer_Data.BTTrans']===name
          )
          .map(e=>({
            ...e,
            date:    parseDate(e.DateFerm),
            rawDate: e.DateFerm,
            person:  e['Transfer_Data.Signed_off_by']||''
          }))

        // D) fermentation rows for sort
        const ferSort = ferRows.map(e=>({
          ...e,
          _type: 'fer',
          date:    parseDate(e.DateFerm),
          rawDate: e.DateFerm,
          person:  e['Daily_Tank_Data.Signed_off_by']||''
        }))

        // E) pick newest among fer/brew/xfer
        const brewSort = brewRows.map(r=>({...r,_type:'brew'}))
        const xferSort = xferRows.map(r=>({...r,_type:'xfer'}))
        const candidates = [...ferSort, ...brewSort, ...xferSort]
        if (!candidates.length) {
          map[name] = makeEmptyEntry(name)
          return
        }
        candidates.sort((a,b)=>b.date - a.date)
        const rec = candidates[0]

        // F) person from correct column
        let person = ''
        if (rec._type === 'brew') {
          person = rec['Brewing_Day_Data.Signed_off_by']||''
        } else if (rec._type === 'xfer') {
          person = rec['Transfer_Data.Signed_off_by']||''
        } else {
          person = rec['Daily_Tank_Data.Signed_off_by']||''
        }

        const batch      = rec.EX
        const sheetUrl   = rec.EY||''
        const lastUpdate = rec.date

        // secondary packaging→empty by batch
        if (all.find(e=>
          e.EX===batch &&
          e['What_are_you_filling_out_today_']
            .toLowerCase().includes('packaging data')
        )) {
          map[name] = makeEmptyEntry(name, parseDate(all.find(e=>e.EX===batch).DateFerm))
          return
        }

        // build gravity history & baseAvgOE
        const history = all
          .filter(e=> e.EX===batch && e['Daily_Tank_Data.GravityFerm'])
          .map(e=>({
            rawDate: e.DateFerm,
            person:  e['Daily_Tank_Data.Signed_off_by']||'',
            date:    parseDate(e.DateFerm),
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

        const pHHistory = all
          .filter(e=> e.EX===batch && e['Daily_Tank_Data.pHFerm'])
          .map(e=>({ date: parseDate(e.DateFerm), p:parseFloat(e['Daily_Tank_Data.pHFerm']) }))
          .filter(h=>!isNaN(h.p))
          .sort((a,b)=>a.date - b.date)
        const lastPH = pHHistory.length ? pHHistory[pHHistory.length-1].p : null

        let stage = '', pHValue=null, carb='', dox='', bbtVol='', totalVolume=0

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
          totalVolume = same.reduce((s,e)=>s + (parseFloat(e['Brewing_Day_Data.Volume_into_FV'])||0), 0)
          pHValue     = brewFallbackPH
        }
        else {
          const raw = rec['Daily_Tank_Data.What_Stage_in_the_Product_in_']||''
          stage   = raw
          pHValue = lastPH!==null? lastPH: brewFallbackPH
          if (raw.toLowerCase().includes('brite')) {
            carb        = rec['Daily_Tank_Data.Bright_Tank_CarbonationFerm']||''
            dox         = rec['Daily_Tank_Data.Bright_Tank_Dissolved_OxygenFerm']||''
            const t     = all.find(e=>e.EX===batch && e['Transfer_Data.Final_Tank_Volume'])
            bbtVol      = t? t['Transfer_Data.Final_Tank_Volume']: ''
            totalVolume = parseFloat(bbtVol)||0
          } else {
            totalVolume = all
              .filter(e=>e.EX===batch)
              .reduce((s,e)=>s + (parseFloat(e['Brewing_Day_Data.Volume_into_FV'])||0), 0)
          }
        }

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
          rawDate:     rec.rawDate,
          person
        }
      })

      // 3) Final Frigid check (last)
      try {
        const resp = await fetch('/api/frigid')
        if (resp.ok) {
          const json = await resp.json()
          const list = Array.isArray(json)
            ? json
            : json.data||json.batches||[]
          const activeSet = new Set(list.map(i=>i.tank))
          // any not in Frigid → empty
          Object.keys(map).forEach(t=>{
            if (!activeSet.has(t)) {
              map[t].isEmpty = true
              map[t].batch   = ''
            }
          })
          // then apply each item’s active flag & temps
          list.forEach(item=>{
            const t = item.tank
            if (!t||!map[t]) return
            if (item.active===false) {
              map[t].isEmpty = true
              map[t].batch   = ''
            }
            if (item.temperature!=null) map[t].temperature = parseFloat(item.temperature)
            if (item.setPoint!=null) {
              try {
                const j = JSON.parse(item.setPoint)
                map[t].setPoint = j.value!==undefined?parseFloat(j.value):parseFloat(item.setPoint)
              } catch {
                map[t].setPoint = parseFloat(item.setPoint)
              }
            }
          })
        }
      } catch(e) {
        console.warn('⚠️ Frigid fetch failed:', e)
      }

      // 4) Deduplicate duplicate batches
      const byBatch = {}
      Object.values(map).forEach(e=>{
        if (e.batch) {
          byBatch[e.batch] = byBatch[e.batch]||[]
          byBatch[e.batch].push(e)
        }
      })
      Object.values(byBatch).forEach(group=>{
        if (group.length>1) {
          group.sort((a,b)=>b.lastUpdate - a.lastUpdate)
          group.slice(1).forEach(old=>{
            map[old.tank] = makeEmptyEntry(old.tank, old.lastUpdate)
          })
        }
      })

      // set state & init controls
      setTankData(Object.values(map))
      setError(null)
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
      console.error('❌ fetchDashboardData error:', e)
      setError(e.message||String(e))
    }
  }, [])

  // “Refresh” button: Apps Script → re-fetch
  const handleRefreshClick = async()=>{
    setLoading(true)
    try {
      const r = await fetch(APPS_SCRIPT_URL)
      if (!r.ok) throw new Error(`Script ${r.status}`)
      const j = await r.json()
      if (j.status!=='ok') throw new Error(j.message)
      await fetchDashboardData()
    } catch(e) {
      console.error('❌ handleRefreshClick:', e)
      setError(e.message||String(e))
    }
    setLoading(false)
  }

  // on-mount & 3h auto
  useEffect(()=>{
    fetchDashboardData()
    const id = setInterval(fetchDashboardData, 3*60*60*1000)
    return ()=>clearInterval(id)
  },[fetchDashboardData])

  // Handlers
  const handleAddDex      = tank=> setDexCounts(d=>({...d,[tank]:d[tank]+1}))
  const handleClear       = tank=>{
    setDexCounts(d=>({...d,[tank]:0}))
    setFruitVolumes(fv=>({...fv,[tank]:0}))
    setFruitInputs(fi=>({...fi,[tank]:''}))
    setTankData(td=> td.map(e=> e.tank===tank? makeEmptyEntry(tank): e))
  }
  const handleFruitChange = (t,v)=> setFruitInputs(fi=>({...fi,[t]:v}))
  const handleAddFruit    = tank=>{
    const v = parseFloat(fruitInputs[tank])
    if (!v||isNaN(v)) return
    setFruitVolumes(fv=>({...fv,[tank]:fv[tank]+v}))
    setFruitInputs(fi=>({...fi,[tank]:''}))
  }

  if (error) return <p style={{padding:20,fontFamily:'Calibri'}}>⚠️ Error: {error}</p>
  if (!tankData.length) return <p style={{padding:20,fontFamily:'Calibri'}}>Loading…</p>

  // Summary counts
  const totalTanks    = tankData.length
  const emptyCount    = tankData.filter(e=>e.isEmpty).length
  const occupiedCount = totalTanks - emptyCount
  const totalVol      = tankData.filter(e=>!e.isEmpty).reduce((s,e)=>s + (e.totalVolume||0),0)
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
      {/* Detailed-chart modal */}
      {modalChart && /* … unchanged … */}

      {/* Dashboard grid */}
      <div style={{/* …grid styles… */}}>
        {tankData.map(e=>{
          const {
            tank,batch,sheetUrl,stage,isEmpty,
            baseAvgOE,history,brewFallbackPH,
            pHValue,bbtVol,carb,dox,totalVolume,
            temperature,setPoint,rawDate,person
          } = e

          // … ABV, dex, fruit, mini-chart setup …

          return (
            <div key={tank} style={baseTile} /*…*/>
              {/* … header, stage, gravity, pH, volume … */}

              {/* ABV */}
              {dexABV && <p><strong>ABV:</strong> {finalABV}%</p>}

              {/* ← NEW: Actual Temp / Set line */}
              {typeof temperature === 'number' && typeof setPoint === 'number' && (
                <p>
                  <a
                    href="https://app.frigid.cloud/app/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration:'none', color:'inherit' }}
                  >
                    <strong>Actual Temp:</strong> {temperature.toFixed(1)}°C&nbsp;&nbsp;
                    <strong>Set:</strong> {setPoint.toFixed(1)}°C
                  </a>
                </p>
              )}

              {/* fill-date & person */}
              {rawDate && (
                <p style={{fontSize:'10px',opacity:0.5,marginTop:'4px'}}>
                  {formatFillDate(rawDate)} — {person}
                </p>
              )}

              {/* Controls & mini-chart */}
              {/* … unchanged … */}
            </div>
          )
        })}
      </div>

      {/* Summary & Refresh button */}
      {/* … unchanged … */}
    </>
  )
}
