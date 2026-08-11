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
    const callNote = String(b.transcript || b.body || '').trim();
    const callLabel = (b.outcome === 'connected' ? 'Connected call' : 'Called — no answer');
    const name = b.subject || (b.kind === 'call'
      ? (callNote ? (callLabel + ' — ' + callNote.split('\n')[0].slice(0, 90)) : callLabel)
      : 'Email sent');

    // Exact logging time (from the client click) — used to match the Plaud recording.
    const loggedAt = (b.loggedAt && !isNaN(new Date(b.loggedAt))) ? new Date(b.loggedAt).toISOString() : nowISO;
    // For calls we want the precise datetime; for emails, keep the day (noon) unless a time was given.
    // For calls, allow an explicit when (b.at) — otherwise use the click moment.
    const callAt = (b.at && !isNaN(new Date(b.at))) ? new Date(b.at).toISOString() : null;
    const dateStart = (b.kind === 'call')
      ? (callAt || loggedAt)
      : ((b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) ? new Date(b.date + 'T12:00:00Z').toISOString()
         : ((b.date && !isNaN(new Date(b.date))) ? new Date(b.date).toISOString() : nowISO));

    const props = {
      Name: { title: [{ text: { content: String(name).slice(0, 200) } }] },
      Date: { date: { start: dateStart } },
      'HS Logged': { checkbox: false },
    };
    // Always stamp the exact in-app logging moment (Plaud match key).
    props['Logged At'] = { date: { start: loggedAt } };
    if (b.kind === 'email') {
      props.Channel = { select: { name: 'Email' } };
      props.Direction = { select: { name: 'Outbound' } };
      const preview = (b.body && String(b.body).trim()) || b.subject || '';
      if (preview) props.Snippet = { rich_text: [{ text: { content: String(preview).slice(0, 1900) } }] };
    } else {
      props.Channel = { select: { name: 'Call' } };
      props['Call Outcome'] = { select: { name: b.outcome === 'connected' ? 'Connected' : 'No answer' } };
      props.Snippet = { rich_text: [{ text: { content: String(callNote ? (callLabel + ' — ' + callNote) : callLabel).slice(0, 1900) } }] };
    }
    if (contactId) props.Contact = { relation: [{ id: contactId }] };

    const body = { parent: { database_id: DB.comms }, properties: props };
    const pageText = b.transcript || b.body;
    if (pageText) {
      body.children = [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: String(pageText).slice(0, 1900) } }] } }];
    }
    const created = await notion('pages', { method: 'POST', body: JSON.stringify(body) });
    res.status(200).json({ ok: true, id: created.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
