import { searchLinkedInCompanies } from './company-search.js';
import { runScraper } from './scan-runner.js';

// background.js — Service worker that orchestrates everything

// ── Side panel setup ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});


// ── Recruiter filter patterns ─────────────────────────────────────────────────

const SEARCH_QUERY = 'technical,tech,recruiter,talent,hiring,coordinator';

const RECRUITER_TITLE_PATTERNS = [
  /\brecruit/i,
  /\btalent\b/i,
  /\bsourc/i,
  /\brecruiting\s*coord/i,
  /\btalent\s*coord/i,
  /\bhr\s*coord/i,
  /\bpeople\s*coord/i,
  /\bacquisition\b/i,
];

const EXCLUDE_TITLE_PATTERNS = [
  /engineer/i,
  /software/i,
  /developer/i,
  /designer/i,
  /executive/i,
  /analyst/i,
  /marketing/i,
  /sales/i,
  /product/i,
  /finance/i,
  /legal/i,
  /\bdata\b/i,
  /devops/i,
  /network/i,
  /security/i,
  /customer/i,
  /account\s+exec/i,
  /deployment/i,
  /training/i,
  /writer/i,
  /payroll/i,
];

function isRecruiter(title) {
  if (!title || title.trim() === '') return false;
  const allowed = RECRUITER_TITLE_PATTERNS.some(p => p.test(title));
  if (!allowed) return false;
  const excluded = EXCLUDE_TITLE_PATTERNS.some(p => p.test(title));
  return !excluded;
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

const CACHE_KEY = 'recruiterHistory';

function getStoredCache() {
  return new Promise(r => chrome.storage.local.get([CACHE_KEY], d => r(d[CACHE_KEY] || {})));
}

async function saveToStoredCache(slug, recruiters, logoUrl) {
  const cache = await getStoredCache();
  cache[slug] = {
    recruiters, logoUrl,
    scannedAt: Date.now(),
    displayName: cache[slug]?.displayName || slug.replace(/-/g, ' ')
  };
  return new Promise(r => chrome.storage.local.set({ [CACHE_KEY]: cache }, r));
}

// ── Auto-scan queue (runs even with panel closed) ─────────────────────────────

const activeScans = new Set();  // slugs currently being scanned (manual or auto)
const autoQueue   = [];         // slugs waiting for auto-scan
let   autoWorking = false;

async function processAutoQueue() {
  if (autoWorking) return;
  autoWorking = true;
  while (autoQueue.length > 0) {
    const slug = autoQueue.shift();
    if (activeScans.has(slug)) continue; // already being scanned manually
    activeScans.add(slug);
    chrome.storage.session.set({ autoScanSlug: slug, autoScanQueue: [...autoQueue] }).catch(() => {});
    try {
      const { recruiters, logoUrl } = await runScraper(slug, {
        createTab,
        waitForTabLoad,
        sleep,
        navigateTab,
        scrapeTab,
        scrapeTabWithHiringFrame,
        isRecruiter,
        SEARCH_QUERY,
      });
      if (recruiters.length > 0) await saveToStoredCache(slug, recruiters, logoUrl);
      chrome.runtime.sendMessage({ action: 'scanComplete', companySlug: slug, count: recruiters.length }).catch(() => {});
    } catch (e) {}
    activeScans.delete(slug);
  }
  chrome.storage.session.set({ autoScanSlug: null, autoScanQueue: [] }).catch(() => {});
  autoWorking = false;
}

function enqueueAutoScan(slug) {
  if (activeScans.has(slug) || autoQueue.includes(slug)) return;
  autoQueue.push(slug);
  chrome.storage.session.set({ autoScanQueue: [...autoQueue] }).catch(() => {});
  processAutoQueue();
}

// ── Watch for LinkedIn job URL changes (works with panel closed) ──────────────

let lastAutoUrl = '';

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  if (changeInfo.url === lastAutoUrl) return;
  if (!changeInfo.url.includes('linkedin.com/jobs')) return;
  lastAutoUrl = changeInfo.url;

  const { autoScanEnabled } = await new Promise(r => chrome.storage.local.get(['autoScanEnabled'], r));
  if (!autoScanEnabled) return;

  setTimeout(async () => {
    let slug = null;
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const sels = [
            '.job-details-jobs-unified-top-card__company-name a',
            '.jobs-unified-top-card__company-name a',
            '.jobs-details-top-card__company-url',
            '.topcard__org-name-link',
            '.job-details-jobs-unified-top-card__primary-description-without-tagline a[href*="/company/"]',
          ];
          for (const sel of sels) {
            const el = document.querySelector(sel);
            if (!el?.href) continue;
            const m = el.href.match(/\/company\/([^/?#]+)/);
            if (!m) continue;
            const s = m[1].toLowerCase().replace(/\/$/, '').split('?')[0];
            if (!['linkedin', 'jobs', 'showcase'].includes(s)) return s;
          }
          const pane = document.querySelector(
            '.jobs-search__job-details--wrapper, .scaffold-layout__detail, .job-view-layout, .jobs-details'
          );
          if (pane) {
            for (const el of pane.querySelectorAll('a[href*="/company/"]')) {
              const r = el.getBoundingClientRect();
              if (!r.width || !r.height) continue;
              const m = el.href.match(/\/company\/([^/?#]+)/);
              if (!m) continue;
              const s = m[1].toLowerCase().replace(/\/$/, '').split('?')[0];
              if (!['linkedin', 'jobs', 'showcase'].includes(s)) return s;
            }
          }
          return null;
        }
      });
      slug = res[0]?.result;
    } catch (e) {}

    if (!slug) return;
    const cache = await getStoredCache();
    if (cache[slug]) return; // already cached
    enqueueAutoScan(slug);
  }, 1000);
});

// ── Manual scan entry point ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'start') {
    const slug = request.companySlug;
    activeScans.add(slug);
    // Track in session so popup can recover if the panel is closed mid-scan
    chrome.storage.session.set({ manualScanSlug: slug, manualScanDone: false, manualScanError: false }).catch(() => {});
    runScraper(slug, {
      createTab,
      waitForTabLoad,
      sleep,
      navigateTab,
      scrapeTab,
      scrapeTabWithHiringFrame,
      isRecruiter,
      SEARCH_QUERY,
    })
      .then(async ({ recruiters, logoUrl }) => {
        activeScans.delete(slug);
        // Always persist to local cache so results survive panel close/reopen
        if (recruiters.length > 0) await saveToStoredCache(slug, recruiters, logoUrl);
        chrome.storage.session.set({ manualScanDone: true, manualScanLogoUrl: logoUrl || null }).catch(() => {});
        sendResponse({ success: true, data: recruiters, logoUrl });
      })
      .catch(err => {
        activeScans.delete(slug);
        chrome.storage.session.set({ manualScanDone: true, manualScanError: true }).catch(() => {});
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (request.action === 'fetchLogo') {
    fetchLogoForSlug(request.companySlug)
      .then(logoUrl => sendResponse({ logoUrl }))
      .catch(() => sendResponse({ logoUrl: null }));
    return true;
  }

  if (request.action === 'searchCompanies') {
    searchLinkedInCompanies(request.companyName, { createTab, waitForTabLoad, sleep })
      .then(companies => sendResponse({ success: true, companies }))
      .catch(() => sendResponse({ success: false, companies: [] }));
    return true;
  }
});


// ── Logo-only fetch (for backfilling old cache entries) ───────────────────────

async function fetchLogoForSlug(slug) {
  const url = `https://www.linkedin.com/company/${slug}/`;
  const tab = await createTab(url);
  try {
    await waitForTabLoad(tab.id);
    await sleep(1500);
    let logoUrl = null;
    for (let attempt = 0; attempt < 3 && !logoUrl; attempt++) {
      if (attempt > 0) await sleep(1000);
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            function getLicdnUrl(img) {
              if (!img) return null;
              if (img.closest('#global-nav, [class*="global-nav"], nav[aria-label]')) return null;
              for (const val of [img.src, img.getAttribute('data-delayed-url'), img.getAttribute('data-src')]) {
                if (val && val.includes('media.licdn.com') && !val.includes('ghost') && !val.includes('data:')) return val;
              }
              return null;
            }
            const url1 = getLicdnUrl(document.querySelector('img.org-top-card-primary-content__logo'));
            if (url1) return url1;
            for (const sel of [
              '.org-top-card-primary-content__logo-container img[alt$=" logo"]',
              '[class*="org-top-card"] img[alt$=" logo"]',
            ]) {
              const url2 = getLicdnUrl(document.querySelector(sel));
              if (url2) return url2;
            }
            for (const sel of [
              'img.org-top-card__logo', 'img.org-top-card-summary__logo',
              '[data-test-id="org-entity-logo"] img',
              '.org-top-card-primary-content__logo-container img',
            ]) {
              const url3 = getLicdnUrl(document.querySelector(sel));
              if (url3) return url3;
            }
            for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
              try {
                const d = JSON.parse(s.textContent);
                const val = d?.logo || d?.image;
                const u = typeof val === 'string' ? val : val?.url;
                if (u && u.includes('licdn.com')) return u;
              } catch (e) {}
            }
            return null;
          }
        });
        logoUrl = res[0]?.result || null;
      } catch (_) {}
    }
    chrome.tabs.remove(tab.id).catch(() => {});
    return logoUrl;
  } catch (err) {
    chrome.tabs.remove(tab.id).catch(() => {});
    throw err;
  }
}

