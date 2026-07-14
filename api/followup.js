// POST /api/followup → proxies to the n8n "AI · Propose Follow-up" flow.
// body: { contactId, email?, name? } → { ok, customer, call:[A,B], email:[A,B] }
const URL = process.env.FOLLOWUP_WEBHOOK || 'https://automation.tenerapro.com/webhook/ai-propose-followup';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    if (!b.contactId && !b.email) return res.status(400).json({ ok: false, error: 'Missing contactId or email' });
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: b.contactId || '', email: b.email || '', name: b.name || '' }),
    });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { ok: false, error: t.slice(0, 400) }; }
    if (!r.ok) return res.status(200).json({ ok: false, error: (d && (d.error || d.message)) || `Flow returned ${r.status}` });
    res.status(200).json(d);
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
