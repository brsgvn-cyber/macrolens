// api/fred.js
// FRED (Federal Reserve Economic Data) proxy
// ABD makro verileri: İşsizlik, CPI, Fed Faizi, GDP
// Cache: 24 saat (günlük güncelleme)

const FRED_API_KEY = process.env.FRED_API_KEY || '734d52ec5c8ce81b4c2555c48c4c910f';
const BASE = 'https://api.stlouisfed.org/fred/series/observations';

const SERIES = [
  { key: 'unemployment',  id: 'UNRATE',    label: 'ABD İşsizlik Oranı',     unit: '%'  },
  { key: 'cpi',           id: 'CPIAUCSL',  label: 'ABD CPI (YoY)',           unit: '%'  },
  { key: 'fed_rate',      id: 'FEDFUNDS',  label: 'Fed Faiz Oranı',          unit: '%'  },
  { key: 'gdp_growth',    id: 'A191RL1Q225SBEA', label: 'ABD GDP Büyüme',   unit: '%'  },
  { key: 'us_10y',        id: 'GS10',      label: 'ABD 10Y Tahvil',          unit: '%'  },
  { key: 'us_2y',         id: 'GS2',       label: 'ABD 2Y Tahvil',           unit: '%'  },
  { key: 'us_3m',         id: 'TB3MS',     label: 'ABD 3M Hazine',           unit: '%'  },
  { key: 'core_cpi',      id: 'CPILFESL',  label: 'ABD Çekirdek CPI',        unit: '%'  },
  { key: 'ppi',           id: 'PPIACO',    label: 'ABD PPI',                 unit: 'idx'},
];

async function fetchSeries(seriesId) {
  const url = `${BASE}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=13`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED HTTP ${res.status} for ${seriesId}`);
  const data = await res.json();
  const obs = (data.observations || []).filter(o => o.value !== '.');
  return obs;
}

function calcYoY(obs) {
  if (obs.length < 13) return null;
  const latest = parseFloat(obs[0].value);
  const yearAgo = parseFloat(obs[12].value);
  return ((latest - yearAgo) / yearAgo * 100).toFixed(2);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const results = await Promise.allSettled(
      SERIES.map(async (s) => {
        const obs = await fetchSeries(s.id);
        const latest = obs[0] || null;
        const prev = obs[1] || null;
        
        let yoy = null;
        if (['cpi', 'core_cpi', 'ppi'].includes(s.key)) {
          yoy = calcYoY(obs);
        }

        return {
          key: s.key,
          label: s.label,
          unit: s.unit,
          value: latest ? parseFloat(latest.value) : null,
          prevValue: prev ? parseFloat(prev.value) : null,
          date: latest?.date || null,
          yoy: yoy,
          history: obs.slice(0, 13).reverse().map(o => ({
            date: o.date,
            value: parseFloat(o.value)
          }))
        };
      })
    );

    const payload = {
      timestamp: new Date().toISOString(),
      data: {}
    };

    SERIES.forEach((s, i) => {
      if (results[i].status === 'fulfilled') {
        payload.data[s.key] = results[i].value;
      } else {
        payload.data[s.key] = { key: s.key, label: s.label, error: results[i].reason?.message };
      }
    });

    // Yield curve spread hesapla
    const y10 = payload.data.us_10y?.value;
    const y2  = payload.data.us_2y?.value;
    if (y10 && y2) {
      payload.data.yield_spread = {
        key: 'yield_spread',
        label: '10Y-2Y Spread',
        value: parseFloat((y10 - y2).toFixed(2)),
        unit: '%',
        signal: (y10 - y2) > 0 ? 'Normal' : 'Ters (Resesyon Sinyali)'
      };
    }

    // 24 saat cache
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
    return res.status(200).json(payload);

  } catch (err) {
    console.error('fred.js error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
