import { useEffect, useState } from 'react';

export default function Home() {
  const [data, setData] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      const sheetId = '1Ajtr8spY64ctRMjd6Z9mfYGTI1f0lJMgdIm8CeBnjm0';
      const range = 'Sheet1!A1:E10'; // Adjust range as needed
      const apiKey = 'AIzaSyDIcqb7GydD5J5H9O_psCdL1vmH5Lka4l8';
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;

      try {
        const response = await fetch(url);
        const result = await response.json();
        setData(result.values || []);
      } catch (error) {
        console.error('Error fetching Google Sheets data:', error);
      }
    };

    fetchData();
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', padding: '20px' }}>
      {data.length > 0 ? (
        data.map((row, index) => (
          <div key={index} style={{ border: '1px solid #ccc', padding: '10px', borderRadius: '8px', background: '#f9f9f9' }}>
            {row.map((cell, i) => (
              <div key={i}>{cell}</div>
            ))}
          </div>
        ))
      ) : (
        <p>Loading data...</p>
      )}
    </div>
  );
}
