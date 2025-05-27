import { useEffect, useState } from 'react';

export default function Home() {
  const [tankData, setTankData] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      const sheetId = '1Ajtr8spY64ctRMjd6Z9mfYGTI1f0lJMgdIm8CeBnjm0';
      const range = 'A1:ZZ1000';
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

        const desiredTanks = ['FV1', 'FV2', 'FV3', 'FV4', 'FV5', 'FV6', 'FV7', 'FV8', 'FV9', 'FV10', 'FVL1', 'FVL2', 'FVL3'];
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Remove time

        const parseAussieDate = (dateStr) => {
          if (!dateStr) return new Date(0);
          const parts = dateStr.split(/[/\s:]+/);
          // DD/MM/YYYY or DD/MM/YYYY HH:MM:SS
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
          const year = parseInt(parts[2], 10);
          return new Date(year, month, day);
        };

        const tankMap = {};

        desiredTanks.forEach(tank => {
          const tankEntries = data.filter(entry => entry['Daily_Tank_Data.FVFerm'] === tank);

          if (tankEntries.length > 0) {
            const sortedEntries = tankEntries.sort((a, b) => parseAussieDate(b['DateFerm']) - parseAussieDate(a['DateFerm']));

            const todayEntry = sortedEntries.find(entry => {
              const entryDate = parseAussieDate(entry['DateFerm']);
              return entryDate.getTime() === today.getTime();
            });

            const chosenEntry = todayEntry || sortedEntries[0];

            const batch = chosenEntry['EX'];
            const totalVolume = data
              .filter(e => e['EX'] === batch)
              .reduce((sum, e) => sum + (parseFloat(e['Brewing_Day_Data.Volume_into_FV']) || 0), 0);

            tankMap[tank] = { ...chosenEntry, totalBatchVolume: totalVolume };
          } else {
            tankMap[tank] = { 'Daily_Tank_Data.FVFerm': tank, totalBatchVolume: 0 };
          }
        });

        const finalData = desiredTanks.map(tank => tankMap[tank]);

        setTankData(finalData);

      } catch (error) {
        console.error('Error fetching Google Sheets data:', error);
      }
    };

    fetchData();
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px', padding: '20px' }}>
      {tankData.length > 0 ? (
        tankData.map((tank, index) => {
          const stage = tank['Daily_Tank_Data.What_Stage_in_the_Product_in_'];
          const carbonation = tank['Daily_Tank_Data.Bright_Tank_CarbonationFerm'];
          const doxygen = tank['Daily_Tank_Data.Bright_Tank_Dissolved_OxygenFerm'];
          const gravity = tank['Daily_Tank_Data.GravityFerm'];
          const pH = tank['Daily_Tank_Data.pHFerm'];
          const isBrite = stage && stage.toLowerCase().includes('brite');

          return (
            <div key={index} style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '10px', background: '#f9f9f9' }}>
              <h3>
                {tank['Daily_Tank_Data.FVFerm']}
                {tank['EX'] ? ` – ${tank['EX'].substring(0, 25)}` : ''}
              </h3>
              <p>Stage: {stage || 'N/A'}</p>
              {isBrite ? (
                <>
                  <p>Carbonation: {carbonation ? `${parseFloat(carbonation).toFixed(2)} vols` : 'N/A'}</p>
                  <p>Dissolved Oxygen: {doxygen ? `${parseFloat(doxygen).toFixed(1)} ppb` : 'N/A'}</p>
                </>
              ) : (
                <>
                  <p>Gravity: {gravity || 'N/A'} °P</p>
                  <p>pH: {pH || 'N/A'} pH</p>
                </>
              )}
              <p>Total Batch Volume: {tank.totalBatchVolume} L</p>
            </div>
          );
        })
      ) : (
        <p>Loading data...</p>
      )}
    </div>
  );
}
