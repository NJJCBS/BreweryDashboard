// ─── Frigid: force any inactive tank → empty ─────────────────────────────
try {
  const resp = await fetch('/api/frigid')
  if (!resp.ok) throw new Error(`frigid status ${resp.status}`)
  const json = await resp.json()

  // 1) pick the actual array:
  const list = Array.isArray(json)
    ? json
    : json.data   // if your API returns { data: […] }
      || json.batches   // or { batches: […] }
      || []

  // 2) for each frigid item, mark map[tank].isEmpty = true if inactive
  list.forEach(item => {
    // adjust these keys to match your API:
    const tankName = item.FV || item.tank || item.fv || item.name
    const isActive = item.active !== undefined
      ? item.active
      : item.enabled    // or whichever field your API uses

    if (!tankName || !map[tankName]) return

    // if Frigid says “inactive” → empty the tile
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
