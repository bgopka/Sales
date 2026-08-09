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
    const [contacts, profiles, comms, companies, reps, tasksAll, activityAll, demosAll, quotesAll, demoPrepsAll, critiquesAll] = await Promise.all([
      queryAll(DB.contacts), queryAll(DB.profile), queryAll(DB.comms),
      queryAll('58ec87a90749457f95198bb00dbedc3a').catch(()=>[]),      // Companies (database id, not collection id)
      queryAll('cf0c3a3f8c1847c1b72e97e32b72b31c').catch(()=>[]),      // Reps
      queryAll(DB.tasks).catch(()=>[]),                                // Sales Tasks
      queryAll(DB.activity).catch(()=>[]),                             // Activity (PostHog), keyed by email
      queryAll(DB.demos).catch(()=>[]),                                // Demos (scores, duration, outcome)
      queryAll('626b88f8a8954225b29a5c313b12f03d').catch(()=>[]),      // Quotes Library (liked quotes)
      queryAll('927cb597503d457494fda0d6fa1d49c5').catch(()=>[]),      // Demo Preps (database id)
      queryAll('e532881e49104104aba6c8a7e708de33').catch(()=>[]),      // Sales Critiques (database id)
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

    // Company profile (client type + report types) for engineer/reporting derivation
    const multi = p => ((p && p.multi_select) || []).map(o => o.name);
    const companyInfo = {};
    for (const c of companies) {
      const p = c.properties || {};
      companyInfo[c.id] = {
        clientType: sel(p['Client Type']) || '',
        reportTypes: multi(p['Report Types']),
        reportVolume: txt(p['Report Volume']) || '',
        industry: txt(p['Industry']) || '',
      };
    }

    // Demo Preps grouped by contact (newest first)
    const prepsByContact = {};
    for (const r of demoPrepsAll) {
      const p = r.properties || {};
      const cid = rel(p['Contact'])[0]; if (!cid) continue;
      (prepsByContact[cid] = prepsByContact[cid] || []).push({
        id: r.id, name: txt(p['Name']) || 'Demo Prep',
        subtitle: txt(p['Subtitle']) || '',
        content: txt(p['Prep Content']) || '',
        engineerTypes: txt(p['Engineer Types']) || '',
        reportingTypes: txt(p['Reporting Types']) || '',
        keyAngles: txt(p['Key Angles']) || '',
        snapshot: txt(p['Snapshot']) || '',
        painPoints: txt(p['Pain Points']) || '',
        objections: txt(p['Objections']) || '',
        whatTheyWant: txt(p['What They Want']) || '',
        criticalQuestions: txt(p['Critical Questions']) || '',
        companyKnowledge: txt(p['Company Knowledge']) || '',
        status: sel(p['Status']) || '',
        doc: fileUrl(p['Source Doc']) || '',
        created: dat(p['Created']) || '',
      });
    }
    // Sales Critiques grouped by contact (newest first)
    const critiquesByContact = {};
    for (const r of critiquesAll) {
      const p = r.properties || {};
      const cid = rel(p['Contact'])[0]; if (!cid) continue;
      (critiquesByContact[cid] = critiquesByContact[cid] || []).push({
        id: r.id, name: txt(p['Name']) || 'Sales Critique',
        subtitle: txt(p['Subtitle']) || '',
        grade: txt(p['Grade']) || '',
        verdict: txt(p['Verdict']) || '',
        content: txt(p['Critique Content']) || '',
        wentWell: txt(p['What Went Well']) || '',
        toImprove: txt(p['To Improve']) || '',
        nextMove: txt(p['Next Move']) || '',
        score: num(p['Score']),
        status: sel(p['Status']) || '',
        doc: fileUrl(p['Source Doc']) || '',
        created: dat(p['Created']) || '',
      });
    }
    const byCreatedDesc = (a,b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0);
    for (const k in prepsByContact) prepsByContact[k].sort(byCreatedDesc);
    for (const k in critiquesByContact) critiquesByContact[k].sort(byCreatedDesc);

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
        owner: sel(p['Owner']), starred: chk(p['Starred']), attendees: txt(p['Attendees']), liked: txt(p['Liked']), myNote: txt(p['My Note']),
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
    const todayISO = new Date().toISOString().slice(0,10);
    const demoByContact = {};
    const upcomingByContact = {};   // soonest future Scheduled demo per contact
    const demosByContact = {};      // ALL demos per contact (for the Demos card)
    const bestScoreByContact = {};  // max demo Score% per contact (mirrors Notion Best Score rollup)
    // Demo Score% = (Fit + Readiness + Urgency + Confirmation) / 20 * 100, when those ratings exist.
    const demoScorePct = (p) => {
      const parts = [num(p['Fit']), num(p['Readiness']), num(p['Urgency']), num(p['Confirmation'])];
      const vals = parts.filter(v => v != null);
      if (!vals.length) { const ss = num(p['Sales Score']); return ss != null ? ss : null; }
      const sum = vals.reduce((a,b)=>a+b,0);
      return Math.round((sum / (vals.length * 5)) * 100);
    };
    for (const d of demosAll) {
      const p = d.properties || {};
      const cid = rel(p['Contact'])[0]; if (!cid) continue;
      const iso = dat(p['Scheduled Date']) || '';
      const outcome = sel(p['Outcome']) || '';
      const dScore = demoScorePct(p);
      if (dScore != null) { const b = bestScoreByContact[cid]; if (b == null || dScore > b) bestScoreByContact[cid] = dScore; }
      const rec = {
        demoId: d.id, iso, date: fmt(iso), outcome,
        salesScore: num(p['Sales Score']), clientRating: num(p['Client Rating']),
        scorePct: dScore,
        duration: round5(num(p['Duration (min)'])),
        sentiment: sel(p['Sentiment']) || '',
        nextSteps: txt(p['Next Steps']) || '', followUp: txt(p['Follow-up to Send']) || '',
        liked: (quotesByDemo[d.id] || []),
      };
      // full list record for the Demos card (only real held/scheduled demos, not comms rows)
      const dtype = sel(p['Type']) || (outcome === 'Scheduled' ? 'Demo' : 'Demo');
      const dnote = txt(p['Executive Summary']) || txt(p['Summary Line']) || txt(p['Next Steps']) || '';
      (demosByContact[cid] = demosByContact[cid] || []).push({
        demoId: d.id, iso, date: fmt(iso), outcome,
        type: dtype, duration: round5(num(p['Duration (min)'])),
        attendees: txt(p['Attendees']) || '', note: dnote,
      });
      const prev = demoByContact[cid];
      // prefer Held; among same tier prefer the most recent date
      const isHeld = outcome === 'Held', prevHeld = prev && prev.outcome === 'Held';
      if (!prev || (isHeld && !prevHeld) || (isHeld === prevHeld && iso > (prev.iso || ''))) demoByContact[cid] = rec;
      // track soonest FUTURE scheduled demo separately
      if (outcome === 'Scheduled' && iso && iso.slice(0,10) >= todayISO) {
        const u = upcomingByContact[cid];
        if (!u || iso < u.iso) upcomingByContact[cid] = rec;
      }
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
      // Migrated overlay fields now live on the CONTACT; fall back to profile during transition.
      const cNextMeeting = fmt(dat(p['Next Meeting'])) || prof.nextMeeting || (upcomingByContact[pg.id] ? upcomingByContact[pg.id].date : '') || '';
      const cEngaged = chk(p['Engaged']) || prof.engaged === true;
      const engaged = cEngaged || !!cNextMeeting;
      return {
        id: pg.id, contactId: pg.id, profileId: prof.profileId || '',
        name: nm,
        engaged,
        activityDate: latestAct ? latestAct.iso : '',
        lastActivity: latestAct ? `${latestAct.d}: ${latestAct.note}` : '',
        activityLog: acts.map(a => ({ d: a.d, note: a.note })),
        myNote: txt(p['My Note']) || prof.myNote || '',
        company: companyName[rel(p['Company'])[0]] || '',
        companyId: rel(p['Company'])[0] || '',
        engineerTypes: (txt(p['Engineer Types']) || (prepsByContact[pg.id]?.[0]?.engineerTypes) || (companyInfo[rel(p['Company'])[0]]?.clientType) || ''),
        reportingTypes: (txt(p['Reporting Types']) || (prepsByContact[pg.id]?.[0]?.reportingTypes) || ((companyInfo[rel(p['Company'])[0]]?.reportTypes)||[]).join(', ') || (companyInfo[rel(p['Company'])[0]]?.reportVolume) || ''),
        demoPreps: (prepsByContact[pg.id] || []),
        salesCritiques: (critiquesByContact[pg.id] || []),
        readiness: {
          likes:   num(p['R: Likes It']),      likesNote:  txt(p['R: Likes It Note']) || '',
          sees:    num(p['R: Sees Use']),      seesNote:   txt(p['R: Sees Use Note']) || '',
          invite:  num(p['R: Invite Others']), inviteNote: txt(p['R: Invite Others Note']) || '',
          reach:   num(p['R: Reachable']),     reachNote:  txt(p['R: Reachable Note']) || '',
          tplAgreed: chk(p['Tpl: Agreed']), tplSent: chk(p['Tpl: Sent']), tplSetup: chk(p['Tpl: Setup']), tplAccepted: chk(p['Tpl: Accepted']),
          tplNote: txt(p['Tpl: Note']) || '',
          repCanMake: chk(p['Rep: Can Make']), repSample: chk(p['Rep: Sample']), repReal: chk(p['Rep: Real']),
          repNote: txt(p['Rep: Note']) || '',
          approved: chk(p['Approved By Mgmt']),
          demands: txt(p['Demands']) || '',
          approvalProcess: txt(p['Approval Process']) || '',
          whoApproves: txt(p['Who Approves']) || '',
          meetMgmt: sel(p['Meet Mgmt']) || '', meetMgmtNote: txt(p['Meet Mgmt Note']) || '',
          roleType: sel(p['Role Type']) || '', roleDesc: txt(p['Role Description']) || ''
        },
        email: email(p['Email']), phone: phone(p['Phone']),
        hubspot: url(p['HubSpot']),
        photo: fileUrl(p['Picture']),
        stage: sel(p['Pipeline Stage']) || '',
        sentiment: sel(p['Sentiment']) || 'Warm',
        owner: sel(p['Owner']) || prof.owner || repName[rel(p['Booked By'])[0]] || 'Boris',
        starred: chk(p['Starred']),
        bookedBy: repName[rel(p['Booked By'])[0]] || '',
        score: (num(p['Score']) ?? bestScoreByContact[pg.id] ?? prof.score ?? 50),
        engineers: num(p['Engineers']) ?? prof.engineers ?? 0,
        reportsMonth: num(p['Reports/mo']) ?? prof.reportsMonth ?? 0,
        blocker: txt(p['Blocker']) || prof.blocker || '',
        trialEnds: fmt(dat(p['Trial Ends'])) || prof.trialEnds || '',
        nextMeeting: cNextMeeting,
        execText: prof.execText || '',
        attendees: (prof.attendees || '').split('·').map(s => s.trim()).filter(Boolean),
        liked: (prof.liked || '').split(';').map(s => s.trim()).filter(Boolean),
        status: prof.status || txt(p['Summary Line']) || '',
        activity: prof.activity || '',
        next: { txt: txt(p['Next Step']) || prof.nextStep || '', date: prof.nextDate || '' },
        comms: commsByContact[pg.id] || [],
        demo: demoByContact[pg.id] || null,
        demos: (demosByContact[pg.id] || []).slice().sort((a,b)=>(b.iso||'').localeCompare(a.iso||'')),
        demoDate: (demoByContact[pg.id] && demoByContact[pg.id].iso) || '',
        upcomingDemo: upcomingByContact[pg.id] || null,
        upcomingDate: (upcomingByContact[pg.id] && upcomingByContact[pg.id].iso) || '',
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
