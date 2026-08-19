// /api/plan — Friday sales-review Plan view.
// Backed by two Notion DBs under "Tenera Sales CRM":
//   Sales Plan Weeks  — one row per review week (section list + lock state)
//   Sales Plan Items  — one row per client per section per week
//
// GET  ?from=YYYY-MM-DD            → { weeks:[…], items:[…] }   (default: last 120 days)
// POST { op:'setItem', weekOf, section, contactId, name?, plan?, status?, sectionOrder?, itemOrder? }
// POST { op:'removeItem', weekOf, section, contactId, name? }    → soft-delete (Deleted = true)
// POST { op:'week', weekOf, sections?, locked?, note? }          → upsert the week row
import { notion, queryAll, txt } from './_notion.js';

const WEEKS_DB = process.env.PLAN_WEEKS_DB || 'adbd62320a3d4daf867b7a70f9038c04';
const ITEMS_DB = process.env.PLAN_ITEMS_DB || 'e9dcc9c87299488a83c8a66bac14da7c';

const sel = p => (p && p.select && p.select.name) || '';
const dat = p => (p && p.date && p.date.start) || '';
const chk = p => !!(p && p.checkbox);
const num = p => (p && typeof p.number === 'number' ? p.number : null);
const rel = p => (p && p.relation ? p.relation.map(r => r.id) : []);
const rt = s => ({ rich_text: [{ text: { content: String(s == null ? '' : s).slice(0, 1900) } }] });

function parseSections(s) {
  try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

async function findWeek(weekOf) {
  const rows = await queryAll(WEEKS_DB, { filter: { property: 'Week Of', date: { equals: weekOf } } });
  return rows[0] || null;
}

async function findItem(weekOf, section, contactId) {
  const rows = await queryAll(ITEMS_DB, { filter: { property: 'Week Of', date: { equals: weekOf } } });
  return rows.find(r => {
    const p = r.properties || {};
    return txt(p['Section']) === section && rel(p['Contact'])[0] === contactId;
  }) || null;
}

export default async function handler(req, res) {
  try {
    if (!process.env.NOTION_TOKEN) return res.status(200).json({ weeks: [], items: [] });

    if (req.method === 'GET') {
      const from = String((req.query && req.query.from) || '').slice(0, 10) ||
        new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
      const [wRows, iRows] = await Promise.all([
        queryAll(WEEKS_DB, { filter: { property: 'Week Of', date: { on_or_after: from } } }).catch(() => []),
        queryAll(ITEMS_DB, { filter: { property: 'Week Of', date: { on_or_after: from } } }).catch(() => []),
      ]);
      const weeks = wRows.map(r => { const p = r.properties || {}; return {
        id: r.id, weekOf: (dat(p['Week Of']) || '').slice(0, 10),
        locked: chk(p['Locked']), lockedAt: dat(p['Locked At']),
        sections: parseSections(txt(p['Sections'])), note: txt(p['Note']) };
      }).filter(w => w.weekOf);
      const items = iRows.map(r => { const p = r.properties || {}; return {
        id: r.id, weekOf: (dat(p['Week Of']) || '').slice(0, 10),
        section: txt(p['Section']), sectionOrder: num(p['Section Order']), itemOrder: num(p['Item Order']),
        contactId: rel(p['Contact'])[0] || '', plan: txt(p['Plan']), status: sel(p['Status']),
        recordNote: txt(p['Record Note']), deleted: chk(p['Deleted']) };
      }).filter(i => i.weekOf && i.contactId);
      return res.status(200).json({ weeks, items });
    }

    const b = req.body || {};

    if (b.op === 'week' && b.weekOf) {
      const props = {};
      if (Array.isArray(b.sections)) props['Sections'] = rt(JSON.stringify(b.sections.map(String)));
      if (typeof b.locked === 'boolean') {
        props['Locked'] = { checkbox: b.locked };
        props['Locked At'] = b.locked ? { date: { start: new Date().toISOString() } } : { date: null };
      }
      if (typeof b.note === 'string') props['Note'] = rt(b.note);
      const existing = await findWeek(b.weekOf);
      if (existing) {
        const d = await notion('pages/' + existing.id, { method: 'PATCH', body: JSON.stringify({ properties: props }) });
        return res.status(200).json({ ok: true, id: d.id });
      }
      props['Week'] = { title: [{ text: { content: b.weekOf } }] };
      props['Week Of'] = { date: { start: b.weekOf } };
      const d = await notion('pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: WEEKS_DB }, properties: props }) });
      return res.status(200).json({ ok: true, id: d.id });
    }

    if ((b.op === 'setItem' || b.op === 'removeItem') && b.weekOf && b.contactId && typeof b.section === 'string') {
      const props = {};
      if (typeof b.plan === 'string') props['Plan'] = rt(b.plan);
      if (typeof b.status === 'string') props['Status'] = b.status ? { select: { name: b.status } } : { select: null };
      if (typeof b.recordNote === 'string') props['Record Note'] = rt(b.recordNote);
      if (typeof b.sectionOrder === 'number') props['Section Order'] = { number: b.sectionOrder };
      if (typeof b.itemOrder === 'number') props['Item Order'] = { number: b.itemOrder };
      props['Deleted'] = { checkbox: b.op === 'removeItem' };

      const existing = await findItem(b.weekOf, b.section, b.contactId);
      if (existing) {
        const d = await notion('pages/' + existing.id, { method: 'PATCH', body: JSON.stringify({ properties: props }) });
        return res.status(200).json({ ok: true, id: d.id });
      }
      props['Item'] = { title: [{ text: { content: `${b.weekOf} · ${b.section} · ${b.name || 'Client'}`.slice(0, 200) } }] };
      props['Week Of'] = { date: { start: b.weekOf } };
      props['Section'] = rt(b.section);
      props['Contact'] = { relation: [{ id: b.contactId }] };
      const d = await notion('pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: ITEMS_DB }, properties: props }) });
      return res.status(200).json({ ok: true, id: d.id });
    }

    return res.status(200).json({ ok: false, error: 'Unsupported operation' });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
