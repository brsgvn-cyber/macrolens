// api/tcmb.js
// TCMB (Türkiye Cumhuriyet Merkez Bankası) veri proxy
// Politika faizi, enflasyon beklentisi, döviz kurları
// Cache: 24 saat

// TCMB EVDS API - Ücretsiz, kayıt gerektirmez
const TCMB_BASE = 'https://evds2.tcmb.gov.tr/service/evds';

// TCMB EVDS seri kodları
const TCMB_SERIES = {
  policy_rate:    'TP.MB.C13',        // TCMB Politika Faizi (haftalık repo)
  usdtry_tcmb:    'TP.DK.USD.A.YTL', // TCMB USD/TRY gösterge kuru
  eurtry_tcmb:    'TP.DK.EUR.A.YTL', // TCMB EUR/TRY gösterge kuru
  inflation_exp:  'TP.BEKLENTI2.G6',  // 12 Ay sonrası TÜFE beklentisi
  cpi_turkey:     'TP.FG.J0',         // TÜFE (genel)
};

async function fetchTCMB(seriesKey, seriesCode) {
  // Son 3 ayın verisi
  const today = new Date();
  const startDate = new Date(today);
  startDate.setMonth(startDate.getMonth() - 3);
  
  const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
  
  const url = `${TCMB_BASE}/series=${seriesCode}&startDate=${fmt(startDate)}&endDate=${fmt(today)}&type=json`;
  
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' }
  });
  
  if (!res.ok) throw new Error(`TCMB HTTP ${res.status} for ${seriesCode}`);
  const data = await res.json();
  return data?.items || [];
}

// TCMB Beklenti Anketi - XML endpoint
async function fetchBeklentiAnketi() {
  const url = 'https://www.tcmb.gov.tr/wps/wcm/connect/tcmb+tr/tcmb+tr/main+menu/istatistikler/beklenti+anketi/beklenti+anketi+verileri';
  // Fallback: EVDS'den çek
  const res = await fetch(`${TCMB_BASE}/series=TP.BEKLENTI2.G6,TP.BEKLENTI2.G7&startDate=01-01-2024&endDate=31-12-2025&type=json`);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.items || [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const results = await Promise.allSettled([
      fetchTCMB('policy_rate', TCMB_SERIES.policy_rate),
      fetchTCMB('inflation_exp', TCMB_SERIES.inflation_exp),
      fetchTCMB('cpi_turkey', TCMB_SERIES.cpi_turkey),
    ]);

    // Politika faizi
    const policyItems = results[0].status === 'fulfilled' ? results[0].value : [];
    const latestPolicy = policyItems.length > 0 ? policyItems[policyItems.length - 1] : null;
    
    // Enflasyon beklentisi
    const expItems = results[1].status === 'fulfilled' ? results[1].value : [];
    const latestExp = expItems.length > 0 ? expItems[expItems.length - 1] : null;

    // Türkiye CPI
    const cpiItems = results[2].status === 'fulfilled' ? results[2].value : [];
    const latestCpi = cpiItems.length > 0 ? cpiItems[cpiItems.length - 1] : null;

    const payload = {
      timestamp: new Date().toISOString(),
      source: 'TCMB EVDS',
      policy_rate: {
        label: 'TCMB Politika Faizi (Haftalık Repo)',
        value: latestPolicy ? parseFloat(Object.values(latestPolicy).find(v => !isNaN(parseFloat(v)))) : null,
        date: latestPolicy?.Tarih || null,
        unit: '%',
        note: 'Merkez Bankası 1 haftalık repo faizi'
      },
      inflation_expectation_12m: {
        label: '12 Aylık TÜFE Beklentisi (Beklenti Anketi)',
        value: latestExp ? parseFloat(Object.values(latestExp).find(v => !isNaN(parseFloat(v)))) : null,
        date: latestExp?.Tarih || null,
        unit: '%',
        note: 'TCMB Beklenti Anketi - Piyasa katılımcıları beklentisi'
      },
      cpi_turkey: {
        label: 'Türkiye TÜFE',
        value: latestCpi ? parseFloat(Object.values(latestCpi).find(v => !isNaN(parseFloat(v)))) : null,
        date: latestCpi?.Tarih || null,
        unit: '%'
      },
      // Carry Trade Net Reel Getiri — TL 2Y Bono - CDS - 12A Enf. Beklentisi
      // (TL 2Y Bono ve CDS market.js + worldgovbonds.js'den gelecek)
      carry_trade_inputs: {
        inflation_expectation: latestExp ? parseFloat(Object.values(latestExp).find(v => !isNaN(parseFloat(v)))) : null,
        note: 'Carry = TL 2Y Bono − CDS − Bu değer'
      }
    };

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
    return res.status(200).json(payload);

  } catch (err) {
    console.error('tcmb.js error:', err.message);
    return res.status(500).json({ 
      error: err.message,
      fallback: {
        policy_rate: { value: 47.5, label: 'TCMB Politika Faizi', unit: '%', note: 'Fallback değer' },
        inflation_expectation_12m: { value: 28.0, unit: '%', note: 'Fallback değer' }
      }
    });
  }
}
