const extractInputText = (input: any): string => Array.isArray(input) ? input.map((item: any) => Array.isArray(item?.content) ? item.content.map((part: any) => part?.text || part?.input_text || '').join('\n') : item?.content || item?.text || '').join('\n') : String(input || '');
const envelope = (model: string, text: string, raw: any) => ({ id: raw?.id || `kie-${Date.now()}`, object: 'response', model, status: 'completed', output: [{ id: 'msg_kie', type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], output_text: text, usage: raw?.usage || raw?.usageMetadata });

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  const auth = req.headers.authorization || req.headers['x-kie-key'];
  const key = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  if (!key) return res.status(401).json({ errorType: 'INVALID_API_KEY', message: 'KIE API key diperlukan.' });
  const body = req.body || {}; const model = String(body.model || ''); const prompt = extractInputText(body.input);
  if (!model || !prompt) return res.status(400).json({ errorType: 'BAD_REQUEST', message: 'Model dan prompt wajib diisi.' });
  let provider = 'openai'; let endpoint = 'https://api.kie.ai/codex/v1/responses'; let payload: any = body;
  if (model.startsWith('claude-')) { provider = 'claude'; endpoint = 'https://api.kie.ai/claude/v1/messages'; payload = { model, max_tokens: 8192, stream: false, messages: [{ role: 'user', content: prompt }] }; }
  else if (model.startsWith('gemini-3.1-pro')) { provider = 'gemini-openai'; endpoint = 'https://api.kie.ai/gemini-3.1-pro/v1/chat/completions'; payload = { model, stream: false, messages: [{ role: 'user', content: prompt }], ...(body.text?.format?.schema ? { response_format: { type: 'json_schema', json_schema: { name: body.text.format.name || 'structured_output', strict: true, schema: body.text.format.schema } } } : {}) }; }
  else if (model.startsWith('gemini-')) { provider = 'gemini'; endpoint = `https://api.kie.ai/gemini/v1/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`; payload = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 8192 } }; }
  else if (!model.startsWith('gpt-')) return res.status(400).json({ errorType: 'MODEL_OR_REQUEST_UNSUPPORTED', message: `Model ${model} belum terdaftar.` });
  try {
    const upstream = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(provider === 'claude' ? { 'anthropic-version': '2023-06-01' } : {}) }, body: JSON.stringify(payload), signal: AbortSignal.timeout(120000) });
    const raw = await upstream.text(); let data: any = null; try { data = JSON.parse(raw); } catch {}
    if (!upstream.ok || (typeof data?.code === 'number' && data.code !== 200)) { const status = upstream.ok ? (data?.code || 502) : upstream.status; return res.status(status >= 400 && status <= 599 ? status : 502).json({ errorType: status === 401 ? 'INVALID_API_KEY' : status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'GATEWAY_ERROR' : 'MODEL_OR_REQUEST_UNSUPPORTED', message: data?.msg || data?.error?.message || data?.message || raw.slice(0, 1200), raw: raw.slice(0, 4000) }); }
    if (provider === 'openai') return res.status(upstream.status).send(data || raw);
    let text = '';
    if (provider === 'claude') text = (data?.content || []).filter((part: any) => part.type === 'text').map((part: any) => part.text || '').join('\n');
    else if (provider === 'gemini-openai') text = data?.choices?.[0]?.message?.content || '';
    else for (const line of raw.split(/\r?\n/)) { const t = line.trim(); if (!t.startsWith('data:')) continue; const v = t.slice(5).trim(); if (!v || v === '[DONE]') continue; try { const chunk = JSON.parse(v); text += (chunk?.candidates || []).flatMap((c: any) => c?.content?.parts || []).map((p: any) => p?.text || '').join(''); } catch {} }
    if (!text.trim()) return res.status(502).json({ errorType: 'MODEL_EMPTY_RESPONSE', message: `Model ${model} tidak mengembalikan teks.`, raw: raw.slice(0, 2000) });
    return res.status(200).json(envelope(model, text, data));
  } catch (err: any) { return res.status(err?.name === 'TimeoutError' ? 504 : 502).json({ errorType: err?.name === 'TimeoutError' ? 'GATEWAY_TIMEOUT' : 'NETWORK_ERROR', message: err?.message || 'Network failure' }); }
}
