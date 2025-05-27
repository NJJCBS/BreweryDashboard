import { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

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
        const parseAussieDate = (dateStr) => {
          if (!dateStr) return new Date(0);
          const parts = dateStr.split(/[/\s:]+/);
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const year = parseInt(parts[2], 10);
          return new Date(year, month, day);
        };

        const platoToSG = (p) => 1.00001 + (0.0038661 * p) + (0.000013488 * p ** 2) + (0.000000043074 * p ** 3);
        const calculateLegacyABV = (OE, AE) => {
          const numerator = OE - AE;
          const denominator = 2.0665 - (0.010665 * OE);
          if (denominator === 0) return null;
          return numerator / denominator;
        };
        const calculateABVFromPlatoViaSG = (OE, AE) => {
          const OG = platoToSG(OE);
          const FG = platoToSG(AE);
          const numerator = 76.08 * (OG - FG);
          const denominator = 1.775 - OG;
          if (denominator === 0) return null;
          const abv = (numerator / denominator) * (FG / 0.794);
          return isNaN(abv) || !isFinite(abv) ? null : parseFloat(abv);
        };

        const tankMap = {};
        desiredTanks.forEach(tank => {
          const tankEntries = data.filter(entry => entry['Daily_Tank_Data.FVFerm'] === tank);
          if (tankEntries.length > 0) {
            const sortedEntries = tankEntries.sort((a, b) => parseAussieDate(b['DateFerm']) - parseAussieDate(a['DateFerm']));
            const latestEntry = sortedEntries[0];
            const batch = latestEntry['EX'];
            const sheetUrl = latestEntry['EY'];
            const stage = latestEntry['Daily_Tank_Data.What_Stage_in_the_Product_in_'] || '';

            const totalVolume = data.filter(e => e['EX'] === batch).reduce((sum, e) => sum + (parseFloat(e['Brewing_Day_Data.Volume_into_FV']) || 0), 0);
            const batchOGs = data.filter(e => e['EX'] === batch).map(e => parseFloat(e['Brewing_Day_Data.Original_Gravity'])).filter(val => !isNaN(val));
            const avgOE = batchOGs.length > 0 ? (batchOGs.reduce((sum, val) => sum + val, 0) / batchOGs.length) : NaN;
            const latestDailyTankDataEntry = sortedEntries.find(e => e['Daily_Tank_Data.GravityFerm']) || latestEntry;
            const ae = parseFloat(latestDailyTankDataEntry['Daily_Tank_Data.GravityFerm']);
            const gravity = latestDailyTankDataEntry['Daily_Tank_Data.GravityFerm'];
            const pH = latestDailyTankDataEntry['Daily_Tank_Data.pHFerm'];
            const legacyABV = calculateLegacyABV(avgOE, ae);
            const newABV = calculateABVFromPlatoViaSG(avgOE, ae);
            let weightedABV = (legacyABV + newABV) / 2;
            weightedABV = isNaN(weightedABV) || !isFinite(weightedABV) ? null : (weightedABV * 100).toFixed(1);

            const fermentationData = data.filter(e => e['Daily_Tank_Data.FVFerm'] === tank && e['Daily_Tank_Data.GravityFerm'])
              .map(e => ({ date: parseAussieDate(e['DateFerm']), gravity: parseFloat(e['Daily_Tank_Data.GravityFerm']) }))
              .filter(e => !isNaN(e.gravity))
              .sort((a, b) => a.date - b.date);
            if (!isNaN(avgOE)) {
              fermentationData.unshift({ date: parseAussieDate(fermentationData[0]?.date || new Date()), gravity: avgOE });
            }

            const carbonation = latestEntry['Daily_Tank_Data.Bright_Tank_CarbonationFerm'];
            const doxygen = latestEntry['Daily_Tank_Data.Bright_Tank_Dissolved_OxygenFerm'];
            const transferEntry = data.find(e => e['EX'] === batch && e['Transfer_Data.Final_Tank_Volume']);
            const hasPackagingEntry = data.some(e => e['EX'] === batch && e['What_are_you_filling_out_today_']?.toLowerCase().includes('packaging data'));

            tankMap[tank] = {
              tank, batch, sheetUrl, stage, gravity, pH, carbonation, doxygen, totalVolume,
              abv: weightedABV, bbtVolume: transferEntry ? transferEntry['Transfer_Data.Final_Tank_Volume'] : 'N/A',
              isEmpty: hasPackagingEntry, fermentationData
            };
          } else {
            tankMap[tank] = { tank, isEmpty: false };
          }
        });
        setTankData(desiredTanks.map(tank => tankMap[tank]));
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    fetchData();
  }, []);

  return (
    <div style={{ fontFamily: 'Calibri, sans-serif', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px', padding: '20px' }}>
      {tankData.length > 0 ? tankData.map((tank, index) => (
        <div key={index} style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '10px', background: '#f9f9f9' }}>
          <h3>{tank.tank}{tank.batch ? <> – <a href={tank.sheetUrl} target="_blank" style={{ color: '#4A90E2', textDecoration: 'none' }}>{tank.batch.substring(0, 25)}</a></> : ''}</h3>
          {tank.isEmpty ? <p><strong>Empty</strong></p> : <>
            <p><strong>Stage:</strong> {tank.stage || 'N/A'}</p>
            {tank.stage?.toLowerCase().includes('brite') ? <>
              <p><strong>Carb:</strong> {tank.carbonation ? `${parseFloat(tank.carbonation).toFixed(2)} vols` : 'N/A'}</p>
              <p><strong>D.O.:</strong> {tank.doxygen ? `${parseFloat(tank.doxygen).toFixed(1)} ppb` : 'N/A'}</p>
              <p><strong>BBT Volume:</strong> {tank.bbtVolume} L</p>
            </> : <>
              <p><strong>Gravity:</strong> {tank.gravity || 'N/A'} °P</p>
              <p><strong>pH:</strong> {tank.pH || 'N/A'} pH</p>
              <p><strong>Tank Volume:</strong> {tank.totalVolume} L</p>
            </>}
            {tank.abv && <p><strong>ABV:</strong> {tank.abv}%</p>}
            {tank.fermentationData && <Line data={{
              labels: tank.fermentationData.map(e => e.date.toLocaleDateString()),
              datasets: [{ label: 'Gravity (°P)', data: tank.fermentationData.map(e => e.gravity), fill: false, borderColor: '#4A90E2', tension: 0.1 }]
            }} options={{ responsive: true, plugins: { legend: { display: false } } }} />}
          </>}
        </div>
      )) : <p>Loading data...</p>}
    </div>
  );
}
