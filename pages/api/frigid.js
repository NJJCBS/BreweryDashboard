// pages/api/frigid.js

export default async function handler(req, res) {
  try {
    const FRIGID_URL = 'https://api2.frigid.cloud/batch/list';
    const API_KEY    = 'ry4b0gkex3hzv71apg84m183g0ibm0slel3hegff'; 
    const frigidRes  = await fetch(FRIGID_URL, {
      headers: {
        'x-api-key': API_KEY
      }
    });

    if (!frigidRes.ok) {
      // If Frigid returns a non-2xx, forward the status/ message
      const text = await frigidRes.text();
      return res
        .status(frigidRes.status)
        .json({ error: `Frigid responded with ${frigidRes.status}: ${text}` });
    }

    const data = await frigidRes.json();
    // Simply echo back the JSON array from Frigid
    return res.status(200).json(data);
  } catch (err) {
    console.error('Error in /api/frigid:', err);
    return res.status(500).json({ error: 'Internal server error fetching Frigid.' });
  }
}

