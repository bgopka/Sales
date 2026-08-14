// POST /api/contact  → create a new CRM Contact (the hub record) with dedup + company linking.
//
//   { op:'check', email }                  → { ok, duplicate, id?, name?, url? }
//   { op:'create', ...fields }             → { ok, id, url, companyId, duplicate }
//
// Dedup key is Email (matches the rest of the CRM). If the email already exists we do NOT
// create a second row — we return the existing one so the UI can open it instead.
// Company is find-or-create by name (case-insensitive).
// "HS Synced" is left false so the n8n "AI · Contact → HubSpot" flow mirrors it and writes back
// the HubSpot record URL.
import { DB, notion, queryAll, txt } from './_notion.js';

const COMPANIES_DB = process.env.COMPANIES_DB || '58ec87a90749457f95198bb00dbedc3a';

const SOURCES = ['My List', 'Sales Factory', 'LinkedIn', 'Cold Call', 'Inbound', 'Referral', 'Website', 'Event', 'Other'];
const OWNERS = ['Boris', 'Ben', 'Quinn', 'Alex', 'Daisy', 'Dariia', 'Unassigned'];
const STAGES = ['New', 'First Call Booked', 'First Call Done', 'Intent Shown', 'Demo Booked',
  'Demo Done', 'Template Sent', 'Trial', 'Paid', 'Closed Lost', 'Stalled'];
const SENTIMENTS = ['Hot', 'Warm', 'Lukewarm', 'Cold', 'Neutral', 'Cool'];

const pick = (list, v, dflt) => list.find(x => x.toLowerCase() === String(v || '').toLowerCase()) || dflt;
const rt = s => [{ text: { content: String(s == null ? '' : s).slice(0, 1900) } }];
const clean = s => String(s == null ? '' : s).trim();
const pageUrl = id => 'https://www.notion.so/' + String(id).replace(/-/g, '');

async function findContactByEmail(email) {
  if (!email) return null;
  const rows = await queryAll(DB.contacts, {
    filter: { property: 'Email', email: { equals: email } },
    page_size: 5,
  });
  return rows[0] || null;
}

async function findOrCreateCompany(nameRaw, website) {
  const name = clean(nameRaw);
  if (!name) return null;
  const rows = await queryAll(COMPANIES_DB, {
    filter: { property: 'Name', title: { contains: name } },
    page_size: 25,
  });
  const hit = rows.find(r => txt(r.properties?.Name).trim().toLowerCase() === name.toLowerCase());
  if (hit) return { id: hit.id, created: false, name: txt(hit.properties?.Name) };

  const props = { Name: { title: rt(name) } };
  if (clean(website)) props.Website = { url: clean(website) };
  const made = await notion('pages', {
    method: 'POST',
    body: JSON.stringify({ parent: { database_id: COMPANIES_DB }, properties: props }),
  });
  return { id: made.id, created: true, name };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    const op = String(b.op || 'create').toLowerCase();
    const email = clean(b.email).toLowerCase();

    // ---- dedup probe (used live as Boris types the email) --------------------
    if (op === 'check') {
      const found = await findContactByEmail(email);
      if (!found) return res.status(200).json({ ok: true, duplicate: false });
      return res.status(200).json({
        ok: true, duplicate: true, id: found.id, url: pageUrl(found.id),
        name: txt(found.properties?.Name) || email,
        stage: found.properties?.['Pipeline Stage']?.select?.name || '',
      });
    }

    // ---- create --------------------------------------------------------------
    let first = clean(b.firstName), last = clean(b.lastName);
    const full = clean(b.name) || [first, last].filter(Boolean).join(' ');
    if (!first && full) { const bits = full.split(/\s+/); first = bits[0]; last = last || bits.slice(1).join(' '); }
    if (!full && !email) return res.status(400).json({ ok: false, error: 'Need at least a name or an email.' });

    // never create a duplicate — hand back the existing record
    if (email) {
      const existing = await findContactByEmail(email);
      if (existing) {
        return res.status(200).json({
          ok: true, duplicate: true, id: existing.id, url: pageUrl(existing.id),
          name: txt(existing.properties?.Name) || full,
          message: 'A contact with that email already exists — opened it instead of creating a duplicate.',
        });
      }
    }

    const company = await findOrCreateCompany(b.company, b.companyWebsite);

    const props = {
      Name: { title: rt(full || email) },
      'Pipeline Stage': { select: { name: pick(STAGES, b.stage, 'New') } },
      Source: { select: { name: pick(SOURCES, b.source, 'Other') } },
      Owner: { select: { name: pick(OWNERS, b.owner, 'Boris') } },
      'HS Synced': { checkbox: false },
    };
    if (first) props['First Name'] = { rich_text: rt(first) };
    if (last) props['Last Name'] = { rich_text: rt(last) };
    if (email) props.Email = { email };
    if (clean(b.phone)) props.Phone = { phone_number: clean(b.phone) };
    if (clean(b.jobTitle)) props['Job Title'] = { rich_text: rt(b.jobTitle) };
    if (clean(b.nextStep)) props['Next Step'] = { rich_text: rt(b.nextStep) };
    if (clean(b.summaryLine)) props['Summary Line'] = { rich_text: rt(b.summaryLine) };
    if (clean(b.intakeNotes)) props['Intake Notes'] = { rich_text: rt(b.intakeNotes) };
    if (clean(b.sentiment)) props.Sentiment = { select: { name: pick(SENTIMENTS, b.sentiment, 'Neutral') } };
    if (company) props.Company = { relation: [{ id: company.id }] };

    const body = { parent: { database_id: DB.contacts }, properties: props };

    // Body = the seed Customer Profile, so the record is never born empty.
    const lines = ['## Customer Profile', ''];
    lines.push('**Source:** ' + pick(SOURCES, b.source, 'Other') + '  ');
    if (company) lines.push('**Company:** ' + company.name + '  ');
    if (clean(b.jobTitle)) lines.push('**Role:** ' + clean(b.jobTitle) + '  ');
    if (clean(b.linkedin)) lines.push('**LinkedIn:** ' + clean(b.linkedin) + '  ');
    lines.push('**Created:** ' + new Date().toISOString().slice(0, 10));
    if (clean(b.intakeNotes)) { lines.push('', '### Intake notes', clean(b.intakeNotes)); }
    body.children = [{
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ text: { content: lines.join('\n').slice(0, 1900) } }] },
    }];

    const created = await notion('pages', { method: 'POST', body: JSON.stringify(body) });

    res.status(200).json({
      ok: true, duplicate: false, id: created.id, url: pageUrl(created.id),
      companyId: company ? company.id : null,
      companyCreated: company ? company.created : false,
      name: full || email,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
