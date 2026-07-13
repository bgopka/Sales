// POST /api/task  → create a sales task. Requires TASKS_DB env (your AI Tasks / Sales Tasks data source).
// body: { contactId?, task, type, due }
import { DB, notion } from './_notion.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    if (!DB.tasks) return res.status(200).json({ ok: true, skipped: 'set TASKS_DB to enable task writes' });
    const { contactId, task, type, due } = req.body || {};
    const props = {
      Task: { title: [{ text: { content: String(task || '').slice(0, 200) } }] },
      Status: { select: { name: 'Planned' } },
    };
    if (type) props.Type = { select: { name: type } };
    if (contactId) props.Customer = { relation: [{ id: contactId }] };
    await notion('pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: DB.tasks }, properties: props }) });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
