export async function runScraper(companySlug, deps) {
  const {
    createTab,
    waitForTabLoad,
    sleep,
    navigateTab,
    scrapeTab,
    scrapeTabWithHiringFrame,
    isRecruiter,
    SEARCH_QUERY,
  } = deps;

  const peopleBaseUrl = `https://www.linkedin.com/company/${companySlug}/people/`;

  const tab = await createTab(peopleBaseUrl);
  const tabId = tab.id;

  try {
    await waitForTabLoad(tabId);
    await sleep(1500);

    let logoUrl = null;
    for (let attempt = 0; attempt < 3 && !logoUrl; attempt++) {
      if (attempt > 0) await sleep(1000);
      try {
        const logoResult = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            function getLicdnUrl(img) {
              if (!img) return null;
              if (img.closest('#global-nav, [class*="global-nav"], nav[aria-label]')) return null;
              for (const val of [img.src, img.getAttribute('data-delayed-url'), img.getAttribute('data-src')]) {
                if (val && val.includes('media.licdn.com') && !val.includes('ghost') && !val.includes('data:')) {
                  return val;
                }
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
              'img.org-top-card__logo',
              'img.org-top-card-summary__logo',
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
        logoUrl = logoResult[0]?.result || null;
      } catch (_) {}
    }

    chrome.storage.session.set({ status: 'Searching for recruiters...', progress: 1, total: 1 });

    const searchUrl = `${peopleBaseUrl}?keywords=${encodeURIComponent(SEARCH_QUERY)}`;
    await navigateTab(tabId, searchUrl);
    await waitForTabLoad(tabId);
    await sleep(1800);

    const results = await scrapeTab(tabId);
    const filtered = results.filter(r => isRecruiter(r.title));

    let hiringFrameResults = [];
    if (filtered.length === 0) {
      chrome.storage.session.set({ status: 'No recruiters found by title. Scanning for #Hiring badges...' });

      await navigateTab(tabId, peopleBaseUrl);
      await waitForTabLoad(tabId);
      await sleep(1800);

      const allPeople = await scrapeTabWithHiringFrame(tabId);
      hiringFrameResults = allPeople.filter(r => r.hiringFrame);

      chrome.storage.session.set({
        status: hiringFrameResults.length > 0
          ? '? Found ' + hiringFrameResults.length + ' people with #Hiring frame.'
          : '?? No recruiters or #Hiring badges found.',
        done: true
      });
    }

    chrome.tabs.remove(tabId);

    const finalResults = filtered.length > 0 ? filtered : hiringFrameResults;

    chrome.storage.session.set({
      status: '? Done! Found ' + finalResults.length + ' people.',
      done: true,
      results: finalResults
    });

    return { recruiters: finalResults, logoUrl };
  } catch (err) {
    chrome.tabs.remove(tabId).catch(() => {});
    throw err;
  }
}
