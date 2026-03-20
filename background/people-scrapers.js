export function autoScrollAndScrape(maxPeople = 80) {
  return new Promise((resolve) => {
    let lastCount = 0;
    let stableRounds = 0;

    function scrape() {
      const seen = new Set();
      const data = [];
      document.querySelectorAll('.artdeco-entity-lockup__title a[href*="/in/"]')
        .forEach(link => {
          const url = link.href.split('?')[0].replace(/\/$/, '') + '/';
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

export function autoScrollAndScrapeWithHiringFrame() {
  return new Promise((resolve) => {
    let lastCount = 0;
    let stableRounds = 0;

    function scrape() {
      const seen = new Set();
      const data = [];

      document.querySelectorAll('.artdeco-entity-lockup__title a[href*="/in/"]')
        .forEach(link => {
          const url = link.href.split('?')[0].replace(/\/$/, '') + '/';
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

          let hiringFrame = false;
          if (card) {
            const hiringKeywords = ['hiring', '#hiring', 'open to hiring'];

            const ariaEls = card.querySelectorAll('[aria-label]');
            for (const el of ariaEls) {
              const label = (el.getAttribute('aria-label') || '').toLowerCase();
              if (hiringKeywords.some(k => label.includes(k))) {
                hiringFrame = true;
                break;
              }
            }

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

            if (!hiringFrame) {
              const cardText = (card.innerText || '').toLowerCase();
              if (cardText.includes('#hiring')) hiringFrame = true;
            }
          }

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
