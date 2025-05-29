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

// Client‐only import of Chart.js wrapper
const Line = dynamic(
  () => import('react-chartjs-2').then(m => m.Line),
  { ssr: false }
)

export default function Home() {
  const [tankData, setTankData] = useState([])
  const [error, setError] = useState(false)
  const [modalChart, setModalChart] = useState(null)
  const [dexCounts, setDexCounts] = useState({})
  const [fruitInputs, setFruitInputs] = useState({})
  const [fruitVolumes, setFruitVolumes] = useState({})

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
    return isFinite(abv)? abv : null
  }

  // ─── Fetch & assemble dashboard data ────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const sheetId = '1Ajtr8spY64ctRMjd6Z9mfYGTI1f0lJMgdIm8CeBnjm0'
      const range   = 'A1:ZZ1000'
      const apiKey  = 'AIzaSyDIcqb7GydD5J5H9O_psCdL1vmH5Lka4l8'
      const url     = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`

      const res  = await fetch(url)
      const json = await res.json()
      const rows = json.values
      if (!rows || rows.length<2) throw new Error('No data')

      const headers = rows[0]
      const all = rows.slice(1).map(r => {
        const o = {}
        headers.forEach((h,i)=> o[h] = r[i]||'')
        return o
      })

      const tanks = ['FV1','FV2','FV3','FV4','FV5','FV6','FV7','FV8','FV9','FV10','FVL1','FVL2','FVL3']
      const map = {}

      // build initial entries
      tanks.forEach(name => {
        // gather possible rows for this tank
        const ferRows = all.filter(e=> e['Daily_Tank_Data.FVFerm'] === name)
        const brewRows = all.filter(e=>
          e['What_are_you_filling_out_today_'].toLowerCase().includes('brewing day data')
          && e['Brewing_Day_Data.FV_Tank'] === name
        )
        const xferRows = all.filter(e=>
          e['What_are_you_filling_out_today_'].toLowerCase().includes('transfer data')
          && e['Transfer_Data.BTTrans'] === name
        )

        // mark empty if packaging in any fer row
        const packagingBatch = ferRows.find(e =>
          e['What_are_you_filling_out_today_'].toLowerCase().includes('packaging data')
        )?.EX
        let isEmpty = !!packagingBatch

        // pick newest row overall
        const candidates = [
          ...ferRows.map(e=>({...e, _type:'fer', _d: parseDate(e.DateFerm)})),
          ...brewRows.map(e=>({...e, _type:'brew', _d: parseDate(e.DateFerm)})),
          ...xferRows.map(e=>({...e, _type:'xfer', _d: parseDate(e.DateFerm)}))
        ]
        if (!candidates.length) {
          // no data at all
          map[name] = {
            tank: name, batch:'', sheetUrl:'', stage:'',
            isEmpty:true, baseAvgOE:null, history:[],
            pHValue:null, bbtVol:null, totalVolume:0,
            lastUpdate: new Date(0)
          }
          return
        }
        candidates.sort((a,b)=> b._d - a._d)
        const rec = candidates[0]
        const batch = rec.EX
        const sheetUrl = rec.EY || ''
        const lastUpdate = rec._d

        // initialize common fields
        let stage='', history=[], baseAvgOE=null, pHValue=null
        let bbtVol=null, carb=null, dox=null, totalVolume=0

        // build history & baseAvgOE for fermentation entries (by batch)
        const batchFer = all.filter(e=> e.EX===batch && e['Daily_Tank_Data.GravityFerm'])
        history = batchFer
          .map(e=>({date:parseDate(e.DateFerm), g:parseFloat(e['Daily_Tank_Data.GravityFerm'])}))
          .filter(h=>!isNaN(h.g))
          .sort((a,b)=>a.date-b.date)
        const OEs = all
          .filter(e=>e.EX===batch && e['Brewing_Day_Data.Original_Gravity'])
          .map(e=>parseFloat(e['Brewing_Day_Data.Original_Gravity']))
          .filter(v=>!isNaN(v))
        baseAvgOE = OEs.length? OEs.reduce((a,b)=>a+b,0)/OEs.length : null

        // special per-record logic
        if (rec._type === 'xfer') {
          // transfer: treat as brite
          stage = 'Brite'
          carb = rec['Transfer_Data.Final_Tank_CO2_Carbonation'] || ''
          dox = rec['Transfer_Data.Final_Tank_Dissolved_Oxygen'] || ''
          bbtVol = rec['Transfer_Data.Final_Tank_Volume'] || ''
          totalVolume = parseFloat(bbtVol) || 0
          pHValue = null
        } else if (rec._type === 'brew') {
          // brewing day data
          stage = 'Brewing Day Data'
          const og = parseFloat(rec['Brewing_Day_Data.Original_Gravity'])
          const ph = parseFloat(rec['Brewing_Day_Data.Final_FV_pH'])
          history = []  // no fermentation history yet
          baseAvgOE = og || null
          pHValue = !isNaN(ph)? ph : null
          totalVolume = parseFloat(rec['Brewing_Day_Data.Volume_into_FV']) || 0
        } else {
          // fermentation / daily
          const rawStage = rec['Daily_Tank_Data.What_Stage_in_the_Product_in_']||''
          stage = rawStage
          pHValue = parseFloat(rec['Daily_Tank_Data.pHFerm']) || null
          // decide brite vs ferment display
          if (rawStage.toLowerCase().includes('brite')) {
            carb = rec['Daily_Tank_Data.Bright_Tank_CarbonationFerm']||''
            dox = rec['Daily_Tank_Data.Bright_Tank_Dissolved_OxygenFerm']||''
            // volume uses last transferVolume if any
            const x = all.find(e=>e.EX===batch && e['Transfer_Data.Final_Tank_Volume'])
            bbtVol = x? x['Transfer_Data.Final_Tank_Volume'] : ''
            totalVolume = parseFloat(bbtVol)||0
          } else {
            // still fermenting
            totalVolume = all
              .filter(e=>e.EX===batch)
              .reduce((s,e)=> s+(parseFloat(e['Brewing_Day_Data.Volume_into_FV'])||0), 0)
          }
        }

        map[name] = {
          tank: name,
          batch,
          sheetUrl,
          stage,
          isEmpty,
          baseAvgOE,
          history,
          pHValue,
          bbtVol,
          carb,
          dox,
          totalVolume,
          lastUpdate
        }
      })

      // ─── Remove duplicate batches, keep only most recent ─────────────────────
      const byBatch = {}
      Object.values(map).forEach(entry => {
        if (entry.batch) {
          byBatch[entry.batch] = byBatch[entry.batch]||[]
          byBatch[entry.batch].push(entry)
        }
      })
      Object.values(byBatch).forEach(group => {
        if (group.length>1) {
          group.sort((a,b)=> b.lastUpdate - a.lastUpdate)
          // entries after first -> clear to empty
          group.slice(1).forEach(e => {
            map[e.tank] = {
              tank: e.tank,
              batch: '',
              sheetUrl: '',
              stage: '',
              isEmpty: true,
              baseAvgOE: null,
              history: [],
              pHValue: null,
              bbtVol: null,
              carb: null,
              dox: null,
              totalVolume: 0,
              lastUpdate: e.lastUpdate
            }
          })
        }
      })

      // finalize tankData
      setTankData(Object.values(map))
      setError(false)

      // init controls if first load
      setDexCounts(dc =>
        Object.keys(dc).length
          ? dc
          : tanks.reduce((o,t)=>({ ...o, [t]: 0 }), {})
      )
      setFruitInputs(fi =>
        Object.keys(fi).length
          ? fi
          : tanks.reduce((o,t)=>({ ...o, [t]: '' }), {})
      )
      setFruitVolumes(fv =>
        Object.keys(fv).length
          ? fv
          : tanks.reduce((o,t)=>({ ...o, [t]: 0 }), {})
      )
    } catch (e) {
      console.error(e)
      setError(true)
    }
  }, [])

  // auto-refresh every 3h
  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 3*60*60*1000)
    return () => clearInterval(id)
  }, [fetchData])

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleAddDex      = name => setDexCounts(d=>({...d,[name]:d[name]+1}))
  const handleClear      = name => {
    setDexCounts(d=>({...d,[name]:0}))
    setFruitVolumes(fv=>({...fv,[name]:0}))
    setFruitInputs(fi=>({...fi,[name]:''}))
  }
  const handleFruitChange = (name,v) => setFruitInputs(fi=>({...fi,[name]:v}))
  const handleAddFruit = name => {
    const v = parseFloat(fruitInputs[name])
    if (!v||isNaN(v)) return
    setFruitVolumes(fv=>({...fv,[name]:fv[name]+v}))
    setFruitInputs(fi=>({...fi,[name]:''}))
  }

  if (error) return <p style={{padding:20,fontFamily:'Calibri'}}>⚠️ Error loading data.</p>
  if (!tankData.length) return <p style={{padding:20,fontFamily:'Calibri'}}>Loading…</p>

  const baseTile = {
    borderRadius: '8px',
    padding: '10px',
    background: '#fff',
    boxShadow: '0 6px 12px rgba(0,0,0,0.1)',
    transition: 'transform 0.2s'
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
              background:'transparent',border:'none',fontSize:16,cursor:'pointer'
            }}>✕</button>
            <Line
              data={{
                labels: modalChart.labels,
                datasets: [{
                  label: 'Gravity (°P)',
                  data: modalChart.data,
                  tension: 0.4,
                  fill: false
                }]
              }}
              options={{
                aspectRatio: 2,
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

      {/* Dashboard */}
      <div style={{
        fontFamily:'Calibri, sans-serif',
        display:'grid',
        gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',
        gap:'20px',padding:'20px'
      }}>
        {tankData.map(t => {
          const {
            tank:name,
            batch,
            sheetUrl,
            stage,
            isEmpty,
            baseAvgOE,
            history,
            pHValue,
            bbtVol,
            carb,
            dox,
            totalVolume
          } = t

          // ABV calculations
          const dex = dexCounts[name]||0
          const HL  = totalVolume/1000
          const incOE = baseAvgOE!==null
            ? baseAvgOE + (HL>0?1.3/HL*dex:0)
            : null
          const curAE = history.length?history[history.length-1].g:null
          const leg   = incOE!==null&&curAE!==null?calcLegacy(incOE,curAE):null
          const neu   = incOE!==null&&curAE!==null?calcNew(incOE,curAE):null
          const dexABV= leg!==null&&neu!==null?((leg+neu)/2).toFixed(1):null

          // fruit adjustments
          const fv   = fruitVolumes[name]||0
          const eff  = fv*0.9
          const baseV= stage.toLowerCase().includes('brite')
            ? (parseFloat(bbtVol)||0)
            : totalVolume
          const dispV= baseV+eff
          const finalABV = dexABV!==null
            ? ((dexABV/100*baseV)/dispV*100).toFixed(1)
            : null

          // chart data
          const labels = incOE!==null
            ? ['OG',...history.map(h=>h.date.toLocaleDateString('en-AU'))]
            : history.map(h=>h.date.toLocaleDateString('en-AU'))
          const pts    = incOE!==null
            ? [incOE,...history.map(h=>h.g)]
            : history.map(h=>h.g)

          // styling
          const style={...baseTile}
          const s = stage.toLowerCase()
          if (isEmpty) style.background='#fff', style.border='1px solid #e0e0e0'
          else if (s.includes('crashed'))    style.background='rgba(30,144,255,0.1)', style.border='1px solid darkblue'
          else if (/d\.h|clean fusion/.test(s)) style.background='rgba(34,139,34,0.1)', style.border='1px solid darkgreen'
          else if (s.includes('fermentation')) style.background='rgba(210,105,30,0.1)', style.border='1px solid maroon'
          else if (s.includes('brite'))        style.background='rgba(211,211,211,0.3)', style.border='1px solid darkgrey'
          else                                  style.border='1px solid #ccc'

          const volLabel = s.includes('brite') ? 'BBT Vol:' : 'Tank Vol:'

          return (
            <div key={name}
                 style={style}
                 onMouseEnter={e=>e.currentTarget.style.transform='translateY(-4px)'}
                 onMouseLeave={e=>e.currentTarget.style.transform='translateY(0)'}
            >
              <h3>
                {name}
                {batch && <>
                  {' – '}
                  <a href={sheetUrl} target="_blank" rel="noopener noreferrer"
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
                  {s.includes('brite') ? (
                    <>
                      <p><strong>Carb:</strong> {carb}</p>
                      <p><strong>D.O.:</strong> {dox}</p>
                    </>
                  ) : s === 'brewing day data' ? (
                    <>
                      <p><strong>Gravity:</strong> {baseAvgOE!=null?baseAvgOE.toFixed(1):''} °P</p>
                      {pHValue!=null && <p><strong>pH:</strong> {pHValue.toFixed(1)} pH</p>}
                    </>
                  ) : (
                    <>
                      <p><strong>Gravity:</strong> {curAE!=null?curAE.toFixed(1):''} °P</p>
                      {pHValue!=null && <p><strong>pH:</strong> {pHValue.toFixed(1)} pH</p>}
                    </>
                  )}
                  <p><strong>{volLabel}</strong> {dispV.toFixed(1)} L</p>
                  {finalABV && <p><strong>ABV:</strong> {finalABV}%</p>}

                  {/* Controls */}
                  <div style={{
                    display:'flex',alignItems:'center',gap:'4px',marginTop:'8px'
                  }}>
                    <button onClick={()=>handleAddDex(name)}
                            style={{height:'28px',minWidth:'60px',fontSize:'12px',padding:'0 4px'}}>Add Dex</button>
                    <span style={{
                      display:'inline-block',height:'28px',minWidth:'24px',
                      lineHeight:'28px',textAlign:'center',fontSize:'12px'
                    }}>{dex}</span>
                    <button onClick={()=>handleClear(name)}
                            style={{
                              height:'28px',width:'28px',fontSize:'14px',
                              background:'transparent',border:'none',cursor:'pointer'
                            }}>🗑️</button>
                    <input type="text"
                           placeholder="fruit"
                           value={fruitInputs[name]||''}
                           onChange={e=>handleFruitChange(name,e.target.value)}
                           style={{
                             height:'28px',width:'50px',
                             fontSize:'12px',padding:'0 4px'
                           }}/>
                    <button onClick={()=>handleAddFruit(name)}
                            style={{height:'28px',width:'28px',fontSize:'12px',padding:'0'}}>+</button>
                  </div>

                  {/* Mini chart */}
                  {pts.length>1 && (
                    <Line
                      data={{labels, datasets:[{label:'Gravity (°P)',data:pts,tension:0.4,fill:false}]}}
                      options={{
                        aspectRatio:2,
                        plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.parsed.y.toFixed(1)} °P`}}},
                        scales:{
                          x:{ticks:{display:false},grid:{display:true}},
                          y:{beginAtZero:true,min:0,max:pts[0],ticks:{callback:v=>v.toFixed(1)}}
                        }
                      }}
                      height={150}
                      onClick={()=>setModalChart({labels,data:pts})}
                    />
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Refresh Button */}
      <div style={{textAlign:'center',padding:'20px'}}>
        <button onClick={fetchData}
                style={{fontSize:'16px',padding:'10px 20px',borderRadius:'4px',cursor:'pointer'}}>
          Refresh
        </button>
      </div>
    </>
  )
}
