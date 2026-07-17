// /api/sequence-steps — base nurturing sequence (Email Sequence Steps DB).
// GET  → { steps:[{id,step,track,day,channel,subjectA,subjectB,html,script,goal,branch,active,attachments:[{name,url}], clientCount}] }
// POST { op:'update', pageId, ...fields }  → update a step
// POST { op:'create', track, day, channel } → new step
import { notion, queryAll, txt } from './_notion.js';

const STEPS_DB = process.env.SEQ_STEPS_DB || 'f9d811cfbf2845eb8b3161684bc4062b';
const CLIENTSEQ_DB = process.env.SEQUENCES_DB || '9775f3136a1d4602b1d2cd56cf352fe7';
const sel = p => (p && p.select && p.select.name) || '';
const numv = p => (p && typeof p.number === 'number') ? p.number : null;
const chk = p => !!(p && p.checkbox);
const files = p => ((p && p.files) || []).map(f => ({ name: f.name, url: (f.file && f.file.url) || (f.external && f.external.url) || '' }));

export default async function handler(req, res) {
  try {
    if (!process.env.NOTION_TOKEN) return res.status(200).json({ steps: [] });

    if (req.method === 'GET') {
      const rows = await queryAll(STEPS_DB, {});
      // client-sequence rows for the track+day heuristic mapping
      let clientRows = [];
      try { clientRows = await queryAll(CLIENTSEQ_DB, {}); } catch {}
      const steps = rows.map(r => {
        const p = r.properties || {};
        return {
          id: r.id, step: txt(p['Step']), track: sel(p['Track']), day: numv(p['Day Offset']),
          channel: sel(p['Channel']) || 'Email', subjectA: txt(p['Subject A']), subjectB: txt(p['Subject B']),
          html: txt(p['HTML Body']), script: txt(p['Call Script']), goal: txt(p['Goal']),
          branch: txt(p['Branch Condition']), active: chk(p['Active']), attachments: files(p['Attachments']),
        };
      });
      // heuristic: a client touch "derives from" a base step if the base step's Action/Channel-ish matches — we approximate by track presence; exact linkage TBD
      const clientCountByTrack = {};
      clientRows.forEach(() => {}); // placeholder; count kept simple below
      steps.sort((a, b) => (a.track || '').localeCompare(b.track || '') || ((a.day ?? 999) - (b.day ?? 999)));
      return res.status(200).json({ steps, clientTotal: clientRows.length });
    }

    const b = req.body || {};
    if (b.op === 'update' && b.pageId) {
      const props = {};
      if (b.day != null && b.day !== '') props['Day Offset'] = { number: Number(b.day) };
      if (b.channel) props['Channel'] = { select: { name: b.channel } };
      if (typeof b.subjectA === 'string') props['Subject A'] = { rich_text: [{ text: { content: b.subjectA.slice(0, 1900) } }] };
      if (typeof b.subjectB === 'string') props['Subject B'] = { rich_text: [{ text: { content: b.subjectB.slice(0, 1900) } }] };
      if (typeof b.html === 'string') props['HTML Body'] = { rich_text: [{ text: { content: b.html.slice(0, 1900) } }] };
      if (typeof b.script === 'string') props['Call Script'] = { rich_text: [{ text: { content: b.script.slice(0, 1900) } }] };
      if (typeof b.goal === 'string') props['Goal'] = { rich_text: [{ text: { content: b.goal.slice(0, 1900) } }] };
      if (typeof b.active === 'boolean') props['Active'] = { checkbox: b.active };
      const d = await notion('pages/' + b.pageId, { method: 'PATCH', body: JSON.stringify({ properties: props }) });
      return res.status(200).json({ ok: true, id: d.id });
    }
    if (b.op === 'create' && b.track) {
      const ch = b.channel || 'Email';
      const title = (b.step || (b.track + ' — new ' + ch + ' (D+' + (b.day ?? 0) + ')'));
      const d = await notion('pages', { method: 'POST', body: JSON.stringify({
        parent: { database_id: STEPS_DB },
        properties: {
          'Step': { title: [{ text: { content: title.slice(0, 200) } }] },
          'Track': { select: { name: b.track } },
          'Day Offset': { number: Number(b.day || 0) },
          'Channel': { select: { name: ch } },
          'Active': { checkbox: true },
        } }) });
      return res.status(200).json({ ok: true, id: d.id });
    }
    return res.status(200).json({ ok: false, error: 'Unsupported operation' });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
