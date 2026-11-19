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

    const prompt = `你是一個專業的美妝、保養品與日用品視覺辨識助手。
【重要影像容錯指令】：
1. 照片可能因為手機拍攝角度而呈現順時針 90 度、逆時針 90 度、倒置 180 度或微幅傾斜，請先在內部自動校正文字方向後再進行閱讀，切勿因圖片旋轉而拒絕辨識或誤判。
2. 若瓶身有局部反光、曲面弧度或部分字樣被遮擋，請結合品牌標誌（Logo）、瓶身造型、容量標示（如 ml、g、mL）及常見美妝日用品命名規則推斷完整正確的品名。

請辨識這張產品包裝或瓶身照片，並嚴格只回傳純 JSON 格式（不要加 markdown 標記或任何額外說明文字），包含以下欄位：
{
  "brand": "品牌名稱（優先提供中英或日英並列，例如 Hada Labo 肌研、TOKIO INKARAMI 京喚羽、SHISEIDO 資生堂）",
  "name": "完整商品名稱與容量規格（保留繁體中文或經典日/英文型號，例如 OUTKARAMI PREMIUM AIR.TR 100ml）",
  "category": "只能從這三個選一個：保養品、化妝品、日用品",
  "pao": 數字（建議開封後保質期月數，若包裝有 6M/12M/24M 圖示請依圖示填寫，否則依品類常識填 6、12、24，無期限填 0）,
  "note": "色號、款式、香調或規格備註（若無則留空字串）"
}`;

    const models = ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-3.5-flash-lite'];
    let lastStatus = 500;
    let lastData = null;

    for (const model of models) {
      try {
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
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.2
            }
          })
        });

        const data = await response.json();
        if (response.ok) {
          const textResult = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
          const cleanJsonStr = textResult
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/, '')
            .trim();

          // 容錯擷取最外層 JSON 物件，避免前後殘留雜訊字元
          const jsonMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
          const parsedJson = JSON.parse(jsonMatch ? jsonMatch[0] : cleanJsonStr);

          const validCategories = ['保養品', '化妝品', '日用品'];
          const safeCategory = validCategories.includes(parsedJson.category) ? parsedJson.category : '保養品';
          const safePao = Number.isFinite(Number(parsedJson.pao)) ? Number(parsedJson.pao) : 12;

          return res.status(200).json({
            success: true,
            model,
            data: {
              brand: String(parsedJson.brand || '').trim(),
              name: String(parsedJson.name || '').trim(),
              category: safeCategory,
              pao: safePao,
              note: String(parsedJson.note || '').trim()
            }
          });
        }

        lastStatus = response.status;
        lastData = data;
        if (![503, 429, 404].includes(response.status)) break;
      } catch (innerErr) {
        lastData = { error: { message: innerErr.message } };
      }
    }

    return res.status(500).json({
      success: false,
      error: lastData?.error?.message || `Google API HTTP ${lastStatus}`
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
