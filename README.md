# LinkedIn Recruiter Finder

A Chrome extension (Manifest V3) that automatically finds recruiters at any company while you browse LinkedIn job postings. Opens as a persistent side panel and works in the background even when the panel is closed.

---
<img width="565" height="883" alt="image" src="https://github.com/user-attachments/assets/156a54f0-0ab2-45bf-9964-289a96ccd806" />

## Features

### Core Scan
- Click **Find Recruiters** from any LinkedIn job page — the extension reads the company, navigates to their People tab in a background tab, scrolls through results, and returns a filtered list of recruiters
- Hard cap of ~20 recruiters per scan (stops at 80 people collected) to keep scans fast
- Results are cached locally so revisiting the same company is instant

### Auto-Scan
- Toggle **Auto-scan as I browse** — the extension quietly scans each new company you view on LinkedIn without any manual action
- Only scans companies not already in cache

### Scan Queue
- While a scan is running, you can queue additional companies with **Add to Queue**
- The queue persists across panel close/reopen — if you close the panel mid-scan it picks up where it left off when you reopen it

### Observer Mode (Option B)
- When you manually browse a company's **People tab** on LinkedIn, a `MutationObserver` watches for recruiter cards as they appear in the DOM
- A green notification banner appears: *"X new recruiters spotted at [company]"*
- Click **👁 Show** to open a picker modal — select which ones to add, leave others pending
- Dismissing (✕) allows the notification to reappear the next time you search or scroll — it removes those URLs from the seen set so they can be re-detected
- Filters out anyone already saved in your cache for that company

### Recruiter Filtering
Titles must match at least one include pattern and no exclude patterns:

**Included:** recruit · talent · sourc(er/ing) · acquisition · recruiting/talent/HR/people coordinator

**Excluded:** engineer · software · developer · designer · executive · analyst · marketing · sales · product · finance · legal · data · devops · security · customer · payroll · writer · training

### Results Display
Recruiters are grouped into sections:
- 🔵 **Technical Recruiters** — technical / tech / sourcing in title
- 🟣 **Senior / Head of Recruiting** — senior / head / director / VP / lead
- 🟡 **Coordinators**
- 🩷 **Talent Acquisition**
- 🟢 **General Recruiters**

Per-result controls: copy link · remove · checkbox for bulk selection

Global controls: Expand All · Collapse All · Open All (background tabs) · Copy All · Copy Selected Links · Clear Selection

Per-section controls: Copy · Open All

### Filter / Search
Type to filter recruiters by name in real time. Section headers hide entirely when they have no matches. Clear with the ✕ button. Section collapse/expand works independently of the filter.

### History Tab
Full searchable history of all scanned companies. Per-company:
- Expand to see all saved recruiters
- Open All / Copy All links
- Per-recruiter checkboxes with **Copy Links** and **Open Tabs** selection bar
- Rename company display name inline
- Delete individual recruiters or entire company entry

### Bulk Scan
Paste a list of company names (one per line or comma-separated) and scan them all in sequence. Optional force re-scan to bypass cache.

### Import / Export
- **Export CSV** — all cached recruiters as a spreadsheet
- **Export Backup** / **Import Backup** — full JSON backup of your cache
- **Refresh Logos** — backfills missing company logos for older cache entries
<img width="578" height="887" alt="image" src="https://github.com/user-attachments/assets/8e74afb1-37a3-4508-8e36-80ea57f06d77" />

### Job Description Copy
From any LinkedIn job page, a **JD** button in the meta row lets you copy the job title + full job description to clipboard in one click. Works on both the jobs search view and direct `/jobs/view/` pages.

### Company Meta
Displays below the scan button for the current job:
- Employee count
- Visa sponsorship status (scraped from the JD)
- Years of experience required
- Tech stack detected from the JD

---

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the extension folder
5. The extension icon appears in your toolbar — click it or press `Alt+R` (`Cmd+Shift+R` on Mac) to open the side panel

> **Note:** This extension requires LinkedIn to be open in a tab. It navigates to company People tabs in background tabs to scrape recruiter data.

---

## Usage

1. Open any LinkedIn job posting
2. Press `Alt+R` or click the extension icon to open the side panel
3. Click **🚀 Find Recruiters** — the extension scans the company automatically
4. Results appear grouped by recruiter type
5. Use checkboxes + **Copy Selected Links** to copy profiles you want to reach out to

**For deeper searches:** Navigate to a company's People tab on LinkedIn and scroll/search — the observer will surface additional recruiters not found in the automated scan.

---

## File Structure

```
+-- manifest.json            # MV3 manifest � permissions, content scripts, side panel
+-- background.js            # Service worker � scraper, auto-scan queue
+-- aliases.js               # Manual company slug alias map
+-- content/
�   +-- content-core.js      # LinkedIn job/company/people content logic
�   +-- profile-content.js   # LinkedIn profile recruiter detection
+-- popup/
�   +-- popup.html           # Side panel UI � HTML + CSS
�   +-- popup.js             # Side panel shell/state wiring
�   +-- init.js
�   +-- cache/
�   +-- history/
�   +-- notifications/
�   +-- meta/
�   +-- bulk/
�   +-- scanner/
�   +-- storage/
+-- oldFiles/                # Legacy inactive reference files
+-- icons/                   # Extension icons (16, 32, 48, 128px)
```

---

## How the Scraper Works

1. Opens the company's LinkedIn People tab in a background tab
2. Searches with keywords: `technical, tech, recruiter, talent, hiring, coordinator`
3. Auto-scrolls and clicks "Show more results" until results stabilize or 15s timeout
4. Stops collecting after ~80 people (yields ~20 recruiters after filtering)
5. Filters by job title using include/exclude regex patterns
6. Saves results to `chrome.storage.local` — survives browser restarts

---

## Permissions Used

| Permission | Why |
|---|---|
| `tabs` | Query the active tab URL to detect LinkedIn job pages |
| `scripting` | Execute scraping scripts in background tabs |
| `storage` | Cache recruiter data and extension settings locally |
| `sidePanel` | Render the UI as a persistent Chrome side panel |
| `activeTab` | Read the current tab's URL and DOM |
| `<all_urls>` | Required for the "any site" job description copy feature |

---

## Privacy

- All data is stored **locally** in your browser (`chrome.storage.local`)
- Nothing is sent to any external server
- The extension only accesses LinkedIn pages and only when you trigger a scan

---

## Known Limitations

- LinkedIn may change their DOM structure at any time, which can break selectors
- The People tab scraper is limited to ~20 recruiters per automated scan; use the Observer (manual browse) to find more
- Auto-scan and background scraping open temporary LinkedIn tabs — these are closed automatically after scraping

---

## License

MIT

