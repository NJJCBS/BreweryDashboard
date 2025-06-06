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
// Apps Script Web App URL (runs pullRecentSheets on the Master sheet)
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
  const parseDate = (ds) => {
    if (!ds) return new Date(0)
    const [d, m, y] = ds.split(/[/\s:]+/).map((v, i) => (i < 3 ? +v : null))
    return new Date(y, m - 1, d)
  }
  const platoToSG = (p) =>
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
    const OG = platoToSG(OE),
      FG = platoToSG(AE)
    const num = 76.08 * (OG - FG),
      den = 1.775 - OG
    if (!den) return null
    const abv = (num / den) * (FG / 0.794)
    return isFinite(abv) ? abv : null
  }

  // ─── Core: Fetch the dashboard data (Sheets + Frigid), but NO Apps Script call here ────
  const fetchDashboardData = useCallback(async () => {
    try {
      // 1) Fetch “Master Dashboard Data” via Google Sheets API
      const sheetId = '1Ajtr8spY64ctRMjd6Z9mfYGTI1f0lJMgdIm8CeBnjm0'
      const range = 'A1:ZZ1000'
      const apiKey = 'AIzaSyDIcqb7GydD5J5H9O_psCdL1vmH5Lka4l8'
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`

      const res = await fetch(url)
      if (!res.ok) {
        const text = await res.text()
        console.error('Sheets API responded with error', res.status, text)
        throw new Error('Error fetching sheet data')
      }
      const json = await res.json()
      const rows = json.values
      if (!rows || rows.length < 2) {
        console.error('Sheets returned too few rows.')
        throw new Error('No data in Sheets')
      }

      // Map rows to objects
      const headers = rows[0]
      const all = rows.slice(1).map((r) => {
        const o = {}
        headers.forEach((h, i) => (o[h] = r[i] || ''))
        return o
      })

      // Assemble per‐tank data
      const tanks = [
        'FV1','FV2','FV3','FV4','FV5','FV6','FV7',
        'FV8','FV9','FV10','FVL1','FVL2','FVL3'
      ]
      const map = {}

      // Prebuild a Frigid temperature map so we can attach .temperature/.setPoint later
      let tempMap = {}
      try {
        const frigidProxy = await fetch('/api/frigid')
        if (frigidProxy.ok) {
          const frigidJson = await frigidProxy.json()
          frigidJson.forEach((item) => {
            if (item.tank) {
              let sp = item.setPoint
              try {
                const parsed = JSON.parse(item.setPoint)
                if (parsed.value !== undefined) sp = parseFloat(parsed.value)
              } catch {
                sp = parseFloat(item.setPoint)
              }
              const spNum = isFinite(parseFloat(sp)) ? parseFloat(sp) : null
              tempMap[item.tank] = {
                temperature: parseFloat(item.temperature),
                setPoint: spNum
              }
            }
          })
        }
      } catch {
        // ignore Frigid errors here; we’ll attach nulls if missing
      }

      tanks.forEach((name) => {
        // 1) Check for “Packaging Data”
        const ferRows = all.filter((e) => e['Daily_Tank_Data.FVFerm'] === name)
        const packaging = ferRows.find((e) =>
          e['What_are_you_filling_out_today_']
            .toLowerCase()
            .includes('packaging data')
        )

        if (packaging) {
          // Before marking empty, check for a “split” transfer row
          const transferRows = all
            .filter(
              (e) =>
                e['What_are_you_filling_out_today_']
                  .toLowerCase()
                  .includes('transfer data') &&
                e['Transfer_Data.BTTrans'] === name
            )
            .map((e) => ({ ...e, d: parseDate(e.DateFerm) }))

          if (transferRows.length) {
            // Pick the most recent transfer row
            transferRows.sort((a, b) => b.d - a.d)
            const latestTrans = transferRows[0]
            // If its EX (file name) contains “split”
            if (
              latestTrans.EX &&
              latestTrans.EX.toLowerCase().includes('split')
            ) {
              map[name] = {
                tank: name,
                batch: latestTrans.EX,
                sheetUrl: latestTrans.EY || '',
                stage: latestTrans['What_are_you_filling_out_today_'],
                isEmpty: false,
                baseAvgOE: null,
                history: [],
                brewFallbackPH: null,
                pHValue: null,
                bbtVol:
                  parseFloat(latestTrans['Transfer_Data.Final_Tank_Volume']) ||
                  0,
                carb: latestTrans['Transfer_Data.Final_Tank_CO2_Carbonation'],
                dox: latestTrans['Transfer_Data.Final_Tank_Dissolved_Oxygen'],
                totalVolume:
                  parseFloat(latestTrans['Transfer_Data.Final_Tank_Volume']) ||
                  0,
                temperature: tempMap[name]?.temperature || null,
                setPoint: tempMap[name]?.setPoint || null,
                lastUpdate: latestTrans.d
              }
              return
            }
          }
          // Otherwise, truly empty
          map[name] = makeEmptyEntry(name, parseDate(packaging.DateFerm))
          return
        }

        // 2) Brewing‐day entries
        const brewRows = all
          .filter(
            (e) =>
              e['What_are_you_filling_out_today_']
                .toLowerCase()
                .includes('brewing day data') &&
              e['Brewing_Day_Data.FV_Tank'] === name
          )
          .map((e) => ({ ...e, d: parseDate(e.DateFerm) }))

        console.log(
          `>>> brewRows for tank ${name}:`,
          brewRows.map((r) => ({
            batch: r.EX,
            date: r.DateFerm,
            volume: r['Brewing_Day_Data.Volume_into_FV']
          }))
        )

        let brewFallbackPH = null
        if (brewRows.length) {
          brewRows.sort((a, b) => b.d - a.d)
          brewFallbackPH =
            parseFloat(brewRows[0]['Brewing_Day_Data.Final_FV_pH']) || null
        }

        // 3) Transfer‐data entries
        const xferRows = all
          .filter(
            (e) =>
              e['What_are_you_filling_out_today_']
                .toLowerCase()
                .includes('transfer data') &&
              e['Transfer_Data.BTTrans'] === name
          )
          .map((e) => ({ ...e, d: parseDate(e.DateFerm) }))

        // 4) Pick newest overall (fermentation, brewing, or transfer)
        const ferRowsForSort = all
          .filter((e) => e['Daily_Tank_Data.FVFerm'] === name)
          .map((e) => ({ ...e, _type: 'fer', d: parseDate(e.DateFerm) }))

        const brewRowsForSort = brewRows.map((e) => ({ ...e, _type: 'brew' }))
        const xferRowsForSort = xferRows.map((e) => ({ ...e, _type: 'xfer' }))

        const candidates = [
          ...ferRowsForSort,
          ...brewRowsForSort,
          ...xferRowsForSort
        ]

        if (!candidates.length) {
          map[name] = makeEmptyEntry(name)
          return
        }
        candidates.sort((a, b) => b.d - a.d)
        const rec = candidates[0]
        const batch = rec.EX
        const sheetUrl = rec.EY || ''
        const lastUpdate = rec.d

        // ─── Secondary Packaging Check ───────────────────────────────────
        const packagingForBatch = all.find(
          (e) =>
            e.EX === batch &&
            e['What_are_you_filling_out_today_']
              .toLowerCase()
              .includes('packaging data')
        )
        if (packagingForBatch) {
          map[name] = makeEmptyEntry(
            name,
            parseDate(packagingForBatch.DateFerm)
          )
          return
        }
        // ───────────────────────────────────────────────────────────────

        // Build gravity history & baseAvgOE
        const history = all
          .filter((e) => e.EX === batch && e['Daily_Tank_Data.GravityFerm'])
          .map((e) => ({
            date: parseDate(e['DateFerm']),
            g: parseFloat(e['Daily_Tank_Data.GravityFerm'])
          }))
          .filter((h) => !isNaN(h.g))
          .sort((a, b) => a.date - b.date)

        const OEs = all
          .filter(
            (e) => e.EX === batch && e['Brewing_Day_Data.Original_Gravity']
          )
          .map((e) => parseFloat(e['Brewing_Day_Data.Original_Gravity']))
          .filter((v) => !isNaN(v))
        const baseAvgOE = OEs.length
          ? OEs.reduce((a, b) => a + b, 0) / OEs.length
          : null

        // Build pH history
        const pHHistory = all
          .filter((e) => e.EX === batch && e['Daily_Tank_Data.pHFerm'])
          .map((e) => ({
            date: parseDate(e['DateFerm']),
            p: parseFloat(e['Daily_Tank_Data.pHFerm'])
          }))
          .filter((h) => !isNaN(h.p))
          .sort((a, b) => a.date - b.date)
        const lastPH = pHHistory.length
          ? pHHistory[pHHistory.length - 1].p
          : null

        // Defaults
        let stage = ''
        let pHValue = null
        let carb = null,
          dox = null
        let bbtVol = null
        let totalVolume = 0

        // a) Transfer data → “Brite”
        if (rec._type === 'xfer') {
          stage = 'Brite'
          carb = rec['Transfer_Data.Final_Tank_CO2_Carbonation'] || ''
          dox = rec['Transfer_Data.Final_Tank_Dissolved_Oxygen'] || ''
          bbtVol = rec['Transfer_Data.Final_Tank_Volume'] || ''
          totalVolume = parseFloat(bbtVol) || 0
        }
        // b) Brewing day
        else if (rec._type === 'brew') {
          stage = 'Brewing Day Data'
          const brewRowsForBatch = brewRows.filter((e) => e.EX === batch)
          totalVolume = brewRowsForBatch.reduce(
            (sum, e) =>
              sum + (parseFloat(e['Brewing_Day_Data.Volume_into_FV']) || 0),
            0
          )
          pHValue = brewFallbackPH
        }
        // c) Fermentation / daily / crashed / D.H.
        else {
          const raw =
            rec['Daily_Tank_Data.What_Stage_in_the_Product_in_'] || ''
          stage = raw
          pHValue = lastPH !== null ? lastPH : brewFallbackPH

          if (raw.toLowerCase().includes('brite')) {
            carb = rec['Daily_Tank_Data.Bright_Tank_CarbonationFerm'] || ''
            dox = rec['Daily_Tank_Data.Bright_Tank_Dissolved_OxygenFerm'] || ''
            const t = all.find(
              (e) => e.EX === batch && e['Transfer_Data.Final_Tank_Volume']
            )
            bbtVol = t ? t['Transfer_Data.Final_Tank_Volume'] : ''
            totalVolume = parseFloat(bbtVol) || 0
          } else {
            totalVolume = all
              .filter((e) => e.EX === batch)
              .reduce(
                (s, e) =>
                  s + (parseFloat(e['Brewing_Day_Data.Volume_into_FV']) || 0),
                0
              )
          }
        }

        // Initially attach null temperature / setPoint
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
          temperature: tempMap[name]?.temperature || null,
          setPoint: tempMap[name]?.setPoint || null,
          lastUpdate
        }
      })

      // ─── Remove duplicate batches ────────────────────────────────────────
      const byBatch = {}
      Object.values(map).forEach((e) => {
        if (e.batch) {
          byBatch[e.batch] = byBatch[e.batch] || []
          byBatch[e.batch].push(e)
        }
      })
      Object.values(byBatch).forEach((group) => {
        if (group.length > 1) {
          group.sort((a, b) => b.lastUpdate - a.lastUpdate)
          group.slice(1).forEach((e) => {
            map[e.tank] = makeEmptyEntry(e.tank, e.lastUpdate)
          })
        }
      })

      setTankData(Object.values(map))
      setError(false)

      // init controls once
      setDexCounts((dc) =>
        Object.keys(dc).length
          ? dc
          : tanks.reduce((o, t) => ({ ...o, [t]: 0 }), {})
      )
      setFruitInputs((fi) =>
        Object.keys(fi).length
          ? fi
          : tanks.reduce((o, t) => ({ ...o, [t]: '' }), {})
      )
      setFruitVolumes((fv) =>
        Object.keys(fv).length
          ? fv
          : tanks.reduce((o, t) => ({ ...o, [t]: 0 }), {})
      )
    } catch (e) {
      console.error('❌ fetchDashboardData() caught:', e)
      setError(true)
    }
  }, [])

  // ─── “Refresh” button handler: call Apps Script first, then update dashboard ───
  const handleRefreshClick = async () => {
    try {
      // 1) Trigger Apps Script to rebuild Master sheet
      const scriptRes = await fetch(APPS_SCRIPT_URL)
      if (!scriptRes.ok) {
        const body = await scriptRes.text()
        console.error('Apps Script Web App failed:', scriptRes.status, body)
        throw new Error('Failed to refresh Master sheet via Apps Script')
      }
      const scriptJson = await scriptRes.json()
      if (scriptJson.status !== 'ok') {
        console.error('Apps Script returned error:', scriptJson)
        throw new Error('Apps Script error: ' + scriptJson.message)
      }
      // 2) Once Master sheet is updated, fetch dashboard data
      await fetchDashboardData()
    } catch (e) {
      console.error('❌ handleRefreshClick() caught:', e)
      setError(true)
    }
  }

  // ─── On mount: fetch full dashboard data once ───────────────────────────────
  useEffect(() => {
    fetchDashboardData()
    // 3-hour auto-refresh but only for dashboard data (no Apps Script)
    const id = setInterval(fetchDashboardData, 3 * 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchDashboardData])

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleAddDex = (tank) =>
    setDexCounts((d) => ({ ...d, [tank]: d[tank] + 1 }))
  const handleClear = (tank) => {
    setDexCounts((d) => ({ ...d, [tank]: 0 }))
    setFruitVolumes((fv) => ({ ...fv, [tank]: 0 }))
    setFruitInputs((fi) => ({ ...fi, [tank]: '' }))
    setTankData((td) =>
      td.map((e) => (e.tank === tank ? makeEmptyEntry(tank) : e))
    )
  }
  const handleFruitChange = (t, v) =>
    setFruitInputs((fi) => ({ ...fi, [t]: v }))
  const handleAddFruit = (tank) => {
    const v = parseFloat(fruitInputs[tank])
    if (!v || isNaN(v)) return
    setFruitVolumes((fv) => ({ ...fv, [tank]: fv[tank] + v }))
    setFruitInputs((fi) => ({ ...fi, [tank]: '' }))
  }

  if (error)
    return (
      <p style={{ padding: 20, fontFamily: 'Calibri' }}>
        ⚠️ Error loading data.
      </p>
    )
  if (!tankData.length)
    return (
      <p style={{ padding: 20, fontFamily: 'Calibri' }}>Loading…</p>
    )

  // ─── Summary ───────────────────────────────────────────────────────────────
  const totalTanks = tankData.length
  const emptyCount = tankData.filter((e) => e.isEmpty).length
  const occupiedCount = totalTanks - emptyCount
  const totalVol = tankData
    .filter((e) => !e.isEmpty)
    .reduce((sum, e) => sum + (e.totalVolume || 0), 0)
  const totalVolStr = totalVol.toLocaleString('en-AU')

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
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            style={{
              position: 'relative',
              background: '#fff',
              padding: 20,
              borderRadius: 8,
              maxWidth: '90%',
              maxHeight: '90%',
              overflow: 'auto'
            }}
          >
            <button
              onClick={() => setModalChart(null)}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                background: 'transparent',
                border: 'none',
                fontSize: 16,
                cursor: 'pointer'
              }}
            >
              ✕
            </button>
            <Line
              data={{
                labels: modalChart.labels,
                datasets: [
                  {
                    label: 'Gravity (°P)',
                    data: modalChart.data,
                    tension: 0.4,
                    fill: false
                  }
                ]
              }}
              options={{
                aspectRatio: 2,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => `${ctx.parsed.y.toFixed(1)} °P`
                    }
                  }
                },
                scales: {
                  x: {
                    title: { display: true, text: 'Date' },
                    grid: { display: true }
                  },
                  y: {
                    beginAtZero: true,
                    min: 0,
                    title: { display: true, text: 'Gravity (°P)' },
                    ticks: { callback: (v) => v.toFixed(1) }
                  }
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Dashboard grid */}
      <div
        style={{
          fontFamily: 'Calibri, sans-serif',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))',
          gap: '20px',
          padding: '20px'
        }}
      >
        {tankData.map((e) => {
          const {
            tank,
            batch,
            sheetUrl,
            stage,
            isEmpty,
            baseAvgOE,
            history,
            brewFallbackPH,
            pHValue,
            bbtVol,
            carb,
            dox,
            totalVolume,
            temperature,
            setPoint
          } = e

          // ABV
          const dex = dexCounts[tank] || 0
          const HL = (totalVolume || 0) / 1000
          const incOE =
            baseAvgOE !== null
              ? baseAvgOE + (HL > 0 ? (1.3 / HL) * dex : 0)
              : null
          const curAE = history.length ? history[history.length - 1].g : null
          const displayAE = curAE !== null ? curAE : baseAvgOE
          const leg =
            incOE !== null && displayAE !== null
              ? calcLegacy(incOE, displayAE)
              : null
          const neu =
            incOE !== null && displayAE !== null
              ? calcNew(incOE, displayAE)
              : null
          const dexABV =
            leg !== null && neu !== null ? ((leg + neu) / 2).toFixed(1) : null

          // fruit & volume
          const fv = fruitVolumes[tank] || 0
          const eff = fv * 0.9
          const baseV = stage.toLowerCase().includes('brite')
            ? parseFloat(bbtVol) || 0
            : totalVolume || 0
          const dispV = baseV + eff
          const finalABV =
            dexABV !== null
              ? ((dexABV / 100) * baseV / dispV) * 100
              : null

          // mini-chart
          const labels =
            incOE !== null
              ? ['OG', ...history.map((h) => h.date.toLocaleDateString('en-AU'))]
              : history.map((h) => h.date.toLocaleDateString('en-AU'))
          const pts =
            incOE !== null ? [incOE, ...history.map((h) => h.g)] : history.map((h) => h.g)

          // styling
          const style = { ...baseTile }
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
            style.background = '#f0f0f0'
            style.border = '1px solid darkgrey'
          } else {
            style.border = '1px solid #ccc'
          }

          const volLabel = s.includes('brite') ? 'BBT Vol:' : 'Tank Vol:'

          return (
            <div
              key={tank}
              style={style}
              onMouseEnter={(e) =>
                (e.currentTarget.style.transform = 'translateY(-4px)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.transform = 'translateY(0)')
              }
            >
              {/* small clear‐tile button */}
              <button
                onClick={() => handleClear(tank)}
                style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  background: 'transparent',
                  border: 'none',
                  fontSize: '8px',
                  cursor: 'pointer'
                }}
              >
                ❌
              </button>

              <h3 style={{ marginTop: 0 }}>
                {tank}
                {batch && (
                  <>
                    {' – '}
                    <a
                      href={sheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#4A90E2', textDecoration: 'none' }}
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

                  {s.includes('brite') ? (
                    <>
                      <p>
                        <strong>Carb:</strong>{' '}
                        {carb ? `${parseFloat(carb).toFixed(2)} vols` : ''}
                      </p>
                      <p>
                        <strong>D.O.:</strong>{' '}
                        {dox ? `${parseFloat(dox).toFixed(1)} ppb` : ''}
                      </p>
                    </>
                  ) : s === 'brewing day data' ? (
                    <>
                      <p>
                        <strong>Gravity:</strong>{' '}
                        {baseAvgOE != null
                          ? `${baseAvgOE.toFixed(1)} °P`
                          : ''}
                      </p>
                      {brewFallbackPH != null && (
                        <p>
                          <strong>pH:</strong> {brewFallbackPH.toFixed(1)} pH
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p>
                        <strong>Gravity:</strong>{' '}
                        {displayAE != null
                          ? `${displayAE.toFixed(1)} °P`
                          : ''}
                      </p>
                      {pHValue != null && (
                        <p>
                          <strong>pH:</strong> {pHValue.toFixed(1)} pH
                        </p>
                      )}
                    </>
                  )}

                  <p>
                    <strong>{volLabel}</strong> {dispV.toFixed(1)} L
                  </p>
                  {finalABV !== null && (
                    <p>
                      <strong>ABV:</strong> {finalABV.toFixed(1)}%
                    </p>
                  )}

                  {/* ─── Display Actual Temp and Set ───────────────────────────── */}
                  {typeof temperature === 'number' &&
                    typeof setPoint === 'number' && (
                      <p>
                        <a
                          href="https://app.frigid.cloud/app/dashboard"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontWeight: 'bold',
                            color: 'black',
                            textDecoration: 'none'
                          }}
                        >
                          Actual Temp:
                        </a>{' '}
                        {temperature.toFixed(1)}°C{'  '}
                        <a
                          href="https://app.frigid.cloud/app/dashboard"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontWeight: 'bold',
                            color: 'black',
                            textDecoration: 'none'
                          }}
                        >
                          Set:
                        </a>{' '}
                        {setPoint.toFixed(1)}°C
                      </p>
                    )}
                  {/* ───────────────────────────────────────────────────────────── */}

                  {/* Controls: Add Dex, count, trash, fruit, + */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginTop: '8px'
                    }}
                  >
                    <button
                      onClick={() => handleAddDex(tank)}
                      style={{
                        height: '28px',
                        minWidth: '60px',  
                        fontSize: '12px',
                        padding: '0 4px'
                      }}
                    >
                      Add Dex
                    </button>
                    <span
                      style={{
                        display: 'inline-block',
                        height: '28px',
                        minWidth: '24px',
                        lineHeight: '28px',
                        textAlign: 'center',
                        fontSize: '12px'
                      }}
                    >
                      {dexCounts[tank] || 0}
                    </span>
                    <button
                      onClick={() => {
                        setDexCounts((dc) => ({ ...dc, [tank]: 0 }))
                        setFruitVolumes((fv) => ({ ...fv, [tank]: 0 }))
                      }}
                      style={{
                        height: '28px',
                        width: '28px',
                        background: 'transparent',
                        border: 'none',
                        fontSize: '14px',
                        cursor: 'pointer'
                      }}
                    >
                      🗑️
                    </button>
                    <input
                      type="text"
                      placeholder="fruit"
                      value={fruitInputs[tank] || ''}
                      onChange={(e) =>
                        handleFruitChange(tank, e.target.value)
                      }
                      style={{
                        height: '28px',
                        width: '50px',
                        fontSize: '12px',
                        padding: '0 4px'
                      }}
                    />
                    <button
                      onClick={() => handleAddFruit(tank)}
                      style={{
                        height: '28px',
                        width: '28px',
                        fontSize: '12px',
                        padding: '0'
                      }}
                    >
                      +
                    </button>
                  </div>

                  {/* Mini chart */}
                  {pts.length > 1 && (
                    <Line
                      data={{
                        labels,
                        datasets: [
                          {
                            label: 'Gravity (°P)',
                            data: pts,
                            tension: 0.4,
                            fill: false
                          }
                        ]
                      }}
                      options={{
                        aspectRatio: 2,
                        plugins: {
                          legend: { display: false },
                          tooltip: {
                            callbacks: {
                              label: (ctx) => `${ctx.parsed.y.toFixed(1)} °P`
                            }
                          }
                        },
                        scales: {
                          x: { ticks: { display: false }, grid: { display: true } },
                          y: {
                            beginAtZero: true,
                            min: 0,
                            max: pts[0],
                            ticks: { callback: (v) => v.toFixed(1) }
                          }
                        }
                      }}
                      height={150}
                      onClick={() => setModalChart({ labels, data: pts })}
                    />
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Summary */}
      <div
        style={{
          fontFamily: 'Calibri, sans-serif',
          padding: '0 20px 10px'
        }}
      >
        <p>
          Empty tanks: {emptyCount}/{totalTanks}
        </p>
        <p>
          Occupied tanks: {occupiedCount}/{totalTanks}
        </p>
        <p>Total volume on site: {totalVolStr} L</p>
      </div>

      {/* Refresh Button */}
      <div style={{ textAlign: 'center', padding: '10px 0 20px' }}>
        <button
          onClick={handleRefreshClick}
          style={{
            fontSize: '16px',
            padding: '10px 20px',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Refresh
        </button>
      </div>
    </>
  )
}
