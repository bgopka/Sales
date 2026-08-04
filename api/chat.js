// /api/chat  → per-contact chat, backed by the Notion "Chats" table.
//   GET  /api/chat?contact=<pageId>[&thread=<id>]  → { messages: [...] }
//   POST /api/chat  { contactId, message, attachments?, thread? }
//        → appends the user message, calls the n8n agent (if configured),
//          appends the assistant reply, returns { user, assistant }.
import { notion, queryAll, txt } from './_notion.js';

const CHATS_DB   = process.env.CHATS_DB   || 'bb7d2a3668554a798d9cc01c936ceb33';
const AGENT_HOOK = process.env.CHAT_AGENT_WEBHOOK || ''; // n8n webhook; empty in Phase 1

const rt   = s => [{ text: { content: String(s == null ? '' : s).slice(0, 1900) } }];
const files = arr => (arr || []).filter(Boolean).map(a =>
  ({ name: (a.name || 'file').slice(0, 90), external: { url: a.url } }));

// map a Chats page → light message object for the UI
function toMsg(pg) {
  const p = pg.properties || {};
  const sel = q => (p[q] && p[q].select && p[q].select.name) || '';
  const at = (p['Attachments'] && p['Attachments'].files) || [];
  return {
    id: pg.id,
    role: sel('Role') || 'user',
    text: txt(p['Message']),
    skills: txt(p['Skills Used']),
    thread: txt(p['Thread']),
    source: sel('Source') || 'app',
    at: (p['Sent At'] && p['Sent At'].date && p['Sent At'].date.start) || pg.created_time,
    attachments: at.map(f => ({ name: f.name, url: (f.external && f.external.url) || (f.file && f.file.url) || '' })),
  };
}

async function addMessage({ contactId, role, text, skills, thread, source, attachments }) {
  const props = {
    'Name':  { title: rt(`${role}: ${String(text || '').slice(0, 60)}`) },
    'Role':  { select: { name: role } },
    'Message': { rich_text: rt(text) },
    'Sent At': { date: { start: new Date().toISOString() } },
    'Source': { select: { name: source || 'app' } },
  };
  if (contactId) props['Contact'] = { relation: [{ id: contactId }] };
  if (skills)    props['Skills Used'] = { rich_text: rt(skills) };
  if (thread)    props['Thread'] = { rich_text: rt(thread) };
  const fs = files(attachments);
  if (fs.length) props['Attachments'] = { files: fs };
  const page = await notion('pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: CHATS_DB }, properties: props }) });
  return page;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { contact, thread } = req.query || {};
      if (!contact) return res.status(400).json({ messages: [], error: 'missing contact' });
      const filter = { and: [{ property: 'Contact', relation: { contains: contact } }] };
      if (thread) filter.and.push({ property: 'Thread', rich_text: { equals: thread } });
      const rows = await queryAll(CHATS_DB, {
        filter,
        sorts: [{ property: 'Sent At', direction: 'ascending' }],
      });
      return res.status(200).json({ messages: rows.map(toMsg) });
    }

    if (req.method === 'POST') {
      const { contactId, message, attachments, thread, name, email } = req.body || {};
      if (!contactId || (!message && !(attachments || []).length))
        return res.status(400).json({ error: 'missing contactId or message' });

      // 1) log the user's message
      const userPage = await addMessage({ contactId, role: 'user', text: message, thread, source: 'app', attachments });

      // 2) ask the agent (Phase 2). If no webhook yet, return a friendly placeholder.
      let reply = '', skills = '';
      if (AGENT_HOOK) {
        try {
          // pull recent history so the agent has context
          const hist = (await queryAll(CHATS_DB, {
            filter: { property: 'Contact', relation: { contains: contactId } },
            sorts: [{ property: 'Sent At', direction: 'ascending' }],
          })).map(toMsg).slice(-30);
          const r = await fetch(AGENT_HOOK, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactId, name: name || '', email: email || '', message, attachments: attachments || [], thread: thread || '', history: hist }),
          });
          const d = await r.json().catch(() => ({}));
          reply  = d.reply || d.text || d.output || '';
          skills = d.skills || (Array.isArray(d.skillsUsed) ? d.skillsUsed.join(', ') : '') || '';
        } catch (e) { reply = `⚠️ Agent error: ${String(e.message || e)}`; }
      } else {
        reply = '🛈 Chat is saved. The AI agent isn’t wired up yet (Phase 2 — the n8n flow). Your message is logged to the Chats table.';
      }

      // 3) log the assistant reply
      const asstPage = await addMessage({ contactId, role: 'assistant', text: reply, skills, thread, source: 'app' });

      return res.status(200).json({ user: toMsg(userPage), assistant: toMsg(asstPage) });
    }

    res.status(405).end();
  } catch (e) {
    res.status(200).json({ error: String(e.message || e) });
  }
}
