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

// Dynamically import React wrapper (client only)
const Line = dynamic(
  () => import('react-chartjs-2').then(mod => mod.Line),
  { ssr: false }
)

export default function Home() {
  // chart & data states
  const [tankData, setTankData] = useState([])
  const [error, setError] = useState(false)
  const [modalChart, setModalChart] = useState(null)
  // dex adjustments: { [tankName]: count }
  const [dexCounts, setDexCounts] = useState({})

  // helper functions
  const parseDate = ds => {
    if (!ds) return new Date(0)
    const [d, m, y] = ds.split(/[/\s:]+/).map((v,i) => (i<3 ? +v : NaN))
    return new Date(y, m - 1, d)
  }

  const platoToSG = p =>
    1.00001 +
    0.0038661 * p +
    0.000013488 * p * p +
    0.000000043074 * p * p * p

  // legacy ABV formula returns percent (e.g. 4.26)
  const calcLegacy = (OE, AE) => {
    const num = OE - AE
    const den = 2.0665 - 0.010665 * OE
    if (!den) return null
    return num / den
  }

  // new ABV formula returns percent (e.g. 4.57)
  const calcNew = (OE, AE) => {
    const OG = platoToSG(OE)
    const FG = platoToSG(AE)
    const num = 76.08 * (OG - FG)
    const den = 1.775 - OG
    if (!den) return null
    const abv = (num / den) * (FG / 0.794)
    return isFinite(abv) ? abv : null
  }

  // fetch and build tank data
  useEffect(() => {
    async function fetchData() {
      try {
        const sheetId = '1Ajtr8spY64ctRMjd6Z9mfYGTI1f0lJMgdIm8CeBnjm0'
        const range = 'A1:ZZ1000'
        const apiKey = 'AIzaSyDIcqb7GydD5J5H9O_psCdL1vmH5Lka4l8'
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`

        const res = await fetch(url)
        const json = await res.json()
        const rows = json.values
        if (!rows || rows.length < 2) {
          throw new Error('No data from sheet')
        }

        const headers = rows[0]
        const data = rows.slice(1).map(row => {
          const obj = {}
          headers.forEach((h,i) => { obj[h] = row[i] || '' })
          return obj
        })

        const tanks = [
          'FV1','FV2','FV3','FV4','FV5','FV6','FV7',
          'FV8','FV9','FV10','FVL1','FVL2','FVL3'
        ]

        const map = {}
        tanks.forEach(tank => {
          const entries = data.filter(e => e['Daily_Tank_Data.FVFerm'] === tank)
          if (!entries.length) {
            map[tank] = { tank, isEmpty: true }
            return
          }

          // sort by date ascending
          const sorted = entries
            .map(e => ({ ...e, dt: parseDate(e['DateFerm']) }))
            .filter(e => e.dt > 0)
            .sort((a,b) => a.dt - b.dt)

          const latest = sorted[sorted.length - 1]
          const batch = latest['EX']
          const sheetUrl = latest['EY']
          const stage = latest['Daily_Tank_Data.What_Stage_in_the_Product_in_'] || ''

          // gravity history
          const history = data
            .filter(e => e['EX'] === batch && e['Daily_Tank_Data.GravityFerm'])
            .map(e => ({
              date: parseDate(e['DateFerm']),
              gravity: parseFloat(e['Daily_Tank_Data.GravityFerm'])
            }))
            .filter(h => !isNaN(h.gravity))
            .sort((a,b) => a.date - b.date)

          // original extract average (OE)
          const OEs = data
            .filter(e => e['EX'] === batch)
            .map(e => parseFloat(e['Brewing_Day_Data.Original_Gravity']))
            .filter(v => !isNaN(v))
          const avgOE = OEs.length
            ? OEs.reduce((a,b) => a + b, 0) / OEs.length
            : null

          // pH value
          const pHHistory = data
            .filter(e => e['EX'] === batch && e['Daily_Tank_Data.pHFerm'])
            .map(e => ({
              date: parseDate(e['DateFerm']),
              pH: parseFloat(e['Daily_Tank_Data.pHFerm'])
            }))
            .filter(h => !isNaN(h.pH))
            .sort((a,b) => a.date - b.date)
          const pHValue = pHHistory.length
            ? pHHistory[pHHistory.length - 1].pH
            : null

          // total volume (for dex calculation)
          const totalVol = data
            .filter(e => e['EX'] === batch)
            .reduce((sum,e) => sum + (parseFloat(e['Brewing_Day_Data.Volume_into_FV'])||0), 0)

          // bright tank volume
          const transfer = data.find(
            e => e['EX'] === batch && e['Transfer_Data.Final_Tank_Volume']
          )
          const bbtVol = transfer
            ? transfer['Transfer_Data.Final_Tank_Volume']
            : 'N/A'

          // store tile
          map[tank] = {
            tank,
            batch,
            sheetUrl,
            stage,
            history,
            avgOE,
            pHValue,
            totalVol,
            bbtVol,
            isEmpty: false
          }
        })

        setTankData(tanks.map(t => map[t]))
      } catch (e) {
        console.error(e)
        setError(true)
      }
    }

    fetchData()
  }, [])

  // styling for floating tiles
  const baseTileStyle = {
    borderRadius: 8,
    padding: 10,
    background: '#fff',
    boxShadow: '0 6px 12px rgba(0,0,0,0.1)',
    transition: 'transform 0.2s',
    cursor: 'default'
  }

  if (error) {
    return <p style={{ padding:20, fontFamily:'Calibri' }}>⚠️ Error loading data.</p>
  }
  if (!tankData.length) {
    return <p style={{ padding:20, fontFamily:'Calibri' }}>Loading data…</p>
  }

  return (
    <>
      {/* detailed modal */}
      {modalChart && (
        <div style={{
          position:'fixed', top:0, left:0,
          width:'100%', height:'100%',
          background:'rgba(0,0,0,0.5)',
          display:'flex', alignItems:'center', justifyContent:'center',
          zIndex:1000
        }}>
          <div style={{
            position:'relative', background:'#fff',
            padding:20, borderRadius:8, maxWidth:'90%', maxHeight:'90%', overflow:'auto'
          }}>
            <button onClick={()=>setModalChart(null)} style={{
              position:'absolute', top:10, right:10,
              background:'transparent', border:'none', fontSize:16, cursor:'pointer'
            }}>✕</button>
            <Line
              data={{
                labels: modalChart.labels,
                datasets:[{
                  label:'Gravity (°P)',
                  data: modalChart.data,
                  tension:0.4, fill:false
                }]
              }}
              options={{
                aspectRatio:2,
                plugins:{ legend:{ display:false } },
                scales:{
                  x:{ title:{ display:true, text:'Date' }, grid:{ display:true } },
                  y:{ beginAtZero:true, min:0, title:{ display:true, text:'Gravity (°P)' } }
                }
              }}
            />
          </div>
        </div>
      )}

      {/* dashboard */}
      <div style={{
        fontFamily:'Calibri, sans-serif',
        display:'grid',
        gridTemplateColumns:'repeat(auto-fill, minmax(250px,1fr))',
        gap:20, padding:20
      }}>
        {tankData.map((t,i) => {
          const {
            tank:name, batch, sheetUrl, stage,
            history, avgOE, pHValue, totalVol,
            bbtVol, isEmpty
          } = t

          // dex count for this tank
          const dexCount = dexCounts[name] || 0
          const dexAmount = totalVol / 1000 * 1.3
          const adjustedOE = avgOE != null
            ? avgOE + dexCount * dexAmount
            : null

          // latest gravity (AE)
          const ae = history.length
            ? history[history.length - 1].gravity
            : null

          // compute ABV with adjusted OE
          let displayABV = null
          if (adjustedOE != null && ae != null) {
            const leg = calcLegacy(adjustedOE, ae)
            const neu = calcNew(adjustedOE, ae)
            if (leg!=null && neu!=null) {
              displayABV = ((leg + neu)/2).toFixed(1)
            }
          }

          // chart data prep
          const labels = []
          const chartData = []
          if (adjustedOE != null) {
            labels.push('OG')
            chartData.push(adjustedOE)
          }
          history.forEach(h => {
            labels.push(h.date.toLocaleDateString('en-AU'))
            chartData.push(h.gravity)
          })

          // determine tile colors
          const s = stage.toLowerCase()
          const style = { ...baseTileStyle }
          if (isEmpty) {
            style.background = '#fff'
            style.border = '1px solid #e0e0e0'
          } else if (s.includes('crashed')) {
            style.background = 'rgba(30,144,255,0.1)'
            style.border = '1px solid darkblue'
          } else if (/d\.h|clean fusion/.test(s)) {
            style.background = 'rgba(34,139,34,0.1)'
            style.border = '1px solid darkgreen'
          } else if (s.includes('fermentation')) {
            style.background = 'rgba(210,105,30,0.1)'
            style.border = '1px solid maroon'
          } else if (s.includes('brite')) {
            style.background = 'rgba(211,211,211,0.3)'
            style.border = '1px solid darkgrey'
          } else {
            style.background = '#fff'
            style.border = '1px solid #ccc'
          }

          return (
            <div
              key={i}
              style={style}
              onMouseEnter={e => e.currentTarget.style.transform='translateY(-4px)'}
              onMouseLeave={e => e.currentTarget.style.transform='translateY(0)'}
            >
              <h3>
                {name}
                {batch && (
                  <>
                    {' – '}
                    <a href={sheetUrl}
                      target="_blank" rel="noopener noreferrer"
                      style={{ color:'#4A90E2', textDecoration:'none' }}
                    >
                      {batch.substring(0,25)}
                    </a>
                  </>
                )}
              </h3>

              {isEmpty ? (
                <p><strong>Empty</strong></p>
              ) : (
                <>
                  <p><strong>Stage:</strong> {stage || 'N/A'}</p>

                  {s.includes('brite') ? (
                    <>
                      <p><strong>Carb:</strong> {bbtVol}</p>
                    </>
                  ) : (
                    <>
                      <p>
                        <strong>Gravity:</strong>{' '}
                        {ae!=null ? `${ae} °P` : ''}
                      </p>
                      {pHValue!=null && (
                        <p><strong>pH:</strong> {pHValue} pH</p>
                      )}
                      <p><strong>Tank Volume:</strong> {totalVol} L</p>
                    </>
                  )}

                  {displayABV && (
                    <p><strong>ABV:</strong> {displayABV}%</p>
                  )}

                  {/* Dex controls */}
                  <div style={{ marginTop: 8, display: 'flex', alignItems:'center' }}>
                    <button
                      onClick={() =>
                        setDexCounts(dc => ({
                          ...dc,
                          [name]: (dc[name] || 0) + 1
                        }))
                      }
                      style={{
                        padding: '4px 8px',
                        fontSize: 12,
                        cursor: 'pointer'
                      }}
                    >
                      Add Dex
                    </button>
                    <button
                      onClick={() =>
                        setDexCounts(dc => {
                          const count = (dc[name] || 0) - 1
                          const next = { ...dc }
                          if (count > 0) next[name] = count
                          else delete next[name]
                          return next
                        })
                      }
                      style={{
                        padding: '4px 6px',
                        fontSize: 12,
                        marginLeft: 4,
                        cursor: 'pointer'
                      }}
                    >
                      🗑️
                    </button>
                    <span style={{ marginLeft: 8, fontSize: 12 }}>
                      Dex: {dexCount}
                    </span>
                  </div>

                  {/* mini fermentation chart */}
                  {chartData.length > 1 && (
                    <Line
                      data={{
                        labels,
                        datasets:[{
                          label:'Gravity (°P)',
                          data:chartData,
                          tension:0.4,
                          fill:false
                        }]
                      }}
                      options={{
                        aspectRatio:2,
                        plugins:{ legend:{ display:false } },
                        scales:{
                          x:{ ticks:{ display:false }, grid:{ display:true } },
                          y:{ beginAtZero:true, min:0, max:chartData[0] }
                        }
                      }}
                      height={150}
                      onClick={() =>
                        setModalChart({ labels, data: chartData })
                      }
                    />
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
