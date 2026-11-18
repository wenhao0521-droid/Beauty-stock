export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'Vercel 尚未設定 GEMINI_API_KEY 環境變數' });
  }

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
          contents: [{ parts: [{ text: '回覆 OK 兩個字即可' }] }]
        })
      });
      const data = await response.json();
      if (response.ok) {
        return res.status(200).json({
          ok: true,
          region: process.env.VERCEL_REGION || 'iad1',
          usedModel: model,
          keyPrefix: apiKey.slice(0, 6) + '...',
          googleResponse: data
        });
      }
      lastStatus = response.status;
      lastData = data;
      if (![503, 429, 404].includes(response.status)) break;
    } catch (e) {
      lastData = { error: { message: e.message } };
    }
  }

  return res.status(lastStatus).json({ ok: false, status: lastStatus, googleResponse: lastData });
}

