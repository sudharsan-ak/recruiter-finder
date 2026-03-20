if (globalThis.__recruiterFinderContentBooted) {
  setTimeout(() => {
    try {
      if (typeof checkProfilePage === 'function') checkProfilePage(true);
      if (typeof checkPeopleTab === 'function') checkPeopleTab();
      if (typeof updateCompanySlugMap === 'function') updateCompanySlugMap();
    } catch {}
  }, 100);
} else {
  globalThis.__recruiterFinderContentBooted = true;

// content.js — Detects LinkedIn job view changes and notifies the side panel
//              + Option B: MutationObserver for Company People Tab

// -Shared state (declared first to avoid TDZ when onNavChange runs on init) ─
let lastJobId      = null;
let obSeenUrls          = new Set();
let obPending           = [];
let obDebounce          = null;
let obInitialScrape     = null; // tracked so stopPeopleObserver can cancel it
let peopleObserver      = null;
let _checkPeopleTimer   = null; // debounce handle for checkPeopleTab
let _lastProfileUrl     = null; // prevents re-checking same profile on repeat nav events
let _profileCheckSeq    = 0;    // ensures stale async profile checks cannot overwrite newer ones

// -Job change detection ──────────────────────────────────────────────────────

function getJobId() {
  const m = location.href.match(/\/jobs\/view\/(\d+)/) ||
             location.href.match(/currentJobId=(\d+)/);
  return m ? m[1] : null;
}

function findCompanySlug() {
  // -Priority 1: specific known selectors for the job detail pane ──────────
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

  // -Priority 2: search only inside the detail pane container ─────────────
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
  _checkPeopleTimer = setTimeout(() => {
    checkPeopleTab();
    checkProfilePage();
    updateCompanySlugMap();
  }, 600);
}

if (!window.__recruiterFinderInitialized) {
  window.__recruiterFinderInitialized = true;

  const _push = history.pushState.bind(history);
  history.pushState = (...a) => { _push(...a); onNavChange(); };

  const _replace = history.replaceState.bind(history);
  history.replaceState = (...a) => { _replace(...a); onNavChange(); };

  window.addEventListener('popstate', onNavChange);
  onNavChange();
} else {
  // Re-injection after extension reload: pushState already wrapped, but we still need
  // to trigger checks since onNavChange won't fire automatically on a static page.
  setTimeout(() => { checkProfilePage(true); checkPeopleTab(); updateCompanySlugMap(); }, 100);
}

// -Option B: MutationObserver for Company People Tab ────────────────────────

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

// -Company slug alias map ────────────────────────────────────────────────────
// When the user visits a company page we record: normalizedCompanyName → canonicalSlug.
// e.g. visiting /company/joinonepay/ with h1 "OnePay" stores {"onepay":"joinonepay"}.
// Profile page detection looks up this map first — no network request needed.

function updateCompanySlugMap() {
  const m = location.pathname.match(/^\/company\/([^/?#]+)/);
  if (!m) return;
  const canonicalSlug = m[1].toLowerCase();

  setTimeout(() => {
    const h1 = document.querySelector('h1');
    const companyName = h1?.innerText?.trim();
    if (!companyName) return;

    const normalizedName = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedSlug = canonicalSlug.replace(/-/g, '');
    // Skip trivial self-mappings (name and slug are essentially the same string)
    if (!normalizedName || normalizedName === normalizedSlug) return;

    chrome.storage.local.get('companySlugMap', data => {
      const map = data.companySlugMap || {};
      if (map[normalizedName] === canonicalSlug) return; // already stored
      map[normalizedName] = canonicalSlug;
      chrome.storage.local.set({ companySlugMap: map });
    });
  }, 1000);
}

// -Profile page recruiter detection ─────────────────────────────────────────

// Parse company name from headline text like "Technical Recruiter @ OnePay | Fintech"
// Used only as a last-resort fallback when experience section has no company links.
function extractCompanyFromHeadline(titleText) {
  const m = titleText.match(/(?:\bat\s+|@\s*)([^|(@\n,·•]+)/i);
  if (!m) return null;
  const name = m[1].trim().replace(/\s*\(.*$/, '').trim();
  if (!name || name.length > 80) return null;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug ? { name, slug } : null;
}

// Find the experience section <section> element, or null.
function findExpSection() {
  const anchor = document.getElementById('experience');
  if (anchor) {
    return anchor.closest('section') || anchor.parentElement?.closest('section') || null;
  }
  return [...document.querySelectorAll('section')].find(s =>
    /\bexperience\b/i.test(s.querySelector('h2,h3,[aria-label*="Experience" i]')?.textContent || s.textContent || '')
  ) || null;
}

// Read the first entry from the experience section.
// Returns { jobTitle, slug, name, numericCandidate } or null if section not found/empty.
function getFirstExperienceEntry() {
  const expSection = findExpSection();
  if (!expSection) return null;

  // Job title: LinkedIn renders hidden spans with aria-hidden="true" for screen-reader dups;
  // visible text is in the first non-empty span[aria-hidden="true"] inside the first list item.
  let jobTitle = '';
  const firstItem = expSection.querySelector('li, .pvs-list__paged-list-item, .pvs-list__item--line-separated');
  if (firstItem) {
    for (const span of firstItem.querySelectorAll('span[aria-hidden="true"]')) {
      const t = span.innerText?.trim();
      if (t) { jobTitle = t; break; }
    }
    // Fallback: any link text in the first item
    if (!jobTitle) {
      const a = firstItem.querySelector('a[href*="/details/experience"]');
      jobTitle = a?.innerText?.trim() || '';
    }
  }

  function readCompanyAnchor(a) {
    if (!a?.href) return null;
    const m = a.href.match(/\/company\/([^/?#]+)/);
    if (!m) return null;
    const raw = m[1].toLowerCase().replace(/\/$/, '').split('?')[0];
    if (['linkedin', 'jobs', 'showcase'].includes(raw)) return null;
    const textBits = [
      a.querySelector('img')?.alt?.trim(),
      a.getAttribute('aria-label')?.trim(),
      a.innerText?.trim(),
      a.textContent?.trim(),
      a.closest('li,div')?.innerText?.split('\n')?.map(t => t.trim()).find(Boolean),
    ].filter(Boolean);
    const companyName = textBits.find(t => t.length > 1) || '';
    return {
      slug: /^\d+$/.test(raw) ? null : raw,
      numericCandidate: /^\d+$/.test(raw) ? raw : null,
      name: companyName,
    };
  }

  // Company link: first try the first experience item, then fall back to the whole section.
  let slug = null, name = '', numericCandidate = null;
  const anchorSets = [
    [...(firstItem?.querySelectorAll('a[href*="/company/"]') || [])],
    [...expSection.querySelectorAll('a[href*="/company/"]')],
  ];

  for (const anchors of anchorSets) {
    for (const a of anchors) {
      const info = readCompanyAnchor(a);
      if (!info) continue;
      if (info.numericCandidate && !numericCandidate) numericCandidate = info.numericCandidate;
      if (info.name && !name) name = info.name;
      if (info.slug) {
        slug = info.slug;
        if (info.name) name = info.name;
        break;
      }
    }
    if (slug || numericCandidate) break;
  }

  return { jobTitle, slug, name, numericCandidate };
}

async function waitForExperienceEntry(profileUrl, instant = false) {
  const attempts = instant ? 12 : 16;
  const intervalMs = instant ? 450 : 700;
  const originalScrollY = window.scrollY;
  let nudgedPage = false;

  for (let i = 0; i < attempts; i++) {
    if (location.href.split('?')[0].replace(/\/$/, '') !== profileUrl) return null;
    const exp = getFirstExperienceEntry();
    if (exp && (exp.slug || exp.numericCandidate || exp.name || exp.jobTitle)) {
      if (nudgedPage) window.scrollTo(0, originalScrollY);
      return exp;
    }

    const expSection = findExpSection();
    if (expSection) {
      expSection.scrollIntoView({ block: 'center', behavior: 'instant' });
    } else if (i === 3 || i === 7 || i === 11) {
      nudgedPage = true;
      window.scrollBy(0, Math.max(Math.round(window.innerHeight * 0.9), 700));
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }

  const finalEntry = getFirstExperienceEntry();
  if (nudgedPage) window.scrollTo(0, originalScrollY);
  return finalEntry;
}

function getProfilePhotoUrl() {
  const img = document.querySelector(
    '.pv-top-card-profile-picture__image, .profile-photo-edit__preview, .presence-entity__image, img.pv-top-card-profile-picture__image, img[alt*="profile photo" i]'
  );
  const src = img?.src || img?.getAttribute('data-delayed-url') || '';
  return /^https?:\/\//i.test(src) ? src : null;
}

function getHeroCompanyInfo(nameEl) {
  const heroRoot = nameEl?.closest('section') || nameEl?.closest('.artdeco-card') || document;
  const badgeLink = heroRoot.querySelector('a[href*="/company/"], button[aria-label^="Current company:"]');
  if (!badgeLink) return { companyName: '', companySlug: null, numericCandidate: null };

  if (badgeLink.matches('button[aria-label^="Current company:"]')) {
    const lbl = badgeLink.getAttribute('aria-label') || '';
    const lm = lbl.match(/Current company:\s*(.+?)(?:\.\s*Click|$)/i);
    return {
      companyName: lm?.[1]?.trim() || '',
      companySlug: null,
      numericCandidate: null,
    };
  }

  const href = badgeLink.getAttribute('href') || '';
  const m = href.match(/\/company\/([^/?#]+)/);
  const raw = m ? m[1].toLowerCase() : null;
  const text = badgeLink.innerText?.trim() || badgeLink.textContent?.trim() || '';
  return {
    companyName: text,
    companySlug: raw && !/^\d+$/.test(raw) ? raw : null,
    numericCandidate: raw && /^\d+$/.test(raw) ? raw : null,
  };
}

function getHeroCompanyNameFallback(nameEl) {
  const heroRoot = nameEl?.closest('section') || nameEl?.closest('.artdeco-card') || document;
  const candidates = [
    ...heroRoot.querySelectorAll('a, button, span, div'),
  ];

  for (const el of candidates) {
    const text = el.innerText?.trim();
    if (!text || text.length < 2 || text.length > 80) continue;
    if (!/^[A-Z0-9][A-Za-z0-9&.,'()\- ]+$/.test(text)) continue;
    if (/^(message|pending|more|contact info|visit my website|follow|connect|open to|hiring|show all posts)$/i.test(text)) continue;
    const hasLogoSibling = !!el.parentElement?.querySelector('img, svg');
    const rightSide = (el.getBoundingClientRect?.().left || 0) > (window.innerWidth * 0.45);
    if (hasLogoSibling || rightSide) {
      return text.replace(/\s+\(formerly.*$/i, '').trim();
    }
  }

  return '';
}

function emitProfileCheckResult(payload) {
  try {
    const maybePromise = chrome.runtime.sendMessage({
      action: 'profileCheckResult',
      ...payload,
    });
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {});
    }
  } catch {}
}

function getProfileHandleFromPath() {
  const m = location.pathname.match(/^\/in\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function getLinkedInCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)JSESSIONID="([^"]+)"/);
  return match ? match[1] : null;
}

function extractCompanyId(value) {
  if (value == null) return null;
  const str = String(value);
  const match = str.match(/(?:company|fsd_company|organization):(\d+)/i) || str.match(/\b(\d{4,})\b/);
  return match ? match[1] : null;
}

function walkVoyager(value, visit, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  visit(value);
  if (Array.isArray(value)) {
    value.forEach(item => walkVoyager(item, visit, seen));
    return;
  }
  Object.values(value).forEach(v => walkVoyager(v, visit, seen));
}

function scoreVoyagerCandidate(candidate) {
  let score = 0;
  if (candidate.companyName) score += 4;
  if (candidate.numericCandidate) score += 3;
  if (candidate.companySlug) score += 3;
  if (candidate.current) score += 8;
  if (candidate.title && isRecruiterCard(candidate.title)) score += 10;
  if (!candidate.hasEndDate) score += 2;
  return score;
}

function pickFirstString(values) {
  return values.find(v => typeof v === 'string' && v.trim())?.trim() || '';
}

function parseVoyagerProfileData(data) {
  if (!data || typeof data !== 'object') return null;

  const result = {
    name: '',
    title: '',
    companyName: '',
    companySlug: null,
    numericCandidate: null,
  };
  const candidates = [];

  walkVoyager(data, obj => {
    if (!result.name) {
      if (typeof obj.firstName === 'string' || typeof obj.lastName === 'string') {
        const full = `${obj.firstName || ''} ${obj.lastName || ''}`.trim();
        if (full) result.name = full;
      } else if (typeof obj.name === 'string' && obj.name.trim() && !/^(technical|recruiter|talent|hiring)/i.test(obj.name.trim())) {
        result.name = obj.name.trim();
      }
    }

    const headline = pickFirstString([
      obj.headline,
      obj.occupation,
      obj.summary,
      obj.profile?.headline,
      obj.miniProfile?.occupation,
    ]);
    if (!result.title && headline) result.title = headline.trim();

    const companyName = pickFirstString([
      obj.companyName,
      obj.companyResolutionResult?.name,
      obj.company?.name,
      obj.organizationName,
      obj.entityCustomTrackingInfo?.companyName,
      obj.companyDetails?.companyName,
      obj.profilePositionIn?.companyName,
      obj.miniCompany?.name,
      obj.miniCompany?.universalName?.replace(/-/g, ' '),
    ]);

    const companySlug = pickFirstString([
      obj.companyResolutionResult?.universalName,
      obj.company?.universalName,
      obj.companyUniversalName,
      obj.companyDetails?.universalName,
      obj.miniCompany?.universalName,
      obj.profilePositionIn?.company?.universalName,
    ]) || null;

    const numericCandidate = extractCompanyId(
      obj.companyUrn
      || obj.company?.entityUrn
      || obj.company?.trackingUrn
      || obj.companyDetails?.companyUrn
      || obj.profilePositionIn?.company?.entityUrn
      || obj.miniCompany?.entityUrn
      || obj.entityUrn
      || obj.objectUrn
      || obj.targetUrn
    );

    const title = pickFirstString([
      obj.title,
      obj.occupation,
      obj.headline,
      obj.profilePositionIn?.title,
      obj.companyDetails?.title,
      obj.entityCustomTrackingInfo?.title,
    ]);

    if (title && (companyName || companySlug || numericCandidate)) {
      candidates.push({
        title: title.trim(),
        companyName: companyName.trim(),
        companySlug: companySlug ? companySlug.trim().toLowerCase() : null,
        numericCandidate,
        current: obj.current === true || obj.isCurrent === true || obj.active === true || obj.profilePositionIn?.current === true,
        hasEndDate: !!(obj.endDate || obj.dateRange?.end || obj.timePeriod?.endDate),
      });
    }
  });

  candidates.sort((a, b) => scoreVoyagerCandidate(b) - scoreVoyagerCandidate(a));
  const best = candidates[0] || null;

  if (best) {
    if (!result.title || isRecruiterCard(best.title)) result.title = best.title || result.title;
    result.companyName = best.companyName || result.companyName;
    result.companySlug = best.companySlug || result.companySlug;
    result.numericCandidate = best.numericCandidate || result.numericCandidate;
  }

  return (result.name || result.title || result.companyName || result.companySlug || result.numericCandidate) ? result : null;
}

async function fetchVoyagerProfileData() {
  const handle = getProfileHandleFromPath();
  const csrf = getLinkedInCsrfToken();
  if (!handle || !csrf) return null;

  try {
    const resp = await fetch(`https://www.linkedin.com/voyager/api/identity/profiles/${encodeURIComponent(handle)}/profileView`, {
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'csrf-token': csrf,
        'x-restli-protocol-version': '2.0.0',
      },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return parseVoyagerProfileData(data);
  } catch {
    return null;
  }
}

async function resolveCanonicalCompanySlug(companySlug, companyName, numericCandidate) {
  const normalizedForLookup = (companySlug || '').replace(/-/g, '');
  const normalizedName = (companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const lowerCompanyName = (companyName || '').toLowerCase().trim();

  let storageData;
  try { storageData = await new Promise(r => chrome.storage.local.get(['companySlugMap', 'recruiterHistory'], r)); }
  catch { return { companySlug: null, companyName }; }

  const slugMap = storageData.companySlugMap || {};
  const cache = storageData.recruiterHistory || {};

  if (companySlug && cache[companySlug]) {
    return { companySlug, companyName: companyName || cache[companySlug]?.displayName || companySlug.replace(/-/g, ' ') };
  }

  if (normalizedForLookup) {
    for (const [slug, entry] of Object.entries(cache)) {
      const slugNorm = slug.toLowerCase().replace(/-/g, '');
      if (slugNorm === normalizedForLookup) {
        return { companySlug: slug, companyName: companyName || entry?.displayName || slug.replace(/-/g, ' ') };
      }
    }
  }

  const mappedSlug = slugMap[companySlug]
    || slugMap[normalizedForLookup]
    || slugMap[normalizedName]
    || slugMap[lowerCompanyName]
    || null;

  if (mappedSlug) {
    return { companySlug: mappedSlug, companyName: companyName || cache[mappedSlug]?.displayName || mappedSlug.replace(/-/g, ' ') };
  }

  if (normalizedName || lowerCompanyName) {
    for (const [slug, entry] of Object.entries(cache)) {
      const displayNorm = (entry?.displayName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const displayLower = (entry?.displayName || '').toLowerCase().trim();
      const aliasMatch = (entry?.aliases || []).some(alias => {
        const aliasNorm = String(alias || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const aliasLower = String(alias || '').toLowerCase().trim();
        return (normalizedName && aliasNorm === normalizedName) || (lowerCompanyName && aliasLower === lowerCompanyName);
      });
      if ((normalizedName && displayNorm === normalizedName) || (lowerCompanyName && displayLower === lowerCompanyName) || aliasMatch) {
        return { companySlug: slug, companyName: companyName || entry?.displayName || slug.replace(/-/g, ' ') };
      }
    }
  }

  const aliasSlug = COMPANY_SLUG_ALIASES[companySlug]
    || COMPANY_SLUG_ALIASES[normalizedForLookup]
    || COMPANY_SLUG_ALIASES[normalizedName]
    || COMPANY_SLUG_ALIASES[lowerCompanyName]
    || null;

  if (aliasSlug) {
    return { companySlug: aliasSlug, companyName: companyName || cache[aliasSlug]?.displayName || aliasSlug.replace(/-/g, ' ') };
  }

  const slugToFetch = companySlug || numericCandidate;
  if (!slugToFetch) return { companySlug: null, companyName };

  try {
    const resp = await fetch(`https://www.linkedin.com/company/${slugToFetch}/`, {
      redirect: 'follow',
      credentials: 'include',
    });
    const m = resp.url.match(/\/company\/([^/?#]+)/);
    if (m && !/^\d+$/.test(m[1])) {
      const canonical = m[1].toLowerCase();
      if (!companyName) companyName = canonical.replace(/-/g, ' ');
      chrome.storage.local.get('companySlugMap', data => {
        const map = data.companySlugMap || {};
        const canonicalNorm = canonical.replace(/-/g, '');
        if (normalizedForLookup && normalizedForLookup !== canonicalNorm) map[normalizedForLookup] = canonical;
        if (normalizedName && normalizedName !== canonicalNorm) map[normalizedName] = canonical;
        if (numericCandidate) map[numericCandidate] = canonical;
        chrome.storage.local.set({ companySlugMap: map });
      });
      return { companySlug: canonical, companyName };
    }
  } catch {}

  return { companySlug: null, companyName };
}

async function checkProfilePage(instant = false) {
  if (!/^\/in\/[^/]+\/?$/.test(location.pathname)) {
    _lastProfileUrl = null;
    return;
  }
  const checkSeq = ++_profileCheckSeq;
  const profileUrl = location.href.split('?')[0].replace(/\/$/, '');
  if (profileUrl === _lastProfileUrl) return;

  // Wait for the profile DOM to settle (name + headline render quickly).
  // Skip the wait when the panel explicitly requests state (page is already loaded).
  if (!instant) await new Promise(r => setTimeout(r, 1500));
  if (location.href.split('?')[0].replace(/\/$/, '') !== profileUrl) return;
  if (checkSeq !== _profileCheckSeq) return;

  // -Name: any h1 on the page (there's only one on profile pages) ─────────
  const nameEl = document.querySelector('h1.text-heading-xlarge')
    || document.querySelector('h1.top-card-layout__title')
    || document.querySelector('h1');
  const name = nameEl?.innerText?.trim() || '';
  if (!name) return; // page not ready — no lock, allow retry

  // -Headline: try DOM selectors, then relative-to-h1 traversal ───────────
  const titleEl = document.querySelector('.pv-text-details__left-panel .text-body-medium.break-words')
    || document.querySelector('.top-card-layout__headline')
    || (() => {
      // Walk up from h1 looking for a sibling with class text-body-medium
      let el = nameEl?.parentElement;
      for (let i = 0; i < 5 && el; i++) {
        for (const child of el.children) {
          if (child.contains(nameEl)) continue;
          if (child.classList.contains('text-body-medium'))  return child;
          const inner = child.querySelector('.text-body-medium');
          if (inner) return inner;
        }
        el = el.parentElement;
      }
      return null;
    })()
    || document.querySelector('.text-body-medium.break-words');
  const title = titleEl?.innerText?.trim() || '';
  const photoUrl = getProfilePhotoUrl();

  // -Header company badge: "Current company: X. Click to skip to experience card" ──
  // This button is always rendered in the profile hero without needing to scroll.
  // It gives us the company name cheaply before touching the experience section.
  let headerCompanyName = null;
  const currentCoBtn = document.querySelector('button[aria-label^="Current company:"]');
  if (currentCoBtn) {
    const lbl = currentCoBtn.getAttribute('aria-label') || '';
    const lm  = lbl.match(/Current company:\s*(.+?)(?:\.\s*Click|$)/i);
    if (lm) headerCompanyName = lm[1].trim();
  }
  const heroCompany = getHeroCompanyInfo(nameEl);
  const heroCompanyNameFallback = getHeroCompanyNameFallback(nameEl);

  // -Experience section: primary source for company + job title ────────────
  // Wait for the section to render instead of relying on a single fixed delay.
  const exp = await waitForExperienceEntry(profileUrl, instant);
  if (checkSeq !== _profileCheckSeq) return;
  const voyager = await fetchVoyagerProfileData();
  if (checkSeq !== _profileCheckSeq) return;

  // Determine recruiter status: headline title first, then experience job title,
  // then fall back to scanning the whole profile hero section text.
  const detectedName = name || voyager?.name || '';
  let effectiveTitle = title || exp?.jobTitle || voyager?.title || '';
  if (!isRecruiterCard(effectiveTitle)) {
    // CSS selectors may have missed the headline — scan raw text of the profile hero
    const heroEl = nameEl?.closest('section') || nameEl?.closest('.artdeco-card') || nameEl?.closest('.ph5');
    const heroText = heroEl?.innerText || '';
    if (!isRecruiterCard(heroText)) {
      _lastProfileUrl = profileUrl;
      emitProfileCheckResult({
        status: 'not_recruiter',
        name: detectedName,
        title: effectiveTitle || title || exp?.jobTitle || '',
        url: profileUrl,
      });
      return;
    }
    // Extract title from the line right after the name in the hero text
    if (!effectiveTitle) {
      const lines = heroText.split('\n').map(l => l.trim()).filter(Boolean);
      const ni = lines.findIndex(l => l === detectedName || l.startsWith(detectedName));
      if (ni >= 0) {
        for (let li = ni + 1; li < Math.min(ni + 5, lines.length); li++) {
          if (isRecruiterCard(lines[li])) { effectiveTitle = lines[li]; break; }
        }
      }
    }
    if (!isRecruiterCard(effectiveTitle || heroText)) {
      _lastProfileUrl = profileUrl;
      emitProfileCheckResult({
        status: 'not_recruiter',
        name: detectedName,
        title: effectiveTitle || title || exp?.jobTitle || '',
        url: profileUrl,
      });
      return;
    }
  }

  // -Company slug resolution ───────────────────────────────────────────────
  let companySlug = exp?.slug || heroCompany.companySlug || voyager?.companySlug || null;
  let companyName = companySlug
    ? (exp?.name || heroCompany.companyName || heroCompanyNameFallback || headerCompanyName || voyager?.companyName || '')
    : (heroCompany.companyName || heroCompanyNameFallback || headerCompanyName || voyager?.companyName || exp?.name || '');
  const numericCandidate = exp?.numericCandidate || heroCompany.numericCandidate || voyager?.numericCandidate || null;

  // Headline fallback if experience section gave nothing
  if (!companySlug && !numericCandidate) {
    const hc = extractCompanyFromHeadline(effectiveTitle);
    if (hc) { companySlug = hc.slug; companyName = hc.name; }
  }

  if (!companySlug && !numericCandidate && !companyName) {
    _lastProfileUrl = profileUrl;
    emitProfileCheckResult({
      status: 'company_unresolved',
      name: detectedName,
      title: effectiveTitle || title,
      url: profileUrl,
      photoUrl,
      reason: voyager
        ? 'Profile data was available, but no current company was exposed in a usable form.'
        : 'Could not identify the current company from the profile header, headline, or Experience section.',
    });
    return;
  }

  ({ companySlug, companyName } = await resolveCanonicalCompanySlug(companySlug, companyName, numericCandidate));
  if (checkSeq !== _profileCheckSeq) return;

  if (!companySlug) {
    _lastProfileUrl = profileUrl;
    emitProfileCheckResult({
      status: 'company_unresolved',
      name: detectedName,
      title: effectiveTitle || title,
      url: profileUrl,
      companyName,
      photoUrl,
      reason: voyager
        ? 'Detected a recruiter profile from LinkedIn profile data, but could not resolve the company to a canonical LinkedIn slug.'
        : 'Detected a recruiter profile, but could not resolve the company to a canonical LinkedIn slug.',
    });
    return;
  }

  _lastProfileUrl = profileUrl; // lock only after a result is ready to send

  emitProfileCheckResult({
    status: 'recruiter_found',
    name: detectedName,
    title: effectiveTitle || title,
    url: profileUrl,
    companySlug,
    companyName,
    photoUrl,
  });
}

// -Respond to popup requesting current people-tab state (e.g. on panel open) ─
chrome.runtime.onMessage.addListener((request) => {
  // When user dismisses the notification, un-mark those URLs so the observer
  // can re-detect them if they appear again after a search change or scroll.
  if (request.action === 'unmarkObservedUrls') {
    (request.urls || []).forEach(url => obSeenUrls.delete(url));
    return;
  }

  if (request.action === 'requestProfileState') {
    // Panel just opened on a profile page — DOM is already loaded, skip the initial wait
    _lastProfileUrl = null;
    checkProfilePage(true);
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

}
