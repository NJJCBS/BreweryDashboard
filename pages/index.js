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
  // ── Helper functions ───────────────────────────────────────────────
  const parseDate = ds => {
    if (!ds) return new Date(0)
    const [d, m, y] = ds.split(/[/\s:]+/).map((v, i) => (i < 3 ? +v : null))
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
    return num / den // percent (e.g. 4.26)
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

  // ── State ────────────────────────────────────────────────────────
  const [tankData, setTankData] = useState([])    // holds all tile data
  const [error, setError] = useState(false)       // fetch error?
  const [modalChart, setModalChart] = useState(null)  // for full-size chart

  // ── Add Dex handler ─────────────────────────────────────────────
  const handleAddDex = tankName => {
    setTankData(prev =>
      prev.map(t => {
        if (t.tank !== tankName) return t

        // increment dex count
        const newDexCount = (t.dexCount || 0) + 1
        // dex adds totalVolume * 0.0012 per press
        const dexAdded = t.totalVolume * 0.0012 * newDexCount
        const newAvgOE = t.rawAvgOE + dexAdded

        // recalc ABV with new OG
        const leg = calcLegacy(newAvgOE, t.gravity)
        const neu = calcNew(newAvgOE, t.gravity)
        const newAvgABV =
          leg !== null && neu !== null
            ? ((leg + neu) / 2).toFixed(1)
            : null

        // update chart's first data point (OG)
        const newChart = {
          labels: [...t.chart.labels],
          data: [...t.chart.data]
        }
        newChart.data[0] = newAvgOE

        return {
          ...t,
          dexCount: newDexCount,
          avgABV: newAvgABV,
          chart: newChart
        }
      })
    )
  }

  // ── Fetch & build tankData ───────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      try {
        const sheetId = '1Ajtr8spY64ctRMjd6Z9mfYGTI1f0lJMgdIm8CeBnjm0'
        const range = 'A1:ZZ1000'
        const apiKey = 'AIzaSyDIcqb7GydD5J5H9O_psCdL1vmH5Lka4l8'
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`

        const res = await fetch(url)
        const { values: rows } = await res.json()
        if (!rows || rows.length < 2) {
          throw new Error('No data returned from Google Sheets')
        }

        // headers + data rows
        const headers = rows[0]
        const data = rows.slice(1).map(r => {
          const obj = {}
          headers.forEach((h, i) => (obj[h] = r[i] || ''))
          return obj
        })

        // list of tanks
        const tanks = [
          'FV1','FV2','FV3','FV4','FV5','FV6','FV7',
          'FV8','FV9','FV10','FVL1','FVL2','FVL3'
        ]

        const map = {}

        tanks.forEach(tank => {
          const entries = data.filter(
            e => e['Daily_Tank_Data.FVFerm'] === tank
          )
          if (!entries.length) {
            map[tank] = { tank, isEmpty: false }
            return
          }

          // sort ascending by DateFerm
          const sorted = entries
            .map(e => ({ ...e, parsedDate: parseDate(e['DateFerm']) }))
            .filter(e => e.parsedDate > 0)
            .sort((a, b) => a.parsedDate - b.parsedDate)

          const latest = sorted[sorted.length - 1]
          const batch = latest['EX']
          const sheetUrl = latest['EY']
          const stage = latest['Daily_Tank_Data.What_Stage_in_the_Product_in_'] || ''

          // build gravity history
          const history = data
            .filter(
              e =>
                e['EX'] === batch &&
                e['Daily_Tank_Data.GravityFerm']
            )
            .map(e => ({
              date: parseDate(e['DateFerm']),
              gravity: parseFloat(e['Daily_Tank_Data.GravityFerm'])
            }))
            .filter(h => !isNaN(h.gravity))
            .sort((a, b) => a.date - b.date)

          // compute avg OE (raw)
          const OEs = data
            .filter(e => e['EX'] === batch)
            .map(e => parseFloat(e['Brewing_Day_Data.Original_Gravity']))
            .filter(v => !isNaN(v))
          const rawAvgOE = OEs.length
            ? OEs.reduce((a, b) => a + b, 0) / OEs.length
            : null

          // build chart labels & data (first point = OG)
          const labels = []
          const chartData = []
          if (rawAvgOE !== null) {
            labels.push('OG')
            chartData.push(rawAvgOE)
          }
          history.forEach(h => {
            labels.push(h.date.toLocaleDateString('en-AU'))
            chartData.push(h.gravity)
          })

          // get last gravity & pH
          const lastGravity = history.length
            ? history[history.length - 1].gravity
            : null
          const pHHistory = data
            .filter(
              e =>
                e['EX'] === batch &&
                e['Daily_Tank_Data.pHFerm']
            )
            .map(e => ({
              date: parseDate(e['DateFerm']),
              pH: parseFloat(e['Daily_Tank_Data.pHFerm'])
            }))
            .filter(h => !isNaN(h.pH))
            .sort((a,b) => a.date - b.date)
          const lastpH = pHHistory.length
            ? pHHistory[pHHistory.length - 1].pH
            : null

          // calculate ABV
          const leg = rawAvgOE !== null ? calcLegacy(rawAvgOE, lastGravity) : null
          const neu = rawAvgOE !== null ? calcNew(rawAvgOE, lastGravity) : null
          const avgABV =
            leg !== null && neu !== null
              ? ((leg + neu) / 2).toFixed(1)
              : null

          // total volume
          const totalVolume = data
            .filter(e => e['EX'] === batch)
            .reduce(
              (sum, e) =>
                sum + (parseFloat(e['Brewing_Day_Data.Volume_into_FV']) || 0),
              0
            )

          // bright tank volume
          const transfer = data.find(
            e =>
              e['EX'] === batch &&
              e['Transfer_Data.Final_Tank_Volume']
          )
          const bbtVol = transfer
            ? transfer['Transfer_Data.Final_Tank_Volume']
            : 'N/A'

          // packaging?
          const isEmpty = data.some(
            e =>
              e['EX'] === batch &&
              e['What_are_you_filling_out_today_']
                .toLowerCase()
                .includes('packaging data')
          )

          map[tank] = {
            tank,
            batch,
            sheetUrl,
            stage,
            gravity: lastGravity,
            pH: lastpH,
            carbonation: latest['Daily_Tank_Data.Bright_Tank_CarbonationFerm'],
            doxygen: latest['Daily_Tank_Data.Bright_Tank_Dissolved_OxygenFerm'],
            totalVolume,
            rawAvgOE,
            avgABV,
            bbtVolume: bbtVol,
            isEmpty,
            chart: { labels, data: chartData },
            dexCount: 0     // initialize dex counter
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

  if (error) {
    return (
      <p style={{ padding: 20, fontFamily: 'Calibri' }}>
        ⚠️ Error loading data. Check console.
      </p>
    )
  }
  if (!tankData.length) {
    return (
      <p style={{ padding: 20, fontFamily: 'Calibri' }}>
        Loading data…
      </p>
    )
  }

  // base style for floating tiles
  const baseTileStyle = {
    borderRadius: '8px',
    padding: '10px',
    background: '#fff',
    boxShadow: '0 6px 12px rgba(0,0,0,0.1)',
    transition: 'transform 0.2s',
    cursor: 'pointer'
  }

  return (
    <>
      {/* Modal large chart */}
      {modalChart && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0,
          width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            position: 'relative',
            background: '#fff',
            padding: 20,
            borderRadius: 8,
            maxWidth: '90%',
            maxHeight: '90%',
            overflow: 'auto'
          }}>
            <button onClick={() => setModalChart(null)} style={{
              position: 'absolute',
              top: 10, right: 10,
              background: 'transparent',
              border: 'none',
              fontSize: 16,
              cursor: 'pointer'
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
                plugins: { legend: { display: false } },
                scales: {
                  x: { title: { display: true, text: 'Date' }, ticks: { display: true }, grid: { display: true } },
                  y: { beginAtZero: true, min: 0, title: { display: true, text: 'Gravity (°P)' } }
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Dashboard grid */}
      <div style={{
        fontFamily: 'Calibri, sans-serif',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(250px,1fr))',
        gap: '20px',
        padding: '20px'
      }}>
        {tankData.map((t, i) => {
          const {
            tank: name,
            batch,
            sheetUrl,
            stage,
            gravity,
            pH,
            carbonation,
            doxygen,
            totalVolume,
            avgABV,
            bbtVolume,
            isEmpty,
            chart,
            dexCount
          } = t

          // tile styling by stage
          const style = { ...baseTileStyle }
          const s = stage.toLowerCase()
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
            <div key={i}
              style={style}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-4px)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
            >
              <h3>
                {name}
                {batch && (
                  <>
                    {' – '}
                    <a href={sheetUrl}
                      target="_blank" rel="noopener noreferrer"
                      style={{ color: '#4A90E2', textDecoration: 'none' }}
                    >
                      {batch.substring(0, 25)}
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
                      <p><strong>Carb:</strong> {carbonation ? `${parseFloat(carbonation).toFixed(2)} vols` : ''}</p>
                      <p><strong>D.O.:</strong> {doxygen ? `${parseFloat(doxygen).toFixed(1)} ppb` : ''}</p>
                      <p><strong>BBT Volume:</strong> {bbtVolume} L</p>
                    </>
                  ) : /fermentation|crashed|d\.h|clean fusion/.test(s) ? (
                    <>
                      <p><strong>Gravity:</strong> {gravity != null ? `${gravity} °P` : ''}</p>
                      {pH != null && <p><strong>pH:</strong> {pH} pH</p>}
                      <p><strong>Tank Volume:</strong> {totalVolume} L</p>
                    </>
                  ) : (
                    <p>No Data</p>
                  )}

                  {avgABV && <p><strong>ABV:</strong> {avgABV}%</p>}

                  {/* Add Dex button */}
                  <button
                    onClick={() => handleAddDex(name)}
                    style={{
                      marginTop: '8px',
                      padding: '4px 8px',
                      fontSize: '0.9rem',
                      borderRadius: '4px',
                      border: '1px solid #888',
                      background: '#fafafa',
                      cursor: 'pointer'
                    }}
                  >
                    Add Dex ({dexCount})
                  </button>

                  {/* Mini fermentation curve */}
                  {chart.data.length > 1 && (
                    <Line
                      data={{
                        labels: chart.labels,
                        datasets: [{
                          label: 'Gravity (°P)',
                          data: chart.data,
                          tension: 0.4,
                          fill: false
                        }]
                      }}
                      options={{
                        aspectRatio: 2,
                        plugins: { legend: { display: false } },
                        scales: {
                          x: { ticks: { display: false }, grid: { display: true } },
                          y: { beginAtZero: true, min: 0, max: chart.data[0] }
                        }
                      }}
                      height={150}
                      onClick={() => setModalChart(chart)}
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