// ── LinkedIn company search (for non-LinkedIn job pages) ──────────────────────
// Opens a hidden search tab, scrapes up to 7 company cards, closes tab.
// Uses a link-based approach that is resilient to LinkedIn DOM class changes.

// ── Helpers ───────────────────────────────────────────────────────────────────

function createTab(url) {
  return new Promise(resolve => chrome.tabs.create({ url, active: false }, resolve));
}

function navigateTab(tabId, url) {
  return new Promise(resolve => chrome.tabs.update(tabId, { url }, resolve));
}

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 15000);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, tab => {
      if (tab && tab.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

async function scrapeTab(tabId, maxPeople = 80) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: autoScrollAndScrape,
    args: [maxPeople],
  });
  return results[0]?.result || [];
}

// ── NEW: separate scrape function for #Hiring frame detection ─────────────────
// Completely isolated — only called when filtered.length === 0
async function scrapeTabWithHiringFrame(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: autoScrollAndScrapeWithHiringFrame,
  });
  return results[0]?.result || [];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Injected scraper — existing, untouched ────────────────────────────────────

function autoScrollAndScrape(maxPeople = 80) {
  return new Promise((resolve) => {
    let lastCount    = 0;
    let stableRounds = 0;

    function scrape() {
      const seen = new Set();
      const data = [];
      document.querySelectorAll('.artdeco-entity-lockup__title a[href*="/in/"]')
        .forEach(link => {
          const url     = link.href.split('?')[0].replace(/\/$/, '') + '/';
          const fullUrl = url.startsWith('http') ? url : 'https://www.linkedin.com' + url;
          if (seen.has(fullUrl)) return;
          seen.add(fullUrl);
          const name = link.textContent.trim();
          if (!name) return;
          const card = link.closest('.artdeco-entity-lockup, li');
          let title = '';
          let photoUrl = '';
          if (card) {
            const sub = card.querySelector('.artdeco-entity-lockup__subtitle');
            if (sub) title = sub.textContent.trim().replace(/\s+/g, ' ');
            const img = card.querySelector('img[src*="licdn.com"], img[src*="media.licdn"]');
            if (img?.src && img.src.startsWith('http')) photoUrl = img.src;
          }
          data.push({ name, title, url: fullUrl, photoUrl });
        });
      return data;
    }

    const interval = setInterval(() => {
      const current = document.querySelectorAll(
        '.artdeco-entity-lockup__title a[href*="/in/"]'
      ).length;

      // Stop early if we already have enough people to yield 20 recruiters
      if (current >= maxPeople) {
        clearInterval(interval);
        resolve(scrape());
        return;
      }

      window.scrollBy(0, 1000);
      const btn = [...document.querySelectorAll('button')].find(
        b => b.textContent.trim().toLowerCase().includes('show more results')
      );
      if (btn) btn.click();

      if (current === lastCount) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastCount = current;
      }

      if (stableRounds >= 3) {
        clearInterval(interval);
        resolve(scrape());
      }
    }, 600);

    setTimeout(() => {
      clearInterval(interval);
      resolve(scrape());
    }, 15000);
  });
}

