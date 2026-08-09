// POST /api/activity  → add a manual Online Activity entry for a contact.
// Body: { email, note, date? }   (email = contact email; date = ISO yyyy-mm-dd, defaults to today)
import { DB, notion } from './_notion.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    if (!DB.activity) return res.status(200).json({ ok: true, skipped: 'no activity db' });
    const b = req.body || {};
    const email = String(b.email || '').trim();
    const note = String(b.note || '').trim();
    if (!email || !note) return res.status(400).json({ ok: false, error: 'email and note required' });

    const date = (b.date && /^\d{4}-\d{2}-\d{2}/.test(b.date)) ? b.date : new Date().toISOString().slice(0, 10);

    const props = {
      Name: { title: [{ text: { content: note.slice(0, 200) } }] },
      Email: { email },
      Activity: { date: { start: date } },
      'Activity Note': { rich_text: [{ text: { content: note.slice(0, 1999) } }] },
    };

    const created = await notion('pages', {
      method: 'POST',
      body: JSON.stringify({ parent: { database_id: DB.activity }, properties: props }),
    });
    res.status(200).json({ ok: true, id: created.id, date });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
