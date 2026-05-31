# Feature Details

## Core Scan

Click **Find Recruiters** from any LinkedIn job page — the extension reads the company, navigates to their People tab in a background tab, filters to US-only results, and returns a list of recruiters. Results are cached locally so revisiting the same company is instant.

- Hard cap of ~20 recruiters per scan (stops at 80 people collected) to keep scans fast
- If fewer than 5 recruiters are found, automatically retries with keywords: `recruiter`, `talent`, `hiring`
- If no title-matched recruiters found, falls back to scanning for `#Hiring` profile frames

## Scan Queue

While a scan is running, you can queue additional companies with **Add to Queue**. The queue persists across panel close/reopen — if you close the panel mid-scan it picks up where it left off when you reopen it.

## Observer Mode

When you manually browse a company's **People tab** on LinkedIn, a `MutationObserver` watches for recruiter cards as they appear in the DOM.

- A green notification banner appears: *"X new recruiters spotted at [company]"*
- Click **👁 Show** to open a picker modal — select which ones to add, leave others pending
- Dismissing (✕) allows the notification to reappear the next time you search or scroll
- Filters out anyone already saved in your cache for that company

## Recruiter Filtering

Titles must match at least one include pattern and no exclude patterns.

**Included:** recruit · talent · sourcer/sourcing · acquisition · recruiting/talent/HR/people coordinator

**Excluded:** engineer · software · developer · designer · executive · analyst · marketing · sales · product · finance · legal · data · devops · security · customer · payroll · writer · training

## Results Display

Recruiters are grouped into sections:
- 🔵 **Technical Recruiters** — technical / tech / sourcing in title
- 🟣 **Senior / Head of Recruiting** — senior / head / director / VP / lead
- 🟡 **Coordinators**
- 🩷 **Talent Acquisition**
- 🟢 **General Recruiters**

Per-result controls: copy link · remove · checkbox for bulk selection

Global controls: Expand All · Collapse All · Open All · Copy All Links · Copy Links + Emails

Per-section controls: Copy · Open All

## Filter / Search

Type to filter recruiters by name in real time. Section headers hide when they have no matches. Clear with the ✕ button.

## History Tab

Full searchable history of all scanned companies. Per-company:
- Expand to see all saved recruiters
- Copy Links · Copy Emails · Copy Links + Emails
- Per-recruiter checkboxes with bulk selection bar
- Rename company display name inline
- Delete individual recruiters or entire company entry

## Bulk Scan

Paste a list of company names (one per line or comma-separated) and scan them all in sequence. Optional force re-scan to bypass cache.

## Import / Export

- **Export CSV** — all cached recruiters as a spreadsheet
- **Export XLSX** — Excel format
- **Export Backup** / **Import Backup** — full JSON backup of your cache
- **Refresh Logos** — backfills missing company logos for older cache entries

## Company Meta

Displayed below the scan button for the current job:
- Employee count
- Visa sponsorship status (scraped from the JD)
- Years of experience required
- Tech stack detected from the JD

## JD Workflow

Three buttons appear in the meta bar when you're on a LinkedIn job page: **📋 JD**, **✎ Paste JD**, and **📷 Paste JD IMG**.

### 📋 JD — Copy Job Description
Copies the job title, job link, and full JD to clipboard in one click. Also writes the entry to your local JD file if the server is running. Works on both the jobs search view and direct `/jobs/view/` pages. On LinkedIn collections pages (`/jobs/collections/`), falls back to opening the canonical job URL in a background tab to extract the description.

### ✎ Paste JD — Manual Paste
Opens a modal pre-filled with the current company and role. Paste any job description text, hit Save — the entry is written to your local JD file and the modal closes.

### 📷 Paste JD IMG — Paste Screenshots
Opens a persistent modal (stays open until you close it). Ctrl+V to paste screenshots one by one — each appears as a thumbnail preview with an × to remove. Hit Save — images are saved as `.png` files next to your JD file and relative markdown links are written into the file, identical to VS Code's native image paste. Click any thumbnail to view it full-size.

### Local JD Writer Server

To enable file saving, run the bundled helper server:

```bash
node tools/jd-writer-server.js "/path/to/JD Text.md" 4545
```

- Listens on `http://127.0.0.1:4545`
- Writes each JD as a numbered entry: `Company`, `Role`, `Job Link`, then the cleaned JD body
- Uses Groq (llama-3.1-8b-instant) to clean and summarize the JD if a `GROQ_API_KEY` is set in `.env`
- If the server is not running, clipboard copy still works normally
- Also provides a **✦ Answer** button to generate application question answers using your profile + the JD
