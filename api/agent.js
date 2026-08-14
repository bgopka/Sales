// POST /api/agent  → fan-out to the n8n flows behind the cockpit's action buttons.
// Anthropic + HubSpot credentials live in n8n, so the cockpit only ever proxies.
//
//   { op:'deal-stage', contactId, email, stage }  → push Pipeline Stage to the HubSpot deal
//   { op:'readiness',  contactId, email, name }   → score + fill Client Readiness (the /customer-state save pass)
//   { op:'demoprep',   contactId, email, name }   → build the Demo Prep from the First Call row
//
// Every op returns { ok, message?, error? }. Failures are reported, never thrown, so a
// button can show "Retry" instead of the panel dying.
const HOOKS = {
  'deal-stage': process.env.DEAL_STAGE_WEBHOOK || 'https://automation.tenerapro.com/webhook/ai-deal-stage',
  'readiness':  process.env.READINESS_WEBHOOK  || 'https://automation.tenerapro.com/webhook/ai-readiness-score',
  'demoprep':   process.env.DEMOPREP_WEBHOOK   || 'https://automation.tenerapro.com/webhook/ai-demo-prep',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    const op = String(b.op || '').toLowerCase();
    const url = HOOKS[op];
    if (!url) return res.status(400).json({ ok: false, error: 'unknown op: ' + op });
    if (!b.contactId && !b.email) return res.status(400).json({ ok: false, error: 'need a contactId or an email' });

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactId: b.contactId || '',
        email: String(b.email || '').toLowerCase(),
        name: b.name || '',
        stage: b.stage || '',
      }),
    });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = null; }

    if (!r.ok) return res.status(200).json({ ok: false, error: `${op} flow returned ${r.status}`, detail: t.slice(0, 300) });
    res.status(200).json({ ok: (d && d.ok !== false), message: (d && (d.message || d.reply)) || 'done', data: d || null });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
