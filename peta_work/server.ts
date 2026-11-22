import express from 'express';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

// Allowed gateway IDs only
// Model validation is provider-aware in the unified chat proxy.

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * Test KIE API Key endpoint & Credit balance
 * Uses GET https://api.kie.ai/api/v1/chat/credit
 */
const handleCreditCheck = async (req: express.Request, res: express.Response) => {
  const authHeader = req.headers['authorization'] || req.headers['x-kie-key'];
  const key = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';

  if (!key) {
    return res.status(401).json({
      valid: false,
      errorType: 'INVALID_API_KEY',
      status: 401,
      message: 'No KIE API Key provided in request.'
    });
  }

  try {
    const upstreamRes = await fetch('https://api.kie.ai/api/v1/chat/credit', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key}`
      }
    });

    const status = upstreamRes.status;
    const responseText = await upstreamRes.text();
    let data: any = {};
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { msg: responseText };
    }

    const code = typeof data?.code === 'number' ? data.code : status;

    if (code === 401 || status === 401) {
      return res.status(401).json({
        valid: false,
        status: 401,
        errorType: 'INVALID_API_KEY',
        message: data?.msg || 'Invalid KIE API key or unauthorized.'
      });
    }

    if (code === 403 || status === 403) {
      return res.status(403).json({
        valid: false,
        status: 403,
        errorType: 'FORBIDDEN',
        message: data?.msg || 'Forbidden.'
      });
    }

    if (code === 404 || status === 404) {
      return res.status(404).json({
        valid: false,
        status: 404,
        errorType: 'ENDPOINT_NOT_FOUND',
        message: 'KIE endpoint tidak ditemukan.'
      });
    }

    if (code === 429 || status === 429) {
      return res.status(429).json({
        valid: false,
        status: 429,
        errorType: 'RATE_LIMITED',
        message: data?.msg || 'Rate limit exceeded on this key.'
      });
    }

    const gatewayBalance = typeof data?.data === 'number' ? data.data : (typeof data?.credit === 'number' ? data.credit : null);

    return res.json({
      valid: upstreamRes.ok && code === 200,
      status: code,
      gatewayBalance,
      message: data?.msg || (upstreamRes.ok ? 'Key verified successfully' : 'Upstream returned status ' + status)
    });
  } catch (err: any) {
    return res.status(502).json({
      valid: false,
      status: 502,
      errorType: 'NETWORK_ERROR',
      message: 'Network error communicating with KIE Gateway: ' + (err.message || 'Unknown network error')
    });
  }
};

app.post('/api/kie/test', handleCreditCheck);
app.get('/api/kie/test', handleCreditCheck);
app.get('/api/kie/credit', handleCreditCheck);

/** Unified KIE chat proxy. Incoming browser payload remains Responses-shaped;
 * provider-specific wire formats are translated server-side. */
const extractInputText = (input: any): string => {
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) return '';
  return input.map((item: any) => {
    if (typeof item === 'string') return item;
    if (Array.isArray(item?.content)) return item.content.map((part: any) => part?.text || part?.input_text || '').join('\n');
    return item?.content || item?.text || '';
  }).join('\n');
};

const toResponsesEnvelope = (model: string, text: string, raw: any) => ({
  id: raw?.id || `kie-${Date.now()}`,
  object: 'response',
  model,
  status: 'completed',
  output: [{ id: 'msg_kie', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: text || '' }] }],
  output_text: text || '',
  usage: raw?.usage || raw?.usageMetadata || undefined
});

async function handleKieUnified(req: any, res: any) {
  const authHeader = req.headers['authorization'] || req.headers['x-kie-key'];
  const key = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
  if (!key) return res.status(401).json({ errorType: 'INVALID_API_KEY', httpStatus: 401, message: 'KIE API key diperlukan.' });

  const body = req.body || {};
  const model = String(body.model || '');
  const prompt = extractInputText(body.input);
  if (!model || !prompt) return res.status(400).json({ errorType: 'BAD_REQUEST', httpStatus: 400, message: 'Model dan input prompt wajib diisi.' });

  let endpoint = 'https://api.kie.ai/codex/v1/responses';
  let payload: any = body;
  let provider: 'openai' | 'claude' | 'gemini' = 'openai';

  if (model.startsWith('claude-')) {
    provider = 'claude';
    endpoint = 'https://api.kie.ai/claude/v1/messages';
    payload = { model, max_tokens: 8192, stream: false, messages: [{ role: 'user', content: prompt }] };
  } else if (model.startsWith('gemini-3.1-pro')) {
    provider = 'gemini';
    endpoint = 'https://api.kie.ai/gemini-3.1-pro/v1/chat/completions';
    payload = { model, stream: false, messages: [{ role: 'user', content: prompt }], ...(body.text?.format?.schema ? { response_format: { type: 'json_schema', json_schema: { name: body.text.format.name || 'structured_output', strict: true, schema: body.text.format.schema } } } : {}) };
  } else if (model.startsWith('gemini-')) {
    provider = 'gemini';
    endpoint = `https://api.kie.ai/gemini/v1/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    payload = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 8192 } };
  } else if (!model.startsWith('gpt-')) {
    return res.status(400).json({ errorType: 'MODEL_OR_REQUEST_UNSUPPORTED', httpStatus: 400, message: `Model ${model} belum terdaftar pada konfigurasi aplikasi.` });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    let upstream: Response;
    try {
      upstream = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(provider === 'claude' ? { 'anthropic-version': '2023-06-01' } : {}) },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally { clearTimeout(timeout); }

    const rawText = await upstream.text();
    let data: any = null;
    try { data = JSON.parse(rawText); } catch {}
    if (!upstream.ok || (typeof data?.code === 'number' && data.code !== 200)) {
      const status = upstream.ok ? (data?.code || 502) : upstream.status;
      return res.status(status >= 400 && status <= 599 ? status : 502).json({ errorType: status === 401 ? 'INVALID_API_KEY' : status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'GATEWAY_ERROR' : 'MODEL_OR_REQUEST_UNSUPPORTED', httpStatus: status, message: data?.msg || data?.error?.message || data?.message || rawText.slice(0, 1200) || `KIE request failed (${status})`, raw: rawText.slice(0, 4000) });
    }

    let text = '';
    if (provider === 'claude') {
      text = (data?.content || []).filter((part: any) => part.type === 'text').map((part: any) => part.text || '').join('\n');
    } else if (provider === 'gemini' && model.startsWith('gemini-3.1-pro')) {
      text = data?.choices?.[0]?.message?.content || '';
    } else if (provider === 'gemini') {
      // KIE native Gemini streaming chunks; aggregate candidate text parts.
      for (const line of rawText.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const chunkText = trimmed.slice(5).trim();
        if (!chunkText || chunkText === '[DONE]') continue;
        try {
          const chunk = JSON.parse(chunkText);
          text += (chunk?.candidates || []).flatMap((candidate: any) => candidate?.content?.parts || []).map((part: any) => part?.text || '').join('');
        } catch {}
      }
    } else {
      // Preserve the OpenAI Responses payload and response shape for existing GPT models.
      if (data) return res.status(upstream.status).json(data);
      return res.status(upstream.status).send(rawText);
    }
    if (!text.trim()) return res.status(502).json({ errorType: 'MODEL_EMPTY_RESPONSE', httpStatus: 502, message: `Model ${model} tidak mengembalikan teks.`, raw: rawText.slice(0, 2000) });
    return res.status(200).json(toResponsesEnvelope(model, text, data));
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return res.status(aborted ? 504 : 502).json({ errorType: aborted ? 'GATEWAY_TIMEOUT' : 'NETWORK_ERROR', httpStatus: aborted ? 504 : 502, message: aborted ? 'KIE Gateway timeout.' : `Network failure: ${err?.message || 'unknown error'}` });
  }
}

