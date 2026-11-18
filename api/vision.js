export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'Vercel 尚未設定 GEMINI_API_KEY' });
  }

  try {
    const { imageBase64, mimeType } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: '缺少圖片資料 (imageBase64)' });
    }

    const prompt = `你是一個專業的美妝與日用品辨識助手。請辨識這張產品包裝或瓶身照片，並嚴格只回傳純 JSON 格式（不要加 markdown 標記），包含以下欄位：
{
  "brand": "品牌名稱（中英或日英並列，例如 Hada Labo 肌研、TOKIO INKARAMI 京喚羽）",
  "name": "完整商品名稱與容量規格（保留繁體中文或日文原名，例如 OUTKARAMI PREMIUM AIR.TR 100ml）",
  "category": "只能從這三個選一個：保養品、化妝品、日用品",
  "pao": 數字（建議開封後保質期月數，例如 6、12、24，若無法判斷或無期限填 0）,
  "note": "色號、款式或批號（若無則留空字串）"
}`;

    const models = ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-3.5-flash-lite'];
    let lastStatus = 500;
    let lastData = null;

    for (const model of models) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } }
            ]
          }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      const data = await response.json();
      if (response.ok) {
        const textResult = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const cleanJsonStr = textResult.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        const parsedJson = JSON.parse(cleanJsonStr);
        return res.status(200).json({ success: true, model, data: parsedJson });
      }

      lastStatus = response.status;
      lastData = data;
      if (![503, 429, 404].includes(response.status)) break;
    }

    return res.status(500).json({
      success: false,
      error: lastData?.error?.message || `Google API HTTP ${lastStatus}`
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

