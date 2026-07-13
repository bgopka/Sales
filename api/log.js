// POST /api/log  → logs a call or email as a Communications Log row (transcript goes in the page body).
// Sets "HS Logged" = false so the n8n "Comms Log → HubSpot" flow syncs the summary to HubSpot.
import { DB, notion } from './_notion.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    let contactId = b.contactId;
    if (!contactId && b.id) {
      const pg = await notion('pages/' + b.id);
      contactId = ((pg.properties?.Contact?.relation) || [])[0]?.id;
    }
    const nowISO = new Date().toISOString();
    const name = b.subject || (b.kind === 'call'
      ? (b.outcome === 'connected' ? 'Connected call' : 'Called — no answer')
      : 'Email sent');

    const props = {
      Name: { title: [{ text: { content: String(name).slice(0, 200) } }] },
      Date: { date: { start: nowISO } },
      'HS Logged': { checkbox: false },
    };
    if (b.kind === 'email') {
      props.Channel = { select: { name: 'Email' } };
      props.Direction = { select: { name: 'Outbound' } };
      if (b.subject) props.Snippet = { rich_text: [{ text: { content: String(b.subject).slice(0, 1900) } }] };
    } else {
      props.Channel = { select: { name: 'Call' } };
      props['Call Outcome'] = { select: { name: b.outcome === 'connected' ? 'Connected' : 'No answer' } };
      props.Snippet = { rich_text: [{ text: { content: (b.outcome === 'connected' ? 'Connected call' : 'Called — no answer') } }] };
    }
    if (contactId) props.Contact = { relation: [{ id: contactId }] };

    const body = { parent: { database_id: DB.comms }, properties: props };
    if (b.transcript) {
      body.children = [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: String(b.transcript).slice(0, 1900) } }] } }];
    }
    const created = await notion('pages', { method: 'POST', body: JSON.stringify(body) });
    res.status(200).json({ ok: true, id: created.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
