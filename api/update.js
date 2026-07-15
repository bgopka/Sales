// POST /api/update  → update a single field on the CONTACT record (the hub).
// body: { id, contactId?, field, value }  — writes target contactId (falls back to id).
import { notion } from './_notion.js';

const MAP = {
  owner:      ['Follow-up Owner', 'select'],
  phone:      ['Phone', 'phone'],
  nextStep:   ['Next Step', 'text'],
  stage:      ['Pipeline Stage', 'select'],
  sentiment:  ['Sentiment', 'select'],
  blocker:    ['Blocker', 'text'],
  note:       ['My Note', 'text'],
  engaged:    ['Engaged', 'checkbox'],
  nextMeeting:['Next Meeting', 'date'],
  trialEnds:  ['Trial Ends', 'date'],
  engineers:  ['Engineers', 'number'],
  reportsMonth:['Reports/mo', 'number'],
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { id, contactId, field, value } = req.body || {};
    const m = MAP[field];
    // These fields now live on the Contact record — always write there.
    const target = contactId || id;
    if (!target || !m) return res.status(400).json({ ok: false, error: 'unknown field or missing id' });
    const [name, kind] = m;
    let prop;
    if (kind === 'select') prop = { select: { name: value } };
    else if (kind === 'phone') prop = { phone_number: value };
    else if (kind === 'checkbox') prop = { checkbox: !!value };
    else if (kind === 'number') prop = { number: (value === '' || value == null) ? null : Number(value) };
    else if (kind === 'date') prop = { date: value ? { start: value } : null };
    else prop = { rich_text: [{ text: { content: String(value).slice(0, 1900) } }] };

    await notion('pages/' + target, { method: 'PATCH', body: JSON.stringify({ properties: { [name]: prop } }) });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
