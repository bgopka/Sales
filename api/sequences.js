// /api/sequences — Client Sequences DB (per-client planned touches).
// GET  ?contact={notionPageId}  → { touches:[{id,title,date,action,description,status,agreement,source}] }
// POST { op:'update', pageId, status?|date?|action?|description? }
// POST { op:'create', contactId, name?, date, action, description }
import { notion, queryAll, txt } from './_notion.js';

const SEQ_DB = process.env.SEQUENCES_DB || '9775f3136a1d4602b1d2cd56cf352fe7';
const sel = p => (p && p.select && p.select.name) || '';
const msel = p => (p && p.multi_select ? p.multi_select.map(o => o.name) : []);
const dat = p => (p && p.date && p.date.start) || '';

export default async function handler(req, res) {
  try {
    if (!process.env.NOTION_TOKEN) return res.status(200).json({ touches: [] });
    if (req.method === 'GET') {
      const contact = String((req.query && req.query.contact) || '');
      if (!contact) return res.status(200).json({ touches: [] });
      const rows = await queryAll(SEQ_DB, { filter: { property: 'Contact', relation: { contains: contact } } });
      const touches = rows.map(r => { const p = r.properties || {}; return {
        id: r.id, title: txt(p['Touch']), date: dat(p['Date']), action: sel(p['Action']),
        description: txt(p['Description']), status: sel(p['Status']) || 'Proposed',
        agreement: txt(p['Client Agreement']), source: sel(p['Source']),
        play: sel(p['Play']), targets: msel(p['Targets Rung']) }; });
      return res.status(200).json({ touches });
    }
    const b = req.body || {};
    if (b.op === 'update' && b.pageId) {
      const props = {};
      if (b.status) props['Status'] = { select: { name: b.status } };
      if (b.date) props['Date'] = { date: { start: b.date } };
      if (b.action) props['Action'] = { select: { name: b.action } };
      if (typeof b.play === 'string' && b.play) props['Play'] = { select: { name: b.play } };
      if (Array.isArray(b.targets)) props['Targets Rung'] = { multi_select: b.targets.map(n => ({ name: n })) };
      if (typeof b.description === 'string') props['Description'] = { rich_text: [{ text: { content: b.description.slice(0, 1900) } }] };
      if (b.date || b.action || typeof b.description === 'string' || b.play || Array.isArray(b.targets)) props['Source'] = { select: { name: 'Manual' } };
      const d = await notion('pages/' + b.pageId, { method: 'PATCH', body: JSON.stringify({ properties: props }) });
      return res.status(200).json({ ok: true, id: d.id });
    }
    if (b.op === 'create' && b.contactId && b.date && b.action) {
      const title = (b.name ? b.name + ' — ' : '') + (b.play || b.action) + ' ' + b.date;
      const props = {
          'Touch': { title: [{ text: { content: title.slice(0, 200) } }] },
          'Contact': { relation: [{ id: b.contactId }] },
          'Date': { date: { start: b.date } },
          'Action': { select: { name: b.action } },
          'Status': { select: { name: 'Approved' } },
          'Source': { select: { name: 'Manual' } },
          'Description': { rich_text: [{ text: { content: String(b.description || '').slice(0, 1900) } }] },
      };
      if (typeof b.play === 'string' && b.play) props['Play'] = { select: { name: b.play } };
      if (Array.isArray(b.targets) && b.targets.length) props['Targets Rung'] = { multi_select: b.targets.map(n => ({ name: n })) };
      const d = await notion('pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: SEQ_DB }, properties: props }) });
      return res.status(200).json({ ok: true, id: d.id });
    }
    return res.status(200).json({ ok: false, error: 'Unsupported operation' });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
