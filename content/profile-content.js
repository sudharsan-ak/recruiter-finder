(function () {
  const state = globalThis.__recruiterFinderProfileState || (globalThis.__recruiterFinderProfileState = {
    lastProfileUrl: null,
    profileCheckSeq: 0,
  });

  const _isRecruiter = globalThis.isRecruiterCard || function (t) {
    return /recruit|talent|sourc|acquisition/i.test(t) && !/engineer|software|developer/i.test(t);
  };

  function emit(payload) {
    try {
      const p = chrome.runtime.sendMessage({ action: 'profileCheckResult', ...payload });
      if (p?.catch) p.catch(() => {});
    } catch {}
  }

  function readJsonLD() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const items = [].concat(JSON.parse(script.textContent || script.innerText || ''));
        for (const item of items) {
          if (item?.['@type'] === 'Person' && (item.name || item.jobTitle)) {
            return {
              name: item.name || '',
              title: item.jobTitle || '',
              company: item.worksFor?.name || '',
            };
          }
        }
      } catch {}
    }
    return null;
  }

  // Returns { title, companyName } by traversing up from nameEl to find sibling <p> elements.
  // New LinkedIn layout: obfuscated classes, title + company are <p> siblings of a nameEl ancestor.
  function readProfileTexts(nameEl) {
    // Legacy selectors (old LinkedIn layouts)
    const legacyTitle = (
      document.querySelector('.pv-text-details__left-panel .text-body-medium.break-words') ||
      document.querySelector('.top-card-layout__headline') ||
      document.querySelector('.text-body-medium.break-words')
    )?.innerText?.trim() || '';
    if (legacyTitle) return { title: legacyTitle, companyName: '' };

    if (!nameEl) return { title: '', companyName: '' };

    // New layout: traverse up, collect p siblings that aren't pronouns/degree markers
    let el = nameEl;
    for (let i = 0; i < 12; i++) {
      el = el.parentElement;
      if (!el || !el.parentElement) break;
      const siblings = [...el.parentElement.children];
      const idx = siblings.indexOf(el);
      const texts = [];
      for (let j = idx + 1; j < Math.min(idx + 6, siblings.length); j++) {
        const sib = siblings[j];
        if (sib.tagName !== 'P') continue;
        const t = sib.textContent?.trim() || '';
        if (t.length < 3) continue;
        // Skip pronouns, connection degrees, bullets
        if (/^[·•·]|^(she\/her|he\/him|they\/them)|\b(1st|2nd|3rd|4th)\b/i.test(t)) continue;
        texts.push(t);
      }
      if (texts.length >= 1) return { title: texts[0], companyName: texts[1] || '' };
    }
    return { title: '', companyName: '' };
  }

  async function resolveSlug(companySlug, companyName) {
    try {
      const data = await new Promise(r => chrome.storage.local.get(['companySlugMap', 'recruiterHistory'], r));
      const slugMap = data.companySlugMap || {};
      const cache = data.recruiterHistory || {};
      const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const slugNorm = norm(companySlug);
      const nameNorm = norm(companyName);

      // Direct cache hit
      if (companySlug && cache[companySlug]) {
        return { companySlug, companyName: companyName || cache[companySlug]?.displayName || companySlug.replace(/-/g, ' ') };
      }
      // SlugMap lookup
      const mapped = slugMap[companySlug] || slugMap[slugNorm] || slugMap[nameNorm] || null;
      if (mapped) return { companySlug: mapped, companyName: companyName || cache[mapped]?.displayName || mapped.replace(/-/g, ' ') };
      // Cache name/alias scan
      if (nameNorm || slugNorm) {
        for (const [slug, entry] of Object.entries(cache)) {
          const dn = norm(entry?.displayName || '');
          const aliasMatch = (entry?.aliases || []).some(a => norm(a) === nameNorm);
          if ((nameNorm && dn === nameNorm) || aliasMatch || (slugNorm && norm(slug) === slugNorm)) {
            return { companySlug: slug, companyName: companyName || entry?.displayName || slug.replace(/-/g, ' ') };
          }
        }
      }
      // COMPANY_SLUG_ALIASES fallback (defined in aliases.js)
      if (typeof COMPANY_SLUG_ALIASES !== 'undefined') {
        const aliasSlug = COMPANY_SLUG_ALIASES[companySlug] || COMPANY_SLUG_ALIASES[slugNorm] || COMPANY_SLUG_ALIASES[nameNorm] || null;
        if (aliasSlug) return { companySlug: aliasSlug, companyName: companyName || cache[aliasSlug]?.displayName || aliasSlug.replace(/-/g, ' ') };
      }
    } catch {}
    // Return slug as-is — may be valid even if not yet in cache
    return { companySlug: companySlug || null, companyName };
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

    const helpers = globalThis.__recruiterFinderProfileHelpers || {};

    // Read name — retry once after 2s if page hasn't loaded yet
    const titleName = document.title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
    const pickName = () => {
      // Try known selectors first, then any h1/h2 whose text matches the page title name
      const el =
        document.querySelector('h1.text-heading-xlarge') ||
        document.querySelector('h1.top-card-layout__title') ||
        document.querySelector('h1') ||
        (titleName.length > 2
          ? [...document.querySelectorAll('h1, h2')].find(e =>
              (e.textContent?.trim() || '').startsWith(titleName.substring(0, 6)))
          : null) ||
        document.querySelector('h2');
      const fromEl = el?.innerText?.trim() || el?.textContent?.trim() || '';
      if (fromEl) return { el, name: fromEl };
      // Fallback: extract from page title ("Megan Vallés | LinkedIn")
      return { el, name: (titleName && titleName.toLowerCase() !== 'linkedin') ? titleName : '' };
    };
    let { el: nameEl, name } = pickName();
    if (!name) {
      await new Promise(r => setTimeout(r, 2000));
      if (checkSeq !== state.profileCheckSeq) return;
      ({ el: nameEl, name } = pickName());
    }
    if (!name) {
      emit({ status: 'profile_error', reason: 'Profile page did not render a name. Try reloading the tab.', url: profileUrl });
      return;
    }

    // JSON-LD structured data — always server-side rendered, most reliable
    const jsonLD = readJsonLD();
    const profileTexts = readProfileTexts(nameEl);

    let title = profileTexts.title || jsonLD?.title || '';
    const photoUrl = helpers.getProfilePhotoUrl?.(name) || null;

    // Extract company info — needed for both recruiter AND non-recruiter paths
    const heroInfo = helpers.getHeroCompanyInfo?.(nameEl) || { companyName: '', companySlug: null };
    let companySlug = heroInfo.companySlug || null;
    let companyName = heroInfo.companyName || profileTexts.companyName || jsonLD?.company || '';

    if (!companySlug && !companyName) {
      const btn = document.querySelector('button[aria-label^="Current company:"]');
      if (btn) {
        const m = (btn.getAttribute('aria-label') || '').match(/Current company:\s*(.+?)(?:\.\s*Click|$)/i);
        if (m) companyName = m[1].trim();
      }
    }
    if (!companySlug) {
      const exp = helpers.getFirstExperienceEntry?.();
      if (exp) { companySlug = exp.slug || null; companyName = companyName || exp.name || ''; }
    }
    if (!companySlug && !companyName) {
      const hc = helpers.extractCompanyFromHeadline?.(title);
      if (hc) { companySlug = hc.slug; companyName = hc.name; }
    }
    // If multiple companies listed (e.g. "Acme · University X"), take only the first
    if (companyName) companyName = companyName.split(/\s*[·•|]\s*/)[0].trim();

    if (!companySlug && companyName) {
      companySlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || null;
    }

    // Recruiter check — emit not_recruiter with company info so the panel can offer a lookup
    if (!_isRecruiter(title)) {
      const heroEl = nameEl?.closest('section') || nameEl?.closest('.artdeco-card') || nameEl?.closest('.ph5');
      const heroText = heroEl?.innerText || heroEl?.textContent || '';
      if (!_isRecruiter(heroText)) {
        state.lastProfileUrl = profileUrl;
        emit({ status: 'not_recruiter', name, title, url: profileUrl, companySlug, companyName, photoUrl });
        return;
      }
    }
    if (checkSeq !== state.profileCheckSeq) return;

    if (!companySlug && !companyName) {
      state.lastProfileUrl = profileUrl;
      emit({ status: 'company_unresolved', name, title, url: profileUrl, photoUrl, reason: 'Could not identify the current company from the profile.' });
      return;
    }

    const resolved = await resolveSlug(companySlug, companyName);
    if (checkSeq !== state.profileCheckSeq) return;
    companySlug = resolved.companySlug;
    companyName = resolved.companyName;

    if (!companySlug) {
      state.lastProfileUrl = profileUrl;
      emit({ status: 'company_unresolved', name, title, url: profileUrl, companyName, photoUrl, reason: 'Detected a recruiter, but could not resolve the company to a known slug.' });
      return;
    }

    state.lastProfileUrl = profileUrl;
    emit({ status: 'recruiter_found', name, title, url: profileUrl, companySlug, companyName, photoUrl });
  }

  globalThis.checkProfilePage = checkProfilePage;

  // No guard — always register listener so re-injection after extension reload works
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action !== 'requestProfileState') return;
    state.lastProfileUrl = null;
    checkProfilePage(true);
  });
})();
