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

        const desiredTanks = [
          'FV1','FV2','FV3','FV4','FV5','FV6','FV7',
          'FV8','FV9','FV10','FVL1','FVL2','FVL3'
        ];

        const parseAussieDate = dateStr => {
          if (!dateStr) return new Date(0);
          const parts = dateStr.split(/[/\s:]+/);
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const year = parseInt(parts[2], 10);
          return new Date(year, month, day);
        };

        const platoToSG = p =>
          1.00001 +
          0.0038661 * p +
          0.000013488 * p * p +
          0.000000043074 * p * p * p;

        // Legacy formula now returns a percentage directly
        const calculateLegacyABV = (OE, AE) => {
          const numerator = OE - AE;
          const denominator = 2.0665 - 0.010665 * OE;
          if (denominator === 0) return null;
          return numerator / denominator; // e.g. 4.26 for 4.26%
        };

        const calculateABVFromPlatoViaSG = (OE, AE) => {
          const OG = platoToSG(OE);
          const FG = platoToSG(AE);
          const numerator = 76.08 * (OG - FG);
          const denominator = 1.775 - OG;
          if (denominator === 0) return null;
          const abv = (numerator / denominator) * (FG / 0.794);
          return isNaN(abv) || !isFinite(abv) ? null : abv; // e.g. 4.57
        };

        const tankMap = {};

        desiredTanks.forEach(tank => {
          const entries = data.filter(e => e['Daily_Tank_Data.FVFerm'] === tank);
          if (entries.length > 0) {
            const sorted = entries.sort(
              (a, b) =>
                parseAussieDate(b['DateFerm']) -
                parseAussieDate(a['DateFerm'])
            );
            const latest = sorted[0];
            const batch = latest['EX'];
            const sheetUrl = latest['EY'];
            const stage = latest['Daily_Tank_Data.What_Stage_in_the_Product_in_'] || '';

            // Total volume for this batch
            const totalVolume = data
              .filter(e => e['EX'] === batch)
              .reduce(
                (sum, e) =>
                  sum + (parseFloat(e['Brewing_Day_Data.Volume_into_FV']) || 0),
                0
              );

            // Average original extract (OE) for batch
            const batchOGs = data
              .filter(e => e['EX'] === batch)
              .map(e => parseFloat(e['Brewing_Day_Data.Original_Gravity']))
              .filter(v => !isNaN(v));
            const avgOE = batchOGs.length
              ? batchOGs.reduce((a, b) => a + b, 0) / batchOGs.length
              : NaN;

            // Latest actual extract (AE)
            const latestTankData =
              sorted.find(
                e =>
                  e['Daily_Tank_Data.GravityFerm'] ||
                  e['Daily_Tank_Data.pHFerm']
              ) || latest;
            const ae = parseFloat(
              latestTankData['Daily_Tank_Data.GravityFerm']
            );
            const gravity = latestTankData['Daily_Tank_Data.GravityFerm'];
            const pH = latestTankData['Daily_Tank_Data.pHFerm'];

            // Calculate ABVs
            const legacyABVDecimal = calculateLegacyABV(avgOE, ae);
            const legacyABV =
              legacyABVDecimal !== null
                ? legacyABVDecimal.toFixed(1)
                : null;
            const newABV = calculateABVFromPlatoViaSG(avgOE, ae);
            let avgABV = null;
            if (
              legacyABVDecimal !== null &&
              newABV !== null &&
              !isNaN(newABV)
            ) {
              avgABV = ((legacyABVDecimal + newABV) / 2).toFixed(1);
            }

            // Bright tank volume
            const transfer = data.find(
              e =>
                e['EX'] === batch &&
                e['Transfer_Data.Final_Tank_Volume']
            );
            const bbtVolume = transfer
              ? transfer['Transfer_Data.Final_Tank_Volume']
              : 'N/A';

            const carbonation =
              latest['Daily_Tank_Data.Bright_Tank_CarbonationFerm'];
            const doxygen =
              latest['Daily_Tank_Data.Bright_Tank_Dissolved_OxygenFerm'];

            const hasPackaging = data.some(
              e =>
                e['EX'] === batch &&
                e['What_are_you_filling_out_today_'] &&
                e['What_are_you_filling_out_today_']
                  .toLowerCase()
                  .includes('packaging data')
            );

            tankMap[tank] = {
              tank,
              batch,
              sheetUrl,
              stage,
              gravity,
              pH,
              carbonation,
              doxygen,
              totalVolume,
              legacyABV,
              newABV: newABV !== null ? newABV.toFixed(1) : null,
              avgABV,
              bbtVolume,
              isEmpty: hasPackaging
            };
          } else {
            tankMap[tank] = {
              tank,
              batch: '',
              sheetUrl: '',
              stage: '',
              gravity: '',
              pH: '',
              carbonation: '',
              doxygen: '',
              totalVolume: 0,
              legacyABV: null,
              newABV: null,
              avgABV: null,
              bbtVolume: 'N/A',
              isEmpty: false
            };
          }
        });

        setTankData(desiredTanks.map(t => tankMap[t]));
      } catch (error) {
        console.error('Error fetching Google Sheets data:', error);
      }
    };

    fetchData();
  }, []);

  return (
    <div
      style={{
        fontFamily: 'Calibri, sans-serif',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
        gap: '20px',
        padding: '20px'
      }}
    >
      {tankData.length > 0 ? (
        tankData.map((tank, i) => {
          const {
            tank: name,
            stage,
            carbonation,
            doxygen,
            gravity,
            pH,
            batch,
            sheetUrl,
            totalVolume,
            legacyABV,
            newABV,
            avgABV,
            bbtVolume,
            isEmpty
          } = tank;
          const isBrite = stage.toLowerCase().includes('brite');
          const isFerment = /fermentation|crashed|d\.h|clean fusion/i.test(
            stage
          );

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

                  {isBrite ? (
                    <>
                      <p>
                        <strong>Carb:</strong>{' '}
                        {carbonation
                          ? `${parseFloat(carbonation).toFixed(2)} vols`
                          : 'N/A'}
                      </p>
                      <p>
                        <strong>D.O.:</strong>{' '}
                        {doxygen
                          ? `${parseFloat(doxygen).toFixed(1)} ppb`
                          : 'N/A'}
                      </p>
                      <p>
                        <strong>BBT Volume:</strong> {bbtVolume} L
                      </p>
                    </>
                  ) : isFerment ? (
                    <>
                      <p>
                        <strong>Gravity:</strong> {gravity || 'N/A'} °P
                      </p>
                      <p>
                        <strong>pH:</strong> {pH || 'N/A'} pH
                      </p>
                      <p>
                        <strong>Tank Volume:</strong> {totalVolume} L
                      </p>
                    </>
                  ) : (
                    <p>No Data</p>
                  )}

                  {legacyABV && (
                    <p>
                      <strong>Legacy ABV:</strong> {legacyABV}%  
                    </p>
                  )}
                  {newABV && (
                    <p>
                      <strong>New ABV:</strong> {newABV}%  
                    </p>
                  )}
                  {avgABV && (
                    <p>
                      <strong>Average ABV:</strong> {avgABV}%  
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })
      ) : (
        <p>Loading data...</p>
      )}
    </div>
  );
}
