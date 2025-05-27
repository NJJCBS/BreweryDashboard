import { useEffect, useState } from 'react';

export default function Home() {
  const [data, setData] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      const sheetId = 'YOUR_SHEET_ID'; // from Google Sheets URL
      const range = 'Sheet1!A1:E10'; // Adjust range
      const apiKey = 'YOUR_API_KEY';
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;

      const response = await fetch(url);
      const result = await response.json();
      setData(result.values || []);
    };
    fetchData();
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', padding: '20px' }}>
      {data.map((row, i) => (
        <div key={i} style={{ border: '1px solid #ccc', padding: '10px', borderRadius: '8px', background: '#f9f9f9' }}>
          {row.map((cell, j) => <div key={j}>{cell}</div>)}
        </div>
      ))}
    </div>
  );
}
