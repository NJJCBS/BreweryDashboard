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
        if (!rows || rows.length < 2) return;

        const headers = rows[0];
        const data = rows.slice(1).map(row => {
          const obj = {};
          headers.forEach((h, i) => (obj[h] = row[i] || ''));
          return obj;
        });

        const desiredTanks = [
          'FV1','FV2','FV3','FV4','FV5','FV6','FV7',
          'FV8','FV9','FV10','FVL1','FVL2','FVL3'
        ];

        const parseAussieDate = ds => {
          if (!ds) return new Date(0);
          const [d,m,y] = ds.split(/[/\s:]+/).map((v,i) => i<3 ? +v : null);
          return new Date(y, m-1, d);
        };

        const platoToSG = p =>
          1.00001 +
          0.0038661 * p +
          0.000013488 * p * p +
          0.000000043074 * p * p * p;

        const calcLegacy = (OE, AE) => {
          const num = OE - AE;
          const den = 2.0665 - 0.010665 * OE;
          if (!den) return null;
          return num / den; // e.g. 4.26
        };

        const calcNew = (OE, AE) => {
          const OG = platoToSG(OE);
          const FG = platoToSG(AE);
          const num = 76.08 * (OG - FG);
          const den = 1.775 - OG;
          if (!den) return null;
          const abv = (num / den) * (FG / 0.794);
          return isFinite(abv) ? abv : null;
        };

        const map = {};
        desiredTanks.forEach(tank => {
          const entries = data.filter(e => e['Daily_Tank_Data.FVFerm'] === tank);
          if (!entries.length) {
            map[tank] = { tank, isEmpty: false };
            return;
          }

          const sorted = entries.sort(
            (a,b) =>
              parseAussieDate(b['DateFerm']) -
              parseAussieDate(a['DateFerm'])
          );
          const latest = sorted[0];
          const batch = latest['EX'];
          const sheetUrl = latest['EY'];
          const stage = latest['Daily_Tank_Data.What_Stage_in_the_Product_in_'] || '';

          // Total volume in batch
          const totalVol = data
            .filter(e => e['EX'] === batch)
            .reduce(
              (sum,e) =>
                sum + (parseFloat(e['Brewing_Day_Data.Volume_into_FV']) || 0),
              0
            );

          // Avg OE
          const OEs = data
            .filter(e => e['EX'] === batch)
            .map(e => parseFloat(e['Brewing_Day_Data.Original_Gravity']))
            .filter(v => !isNaN(v));
          const avgOE = OEs.length
            ? OEs.reduce((a,b) => a+b,0)/OEs.length
            : NaN;

          // AE from latest tank data
          const latestTank = sorted.find(
            e =>
              e['Daily_Tank_Data.GravityFerm'] ||
              e['Daily_Tank_Data.pHFerm']
          ) || latest;
          const ae = parseFloat(latestTank['Daily_Tank_Data.GravityFerm']);

          // Calculate ABVs
          const leg = calcLegacy(avgOE, ae);
          const neu = calcNew(avgOE, ae);
          const avgABV =
            leg !== null && neu !== null
              ? ((leg + neu) / 2).toFixed(1)
              : null;

          // Bright tank volume
          const transfer = data.find(
            e =>
              e['EX'] === batch &&
              e['Transfer_Data.Final_Tank_Volume']
          );
          const bbtVol = transfer
            ? transfer['Transfer_Data.Final_Tank_Volume']
            : 'N/A';

          const carb = latest['Daily_Tank_Data.Bright_Tank_CarbonationFerm'];
          const dox = latest['Daily_Tank_Data.Bright_Tank_Dissolved_OxygenFerm'];
          const hasPack = data.some(
            e =>
              e['EX'] === batch &&
              e['What_are_you_filling_out_today_']
                .toLowerCase()
                .includes('packaging data')
          );

          map[tank] = {
            tank,
            batch,
            sheetUrl,
            stage,
            gravity: latestTank['Daily_Tank_Data.GravityFerm'],
            pH: latestTank['Daily_Tank_Data.pHFerm'],
            carbonation: carb,
            doxygen: dox,
            totalVolume: totalVol,
            avgABV,
            bbtVolume: bbtVol,
            isEmpty: hasPack
          };
        });

        setTankData(desiredTanks.map(t => map[t]));
      } catch (e) {
        console.error(e);
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
        tankData.map((t, i) => {
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
            avgABV,
            bbtVolume,
            isEmpty
          } = t;
          const isBrite = stage.toLowerCase().includes('brite');
          const isFerment =
            /fermentation|crashed|d\.h|clean fusion/i.test(stage);

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

                  {avgABV && (
                    <p>
                      <strong>ABV:</strong> {avgABV}%  
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