// ── NEW: Injected scraper with #Hiring frame detection ────────────────────────
// Same scroll/scrape structure as above, adds hiringFrame detection per card.
// Does NOT modify autoScrollAndScrape above.

function autoScrollAndScrapeWithHiringFrame() {
  return new Promise((resolve) => {
    let lastCount    = 0;
    let stableRounds = 0;

    function scrape() {
      const seen = new Set();
      const data = [];

      document.querySelectorAll('.artdeco-entity-lockup__title a[href*="/in/"]')
        .forEach(link => {
          const url     = link.href.split('?')[0].replace(/\/$/, '') + '/';
          const fullUrl = url.startsWith('http') ? url : 'https://www.linkedin.com' + url;
          if (seen.has(fullUrl)) return;
          seen.add(fullUrl);

          const name = link.textContent.trim();
          if (!name) return;

          const card = link.closest('.artdeco-entity-lockup, li');
          let title = '';
          if (card) {
            const sub = card.querySelector('.artdeco-entity-lockup__subtitle');
            if (sub) title = sub.textContent.trim().replace(/\s+/g, ' ');
          }

          // ── #Hiring frame detection ──────────────────────────────────────
          // LinkedIn marks the hiring frame via aria-label on the img wrapper
          // or on the img itself. We check all common patterns.
          let hiringFrame = false;
          if (card) {
            const hiringKeywords = ['hiring', '#hiring', 'open to hiring'];

            // Check 1: aria-label on any element inside the card
            const ariaEls = card.querySelectorAll('[aria-label]');
            for (const el of ariaEls) {
              const label = (el.getAttribute('aria-label') || '').toLowerCase();
              if (hiringKeywords.some(k => label.includes(k))) {
                hiringFrame = true;
                break;
              }
            }

            // Check 2: img alt text
            if (!hiringFrame) {
              const imgs = card.querySelectorAll('img');
              for (const img of imgs) {
                const alt = (img.alt || '').toLowerCase();
                if (hiringKeywords.some(k => alt.includes(k))) {
                  hiringFrame = true;
                  break;
                }
              }
            }

            // Check 3: any element's title attribute
            if (!hiringFrame) {
              const titleEls = card.querySelectorAll('[title]');
              for (const el of titleEls) {
                const t = (el.getAttribute('title') || '').toLowerCase();
                if (hiringKeywords.some(k => t.includes(k))) {
                  hiringFrame = true;
                  break;
                }
              }
            }

            // Check 4: visible text inside the card (some LinkedIn versions
            // render a small "#Hiring" text label next to the photo)
            if (!hiringFrame) {
              const cardText = (card.innerText || '').toLowerCase();
              if (cardText.includes('#hiring')) hiringFrame = true;
            }
          }
          // ── end hiring frame detection ────────────────────────────────────

          let photoUrl = '';
          if (card) {
            const img = card.querySelector('img[src*="licdn.com"], img[src*="media.licdn"]');
            if (img?.src && img.src.startsWith('http')) photoUrl = img.src;
          }

          data.push({ name, title, url: fullUrl, hiringFrame, photoUrl });
        });

      return data;
    }

    const interval = setInterval(() => {
      window.scrollBy(0, 1000);
      const btn = [...document.querySelectorAll('button')].find(
        b => b.textContent.trim().toLowerCase().includes('show more results')
      );
      if (btn) btn.click();

      const current = document.querySelectorAll(
        '.artdeco-entity-lockup__title a[href*="/in/"]'
      ).length;

      if (current === lastCount) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastCount = current;
      }

      if (stableRounds >= 2) {
        clearInterval(interval);
        resolve(scrape());
      }
    }, 500);

    setTimeout(() => {
      clearInterval(interval);
      resolve(scrape());
    }, 15000);
  });
}
