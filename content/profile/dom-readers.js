(function () {
  const helpers = globalThis.__recruiterFinderProfileHelpers || (globalThis.__recruiterFinderProfileHelpers = {});

  helpers.extractCompanyFromHeadline = function extractCompanyFromHeadline(titleText) {
    const m = titleText.match(/(?:\bat\s+|@\s*)([^|(@\n,Â·â€¢]+)/i);
    if (!m) return null;
    const name = m[1].trim().replace(/\s*\(.*$/, '').trim();
    if (!name || name.length > 80) return null;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return slug ? { name, slug } : null;
  };

  helpers.findExpSection = function findExpSection() {
    const anchor = document.getElementById('experience');
    if (anchor) {
      return anchor.closest('section') || anchor.parentElement?.closest('section') || null;
    }
    return [...document.querySelectorAll('section')].find(s =>
      /\bexperience\b/i.test(s.querySelector('h2,h3,[aria-label*="Experience" i]')?.textContent || s.textContent || '')
    ) || null;
  };

  helpers.getFirstExperienceEntry = function getFirstExperienceEntry() {
    const expSection = helpers.findExpSection();
    if (!expSection) return null;

    let jobTitle = '';
    const firstItem = expSection.querySelector('li, .pvs-list__paged-list-item, .pvs-list__item--line-separated');
    if (firstItem) {
      for (const span of firstItem.querySelectorAll('span[aria-hidden="true"]')) {
        const t = span.innerText?.trim();
        if (t) {
          jobTitle = t;
          break;
        }
      }
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

    let slug = null;
    let name = '';
    let numericCandidate = null;
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
  };

  helpers.waitForExperienceEntry = async function waitForExperienceEntry(profileUrl, instant = false) {
    const attempts = instant ? 12 : 16;
    const intervalMs = instant ? 450 : 700;
    const originalScrollY = window.scrollY;
    let nudgedPage = false;

    for (let i = 0; i < attempts; i++) {
      if (location.href.split('?')[0].replace(/\/$/, '') !== profileUrl) return null;
      const exp = helpers.getFirstExperienceEntry();
      if (exp && (exp.slug || exp.numericCandidate || exp.name || exp.jobTitle)) {
        if (nudgedPage) window.scrollTo(0, originalScrollY);
        return exp;
      }

      const expSection = helpers.findExpSection();
      if (expSection) {
        expSection.scrollIntoView({ block: 'center', behavior: 'instant' });
      } else if (i === 3 || i === 7 || i === 11) {
        nudgedPage = true;
        window.scrollBy(0, Math.max(Math.round(window.innerHeight * 0.9), 700));
      }

      await new Promise(r => setTimeout(r, intervalMs));
    }

    const finalEntry = helpers.getFirstExperienceEntry();
    if (nudgedPage) window.scrollTo(0, originalScrollY);
    return finalEntry;
  };

  helpers.getProfilePhotoUrl = function getProfilePhotoUrl() {
    const img = document.querySelector(
      '.pv-top-card-profile-picture__image, .profile-photo-edit__preview, .presence-entity__image, img.pv-top-card-profile-picture__image, img[alt*="profile photo" i]'
    );
    const src = img?.src || img?.getAttribute('data-delayed-url') || '';
    return /^https?:\/\//i.test(src) ? src : null;
  };

  helpers.getHeroCompanyInfo = function getHeroCompanyInfo(nameEl) {
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
  };

  helpers.getHeroCompanyNameFallback = function getHeroCompanyNameFallback(nameEl) {
    const heroRoot = nameEl?.closest('section') || nameEl?.closest('.artdeco-card') || document;
    const candidates = [...heroRoot.querySelectorAll('a, button, span, div')];

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
  };

  helpers.getProfileHandleFromPath = function getProfileHandleFromPath() {
    const m = location.pathname.match(/^\/in\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };

  helpers.getLinkedInCsrfToken = function getLinkedInCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)JSESSIONID="([^"]+)"/);
    return match ? match[1] : null;
  };
})();
