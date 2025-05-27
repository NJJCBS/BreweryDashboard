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

// 1️⃣ Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
)

// 2️⃣ Dynamically import the React wrapper so it only runs in the browser
const Line = dynamic(
  () => import('react-chartjs-2').then(mod => mod.Line),
  { ssr: false }
)

export default function Home() {
  const [tankData, setTankData] = useState([])
  const [error, setError] = useState(false)

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
        if (!rows || rows.length < 2) {
          throw new Error('No data returned from Google Sheets')
        }

        const headers = rows[0]
        const data = rows.slice(1).map(row => {
          const obj = {}
          headers.forEach((h, i) => {
            obj[h] = row[i] || ''
          })
          return obj
        })

        const tanks = [
          'FV1','FV2','FV3','FV4','FV5','FV6','FV7',
          'FV8','FV9','FV10','FVL1','FVL2','FVL3'
        ]

        const parseDate = ds => {
          if (!ds) return new Date(0)
          const [d,m,y] = ds.split(/[/\s:]+/).map((v,i) => i < 3 ? +v : null)
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
          return num / den  // e.g. 4.26
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

        const map = {}
        tanks.forEach(tank => {
          const entries = data.filter(
            e => e['Daily_Tank_Data.FVFerm'] === tank
          )
          if (!entries.length) {
            map[tank] = { tank, isEmpty: false }
            return
          }

          // sort by DateFerm ascending
          const sorted = entries
            .map(e => ({
              ...e,
              parsedDate: parseDate(e['DateFerm'])
            }))
            .filter(e => e.parsedDate > 0)
            .sort((a, b) => a.parsedDate - b.parsedDate)

          const latest = sorted[sorted.length - 1]
          const batch = latest['EX']
          const sheetUrl = latest['EY']
          const stage =
            latest['Daily_Tank_Data.What_Stage_in_the_Product_in_'] || ''

          // Build gravity history
          const history = data
            .filter(
              e =>
                e['EX'] === batch &&
                e['Daily_Tank_Data.GravityFerm']
            )
            .map(e => ({
              date: parseDate(e['DateFerm']),
              gravity: parseFloat(
                e['Daily_Tank_Data.GravityFerm']
              )
            }))
            .filter(h => !isNaN(h.gravity))
            .sort((a, b) => a.date - b.date)

          // Compute avg OE
          const OEs = data
            .filter(e => e['EX'] === batch)
            .map(e =>
              parseFloat(e['Brewing_Day_Data.Original_Gravity'])
            )
            .filter(v => !isNaN(v))
          const avgOE = OEs.length
            ? OEs.reduce((a, b) => a + b, 0) / OEs.length
            : null

          // Build chart data
          const labels = []
          const chartData = []
          if (avgOE !== null) {
            labels.push('OG')
            chartData.push(avgOE)
          }
          history.forEach(h => {
            labels.push(h.date.toLocaleDateString('en-AU'))
            chartData.push(h.gravity)
          })

          // Calculate ABV
          const ae =
            history.length > 0 ? history[history.length - 1].gravity : NaN
          const leg = avgOE !== null ? calcLegacy(avgOE, ae) : null
          const neu = avgOE !== null ? calcNew(avgOE, ae) : null
          let avgABV = null
          if (leg !== null && neu !== null) {
            avgABV = ((leg + neu) / 2).toFixed(1)
          }

          // Bright tank volume
          const transfer = data.find(
            e =>
              e['EX'] === batch &&
              e['Transfer_Data.Final_Tank_Volume']
          )
          const bbtVol = transfer
            ? transfer['Transfer_Data.Final_Tank_Volume']
            : 'N/A'

          const hasPack = data.some(
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
            gravity: ae,
            pH: latest['Daily_Tank_Data.pHFerm'],
            carbonation:
              latest['Daily_Tank_Data.Bright_Tank_CarbonationFerm'],
            doxygen:
              latest['Daily_Tank_Data.Bright_Tank_Dissolved_OxygenFerm'],
            totalVolume: data
              .filter(e => e['EX'] === batch)
              .reduce(
                (sum, e) =>
                  sum +
                  (parseFloat(e['Brewing_Day_Data.Volume_into_FV']) ||
                    0),
                0
              ),
            avgABV,
            bbtVolume: bbtVol,
            isEmpty: hasPack,
            chart: { labels, data: chartData }
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
        ⚠️ Error loading data. Check console for details.
      </p>
    )
  }

  if (tankData.length === 0) {
    return (
      <p style={{ padding: 20, fontFamily: 'Calibri' }}>
        Loading data…
      </p>
    )
  }

  return (
    <div
      style={{
        fontFamily: 'Calibri, sans-serif',
        display: 'grid',
        gridTemplateColumns:
          'repeat(auto-fill, minmax(250px, 1fr))',
        gap: '20px',
        padding: '20px'
      }}
    >
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
          chart
        } = t
        const isBrite = stage.toLowerCase().includes('brite')
        const isFerment = /fermentation|crashed|d\.h|clean fusion/i.test(
          stage
        )

        return (
          <div
            key={i}
            style={{
              border: '1px solid #ccc',
              borderRadius: '8px',
              padding: '10px',
              background: '#f9f9f9'
            }}
          >
            <h3>
              {name}
              {batch && (
                <>
                  {' – '}
                  <a
                    href={sheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: '#4A90E2',
                      textDecoration: 'none'
                    }}
                  >
                    {batch.substring(0, 25)}
                  </a>
                </>
              )}
            </h3>

            {isEmpty ? (
              <p>
                <strong>Empty</strong>
              </p>
            ) : (
              <>
                <p>
                  <strong>Stage:</strong> {stage || 'N/A'}
                </p>

                {isBrite ? (
                  <>
                    <p>
                      <strong>Carb:</strong>{' '}
                      {carbonation
                        ? `${parseFloat(
                            carbonation
                          ).toFixed(2)} vols`
                        : 'N/A'}
                    </p>
                    <p>
                      <strong>D.O.:</strong>{' '}
                      {doxygen
                        ? `${parseFloat(
                            doxygen
                          ).toFixed(1)} ppb`
                        : 'N/A'}
                    </p>
                    <p>
                      <strong>BBT Volume:</strong> {bbtVolume} L
                    </p>
                  </>
                ) : isFerment ? (
                  <>
                    <p>
                      <strong>Gravity:</strong>{' '}
                      {gravity || 'N/A'} °P
                    </p>
                    <p>
                      <strong>pH:</strong> {pH || 'N/A'} pH
                    </p>
                    <p>
                      <strong>Tank Volume:</strong>{' '}
                      {totalVolume} L
                    </p>
                  </>
                ) : (
                  <p>No Data</p>
                )}

                {avgABV && (
                  <p>
                    <strong>ABV:</strong> {avgABV}%  
                  </p>
                )}

                {chart.data.length > 1 && (
                  <Line
                    data={{
                      labels: chart.labels,
                      datasets: [
                        {
                          label: 'Gravity (°P)',
                          data: chart.data,
                          tension: 0.4,
                          fill: false
                        }
                      ]
                    }}
                    options={{
                      plugins: { legend: { display: false } },
                      scales: {
                        x: {
                          title: {
                            display: true,
                            text: 'Date'
                          }
                        },
                        y: {
                          title: {
                            display: true,
                            text: '°P'
                          }
                        }
                      }
                    }}
                    height={150}
                  />
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
