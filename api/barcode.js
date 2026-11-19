export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const code = String(req.query?.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Missing barcode' });

  let rawTitle = '';
  let rawBrand = '';
  let source = '';
  let imageUrl = '';

  // 1. 查詢 Rakuten 日本樂天 API（若有設定 RAKUTEN_APP_ID）
  if (process.env.RAKUTEN_APP_ID) {
    try {
      const rkUrl = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?applicationId=${process.env.RAKUTEN_APP_ID}&keyword=${encodeURIComponent(code)}&hits=1`;
      const rkRes = await fetch(rkUrl);
      if (rkRes.ok) {
        const rkData = await rkRes.json();
        if (rkData.Items && rkData.Items.length > 0) {
          const item = rkData.Items[0].Item;
          rawTitle = item.itemName || '';
          source = 'Rakuten 日本樂天';
          imageUrl = item.mediumImageUrls?.[0]?.imageUrl || '';
        }
      }
    } catch (e) {}
  }

  // 2. 查詢 JANCODE 日本條碼資料庫（45 / 49 開頭商品）
  if (!rawTitle) {
    try {
      const janRes = await fetch(`https://www.jancode.xyz/${encodeURIComponent(code)}/`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BeautyStockBot/1.0)' }
      });
      if (janRes.ok) {
        const html = await janRes.text();
        const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1] && !titleMatch[1].includes('見つかりません') && !titleMatch[1].includes('404')) {
          rawTitle = titleMatch[1].replace(/\s*[-|｜]\s*JANCODE.*$/i, '').trim();
          source = 'JANCODE 日本資料庫';
        }
      }
    } catch (e) {}
  }

  // 3. 查詢 Open Beauty Facts 國際美妝與日用品開源庫（歐美 / 國際條碼）
  if (!rawTitle) {
    try {
      const obfRes = await fetch(`https://world.openbeautyfacts.org/api/v2/product/${encodeURIComponent(code)}.json`, {
        headers: { 'User-Agent': 'BeautyStockApp/1.0' }
      });
      if (obfRes.ok) {
        const obfData = await obfRes.json();
        if (obfData.status === 1 && obfData.product) {
          const p = obfData.product;
          rawTitle = p.product_name_zh || p.product_name_en || p.product_name || '';
          rawBrand = p.brands || '';
          imageUrl = p.image_front_small_url || p.image_url || '';
          if (rawTitle) source = 'Open Beauty Facts 國際庫';
        }
      }
    } catch (e) {}
  }

  // 4. 查詢 Open Food Facts 通用日用品庫（涵蓋部分洗沐、牙膏、家用清潔品）
  if (!rawTitle) {
    try {
      const offRes = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`, {
        headers: { 'User-Agent': 'BeautyStockApp/1.0' }
      });
      if (offRes.ok) {
        const offData = await offRes.json();
        if (offData.status === 1 && offData.product) {
          const p = offData.product;
          rawTitle = p.product_name_zh || p.product_name_en || p.product_name || '';
          rawBrand = p.brands || '';
          imageUrl = p.image_front_small_url || p.image_url || '';
          if (rawTitle) source = 'Open Products 國際資料庫';
        }
      }
    } catch (e) {}
  }

  if (!rawTitle) {
    return res.status(200).json({ found: false });
  }

  // 5. 若抓到原始品名，呼叫 Gemini 進行結構化拆解與繁中正規化（去除電商雜訊字眼）
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (apiKey) {
    try {
      const prompt = `請將以下條碼查詢到的原始商品資訊整理為標準結構化 JSON（去除【送料無料】、促銷字眼、括號賣場資訊，保留品牌中英/日英對照與完整容量規格）：
原始品牌：${rawBrand || '未知'}
原始標題：${rawTitle}

嚴格只回傳純 JSON（不要加 markdown 標記）：
{
  "brand": "品牌名稱（中英或日英並列，例如 SHISEIDO 資生堂、TOKIO INKARAMI 京喚羽）",
  "name": "標準商品名稱與容量規格（繁體中文或保留經典日/英文型號）",
  "category": "只能從這三個選一個：保養品、化妝品、日用品",
  "pao": 數字（建議開封後保質期月數：6、12、18、24，無法判斷或無期限填 0）
}`;

      const aiRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        const text = aiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const cleanJson = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim());
        return res.status(200).json({
          found: true,
          source,
          rawTitle,
          imageUrl,
          structured: {
            brand: cleanJson.brand || rawBrand || '',
            name: cleanJson.name || rawTitle,
            category: cleanJson.category || '保養品',
            pao: typeof cleanJson.pao === 'number' ? cleanJson.pao : 12
          }
        });
      }
    } catch (e) {}
  }

  return res.status(200).json({
    found: true,
    source,
    rawTitle,
    imageUrl,
    structured: {
      brand: rawBrand,
      name: rawTitle,
      category: '保養品',
      pao: 12
    }
  });
}
