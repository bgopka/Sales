// POST /api/intake  → the "New contact" chat. Proxies to the n8n "AI · Contact Intake" flow,
// which runs the extraction (Anthropic lives in n8n, same pattern as /api/ask and /api/chat).
//
// body: {
//   message:     "what Boris typed / pasted",
//   attachments: [{ name, type, data }]      // data = base64 (no data: prefix), pdf/docx/png/jpg
//   fields:      { ...whatever is already filled in the form... },
//   history:     [{ role:'user'|'assistant', text }]
// }
// returns: {
//   ok, fields:{...merged...}, missing:[...], question:"the one thing to ask next",
//   reply:"what to show in the chat", confidence:{field:0..1}
// }
//
// The flow NEVER writes to Notion — it only extracts and asks. /api/contact does the writing,
// so Boris always sees the parsed fields before anything is created.
const INTAKE_URL = process.env.INTAKE_WEBHOOK || 'https://automation.tenerapro.com/webhook/ai-contact-intake';

// what a contact needs before it is worth creating
const REQUIRED = ['firstName', 'lastName', 'email', 'phone', 'company'];
const LABEL = {
  firstName: 'first name', lastName: 'last name', email: 'email address',
  phone: 'phone number', company: 'company name', jobTitle: 'job title',
};

const MAX_ATTACH_MB = 8;

function localGaps(fields) {
  const f = fields || {};
  return REQUIRED.filter(k => !String(f[k] || '').trim());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    const message = String(b.message || '').slice(0, 20000);
    const fields = (b.fields && typeof b.fields === 'object') ? b.fields : {};
    const history = Array.isArray(b.history) ? b.history.slice(-12) : [];
    const attachments = (Array.isArray(b.attachments) ? b.attachments : [])
      .slice(0, 6)
      .map(a => ({ name: String(a.name || 'file').slice(0, 120), type: String(a.type || ''), data: a.data || '' }))
      .filter(a => a.data);

    const bytes = attachments.reduce((n, a) => n + Math.ceil(String(a.data).length * 0.75), 0);
    if (bytes > MAX_ATTACH_MB * 1024 * 1024) {
      return res.status(200).json({
        ok: false, fields, missing: localGaps(fields),
        reply: `Those attachments come to more than ${MAX_ATTACH_MB} MB — send them one at a time, or paste the key details as text.`,
      });
    }
    if (!message && !attachments.length) {
      return res.status(400).json({ ok: false, error: 'Nothing to read — type something or attach a file.' });
    }

    const r = await fetch(INTAKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, fields, history, attachments, required: REQUIRED }),
    });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = null; }

    // Flow not built / not active yet → degrade to manual entry instead of breaking the panel.
    if (!r.ok || !d) {
      return res.status(200).json({
        ok: false, fields, missing: localGaps(fields),
        reply: 'The intake reader is not answering right now — fill the fields on the left and save; nothing is lost.',
        error: `intake flow returned ${r.status}`,
      });
    }

    const merged = { ...fields, ...(d.fields || {}) };
    const missing = Array.isArray(d.missing) && d.missing.length ? d.missing : localGaps(merged);
    // Ask for one gap at a time — a wall of questions gets ignored.
    const question = d.question || (missing.length ? `What is the ${LABEL[missing[0]] || missing[0]}?` : '');

    res.status(200).json({
      ok: true,
      fields: merged,
      missing,
      question,
      reply: d.reply || d.answer || question || 'Got it.',
      confidence: d.confidence || {},
    });
  } catch (e) {
    res.status(200).json({
      ok: false, fields: (req.body && req.body.fields) || {},
      reply: 'Could not reach the intake reader — fill the fields manually and save.',
      error: String(e.message || e),
    });
  }
}
