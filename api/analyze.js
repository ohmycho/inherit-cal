// Vercel Serverless Function - 60초 타임아웃
// 파일 위치: api/analyze.js

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userPrompt, systemPrompt } = req.body;

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'messages-2023-12-15'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        stream: true,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      let errMsg = 'API Error: ' + errText.slice(0, 300);
      if (response.status === 429) errMsg = '429 사용량 초과: 잠시 후 다시 시도해 주세요.';
      else if (response.status === 503) errMsg = '503 서버 혼잡: AI 서버가 일시적으로 과부하 상태입니다.';
      else if (response.status === 401 || response.status === 403) errMsg = response.status + ' API key 오류';
      return res.status(response.status).json({ error: errMsg });
    }

    // SSE 스트림을 읽어서 텍스트 조립
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            fullText += parsed.delta.text;
          }
        } catch (e) {}
      }
    }

    return res.status(200).json({ result: fullText });

  } catch (err) {
    return res.status(500).json({ error: err.message || '알 수 없는 오류' });
  }
}
