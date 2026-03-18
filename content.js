// content.js — Detects LinkedIn job view changes and notifies the side panel
//              + Option B: MutationObserver for Company People Tab

// ── Shared state (declared first to avoid TDZ when onNavChange runs on init) ─
let lastJobId      = null;
let obSeenUrls          = new Set();
let obPending           = [];
let obDebounce          = null;
let obInitialScrape     = null; // tracked so stopPeopleObserver can cancel it
let peopleObserver      = null;
let _checkPeopleTimer   = null; // debounce handle for checkPeopleTab

// ── Job change detection ──────────────────────────────────────────────────────

function getJobId() {
  const m = location.href.match(/\/jobs\/view\/(\d+)/) ||
             location.href.match(/currentJobId=(\d+)/);
  return m ? m[1] : null;
}

function findCompanySlug() {
  // ── Priority 1: specific known selectors for the job detail pane ──────────
  const specificSelectors = [
    '.job-details-jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name a',
    '.jobs-details-top-card__company-url',
    '.topcard__org-name-link',
    '.job-details-jobs-unified-top-card__primary-description-without-tagline a[href*="/company/"]',
  ];

  for (const sel of specificSelectors) {
    const el = document.querySelector(sel);
    if (!el?.href) continue;
    const m = el.href.match(/\/company\/([^/?#]+)/);
    if (!m) continue;
    const s = m[1].toLowerCase().replace(/\/$/, '').split('?')[0];
    if (!['linkedin', 'jobs', 'showcase'].includes(s)) return s;
  }

  // ── Priority 2: search only inside the detail pane container ─────────────
  const detailPane = document.querySelector(
    '.jobs-search__job-details--wrapper, .scaffold-layout__detail, .job-view-layout, .jobs-details'
  );

  if (detailPane) {
    for (const el of detailPane.querySelectorAll('a[href*="/company/"]')) {
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

function tryNotify(jobId, attempt = 0) {
  const slug = findCompanySlug();
  if (slug) {
    chrome.runtime.sendMessage({ action: 'jobChanged', companySlug: slug }).catch(() => {});
    return;
  }
  if (attempt < 5) setTimeout(() => tryNotify(jobId, attempt + 1), 1000);
}

function onNavChange() {
  const jobId = getJobId();
  if (jobId && jobId !== lastJobId) {
    lastJobId = jobId;
    setTimeout(() => tryNotify(jobId), 1500);
  }
  // Debounce checkPeopleTab — LinkedIn fires pushState multiple times per search
  // change; waiting 600ms ensures we only restart the observer once per navigation.
  clearTimeout(_checkPeopleTimer);
  _checkPeopleTimer = setTimeout(checkPeopleTab, 600);
}

const _push = history.pushState.bind(history);
history.pushState = (...a) => { _push(...a); onNavChange(); };

const _replace = history.replaceState.bind(history);
history.replaceState = (...a) => { _replace(...a); onNavChange(); };

window.addEventListener('popstate', onNavChange);
onNavChange();

// ── Option B: MutationObserver for Company People Tab ────────────────────────

const OB_RECRUITER_PATTERNS = [
  /\brecruit/i,
  /\btalent\b/i,
  /\bsourc/i,
  /\brecruiting\s*coord/i,
  /\btalent\s*coord/i,
  /\bhr\s*coord/i,
  /\bpeople\s*coord/i,
  /\bacquisition\b/i,
];

const OB_EXCLUDE_PATTERNS = [
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

function isRecruiterCard(title) {
  if (!title || !title.trim()) return false;
  return OB_RECRUITER_PATTERNS.some(p => p.test(title)) &&
         !OB_EXCLUDE_PATTERNS.some(p => p.test(title));
}

function getPeopleSlug() {
  const m = location.pathname.match(/\/company\/([^/]+)\/people/);
  return m ? m[1].toLowerCase() : null;
}

function scrapeVisiblePeopleCards() {
  const results = [];
  document.querySelectorAll('.artdeco-entity-lockup').forEach(card => {
    const anchor = card.querySelector('a[href*="/in/"]');
    if (!anchor) return;
    const url = anchor.href.split('?')[0].replace(/\/$/, '');
    const nameEl  = card.querySelector('.artdeco-entity-lockup__title');
    const titleEl = card.querySelector('.artdeco-entity-lockup__subtitle');
    const photoEl = card.querySelector('img.ghost-person__img, img[class*="presence-entity__image"], img[class*="EntityPhoto"]');
    const name  = nameEl?.innerText?.trim() || '';
    const title = titleEl?.innerText?.trim() || '';
    if (!name || !url) return;
    if (!isRecruiterCard(title)) return;
    results.push({ name, title, url, photo: photoEl?.src || null });
  });
  return results;
}

function flushObserved(slug) {
  if (!obPending.length) return;
  const batch = [...obPending];
  obPending = [];
  chrome.runtime.sendMessage({
    action: 'observedRecruiters',
    companySlug: slug,
    recruiters: batch,
  }).catch(() => {});
}

function startPeopleObserver() {
  const slug = getPeopleSlug();
  if (!slug) return;

  // Delay initial scrape so the DOM has settled after SPA navigation.
  // Timer is tracked so stopPeopleObserver() can cancel it if another URL change fires.
  obInitialScrape = setTimeout(() => {
    obInitialScrape = null;
    const currentSlug = getPeopleSlug();
    if (!currentSlug || !peopleObserver) return;
    scrapeVisiblePeopleCards().forEach(r => {
      if (!obSeenUrls.has(r.url)) {
        obSeenUrls.add(r.url);
        obPending.push(r);
      }
    });
    if (obPending.length) {
      clearTimeout(obDebounce);
      obDebounce = setTimeout(() => flushObserved(currentSlug), 800);
    }
  }, 1200);

  peopleObserver = new MutationObserver(() => {
    const currentSlug = getPeopleSlug();
    if (!currentSlug) { stopPeopleObserver(); return; }
    let hadNew = false;
    scrapeVisiblePeopleCards().forEach(r => {
      if (!obSeenUrls.has(r.url)) {
        obSeenUrls.add(r.url);
        obPending.push(r);
        hadNew = true;
      }
    });
    if (hadNew) {
      clearTimeout(obDebounce);
      obDebounce = setTimeout(() => flushObserved(currentSlug), 800);
    }
  });

  peopleObserver.observe(document.body, { childList: true, subtree: true });
}

function stopPeopleObserver() {
  if (peopleObserver) { peopleObserver.disconnect(); peopleObserver = null; }
  clearTimeout(obInitialScrape); obInitialScrape = null;
  clearTimeout(obDebounce);
  obPending = [];
}

function checkPeopleTab() {
  if (getPeopleSlug()) {
    // Always restart on any URL change while on a people page
    // (covers search param changes like ?keywords=..., filters, etc.)
    stopPeopleObserver();
    obSeenUrls = new Set();
    startPeopleObserver();
  } else {
    stopPeopleObserver();
  }
}

// ── Respond to popup requesting current people-tab state (e.g. on panel open) ─
chrome.runtime.onMessage.addListener((request) => {
  // When user dismisses the notification, un-mark those URLs so the observer
  // can re-detect them if they appear again after a search change or scroll.
  if (request.action === 'unmarkObservedUrls') {
    (request.urls || []).forEach(url => obSeenUrls.delete(url));
    return;
  }

  if (request.action !== 'requestPeopleState') return;
  const slug = getPeopleSlug();
  if (!slug) return;
  const current = scrapeVisiblePeopleCards();
  current.forEach(r => obSeenUrls.add(r.url)); // mark as seen so observer won't double-send
  if (current.length) {
    chrome.runtime.sendMessage({
      action: 'observedRecruiters',
      companySlug: slug,
      recruiters: current,
    }).catch(() => {});
  }
});
