(function () {
  const state = globalThis.__recruiterFinderProfileState || (globalThis.__recruiterFinderProfileState = {
    lastProfileUrl: null,
    profileCheckSeq: 0,
  });

  function extractCompanyFromHeadline(titleText) {
    const m = titleText.match(/(?:\bat\s+|@\s*)([^|(@\n,·•]+)/i);
    if (!m) return null;
    const name = m[1].trim().replace(/\s*\(.*$/, '').trim();
    if (!name || name.length > 80) return null;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return slug ? { name, slug } : null;
  }

  function findExpSection() {
    const anchor = document.getElementById('experience');
    if (anchor) {
      return anchor.closest('section') || anchor.parentElement?.closest('section') || null;
    }
    return [...document.querySelectorAll('section')].find(s =>
      /\bexperience\b/i.test(s.querySelector('h2,h3,[aria-label*="Experience" i]')?.textContent || s.textContent || '')
    ) || null;
  }

  function getFirstExperienceEntry() {
    const expSection = findExpSection();
    if (!expSection) return null;

    let jobTitle = '';
    const firstItem = expSection.querySelector('li, .pvs-list__paged-list-item, .pvs-list__item--line-separated');
    if (firstItem) {
      for (const span of firstItem.querySelectorAll('span[aria-hidden="true"]')) {
        const t = span.innerText?.trim();
        if (t) { jobTitle = t; break; }
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
      state.lastProfileUrl = null;
      return;
    }
    const checkSeq = ++state.profileCheckSeq;
    const profileUrl = location.href.split('?')[0].replace(/\/$/, '');
    if (profileUrl === state.lastProfileUrl) return;

    if (!instant) await new Promise(r => setTimeout(r, 1500));
    if (location.href.split('?')[0].replace(/\/$/, '') !== profileUrl) return;
    if (checkSeq !== state.profileCheckSeq) return;

    const nameEl = document.querySelector('h1.text-heading-xlarge')
      || document.querySelector('h1.top-card-layout__title')
      || document.querySelector('h1');
    const name = nameEl?.innerText?.trim() || '';
    if (!name) return;

    const titleEl = document.querySelector('.pv-text-details__left-panel .text-body-medium.break-words')
      || document.querySelector('.top-card-layout__headline')
      || (() => {
        let el = nameEl?.parentElement;
        for (let i = 0; i < 5 && el; i++) {
          for (const child of el.children) {
            if (child.contains(nameEl)) continue;
            if (child.classList.contains('text-body-medium')) return child;
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

    let headerCompanyName = null;
    const currentCoBtn = document.querySelector('button[aria-label^="Current company:"]');
    if (currentCoBtn) {
      const lbl = currentCoBtn.getAttribute('aria-label') || '';
      const lm  = lbl.match(/Current company:\s*(.+?)(?:\.\s*Click|$)/i);
      if (lm) headerCompanyName = lm[1].trim();
    }
    const heroCompany = getHeroCompanyInfo(nameEl);
    const heroCompanyNameFallback = getHeroCompanyNameFallback(nameEl);

    const exp = await waitForExperienceEntry(profileUrl, instant);
    if (checkSeq !== state.profileCheckSeq) return;
    const voyager = await fetchVoyagerProfileData();
    if (checkSeq !== state.profileCheckSeq) return;

    const detectedName = name || voyager?.name || '';
    let effectiveTitle = title || exp?.jobTitle || voyager?.title || '';
    if (!isRecruiterCard(effectiveTitle)) {
      const heroEl = nameEl?.closest('section') || nameEl?.closest('.artdeco-card') || nameEl?.closest('.ph5');
      const heroText = heroEl?.innerText || '';
      if (!isRecruiterCard(heroText)) {
        state.lastProfileUrl = profileUrl;
        emitProfileCheckResult({
          status: 'not_recruiter',
          name: detectedName,
          title: effectiveTitle || title || exp?.jobTitle || '',
          url: profileUrl,
        });
        return;
      }
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
        state.lastProfileUrl = profileUrl;
        emitProfileCheckResult({
          status: 'not_recruiter',
          name: detectedName,
          title: effectiveTitle || title || exp?.jobTitle || '',
          url: profileUrl,
        });
        return;
      }
    }

    let companySlug = exp?.slug || heroCompany.companySlug || voyager?.companySlug || null;
    let companyName = companySlug
      ? (exp?.name || heroCompany.companyName || heroCompanyNameFallback || headerCompanyName || voyager?.companyName || '')
      : (heroCompany.companyName || heroCompanyNameFallback || headerCompanyName || voyager?.companyName || exp?.name || '');
    const numericCandidate = exp?.numericCandidate || heroCompany.numericCandidate || voyager?.numericCandidate || null;

    if (!companySlug && !numericCandidate) {
      const hc = extractCompanyFromHeadline(effectiveTitle);
      if (hc) { companySlug = hc.slug; companyName = hc.name; }
    }

    if (!companySlug && !numericCandidate && !companyName) {
      state.lastProfileUrl = profileUrl;
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
    if (checkSeq !== state.profileCheckSeq) return;

    if (!companySlug) {
      state.lastProfileUrl = profileUrl;
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

    state.lastProfileUrl = profileUrl;

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

  globalThis.checkProfilePage = checkProfilePage;

  if (!globalThis.__recruiterFinderProfileListenerAdded) {
    globalThis.__recruiterFinderProfileListenerAdded = true;
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action !== 'requestProfileState') return;
      state.lastProfileUrl = null;
      checkProfilePage(true);
    });
  }
})();
