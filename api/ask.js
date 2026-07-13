// POST /api/ask  → proxies a natural-language question to the n8n "AI · Ask CRM" flow,
// which reads the Demos + Communications Log from Notion and answers via Anthropic.
// body: { question }   → returns { ok, answer, counts }
const ASK_URL = process.env.ASK_CRM_WEBHOOK || 'https://automation.tenerapro.com/webhook/ai-ask-crm';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const q = (req.body && (req.body.question || req.body.q) || '').toString().slice(0, 2000).trim();
    if (!q) return res.status(400).json({ ok: false, error: 'Ask a question first.' });
    const r = await fetch(ASK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q }),
    });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { ok: false, answer: t }; }
    if (!r.ok) return res.status(200).json({ ok: false, answer: '', error: (d && d.message) || `Ask flow returned ${r.status}` });
    res.status(200).json({ ok: true, answer: (d && (d.answer || d.output)) || '(no answer)', counts: d && d.counts });
  } catch (e) {
    res.status(200).json({ ok: false, answer: '', error: String(e.message || e) });
  }
}
