export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const code = String(req.query?.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Missing barcode' });

  if (process.env.RAKUTEN_APP_ID) {
    try {
      const rkUrl = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?applicationId=${process.env.RAKUTEN_APP_ID}&keyword=${encodeURIComponent(code)}&hits=1`;
      const rkRes = await fetch(rkUrl);
      if (rkRes.ok) {
        const rkData = await rkRes.json();
        if (rkData.Items && rkData.Items.length > 0) {
          const item = rkData.Items[0].Item;
          return res.status(200).json({
            found: true,
            source: 'Rakuten 日本樂天',
            rawTitle: item.itemName,
            imageUrl: item.mediumImageUrls?.[0]?.imageUrl || ''
          });
        }
      }
    } catch (e) {}
  }

  try {
    const janRes = await fetch(`https://www.jancode.xyz/${encodeURIComponent(code)}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BeautyStockBot/1.0)' }
    });
    if (janRes.ok) {
      const html = await janRes.text();
      const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1] && !titleMatch[1].includes('見つかりません') && !titleMatch[1].includes('404')) {
        return res.status(200).json({
          found: true,
          source: 'JANCODE 資料庫',
          rawTitle: titleMatch[1].replace(/\s*[-|｜]\s*JANCODE.*$/i, '').trim(),
          imageUrl: ''
        });
      }
    }
  } catch (e) {}

  return res.status(200).json({ found: false });
}

