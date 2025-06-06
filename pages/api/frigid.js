// pages/api/frigid.js

export default async function handler(req, res) {
  try {
    const FRIGID_URL = 'https://api2.frigid.cloud/batch/list'
    const API_KEY    = 'ry4b0gkex3hzv71apg84m183g0ibm0slel3hegff'

    // Fetch directly from Frigid on the server
    const frigidRes = await fetch(FRIGID_URL, {
      headers: {
        'x-api-key': API_KEY
      }
    })

    if (!frigidRes.ok) {
      const text = await frigidRes.text()
      // Forward Frigid’s status and message if it did not return 200
      return res
        .status(frigidRes.status)
        .json({ error: `Frigid responded with ${frigidRes.status}: ${text}` })
    }

    const data = await frigidRes.json()
    // Return the raw JSON array from Frigid
    return res.status(200).json(data)
  } catch (err) {
    console.error('Error in /api/frigid:', err)
    return res
      .status(500)
      .json({ error: 'Internal server error fetching Frigid.' })
  }
}
