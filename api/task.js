// POST /api/task  → create a Sales Task, or update an existing task's status.
// Create body: { contactId?, task, type, due }   (due = ISO yyyy-mm-dd)
// Update body: { taskId, status }                 (status = Planned | In progress | Done)
import { DB, notion } from './_notion.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    if (!DB.tasks) return res.status(200).json({ ok: true, skipped: 'no tasks db' });
    const b = req.body || {};

    // Update an existing task's status (toggle done / in progress)
    if (b.taskId) {
      await notion('pages/' + b.taskId, {
        method: 'PATCH',
        body: JSON.stringify({ properties: { Status: { select: { name: b.status || 'Done' } } } }),
      });
      return res.status(200).json({ ok: true, id: b.taskId });
    }

    // Create a new task
    const props = {
      Task: { title: [{ text: { content: String(b.task || '').slice(0, 200) } }] },
      Status: { select: { name: 'Planned' } },
      Owner: { select: { name: 'Boris' } },
    };
    if (b.type) props.Type = { select: { name: b.type } };
    if (b.due && /^\d{4}-\d{2}-\d{2}/.test(b.due)) props.Due = { date: { start: b.due } };
    if (b.contactId) props.Customer = { relation: [{ id: b.contactId }] };

    const created = await notion('pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: DB.tasks }, properties: props }) });
    res.status(200).json({ ok: true, id: created.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
