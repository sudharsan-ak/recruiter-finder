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

  let lastJobId = null;
  let obSeenUrls = new Set();
  let obPending = [];
  let obDebounce = null;
  let obInitialScrape = null;
  let peopleObserver = null;
  let _checkPeopleTimer = null;

  function getJobId() {
    const m = location.href.match(/\/jobs\/view\/(\d+)/) ||
               location.href.match(/currentJobId=(\d+)/);
    return m ? m[1] : null;
  }

  function findCompanySlug() {
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
      try { chrome.runtime.sendMessage({ action: 'jobChanged', companySlug: slug }).catch(() => {}); } catch {}
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
    clearTimeout(_checkPeopleTimer);
    _checkPeopleTimer = setTimeout(() => {
      checkPeopleTab();
      if (typeof checkProfilePage === 'function') checkProfilePage();
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
    setTimeout(() => {
      if (typeof checkProfilePage === 'function') checkProfilePage(true);
      checkPeopleTab();
      updateCompanySlugMap();
    }, 100);
  }

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
      const photoEl = card.querySelector('img.ghost-person__img, img[class*="presence-entity__image"], img[class*="EntityPhoto"], img.artdeco-entity-image, img[class*="artdeco-entity-image"]')
        || card.querySelector('img[src*="media.licdn.com"], img[data-delayed-url*="media.licdn.com"]');
      const name  = nameEl?.innerText?.trim() || '';
      const title = titleEl?.innerText?.trim() || '';
      if (!name || !url) return;
      if (!isRecruiterCard(title)) return;
      const photoSrc = photoEl
        ? (photoEl.src?.includes('media.licdn.com') ? photoEl.src : null)
          || photoEl.getAttribute('data-delayed-url') || null
        : null;
      results.push({ name, title, url, photoUrl: photoSrc });
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
      stopPeopleObserver();
      obSeenUrls = new Set();
      startPeopleObserver();
    } else {
      stopPeopleObserver();
    }
  }

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
      if (!normalizedName || normalizedName === normalizedSlug) return;

      chrome.storage.local.get('companySlugMap', data => {
        const map = data.companySlugMap || {};
        if (map[normalizedName] === canonicalSlug) return;
        map[normalizedName] = canonicalSlug;
        chrome.storage.local.set({ companySlugMap: map });
      });
    }, 1000);
  }

  globalThis.isRecruiterCard = isRecruiterCard;
  globalThis.checkPeopleTab = checkPeopleTab;
  globalThis.updateCompanySlugMap = updateCompanySlugMap;

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'unmarkObservedUrls') {
      (request.urls || []).forEach(url => obSeenUrls.delete(url));
      return;
    }

    if (request.action !== 'requestPeopleState') return;
    const slug = getPeopleSlug();
    if (!slug) return;
    const current = scrapeVisiblePeopleCards();
    current.forEach(r => obSeenUrls.add(r.url));
    if (current.length) {
      chrome.runtime.sendMessage({
        action: 'observedRecruiters',
        companySlug: slug,
        recruiters: current,
      }).catch(() => {});
    }
  });
}
