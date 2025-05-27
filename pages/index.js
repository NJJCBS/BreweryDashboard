import { useEffect, useState } from 'react';

export default function Home() {
  const [tankData, setTankData] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      const sheetId = '1Ajtr8spY64ctRMjd6Z9mfYGTI1f0lJMgdIm8CeBnjm0';
      const range = 'A1:ZZ1000'; // Adjust range as needed
      const apiKey = 'AIzaSyDIcqb7GydD5J5H9O_psCdL1vmH5Lka4l8';
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;

      try {
        const response = await fetch(url);
        const result = await response.json();
        const rows = result.values;

        if (!rows || rows.length < 2) {
          console.log('No data found.');
          return;
        }

        const headers = rows[0];
        const data = rows.slice(1).map(row => {
          const obj = {};
          headers.forEach((header, idx) => {
            obj[header] = row[idx] || '';
          });
          return obj;
        });

        // Define the tanks you want to display
        const desiredTanks = ['FV1', 'FV2', 'FV3', 'FV4', 'FV5', 'FV6', 'FV7', 'FV8', 'FV9', 'FV10', 'FVL1', 'FVL2', 'FVL3'];

        // Filter data for desired tanks only and pick the latest entry per tank
        const grouped = {};
        data.forEach(entry => {
          const tank = entry['Daily_Tank_Data.FVFerm'];
          const date = new Date(entry['DateFerm']);
          if (desiredTanks.includes(tank)) {
            if (!grouped[tank] || date > new Date(grouped[tank]['DateFerm'])) {
              grouped[tank] = entry;
            }
          }
        });

        // Ensure all desired tanks are represented (even if missing data)
        const completeData = desiredTanks.map(tank => grouped[tank] || { 'Daily_Tank_Data.FVFerm': tank });

        setTankData(completeData);

      } catch (error) {
        console.error('Error fetching Google Sheets data:', error);
      }
    };

    fetchData();
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px', padding: '20px' }}>
      {tankData.length > 0 ? (
        tankData.map((tank, index) => (
          <div key={index} style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '10px', background: '#f9f9f9' }}>
            <h3>{tank['Daily_Tank_Data.FVFerm']}</h3>
            <p>Stage: {tank['Daily_Tank_Data.What_Stage_in_the_Product_in_'] || 'N/A'}</p>
            <p>Gravity: {tank['Daily_Tank_Data.GravityFerm'] || 'N/A'} °P</p>
            <p>pH: {tank['Daily_Tank_Data.pHFerm'] || 'N/A'} pH</p>
            <p>Volume: {tank['Brewing_Day_Data.Volume_into_FV'] || tank['Transfer_Data.Final_Tank_Volume'] || 'N/A'} L</p>
          </div>
        ))
      ) : (
        <p>Loading data...</p>
      )}
    </div>
  );
}
