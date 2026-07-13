// Shared Notion helpers (zero-dependency; uses global fetch on Vercel Node 18+).
const TOKEN = process.env.NOTION_TOKEN;
const V = '2026-03-11';

export const DB = {
  contacts: process.env.CONTACTS_DB || 'd972d5387c594732b27b42e1ac3b3e18',
  profile:  process.env.PROFILE_DB  || '707a7c1a7ec5469e8b02ab44306cbc8a',
  comms:    process.env.COMMS_DB    || '6b9efcc1429046b0b2785133e3d558e9',
  activity: process.env.ACTIVITY_DB || '3966244db1a380ce867df6fd822c4164',
  demos:    process.env.DEMOS_DB    || 'c2aa8b20372849af812d63dcf294b077',
  tasks:    process.env.TASKS_DB    || '',
};

export async function notion(path, opts = {}) {
  const r = await fetch('https://api.notion.com/v1/' + path, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': V, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  if (!r.ok) throw new Error(typeof d === 'string' ? d : (d.message || JSON.stringify(d)));
  return d;
}

export async function queryAll(db, body = {}) {
  let out = [], cursor;
  do {
    const d = await notion(`databases/${db}/query`, {
      method: 'POST',
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}), ...body }),
    });
    out = out.concat(d.results || []);
    cursor = d.has_more ? d.next_cursor : null;
  } while (cursor);
  return out;
}

export const txt = p => (((p && (p.title || p.rich_text))) || []).map(x => x.plain_text).join('');
