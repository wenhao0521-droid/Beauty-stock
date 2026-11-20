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

    const prompt = `辨識圖片中的美妝、保養或日用品包裝（若圖片旋轉請自動校正方向閱讀），只回傳純 JSON：
{
  "brand": "品牌名稱（優先中英或日英並列，如 Hada Labo 肌研）",
  "name": "完整品名與容量（如 2% BHA Body Treatment 210ml）",
  "category": "僅限：保養品、化妝品、日用品",
  "pao": 數字（開封保質月數，依圖示或常識填 6、12、24，無期限填 0）,
  "note": "色號、款式或規格備註（無則留空）"
}`;

    // 使用速度最快的 Flash-Lite 作為首選，避免無效模型重試浪費時間
    const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
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
              temperature: 0.1,
              maxOutputTokens: 256,
              thinkingConfig: {
                thinkingBudget: 0
              }
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
