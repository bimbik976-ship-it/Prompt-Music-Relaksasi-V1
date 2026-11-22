const GEMINI_MODELS = [
  { id: 'gemini-3.1-pro', display_name: 'Gemini 3.1 Pro' },
  { id: 'gemini-3-6-flash', display_name: 'Gemini 3.6 Flash' },
  { id: 'gemini-3-8-flash', display_name: 'Gemini 3.8 Flash' },
  { id: 'gemini-4-neon', display_name: 'Gemini 4 Neon' },
  { id: 'gemini-4-carbon', display_name: 'Gemini 4 Carbon' }
];
export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
  const auth = req.headers.authorization || '';
  const key = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  if (!key) return res.status(401).json({ message: 'KIE API key diperlukan.' });
  const headers = { Authorization: `Bearer ${key}` };
  try {
    const openaiRes = await fetch('https://api.kie.ai/openai/v1/models', { headers });
    const openai = await openaiRes.json().catch(() => ({}));
    let claudeRows: any[] = []; let afterId = ''; let claudeOk = false;
    for (let page = 0; page < 20; page++) {
      const url = new URL('https://api.kie.ai/anthropic/v1/models'); if (afterId) url.searchParams.set('after_id', afterId);
      const response = await fetch(url, { headers }); if (!response.ok) break; claudeOk = true;
      const pageData: any = await response.json().catch(() => ({})); if (Array.isArray(pageData?.data)) claudeRows.push(...pageData.data);
      if (!pageData?.has_more || !pageData?.last_id || pageData.last_id === afterId) break; afterId = pageData.last_id;
    }
    if (!openaiRes.ok && !claudeOk) return res.status(502).json({ message: 'Katalog model KIE tidak dapat diakses.' });
    const data = [
      ...(Array.isArray(openai?.models) ? openai.models.map((m: any) => ({ id: m.slug, name: m.display_name || m.slug, provider: 'OpenAI' })) : Array.isArray(openai?.data) ? openai.data.map((m: any) => ({ id: m.id, name: m.id, provider: 'OpenAI' })) : []),
      ...GEMINI_MODELS.map(m => ({ id: m.id, name: m.display_name, provider: 'Gemini' })),
      ...claudeRows.map((m: any) => ({ id: m.id, name: m.display_name || m.id, provider: 'Claude' }))
    ].filter(m => typeof m.id === 'string' && m.id);
    return res.status(200).json({ data, source: { openai: openaiRes.ok, claude: claudeOk, gemini: 'KIE documented catalog' } });
  } catch (error: any) { return res.status(502).json({ message: error?.message || 'Gagal mengambil katalog model.' }); }
}
