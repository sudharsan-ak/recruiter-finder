# Setup & Reference

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the extension folder
5. The extension icon appears in your toolbar — click it or press `Alt+R` (`Cmd+Shift+R` on Mac) to open the side panel

> **Note:** This extension requires LinkedIn to be open in a tab. It navigates to company People tabs in background tabs to scrape recruiter data.

## File Structure

```
├── manifest.json            # MV3 manifest — permissions, content scripts, side panel
├── background.js            # Service worker — scraper, scan queue
├── background/
│   └── scan-runner.js       # Core scrape logic (People tab navigation + filtering)
├── aliases.js               # Manual company slug alias map
├── content/
│   ├── content-core.js      # LinkedIn job/company/people content logic
│   └── profile-content.js   # LinkedIn profile recruiter detection
├── popup/
│   ├── popup.html           # Side panel UI
│   ├── popup.js             # Side panel shell/state wiring
│   ├── cache/               # Cache read/write helpers
│   ├── history/             # History tab rendering
│   ├── meta/                # Company meta, JD copy/paste, tech stack
│   ├── bulk/                # Bulk scan panel
│   ├── search/              # Results rendering, profile check
│   └── styles/              # CSS per panel/component
├── tools/
│   └── jd-writer-server.js  # Local Node.js server for JD file writing
└── icons/                   # Extension icons (16, 32, 48, 128px)
```

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Query the active tab URL to detect LinkedIn job pages |
| `scripting` | Execute scraping scripts in background tabs |
| `storage` | Cache recruiter data and extension settings locally |
| `sidePanel` | Render the UI as a persistent Chrome side panel |
| `activeTab` | Read the current tab's URL and DOM |
| `<all_urls>` | Required for the any-site job description copy feature |

## Privacy

- All data is stored **locally** in your browser (`chrome.storage.local`)
- Nothing is sent to any external server
- The extension only accesses LinkedIn pages and only when you trigger a scan
- The local JD server (`tools/jd-writer-server.js`) only runs when you start it manually and only listens on `127.0.0.1`

## Known Limitations

- LinkedIn may change their DOM structure at any time, which can break selectors
- The People tab scraper is limited to ~20 recruiters per automated scan; use Observer mode (manual browse) to find more
- Background scraping opens temporary LinkedIn tabs — these are closed automatically after scraping
