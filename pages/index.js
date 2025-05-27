// pages/index.js
import { useEffect, useState } from 'react'
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

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
)

// Dynamically import the React wrapper (client-only)
const Line = dynamic(
  () => import('react-chartjs-2').then(mod => mod.Line),
  { ssr: false }
)

export default function Home() {
  const [tankData, setTankData] = useState([])
  const [error, setError] = useState(false)
  const [modalChart, setModalChart] = useState(null)
  const [dexCounts, setDexCounts] = useState({})

  // Helpers
  const parseDate = ds => {
    if (!ds) return new Date(0)
    const [d, m, y] = ds.split(/[/\s:]+/).map((v,i) => (i<3 ? +v : null))
    return new Date(y, m - 1, d)
  }
  const platoToSG = p =>
    1.00001 +
    0.0038661 * p +
    0.000013488 * p * p +
    0.000000043074 * p * p * p
  const calcLegacy = (OE, AE) => {
    const num = OE - AE
    const den = 2.0665 - 0.010665 * OE
    if (!den) return null
    return num / den
  }
  const calcNew = (OE, AE) => {
    const OG = platoToSG(OE)
    const FG = platoToSG(AE)
    const num = 76.08 * (OG - FG)
    const den = 1.775 - OG
    if (!den) return null
    const abv = (num / den) * (FG / 0.794)
    return isFinite(abv) ? abv : null
  }

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const sheetId = '1Ajtr8spY64ctRMjd6Z9mfYGTI1f0lJMgdIm8CeBnjm0'
        const range = 'A1:ZZ1000'
        const apiKey = 'AIzaSyDIcqb7GydD5J5H9O_psCdL1vmH5Lka4l8'
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`

        const res = await fetch(url)
        const json = await res.json()
        const rows = json.values
        if (!rows || rows.length < 2) throw new Error('No data')

        const headers = rows[0]
        const all = rows.slice(1).map(row => {
          const o = {}
          headers.forEach((h,i) => { o[h] = row[i] || '' })
          return o
        })

        const tanks = ['FV1','FV2','FV3','FV4','FV5','FV6','FV7','FV8','FV9','FV10','FVL1','FVL2','FVL3']
        const map = {}

        tanks.forEach(name => {
          const entries = all.filter(e => e['Daily_Tank_Data.FVFerm'] === name)
          if (!entries.length) {
            map[name] = { tank: name, isEmpty: true }
            return
          }
          // sort by date
          const sorted = entries
            .map(e => ({ ...e, d: parseDate(e['DateFerm']) }))
            .filter(e => e.d > 0)
            .sort((a,b)=>a.d - b.d)

          const latest = sorted[sorted.length-1]
          const batch = latest['EX'], sheetUrl = latest['EY']
          const stage = latest['Daily_Tank_Data.What_Stage_in_the_Product_in_']||''

          // packaging check
          const isEmpty = all.some(e =>
            e['EX']===batch &&
            e['What_are_you_filling_out_today_'].toLowerCase().includes('packaging data')
          )

          // gravity history
          const history = all
            .filter(e=>e['EX']===batch && e['Daily_Tank_Data.GravityFerm'])
            .map(e=>({date:parseDate(e['DateFerm']),g:parseFloat(e['Daily_Tank_Data.GravityFerm'])}))
            .filter(h=>!isNaN(h.g))
            .sort((a,b)=>a.date-b.date)

          // base OG
          const OEs = all
            .filter(e=>e['EX']===batch)
            .map(e=>parseFloat(e['Brewing_Day_Data.Original_Gravity']))
            .filter(v=>!isNaN(v))
          const baseAvgOE = OEs.length
            ? OEs.reduce((a,b)=>a+b,0)/OEs.length
            : null

          // pH
          const pHHist = all
            .filter(e=>e['EX']===batch && e['Daily_Tank_Data.pHFerm'])
            .map(e=>({date:parseDate(e['DateFerm']),p:parseFloat(e['Daily_Tank_Data.pHFerm'])}))
            .filter(h=>!isNaN(h.p))
            .sort((a,b)=>a.date-b.date)
          const pHValue = pHHist.length ? pHHist[pHHist.length-1].p : null

          // bright tank etc
          const bbtVol = (all.find(e=>e['EX']===batch && e['Transfer_Data.Final_Tank_Volume'])||{})['Transfer_Data.Final_Tank_Volume']||'N/A'
          const carb = latest['Daily_Tank_Data.Bright_Tank_CarbonationFerm']
          const dox = latest['Daily_Tank_Data.Bright_Tank_Dissolved_OxygenFerm']
          const totalVolume = all
            .filter(e=>e['EX']===batch)
            .reduce((s,e)=>s + (parseFloat(e['Brewing_Day_Data.Volume_into_FV'])||0),0)

          map[name] = {
            tank: name, batch, sheetUrl, stage, isEmpty,
            baseAvgOE, history, pHValue, bbtVol, carb, dox, totalVolume
          }
        })

        setTankData(tanks.map(t=>map[t]))
      } catch(e) {
        console.error(e)
        setError(true)
      }
    }
    fetchData()
  }, [])

  // init dex counts
  useEffect(() => {
    if (tankData.length && !Object.keys(dexCounts).length) {
      const init = {}
      tankData.forEach(t=>{ init[t.tank]=0 })
      setDexCounts(init)
    }
  }, [tankData])

  const handleAddDex = name=>{
    setDexCounts(p=>({...p,[name]:p[name]+1}))
  }
  const handleRemoveDex = name=>{
    setDexCounts(p=>({...p,[name]:Math.max(0,p[name]-1)}))
  }

  if (error) return <p style={{padding:20,fontFamily:'Calibri'}}>⚠️ Error loading data.</p>
  if (!tankData.length) return <p style={{padding:20,fontFamily:'Calibri'}}>Loading data…</p>

  const baseTile = {
    borderRadius:'8px',
    padding:'10px',
    background:'#fff',
    boxShadow:'0 6px 12px rgba(0,0,0,0.1)',
    transition:'transform 0.2s'
  }

  return (<>
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
            background:'transparent',border:'none',fontSize:16,cursor:'pointer'
          }}>✕</button>
          <Line
            data={{
              labels:modalChart.labels,
              datasets:[{
                label:'Gravity (°P)',
                data:modalChart.data,
                tension:0.4,fill:false
              }]
            }}
            options={{
              aspectRatio:2,
              plugins:{
                legend:{display:false},
                tooltip:{
                  callbacks:{
                    label:ctx=>`${ctx.parsed.y.toFixed(1)} °P`
                  }
                }
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

    <div style={{
      fontFamily:'Calibri, sans-serif',
      display:'grid',
      gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',
      gap:'20px',padding:'20px'
    }}>
      {tankData.map(t=>{
        const {
          tank:name, batch, sheetUrl, stage, isEmpty,
          baseAvgOE, history, pHValue, bbtVol, carb, dox, totalVolume
        } = t

        // dex logic
        const dexCount = dexCounts[name]||0
        const HL = totalVolume/1000
        const incr = HL>0 ? (1.3/HL)*dexCount : 0
        const currentOE = baseAvgOE!==null ? baseAvgOE+incr : null
        const currentAE = history.length ? history[history.length-1].g : null
        const leg = (currentOE!==null && currentAE!==null) ? calcLegacy(currentOE,currentAE) : null
        const neu = (currentOE!==null && currentAE!==null) ? calcNew(currentOE,currentAE) : null
        const avgABV = (leg!==null&&neu!==null) ? ((leg+neu)/2).toFixed(1) : null

        // chart
        const labels = currentOE!==null
          ? ['OG',...history.map(h=>h.date.toLocaleDateString('en-AU'))]
          : history.map(h=>h.date.toLocaleDateString('en-AU'))
        const dataPts = currentOE!==null
          ? [currentOE,...history.map(h=>h.g)]
          : history.map(h=>h.g)

        // style by stage
        const style = {...baseTile}
        const s=stage.toLowerCase()
        if(isEmpty){
          style.background='#fff';style.border='1px solid #e0e0e0'
        } else if(s.includes('crashed')){
          style.background='rgba(30,144,255,0.1)';style.border='1px solid darkblue'
        } else if(/d\.h|clean fusion/.test(s)){
          style.background='rgba(34,139,34,0.1)';style.border='1px solid darkgreen'
        } else if(s.includes('fermentation')){
          style.background='rgba(210,105,30,0.1)';style.border='1px solid maroon'
        } else if(s.includes('brite')){
          style.background='rgba(211,211,211,0.3)';style.border='1px solid darkgrey'
        } else {
          style.border='1px solid #ccc'
        }

        return (
          <div key={name}
               style={style}
               onMouseEnter={e=>e.currentTarget.style.transform='translateY(-4px)'}
               onMouseLeave={e=>e.currentTarget.style.transform='translateY(0)'}>
            <h3>
              {name}
              {batch&&<>
                {' – '}
                <a href={sheetUrl}
                   target="_blank"
                   rel="noopener noreferrer"
                   style={{color:'#4A90E2',textDecoration:'none'}}>
                  {batch.substring(0,25)}
                </a>
              </>}
            </h3>
            {isEmpty ? (
              <p><strong>Empty</strong></p>
            ) : (
              <>
                <p><strong>Stage:</strong> {stage||'N/A'}</p>
                <p><strong>Gravity:</strong> {currentAE!=null?`${currentAE.toFixed(1)} °P`:''}</p>
                {pHValue!=null&&<p><strong>pH:</strong> {pHValue.toFixed(1)} pH</p>}
                <p><strong>Tank Vol:</strong> {totalVolume} L</p>
                {avgABV&&<p><strong>ABV:</strong> {avgABV}%</p>}

                {/* Dex controls */}
                <div style={{
                  display:'flex',alignItems:'center',gap:'8px',marginTop:'8px'
                }}>
                  <button
                    onClick={()=>handleAddDex(name)}
                    style={{
                      width:'80px',height:'30px',
                      fontSize:'14px'
                    }}>
                    Add Dex
                  </button>
                  <span style={{
                    minWidth:'20px',textAlign:'center'
                  }}>{dexCount}</span>
                  <button
                    onClick={()=>handleRemoveDex(name)}
                    style={{
                      width:'80px',height:'30px',
                      fontSize:'14px'
                    }}>
                    🗑️
                  </button>
                </div>

                {/* Mini chart */}
                {dataPts.length>1&&(
                  <Line
                    data={{
                      labels, datasets:[{
                        label:'Gravity (°P)',
                        data:dataPts,
                        tension:0.4,fill:false
                      }]
                    }}
                    options={{
                      aspectRatio:2,
                      plugins:{
                        legend:{display:false},
                        tooltip:{
                          callbacks:{
                            label:ctx=>`${ctx.parsed.y.toFixed(1)} °P`
                          }
                        }
                      },
                      scales:{
                        x:{ticks:{display:false},grid:{display:true}},
                        y:{beginAtZero:true,min:0,max:dataPts[0],ticks:{callback:v=>v.toFixed(1)}}
                      }
                    }}
                    height={150}
                    onClick={()=>setModalChart({labels,data:dataPts})}
                  />
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  </>)
}
