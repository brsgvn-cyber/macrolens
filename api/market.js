// api/market.js
// Vercel Serverless Function
// Yahoo Finance'dan FX ve emtia verilerini çeker
// Cache: 5 dakika (300 saniye)

const SYMBOLS = {
  fx: [
    { key: 'USDTRY', symbol: 'USDTRY=X', label: 'USD/TRY' },
    { key: 'EURTRY', symbol: 'EURTRY=X', label: 'EUR/TRY' },
    { key: 'EURUSD', symbol: 'EURUSD=X', label: 'EUR/USD' },
  ],
  bonds: [
    { key: 'TR2Y',   symbol: 'TR2YT=RR', label: 'TL 2Y Bono' },
    { key: 'US10Y',  symbol: '^TNX',      label: 'ABD 10Y' },
    { key: 'US2Y',   symbol: '^IRX',      label: 'ABD 2Y (13W proxy)' },
  ],
  commodities: [
    { key: 'GOLD',   symbol: 'GC=F',  label: 'Altın (XAU/USD)' },
    { key: 'BRENT',  symbol: 'BZ=F',  label: 'Brent Ham Petrol' },
    { key: 'WTI',    symbol: 'CL=F',  label: 'WTI Ham Petrol' },
    { key: 'NATGAS', symbol: 'NG=F',  label: 'Doğalgaz' },
    { key: 'SILVER', symbol: 'SI=F',  label: 'Gümüş' },
  ]
};

async function fetchYahoo(symbols) {
  const joined = symbols.join(',');
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com/',
  };

  // query2 dene
  const res = await fetch(
    `https://query2.finance.yahoo.com/v8/finance/quote?symbols=${joined}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketChange,regularMarketPreviousClose`,
    { headers }
  );

  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
  const data = await res.json();
  return data?.quoteResponse?.result || [];
}
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const allSymbols = [
      ...SYMBOLS.fx.map(s => s.symbol),
      ...SYMBOLS.bonds.map(s => s.symbol),
      ...SYMBOLS.commodities.map(s => s.symbol),
    ];

    const quotes = await fetchYahoo(allSymbols);
    const quoteMap = {};
    quotes.forEach(q => { quoteMap[q.symbol] = q; });

    const buildGroup = (group) => {
      return group.map(item => {
        const q = quoteMap[item.symbol];
        return {
          key: item.key,
          label: item.label,
          symbol: item.symbol,
          price: q?.regularMarketPrice ?? null,
          change: q?.regularMarketChange ?? null,
          changePct: q?.regularMarketChangePercent ?? null,
          prevClose: q?.regularMarketPreviousClose ?? null,
        };
      });
    };

    const payload = {
      timestamp: new Date().toISOString(),
      fx: buildGroup(SYMBOLS.fx),
      bonds: buildGroup(SYMBOLS.bonds),
      commodities: buildGroup(SYMBOLS.commodities),
    };

    // Cache 5 dakika
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(payload);

  } catch (err) {
    console.error('market.js error:', err.message);
    return res.status(500).json({ error: err.message, timestamp: new Date().toISOString() });
  }
}
