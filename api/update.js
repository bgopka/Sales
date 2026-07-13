// POST /api/update  → update a single field on the Customer Profile (and Contact where relevant).
// body: { id: <profile page id>, contactId?, field, value }
import { notion } from './_notion.js';

const MAP = {
  owner:      ['Owner', 'select'],
  phone:      ['Phone', 'phone'],
  nextStep:   ['Next Step', 'text'],
  stage:      ['Pipeline Stage', 'select'],
  sentiment:  ['Sentiment', 'select'],
  blocker:    ['Blocker', 'text'],
  note:       ['My Note', 'text'],
  engaged:    ['Engaged', 'checkbox'],
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { id, contactId, field, value } = req.body || {};
    const m = MAP[field];
    if (!id || !m) return res.status(400).json({ ok: false, error: 'unknown field or missing id' });
    const [name, kind] = m;
    let prop;
    if (kind === 'select') prop = { select: { name: value } };
    else if (kind === 'phone') prop = { phone_number: value };
    else if (kind === 'checkbox') prop = { checkbox: !!value };
    else prop = { rich_text: [{ text: { content: String(value).slice(0, 1900) } }] };

    await notion('pages/' + id, { method: 'PATCH', body: JSON.stringify({ properties: { [name]: prop } }) });
    // phone is authored on the Contacts hub too
    if (field === 'phone' && contactId) {
      await notion('pages/' + contactId, { method: 'PATCH', body: JSON.stringify({ properties: { Phone: { phone_number: value } } }) });
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