app.get('/api/kie/models', async (req, res) => {
  const auth = req.headers.authorization || '';
  const key = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  if (!key) return res.status(401).json({ message: 'KIE API key diperlukan.' });
  try {
    const openaiRes = await fetch('https://api.kie.ai/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    const openai = await openaiRes.json().catch(() => ({}));
    let claudeRows: any[] = []; let afterId = '';
    let claudeOk = false;
    for (let page = 0; page < 20; page++) {
      const url = new URL('https://api.kie.ai/anthropic/v1/models');
      if (afterId) url.searchParams.set('after_id', afterId);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!response.ok) break;
      claudeOk = true;
      const pageData: any = await response.json().catch(() => ({}));
      if (Array.isArray(pageData?.data)) claudeRows.push(...pageData.data);
      if (!pageData?.has_more || !pageData?.last_id || pageData.last_id === afterId) break;
      afterId = pageData.last_id;
    }
    const gemini = [
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' }, { id: 'gemini-3-6-flash', name: 'Gemini 3.6 Flash' },
      { id: 'gemini-3-8-flash', name: 'Gemini 3.8 Flash' }, { id: 'gemini-4-neon', name: 'Gemini 4 Neon' }, { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }
    ].map(m => ({ ...m, provider: 'Gemini' }));
    const data = [
      ...(Array.isArray(openai?.models) ? openai.models.map((m: any) => ({ id: m.slug, name: m.display_name || m.slug, provider: 'OpenAI' })) : Array.isArray(openai?.data) ? openai.data.map((m: any) => ({ id: m.id, name: m.id, provider: 'OpenAI' })) : []),
      ...gemini,
      ...claudeRows.map((m: any) => ({ id: m.id, name: m.display_name || m.id, provider: 'Claude' }))
    ].filter((m: any) => typeof m.id === 'string' && m.id);
    res.json({ data, source: { openai: openaiRes.ok, claude: claudeOk, gemini: 'KIE documented catalog' } });
  } catch (error: any) { res.status(502).json({ message: error?.message || 'Gagal mengambil katalog model.' }); }
});

app.post('/api/kie/responses', handleKieUnified);
app.post('/codex/v1/responses', handleKieUnified);

async function startServer() {
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    Boolean(process.argv[1]?.endsWith('server.cjs'));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[PETA PIANO AI] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
