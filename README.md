# Tenera — Customer Cockpit (Vercel)

A Notion-backed sales cockpit: prioritized customer list on the left, full profile on the right
(memory refresh, 8 chase-signals, exec summary, comms timeline, nurture/response tracking,
log-call / email-sent, tasks, and one-click "Call in Teams").

- **Front end:** `public/index.html` (zero-build static page). Works standalone with sample data,
  and automatically switches to live Notion data when the API is available.
- **API (serverless):** `api/*.js` — reads/writes your Notion CRM using `NOTION_TOKEN`.

---

## What you need first
A **Notion internal integration** connected to the **Tenera Sales CRM** page, and its `ntn_…` secret.
(notion.so/my-integrations → New integration → Read + Insert + Update content → then open the
Tenera Sales CRM page → ••• → Connections → add it.) This is the same token used elsewhere.

---

## Deploy — Option A: Vercel dashboard (no terminal)
1. Put this folder in a **new GitHub repo** (drag the files into github.com/new, or push it).
2. Go to **vercel.com → Add New… → Project → Import** that repo.
3. **Framework Preset: Other.** Leave build/output blank (it's a static site + `api/` functions).
4. **Environment Variables →** add `NOTION_TOKEN = ntn_…` (and any optional DB overrides from `.env.example`).
5. **Deploy.** You'll get a `https://your-project.vercel.app` URL. Open it — the cockpit loads live from Notion.

## Deploy — Option B: Vercel CLI (fastest)
```bash
npm i -g vercel            # once
cd tenera-cockpit
vercel                     # first run: creates the project (accept defaults; "Other" framework)
vercel env add NOTION_TOKEN     # paste your ntn_… secret (choose Production + Preview)
vercel --prod              # deploys to your live URL
```
To update later: change files → `vercel --prod` (or just `git push` if using Option A).

Run locally with `vercel dev` (serves the page + API at http://localhost:3000).

---

## How it works
- `GET /api/customers` → reads **Customer Profile** + **Communications Log**, returns the list the UI renders
  (photo comes from the Notion-hosted `Picture`, so it always loads).
- `POST /api/log` → logs a **call** (no-answer / connected + transcript) or **email** to the Comms Log;
  transcript goes in the row **body**, and `HS Logged=false` so the n8n HubSpot flow syncs the **summary only**.
- `POST /api/update` → updates a field (phone, owner/"leading", next step, stage, sentiment, blocker).
- `POST /api/task` → creates a sales task (needs `TASKS_DB`).

## To light up every field
The UI shows the full AE picture (Priority, score, deal size, 8 signals, etc.). A few of those read from
**new Notion properties** — add these once and the app fills them automatically (blank until then):
- **Communications Log:** `Channel` option **Call**, `Call Outcome` (select), `HS Logged` (checkbox), `HubSpot Engagement ID` (text)
- **Customer Profile:** `Score` (number), `Reports/mo` (number), `Engineers` (number), `Booked By` (select), `Blocker` (text), `Trial Ends` (date), `Next Meeting` (date)
- **Demos:** `Engineers`, `Reports/mo`, `Attendees`, `Type` (Demo / First-Report / Check-in)

(The `/Update_CustomerState` skill + its n8n flow keep these populated — see the separate files.)

Until those exist, the app still runs: it shows what's in Notion and falls back to the built-in sample
for anything missing.
