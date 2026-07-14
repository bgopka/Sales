// GET /api/customers → Contacts hub is the customer list (with synced photos);
// enriched from Customer Profile where a row exists, plus the Communications Log timeline.
import { DB, queryAll, txt } from './_notion.js';

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmt = d => { if (!d) return ''; const x = new Date(d); if (isNaN(x)) return ''; return `${String(x.getUTCDate()).padStart(2,'0')}-${MON[x.getUTCMonth()]}-${String(x.getUTCFullYear()).slice(2)}`; };
const sel = p => (p && p.select && p.select.name) || '';
const url = p => (p && p.url) || '';
const email = p => (p && p.email) || '';
const phone = p => (p && p.phone_number) || '';
const rel = p => ((p && p.relation) || []).map(r => r.id);
const dat = p => (p && p.date && p.date.start) || '';
const num = p => (p && typeof p.number === 'number') ? p.number : null;
const chk = p => !!(p && p.checkbox);
const fileUrl = p => { const f = ((p && p.files) || [])[0]; if (!f) return ''; return (f.file && f.file.url) || (f.external && f.external.url) || ''; };

export default async function handler(req, res) {
  try {
    if (!process.env.NOTION_TOKEN) return res.status(200).json({ customers: [] });
    const [contacts, profiles, comms, companies, reps, tasksAll, activityAll, demosAll, quotesAll] = await Promise.all([
      queryAll(DB.contacts), queryAll(DB.profile), queryAll(DB.comms),
      queryAll('58ec87a90749457f95198bb00dbedc3a').catch(()=>[]),      // Companies (database id, not collection id)
      queryAll('cf0c3a3f8c1847c1b72e97e32b72b31c').catch(()=>[]),      // Reps
      queryAll(DB.tasks).catch(()=>[]),                                // Sales Tasks
      queryAll(DB.activity).catch(()=>[]),                             // Activity (PostHog), keyed by email
      queryAll(DB.demos).catch(()=>[]),                                // Demos (scores, duration, outcome)
      queryAll('626b88f8a8954225b29a5c313b12f03d').catch(()=>[]),      // Quotes Library (liked quotes)
    ]);

    // Product activity grouped by lowercased email → latest date + note (newest first)
    const activityByEmail = {};
    for (const r of activityAll) {
      const p = r.properties || {};
      const em = (email(p['Email']) || '').toLowerCase().trim(); if (!em) continue;
      const iso = dat(p['Activity']); if (!iso) continue;
      const item = { iso, d: fmt(iso), note: txt(p['Activity Note']) || '' };
      (activityByEmail[em] = activityByEmail[em] || []).push(item);
    }
    for (const em in activityByEmail) activityByEmail[em].sort((a,b)=> (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));

    // Tasks grouped by contact id
    const TST = { Done: 'done', 'In progress': 'prog', Planned: 'plan' };
    const tasksByContact = {};
    for (const r of tasksAll) {
      const p = r.properties || {};
      const cid = rel(p['Customer'])[0]; if (!cid) continue;
      const item = { taskId: r.id, t: txt(p['Task']) || '(task)', type: sel(p['Type']) || 'Call', due: fmt(dat(p['Due'])), iso: dat(p['Due']) || '', st: TST[sel(p['Status'])] || 'plan' };
      (tasksByContact[cid] = tasksByContact[cid] || []).push(item);
    }

    const companyName = {}; for (const c of companies) companyName[c.id] = txt(c.properties?.Name) || txt(c.properties?.['Company']) || '';
    const repName = {};     for (const r of reps)      repName[r.id]     = txt(r.properties?.Name) || '';

    // Customer Profile enrichment, keyed by linked contact id
    const profByContact = {};
    for (const pg of profiles) {
      const p = pg.properties || {};
      const cid = rel(p['Contact'])[0]; if (!cid) continue;
      profByContact[cid] = {
        profileId: pg.id,
        execText: txt(p['Executive Summary']), status: txt(p['Last Status']), activity: txt(p['Online Activity']),
        nextStep: txt(p['Next Step']), nextDate: fmt(dat(p['Next Step Date'])),
        score: num(p['Score']), engineers: num(p['Engineers']), reportsMonth: num(p['Reports/mo']),
        blocker: txt(p['Blocker']), trialEnds: fmt(dat(p['Trial Ends'])), nextMeeting: fmt(dat(p['Next Meeting'])),
        owner: sel(p['Owner']), attendees: txt(p['Attendees']), liked: txt(p['Liked']), myNote: txt(p['My Note']),
        engaged: chk(p['Engaged']),
      };
    }

    // Quotes Library → "what they liked", grouped by Source Demo id (and fallback by Customer id)
    const quotesByDemo = {}, quotesByContact = {};
    for (const q of quotesAll) {
      const p = q.properties || {};
      const item = { theme: txt(p['Theme / Feature']) || '', quote: txt(p['Quote']) || txt(p['Verbatim']) || '', etype: sel(p['Entry Type']) || '' };
      if (!item.quote && !item.theme) continue;
      for (const did of rel(p['Source Demo'])) (quotesByDemo[did] = quotesByDemo[did] || []).push(item);
      for (const cid of rel(p['Customer']))    (quotesByContact[cid] = quotesByContact[cid] || []).push(item);
    }

    // Demos → latest HELD demo per contact, carrying scores/duration/outcome/date.
    // "liked" prefers quotes tied to that exact demo, else any quote for the contact.
    const round5 = n => (typeof n === 'number' ? Math.round(n / 5) * 5 : null);
    const demoByContact = {};
    for (const d of demosAll) {
      const p = d.properties || {};
      const cid = rel(p['Contact'])[0]; if (!cid) continue;
      const iso = dat(p['Scheduled Date']) || '';
      const outcome = sel(p['Outcome']) || '';
      const rec = {
        demoId: d.id, iso, date: fmt(iso), outcome,
        salesScore: num(p['Sales Score']), clientRating: num(p['Client Rating']),
        duration: round5(num(p['Duration (min)'])),
        sentiment: sel(p['Sentiment']) || '',
        nextSteps: txt(p['Next Steps']) || '', followUp: txt(p['Follow-up to Send']) || '',
        liked: (quotesByDemo[d.id] || []),
      };
      const prev = demoByContact[cid];
      // prefer Held; among same tier prefer the most recent date
      const isHeld = outcome === 'Held', prevHeld = prev && prev.outcome === 'Held';
      if (!prev || (isHeld && !prevHeld) || (isHeld === prevHeld && iso > (prev.iso || ''))) demoByContact[cid] = rec;
    }
    for (const cid in demoByContact) {
      const rec = demoByContact[cid];
      if ((!rec.liked || !rec.liked.length) && quotesByContact[cid]) rec.liked = quotesByContact[cid];
    }

    const emailToContact = {};
    for (const cpg of contacts) { const e = ((cpg.properties?.Email?.email) || '').toLowerCase().trim(); if (e) emailToContact[e] = cpg.id; }
    // Comms grouped by contact id (the linked Contact + anyone on From/To)
    const commsByContact = {};
    for (const r of comms) {
      const p = r.properties || {};
      const ch = sel(p['Channel']), dir = sel(p['Direction']), mst = sel(p['Meeting Status']), callout = sel(p['Call Outcome']);
      let type = 'email', status;
      if (ch === 'Meeting') { type='meeting'; status = ({Completed:'held',Cancelled:'cancelled','No Show':'noshow',Rescheduled:'moved',Scheduled:'held',Declined:'cancelled'})[mst] || 'held'; }
      else if (ch === 'Call') { type = callout === 'Connected' ? 'callok' : 'callna'; }
      const item = { type, status, dir: dir==='Inbound'?'in':'out', t: txt(p['Name'])||'(no subject)', d: fmt(dat(p['Date'])), _d: dat(p['Date'])||'', s: txt(p['Snippet']) };
      if (ch === 'Meeting') {
        item.mStatus = mst || '';
        const oi = dat(p['Original Time']) || '';
        const di = dat(p['Date']) || '';
        // Guard against the sync's timezone artifact: a "reschedule" whose Original Time
        // is the SAME calendar day as Date is not a real move — ignore it.
        const sameDay = oi && di && oi.slice(0,10) === di.slice(0,10);
        item.origIso = sameDay ? '' : oi;
        item.origDate = sameDay ? '' : fmt(oi);
        if (sameDay && item.mStatus === 'Rescheduled') item.mStatus = ''; // let date decide the badge
      }
      const targets = new Set(rel(p['Contact']));
      const addrs = (txt(p['From']) + ' ' + txt(p['To'])).toLowerCase();
      for (const em in emailToContact) { if (em && addrs.includes(em)) targets.add(emailToContact[em]); }
      for (const cid of targets) { if (cid) (commsByContact[cid] = commsByContact[cid] || []).push(item); }
    }
    for (const k in commsByContact) commsByContact[k].sort((a,b)=> (a._d < b._d ? 1 : a._d > b._d ? -1 : 0)); // newest first

    const customers = contacts.map(pg => {
      const p = pg.properties || {};
      const nm = txt(p['Name']) || `${txt(p['First Name'])} ${txt(p['Last Name'])}`.trim();
      const prof = profByContact[pg.id] || {};
      const em = (email(p['Email']) || '').toLowerCase().trim();
      const acts = activityByEmail[em] || [];
      const latestAct = acts[0] || null;
      const engaged = (prof.engaged === true) || !!prof.nextMeeting;
      return {
        id: pg.id, contactId: pg.id, profileId: prof.profileId || '',
        name: nm,
        engaged,
        activityDate: latestAct ? latestAct.iso : '',
        lastActivity: latestAct ? `${latestAct.d}: ${latestAct.note}` : '',
        activityLog: acts.map(a => ({ d: a.d, note: a.note })),
        myNote: prof.myNote || txt(p['My Note']) || '',
        company: companyName[rel(p['Company'])[0]] || '',
        email: email(p['Email']), phone: phone(p['Phone']),
        hubspot: url(p['HubSpot']),
        photo: fileUrl(p['Picture']),
        stage: sel(p['Pipeline Stage']) || '',
        sentiment: sel(p['Sentiment']) || 'Warm',
        owner: prof.owner || repName[rel(p['Booked By'])[0]] || 'Boris',
        bookedBy: repName[rel(p['Booked By'])[0]] || '',
        score: (prof.score ?? null) ?? 50,
        engineers: prof.engineers ?? 0, reportsMonth: prof.reportsMonth ?? 0,
        blocker: prof.blocker || '', trialEnds: prof.trialEnds || '', nextMeeting: prof.nextMeeting || '',
        execText: prof.execText || '',
        attendees: (prof.attendees || '').split('·').map(s => s.trim()).filter(Boolean),
        liked: (prof.liked || '').split(';').map(s => s.trim()).filter(Boolean),
        status: prof.status || txt(p['Summary Line']) || '',
        activity: prof.activity || '',
        next: { txt: prof.nextStep || txt(p['Next Step']) || '', date: prof.nextDate || '' },
        comms: commsByContact[pg.id] || [],
        demo: demoByContact[pg.id] || null,
        demoDate: (demoByContact[pg.id] && demoByContact[pg.id].iso) || '',
        meetings: (commsByContact[pg.id] || [])
          .filter(m => m.type === 'meeting')
          .map(m => ({ title: m.t, date: m.d, iso: m._d, status: m.mStatus || '', movedFrom: m.origDate || '' })),
        tasks: tasksByContact[pg.id] || [],
      };
    })
    // only real customers (must have a name); newest-updated first
    .filter(c => c.name);

    res.status(200).json({ customers });
  } catch (e) {
    res.status(200).json({ customers: [], error: String(e.message || e) });
  }
}
