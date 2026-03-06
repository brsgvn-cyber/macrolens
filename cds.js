// api/cds.js
// Türkiye CDS verisi - worldgovernmentbonds.com scraping proxy
// Cache: 24 saat (günlük)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // worldgovernmentbonds.com - Turkey CDS sayfası
    const url = 'http://www.worldgovernmentbonds.com/cds-historical-data/turkey/5-years/';
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Referer': 'http://www.worldgovernmentbonds.com/'
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    
    // CDS değerini HTML'den parse et
    // worldgovernmentbonds.com tablodaki güncel CDS bps değeri
    let cdsValue = null;
    let cdsDate = null;

    // Farklı pattern'leri dene
    const patterns = [
      /(\d{1,4}(?:\.\d+)?)\s*bps/i,
      /CDS[^0-9]*(\d{1,4}(?:\.\d+)?)/i,
      /"value"[^0-9]*(\d{1,4}(?:\.\d+)?)/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const val = parseFloat(match[1]);
        if (val > 50 && val < 2000) { // Mantıklı CDS aralığı
          cdsValue = val;
          break;
        }
      }
    }

    // Tarihi parse et
    const dateMatch = html.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) cdsDate = dateMatch[1];

    // CDS'i yüzdeye çevir (bps / 100)
    const cdsPercent = cdsValue ? (cdsValue / 100) : null;

    const payload = {
      timestamp: new Date().toISOString(),
      source: 'worldgovernmentbonds.com',
      turkey_cds_5y: {
        label: 'Türkiye 5Y CDS',
        value_bps: cdsValue,
        value_pct: cdsPercent,
        date: cdsDate,
        unit: 'bps',
        note: 'Carry Trade hesabında % olarak kullanılır'
      }
    };

    // Parse başarısızsa fallback
    if (!cdsValue) {
      payload.turkey_cds_5y.value_bps = 280; // yaklaşık güncel değer
      payload.turkey_cds_5y.value_pct = 2.80;
      payload.turkey_cds_5y.note = 'Fallback değer - scraping başarısız';
      payload.warning = 'HTML parse edilemedi, fallback değer kullanıldı';
    }

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
    return res.status(200).json(payload);

  } catch (err) {
    console.error('cds.js error:', err.message);
    // Hata durumunda fallback
    return res.status(200).json({
      timestamp: new Date().toISOString(),
      source: 'fallback',
      turkey_cds_5y: {
        label: 'Türkiye 5Y CDS',
        value_bps: 280,
        value_pct: 2.80,
        date: new Date().toISOString().split('T')[0],
        unit: 'bps',
        note: 'Fallback değer'
      },
      error: err.message
    });
  }
}
