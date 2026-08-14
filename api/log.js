// POST /api/log  → logs a call, email or message as a Communications Log row.
// (full text goes in the page body; Snippet holds the short preview)
// Sets "HS Logged" = false so the n8n "Comms Log → HubSpot" flow syncs the summary to HubSpot.
//
// body: { contactId | id, kind: 'call'|'email'|'message', ... }
//   call    → { outcome: 'connected'|'noanswer', transcript?, at?, loggedAt? }
//   email   → { subject, body?, date?, direction?: 'Outbound'|'Inbound' }
//   message → { body, platform: 'SMS'|'LinkedIn'|'WhatsApp'|'Instagram'|'Facebook'|'Telegram'|'Other',
//               direction: 'Outbound'|'Inbound', at?, subject? }
import { DB, notion } from './_notion.js';

const PLATFORMS = ['SMS', 'LinkedIn', 'WhatsApp', 'Instagram', 'Facebook', 'Telegram', 'Other'];
const dirOf = v => {
  const s = String(v || '').toLowerCase();
  if (s.startsWith('int')) return 'Internal';
  if (s.startsWith('in')) return 'Inbound';
  return 'Outbound';
};
const platformOf = v => PLATFORMS.find(p => p.toLowerCase() === String(v || '').toLowerCase()) || 'Other';

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
    const kind = String(b.kind || 'email').toLowerCase();

    const noteText = String(b.transcript || b.body || '').trim();
    const callLabel = (b.outcome === 'connected' ? 'Connected call' : 'Called — no answer');

    // ---- title ---------------------------------------------------------------
    let name = b.subject || '';
    if (!name) {
      if (kind === 'call') {
        name = noteText ? (callLabel + ' — ' + noteText.split('\n')[0].slice(0, 90)) : callLabel;
      } else if (kind === 'message') {
        const pf = platformOf(b.platform);
        const inbound = dirOf(b.direction) === 'Inbound';
        const head = noteText ? noteText.split('\n')[0].slice(0, 90) : '';
        name = pf + ' message ' + (inbound ? 'received' : 'sent') + (head ? ' — ' + head : '');
      } else {
        name = dirOf(b.direction) === 'Inbound' ? 'Email received' : 'Email sent';
      }
    }

    // ---- date ----------------------------------------------------------------
    // Exact logging time (from the client click) — used to match the Plaud recording.
    const loggedAt = (b.loggedAt && !isNaN(new Date(b.loggedAt))) ? new Date(b.loggedAt).toISOString() : nowISO;
    // Calls and messages want the precise datetime; emails keep the day (noon) unless a time was given.
    const atExplicit = (b.at && !isNaN(new Date(b.at))) ? new Date(b.at).toISOString() : null;
    const dateStart = (kind === 'call' || kind === 'message')
      ? (atExplicit || loggedAt)
      : ((b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) ? new Date(b.date + 'T12:00:00Z').toISOString()
         : ((b.date && !isNaN(new Date(b.date))) ? new Date(b.date).toISOString() : nowISO));

    const props = {
      Name: { title: [{ text: { content: String(name).slice(0, 200) } }] },
      Date: { date: { start: dateStart } },
      'HS Logged': { checkbox: false },
      'Logged At': { date: { start: loggedAt } },
    };

    if (kind === 'email') {
      props.Channel = { select: { name: 'Email' } };
      props.Direction = { select: { name: dirOf(b.direction) } };
      const preview = (b.body && String(b.body).trim()) || b.subject || '';
      if (preview) props.Snippet = { rich_text: [{ text: { content: String(preview).slice(0, 1900) } }] };
    } else if (kind === 'message') {
      props.Channel = { select: { name: 'Message' } };
      props.Platform = { select: { name: platformOf(b.platform) } };
      props.Direction = { select: { name: dirOf(b.direction) } };
      if (b.type) props.Type = { select: { name: b.type } };
      if (noteText) props.Snippet = { rich_text: [{ text: { content: noteText.slice(0, 1900) } }] };
    } else {
      props.Channel = { select: { name: 'Call' } };
      props['Call Outcome'] = { select: { name: b.outcome === 'connected' ? 'Connected' : 'No answer' } };
      props.Direction = { select: { name: dirOf(b.direction) } };
      props.Snippet = { rich_text: [{ text: { content: String(noteText ? (callLabel + ' — ' + noteText) : callLabel).slice(0, 1900) } }] };
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
