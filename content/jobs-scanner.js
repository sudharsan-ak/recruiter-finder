(function () {
  if (window._jobScannerLoaded) return;
  window._jobScannerLoaded = true;

  let _scanning = false;
  let _stopRequested = false;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

      const result = {
        title: title || cardTitle,
        company: company || cardCompany,
        url,
        jobId: extractedId || jobId,
        jdText,
        scannedAt: Date.now(),
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
    const s = await new Promise(r => chrome.storage.local.get(['jobScanState'], r));
    await chrome.storage.local.set({
      jobScanState: { ...s.jobScanState, running: false },
    });

    try { chrome.runtime.sendMessage({ action: 'jobScanDone' }).catch(() => {}); } catch {}
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'startJobScan') scanJobs(msg.maxJobs || Infinity);
    if (msg.action === 'stopJobScan') _stopRequested = true;
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
