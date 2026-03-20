export async function fetchLogoForSlug(slug, { createTab, waitForTabLoad, sleep }) {
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
