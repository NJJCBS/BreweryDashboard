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

// Apps Script trigger URL
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/…/exec'

// Chart.js wrapper (client-only)
const Line = dynamic(() => import('react-chartjs-2').then(m => m.Line), { ssr: false })

// Date formatter for “Tue-5-Aug”
const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const monNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function formatFillDate(ds) {
  if (!ds) return ''
  const [d,m,y] = ds.split(/[/\s:]+/).map((v,i)=> i<3 ? +v : null)
  const dt = new Date(y,m-1,d)
  return `${dayNames[dt.getDay()]}-${dt.getDate()}-${monNames[dt.getMonth()]}`
}

// “Empty” tile factory
const makeEmptyEntry = (tankName, lastUpdate=new Date()) => ({
  tank: tankName, batch:'', sheetUrl:'', stage:'', isEmpty:true,
  baseAvgOE:null, history:[], brewFallbackPH:null, pHValue:null,
  bbtVol:null, carb:null, dox:null, totalVolume:0,
  temperature:null, setPoint:null,
  lastUpdate
})

export default function Home(){
  const [tankData, setTankData] = useState([])
  const [error,    setError]    = useState(false)
  const [modalChart, setModalChart] = useState(null)
  const [dexCounts,   setDexCounts]   = useState({})
  const [fruitInputs, setFruitInputs] = useState({})
  const [fruitVolumes,setFruitVolumes]= useState({})
  const [loading, setLoading] = useState(false)

  // Register Chart.js
  useEffect(()=>{
    ChartJS.register(CategoryScale,LinearScale,PointElement,LineElement,Title,Tooltip,Legend)
  },[])

  // Parsers & ABV calcs
  const parseDate = ds => {/*…*/}      // same as before
  const platoToSG = p => {/*…*/}
  const calcLegacy = (OE,AE)=>{/*…*/}
  const calcNew    = (OE,AE)=>{/*…*/}

  // Fetch sheets → build map → fetch frigid → dedupe → setTankData
  const fetchDashboardData = useCallback(async ()=>{
    try {
      // 1) Sheets
      const sheetId='1Ajtr8spY…',range='A1:ZZ1000'
      const apiKey='AIzaSy…'
      const url=`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`
      const res=await fetch(url)
      if(!res.ok) throw new Error(`Sheets ${res.status}`)
      const {values:rows}=await res.json()
      if(!rows||rows.length<2) throw new Error('No data')
      const headers=rows[0]
      const all=rows.slice(1).map(r=>{
        const o={}
        headers.forEach((h,i)=>o[h]=r[i]||'')
        return o
      })

      // 2) Build per-tank
      const tanks=['FV1','FV2','FV3','FV4','FV5','FV6','FV7','FV8','FV9','FV10','FVL1','FVL2','FVL3']
      const map={}
      tanks.forEach(name=>{
        // packaging → empty
        const ferRows=all.filter(e=>e['Daily_Tank_Data.FVFerm']===name)
        if(ferRows.find(e=>e['What_are_you_filling_out_today_'].toLowerCase().includes('packaging data'))){
          map[name]=makeEmptyEntry(name,parseDate(ferRows.find(e=>/*…*/).DateFerm))
          return
        }
        // brewing-day
        const brewRows=all.filter(e=>/*…*/).map(e=>({...e,d:parseDate(e.DateFerm)}))
        /* …same logic as before… */
        // produce map[name]={ tank,name,…,history,… lastUpdate }
      })

      // 3) Frigid proxy
      try {
        const fr = await fetch('/api/frigid')
        if(fr.ok){
          const arr = await fr.json()
          arr.forEach(item=>{
            if(item.tank && map[item.tank]){
              if(item.active===false){
                map[item.tank].isEmpty=true
              }
              // parse setPoint & temp
              let sp=item.setPoint
              try{ const j=JSON.parse(sp);if(j.value!==undefined)sp=j.value }catch{}
              map[item.tank].temperature=parseFloat(item.temperature)||null
              map[item.tank].setPoint= isFinite(+sp)?+sp:null
            }
          })
        }
      }catch(_){ console.warn('Frigid failed') }

      // 4) Dedupe
      const byBatch={}
      Object.values(map).forEach(e=>{
        if(e.batch){
          byBatch[e.batch]=byBatch[e.batch]||[]
          byBatch[e.batch].push(e)
        }
      })
      Object.values(byBatch).forEach(group=>{
        if(group.length>1){
          group.sort((a,b)=>b.lastUpdate - a.lastUpdate)
          group.slice(1).forEach(old=>{
            map[old.tank]=makeEmptyEntry(old.tank,old.lastUpdate)
          })
        }
      })

      setTankData(Object.values(map))
      setError(false)
      // init controls once…
    } catch(e){
      console.error(e)
      setError(true)
    }
  },[])

  // Refresh click: Apps Script → re-fetch
  const handleRefreshClick=async()=>{
    setLoading(true)
    try {
      const r=await fetch(APPS_SCRIPT_URL)
      if(!r.ok) throw new Error(`Script ${r.status}`)
      const j=await r.json()
      if(j.status!=='ok') throw new Error(j.message)
      await fetchDashboardData()
    } catch(e){
      console.error(e)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  // on-mount & 3h auto
  useEffect(()=>{
    fetchDashboardData()
    const id=setInterval(fetchDashboardData,3*3600*1000)
    return ()=>clearInterval(id)
  },[fetchDashboardData])

  // handlers…
  const handleAddDex      = tank=>{/*…*/}
  const handleClear       = tank=>{/*…*/}
  const handleFruitChange = (t,v)=>{/*…*/}
  const handleAddFruit    = tank=>{/*…*/}

  if(error)    return <p>⚠️ Error loading data.</p>
  if(!tankData.length) return <p>Loading…</p>

  // summary counts…
  // JSX render…
  // — under each mini-chart only:
  //   <p style={{fontSize:'10px',opacity:.4,marginTop:'4px'}}>
  //     {formatFillDate(history[last].rawDate)} — {history[last].person}
  //   </p>
  // — remove the extra “Tiny fill info” above controls
  // — Refresh button shows spinner when `loading===true`
}
