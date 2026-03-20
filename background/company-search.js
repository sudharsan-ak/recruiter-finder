export async function searchLinkedInCompanies(companyName, { createTab, waitForTabLoad, sleep }) {
  const url = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(companyName)}`;
  const tab = await createTab(url);
  try {
    await waitForTabLoad(tab.id);
    await sleep(3000);

    let results = [];
    for (let attempt = 0; attempt < 3 && results.length === 0; attempt++) {
      if (attempt > 0) await sleep(1500);
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const items = [];
          const seen = new Set();

          for (const link of document.querySelectorAll('a[href*="/company/"]')) {
            if (items.length >= 7) break;
            if (link.closest('#global-nav, header, [role="navigation"], footer')) continue;

            const m = link.href.match(/linkedin\.com\/company\/([^/?#]+)/);
            if (!m) continue;
            const slug = m[1].toLowerCase().replace(/[/?#].*$/, '');
            if (['linkedin', 'showcase', 'pages', 'ads', 'jobs'].includes(slug)) continue;
            if (seen.has(slug)) continue;
            seen.add(slug);

            const nameSpan = link.querySelector('span[aria-hidden="true"]');
            const rawName = (nameSpan?.textContent || link.textContent || '').trim();
            const half = Math.ceil(rawName.length / 2);
            const name = rawName.slice(0, half) === rawName.slice(half) ? rawName.slice(0, half) : rawName;
            if (!name || name.length < 2) continue;

            const card = link.closest('li') || link.parentElement;
            const subtitleEl = card?.querySelector(
              '.entity-result__primary-subtitle, [class*="primary-subtitle"], [class*="subtitle--top"]'
            );
            const subtitle = subtitleEl?.textContent?.trim() || '';

            const secEl = card?.querySelector(
              '.entity-result__secondary-subtitle, [class*="secondary-subtitle"]'
            );
            const secondary = secEl?.textContent?.trim() || '';

            const img = card?.querySelector('img');
            const logoUrl = (img?.src?.includes('licdn.com') && !img.src.includes('ghost'))
              ? img.src : null;

            items.push({ slug, name, subtitle, secondary, logoUrl });
          }
          return items;
        }
      });
      results = res[0]?.result || [];
    }

    chrome.tabs.remove(tab.id).catch(() => {});
    return results;
  } catch (err) {
    chrome.tabs.remove(tab.id).catch(() => {});
    throw err;
  }
}
