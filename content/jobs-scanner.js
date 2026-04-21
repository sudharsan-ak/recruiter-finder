(function () {
  if (window._jobScannerLoaded) return;
  window._jobScannerLoaded = true;

  const HASH_KEY    = 'jobScanHashIndex';
  const HISTORY_KEY = 'jobScanHistory';
  const HISTORY_CAP = 10000;

  let _scanning = false;
  let _stopRequested = false;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  const _NO_VISA = [
    /authorized?\s+to\s+work\s+in\s+the\s+u\.?s\.?\s+without.*visa/i,
    /no\s+visa\s+sponsorship/i,
    /visa\s+sponsorship.*not\s+(available|offered|provided)/i,
    /not\s+(able\s+to|in\s+a\s+position\s+to)?\s*sponsor/i,
    /cannot\s+sponsor/i,
    /unable\s+to\s+sponsor/i,
    /we\s+do\s+not\s+sponsor/i,
    /does\s+not\s+(offer|provide)\s+sponsorship/i,
    /without\s+sponsorship/i,
    /\bno\s+sponsorship\b/i,
    /sponsorship\s+is\s+not\s+available/i,
    /must\s+not\s+require\s+(visa|sponsorship)/i,
    /security\s+clearance\s+required/i,
    /must\s+(hold|have|possess)\s+(an?\s+)?(active|current|valid)\s+.*(clearance|secret|ts\/sci)/i,
    /active\s+.*(secret|top\s+secret|ts\/sci|clearance)/i,
    /clearance\s+required/i,
    /must\s+be\s+eligible\s+for\s+.*(clearance|secret)/i,
    /eligible\s+for\s+security\s+clearance/i,
    /u\.?s\.?\s+citizens?\s+only/i,
    /\bcitizens?\s+only\b/i,
    /must\s+be\s+(a\s+)?u\.?s\.?\s+citizen/i,
    /work\s+authorization\s+(in|for)\s+the\s+u\.?s\.?/i,
    /will\s+not\s+(provide|offer)\s+immigration\s+sponsorship/i,
    /not\s+(provide|offer|support)\s+(immigration|visa)\s+sponsorship/i,
    /does\s+not\s+(provide|offer)\s+.*sponsorship/i,
    /permanent\s+work\s+authorization/i,
    /without\s+employer\s+(assistance|support|sponsorship)/i,
    /must\s+have\s+authorization\s+to\s+work/i,
    /not\s+eligible\s+to\s+sponsor/i,
    /requires?\s+work\s+authorization/i,
    /must\s+be\s+legally\s+authorized/i,
    /authorized\s+to\s+work\s+without\s+(employer|company)/i,
    /not\s+sponsor\s+(work\s+)?visas?/i,
    /must\s+be\s+eligible\s+to\s+work\s+in\s+the\s+u\.?s\.?/i,
  ];
  const _YES_VISA = [
    /visa\s+sponsorship\s+(is\s+)?(available|offered|provided)/i,
    /we\s+(do\s+)?(offer|provide|support)\s+visa\s+sponsorship/i,
    /will\s+sponsor\s+.*(visa|h[-\s]?1b|work\s+authorization)/i,
    /sponsorship\s+(is\s+)?available/i,
    /open\s+to\s+sponsor/i,
    /we\s+sponsor\s+(h[-\s]?1b|work\s+visa)/i,
    /h[-\s]?1b\s+sponsorship\s+(is\s+)?(available|offered|provided|considered)/i,
    /will\s+(provide|offer|support)\s+immigration\s+sponsorship/i,
    /willing\s+to\s+sponsor/i,
    /able\s+to\s+sponsor/i,
    /sponsorship\s+(will\s+be\s+)?(considered|offered)/i,
    /immigration\s+assistance\s+(is\s+)?(provided|available|offered)/i,
    /we\s+support\s+(visa|immigration)/i,
    /sponsorship\s+for\s+qualified\s+candidates/i,
  ];
  function detectVisaStatus(text) {
    if (!text) return 'na';
    if (_NO_VISA.some(p => p.test(text))) return 'no';
    if (_YES_VISA.some(p => p.test(text))) return 'yes';
    return 'na';
  }

  function hashJD(text) {
    const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h) ^ s.charCodeAt(i);
      h = h >>> 0;
    }
    return h.toString(36);
  }

  async function checkAndRecordJD(title, company, url, jdText) {
    if (!jdText) return { isDuplicate: false, previouslySeen: null };
    const hash = hashJD(jdText);
    const stored = await new Promise(r =>
      chrome.storage.local.get([HASH_KEY, HISTORY_KEY], r)
    );
    const hashIndex = stored[HASH_KEY]   || [];
    const history   = stored[HISTORY_KEY] || [];

    const hashSet = new Set(hashIndex);
    const seenBefore = hashSet.has(hash);

    // Extract job ID from URL for same-job detection
    function extractJobId(u) {
      const m = (u || '').match(/\/jobs\/view\/(\d+)|currentJobId=(\d+)/);
      return m ? (m[1] || m[2]) : null;
    }
    const currentJobId = extractJobId(url);

    let isDuplicate = false;
    let previouslySeen = null;
    if (seenBefore) {
      const prev = history.find(e => e[0] === hash);
      if (prev) {
        const prevJobId = extractJobId(prev[3]);
        // Only a true repost if the job ID is different
        if (!currentJobId || !prevJobId || currentJobId !== prevJobId) {
          isDuplicate = true;
          previouslySeen = { title: prev[1], company: prev[2], url: prev[3], firstSeenAt: prev[4] };
        }
        // Same job ID = re-scan of the same listing, not a repost; leave isDuplicate false
      }
    }

    if (!seenBefore) {
      // Add to Tier 1
      hashIndex.push(hash);
      // Add to Tier 2 (newest at front, cap at HISTORY_CAP)
      history.unshift([hash, title, company, url, Date.now()]);
      if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
      await chrome.storage.local.set({ [HASH_KEY]: hashIndex, [HISTORY_KEY]: history });
    }

    return { isDuplicate, previouslySeen };
  }

  function getJobCards() {
    return [...document.querySelectorAll('.job-card-container--clickable')];
  }

  function extractFromDetailPane() {
    const titleEl = document.querySelector([
      '.job-details-jobs-unified-top-card__job-title h1',
      '.jobs-unified-top-card__job-title h1',
      '.jobs-details-top-card__job-title',
      '.t-24.t-bold.inline',
    ].join(', '));

    const companyEl = document.querySelector([
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name a',
      '.jobs-unified-top-card__company-name',
    ].join(', '));

    const jdEl = document.querySelector([
      '.jobs-description__content',
      '.jobs-description-content',
      '.jobs-box__html-content',
      '.jobs-search__job-details--wrapper',
    ].join(', '));

    const urlMatch = location.href.match(/currentJobId=(\d+)|\/jobs\/view\/(\d+)/);
    const jobId = urlMatch ? (urlMatch[1] || urlMatch[2]) : null;
    const url = jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : location.href;

    return {
      title: titleEl?.textContent.trim() || '',
      company: companyEl?.textContent.trim() || '',
      jdText: jdEl?.innerText.trim() || '',
      url,
      jobId,
    };
  }

  async function goToNextPage() {
    const btn = document.querySelector(
      'button[aria-label="View next page"], .jobs-search-pagination__button--next'
    );
    if (!btn || btn.disabled) return false;
    btn.click();
    // Wait for new cards to replace old ones
    const prevFirst = document.querySelector('.job-card-container--clickable')?.getAttribute('data-job-id');
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const newFirst = document.querySelector('.job-card-container--clickable')?.getAttribute('data-job-id');
      if (newFirst && newFirst !== prevFirst) return true;
    }
    return true; // assume loaded
  }

  async function scanJobs(maxJobs = Infinity) {
    if (_scanning) return;
    _scanning = true;
    _stopRequested = false;

    await chrome.storage.local.set({
      jobScanState: { running: true, total: 0, done: 0, pageUrl: location.href },
      jobScanResults: [],
    });
    try { chrome.runtime.sendMessage({ action: 'jobScanProgress' }).catch(() => {}); } catch {}

    // ── Dynamic scan: discover cards as we scroll through them ──────────────
    // No separate pre-scroll phase. We scan cards one by one; clicking each
    // card scrolls LinkedIn naturally and triggers more cards to load below.
    // When we exhaust visible cards and haven't hit the end footer yet, we
    // scroll the last card into view to nudge LinkedIn into loading more.

    // Build a job-ID → history-entry map for fast "already scanned" lookup
    const _hist = await new Promise(r => chrome.storage.local.get([HISTORY_KEY], r));
    const _histEntries = _hist[HISTORY_KEY] || [];
    const historyByJobId = new Map();
    for (const e of _histEntries) {
      const m = (e[3] || '').match(/\/jobs\/view\/(\d+)|currentJobId=(\d+)/);
      if (m) historyByJobId.set(m[1] || m[2], e);
    }

    const scannedIds = new Set();
    let done = 0;
    let stuckCount = 0;

    while (!_stopRequested) {
      const cards = getJobCards();
      const nextCard = cards.find(c => {
        const id = c.getAttribute('data-job-id') || '';
        return id && !scannedIds.has(id);
      });

      if (!nextCard) {
        // No new cards yet — scroll past the last card to trigger LinkedIn loading more.
        // Do NOT check isEndOfPageLoaded() here: LinkedIn renders the pagination
        // footer early in the DOM even before all cards are loaded, so that check
        // fires prematurely and exits before cards are actually exhausted.
        if (cards.length > 0) {
          const lastCard = cards[cards.length - 1];
          // Walk up and directly set scrollTop on the first scrollable ancestor
          let scrolled = false;
          let el = lastCard.parentElement;
          while (el && el !== document.documentElement) {
            if (el.scrollHeight > el.clientHeight + 10) {
              const before = el.scrollTop;
              el.scrollTop += 600;
              if (el.scrollTop !== before) { scrolled = true; break; }
            }
            el = el.parentElement;
          }
          if (!scrolled) {
            // Last-resort: WheelEvent on the last card
            lastCard.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, bubbles: true }));
          }
        }
        await sleep(1200);
        stuckCount++;
        if (stuckCount >= 6) {
          // Current page exhausted — go to next page if target not yet reached
          if (done < maxJobs && !_stopRequested) {
            const moved = await goToNextPage();
            if (moved) { stuckCount = 0; continue; }
          }
          break;
        }
        continue;
      }

      stuckCount = 0;
      const jobId = nextCard.getAttribute('data-job-id') ||
                    nextCard.querySelector('[href]')?.getAttribute('href') ||
                    String(done);
      scannedIds.add(jobId);

      const cardTitle = nextCard.querySelector(
        '.artdeco-entity-lockup__title, .job-card-list__title, .job-card-container__link'
      )?.textContent.trim() || '';
      const cardCompany = nextCard.querySelector(
        '.artdeco-entity-lockup__subtitle, .job-card-container__primary-description'
      )?.textContent.trim() || '';

      // ── Already in history: skip the click, pull metadata from seen jobs ──
      if (historyByJobId.has(jobId)) {
        const h = historyByJobId.get(jobId);
        const cachedResult = {
          title:         h[1] || cardTitle,
          company:       h[2] || cardCompany,
          url:           h[3] || `https://www.linkedin.com/jobs/view/${jobId}/`,
          jobId,
          jdText:        '',
          scannedAt:     Date.now(),
          isDuplicate:   false,
          isFromHistory: true,
          firstSeenAt:   h[4],
          previouslySeen: null,
        };
        const stored2 = await new Promise(r => chrome.storage.local.get(['jobScanResults'], r));
        const existing2 = stored2.jobScanResults || [];
        if (!existing2.some(r => (r.jobId || r.url) === jobId)) existing2.push(cachedResult);
        done++;
        await chrome.storage.local.set({
          jobScanResults: existing2,
          jobScanState: { running: true, total: Math.max(getJobCards().length, done), done, pageUrl: location.href },
        });
        try { chrome.runtime.sendMessage({ action: 'jobScanProgress' }).catch(() => {}); } catch {}
        if (done >= maxJobs) break;
        continue;
      }

      // Update progress (total = however many are in DOM right now)
      await chrome.storage.local.set({
        jobScanState: { running: true, total: getJobCards().length, done, pageUrl: location.href },
      });

      nextCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      await sleep(400);
      nextCard.click();
      await sleep(2000);

      if (_stopRequested) break;

      const { title, company, jdText, url, jobId: extractedId } = extractFromDetailPane();

      const finalTitle   = title   || cardTitle;
      const finalCompany = company || cardCompany;
      const { isDuplicate, previouslySeen } = await checkAndRecordJD(finalTitle, finalCompany, url, jdText);

      const visaStatus = detectVisaStatus(jdText);

      const result = {
        title: finalTitle,
        company: finalCompany,
        url,
        jobId: extractedId || jobId,
        jdText,
        scannedAt: Date.now(),
        isDuplicate,
        previouslySeen,
        visaStatus,
      };

      const stored = await new Promise(r => chrome.storage.local.get(['jobScanResults'], r));
      const existing = stored.jobScanResults || [];
      const key = extractedId || url;
      if (!existing.some(r => (r.jobId || r.url) === key)) {
        existing.push(result);
      }

      done++;
      await chrome.storage.local.set({
        jobScanResults: existing,
        jobScanState: { running: true, total: Math.max(getJobCards().length, done), done, pageUrl: location.href },
      });

      try { chrome.runtime.sendMessage({ action: 'jobScanProgress' }).catch(() => {}); } catch {}

      if (done >= maxJobs) break;
    }

    _scanning = false;
    try {
      const s = await new Promise(r => chrome.storage.local.get(['jobScanState'], r));
      await chrome.storage.local.set({
        jobScanState: { ...s.jobScanState, running: false },
      });
      try { chrome.runtime.sendMessage({ action: 'jobScanDone' }).catch(() => {}); } catch {}
    } catch {}
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'startJobScan') { _scanning = false; _stopRequested = false; scanJobs(msg.maxJobs || Infinity); }
    if (msg.action === 'stopJobScan') { _stopRequested = true; _scanning = false; }
    if (msg.action === 'getVisibleJobIds') {
      const ids = [...document.querySelectorAll('.job-card-container--clickable')]
        .map(c => c.getAttribute('data-job-id'))
        .filter(Boolean);
      sendResponse({ ids, pageUrl: location.href });
    }
    if (msg.action === 'focusJobCard') {
      const card = document.querySelector(
        `.job-card-container[data-job-id="${msg.jobId}"], ` +
        `.job-card-container--clickable[data-job-id="${msg.jobId}"]`
      );
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        card.click();
      }
    }
  });
})();
