(function () {
  const state = globalThis.__recruiterFinderProfileState || (globalThis.__recruiterFinderProfileState = {
    lastProfileUrl: null,
    profileCheckSeq: 0,
  });
  const helpers = globalThis.__recruiterFinderProfileHelpers || {};

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
    const photoUrl = helpers.getProfilePhotoUrl?.();

    let headerCompanyName = null;
    const currentCoBtn = document.querySelector('button[aria-label^="Current company:"]');
    if (currentCoBtn) {
      const lbl = currentCoBtn.getAttribute('aria-label') || '';
      const lm = lbl.match(/Current company:\s*(.+?)(?:\.\s*Click|$)/i);
      if (lm) headerCompanyName = lm[1].trim();
    }
    const heroCompany = helpers.getHeroCompanyInfo?.(nameEl) || { companyName: '', companySlug: null, numericCandidate: null };
    const heroCompanyNameFallback = helpers.getHeroCompanyNameFallback?.(nameEl) || '';

    const exp = await helpers.waitForExperienceEntry?.(profileUrl, instant);
    if (checkSeq !== state.profileCheckSeq) return;
    const voyager = await helpers.fetchVoyagerProfileData?.();
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
            if (isRecruiterCard(lines[li])) {
              effectiveTitle = lines[li];
              break;
            }
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
      const hc = helpers.extractCompanyFromHeadline?.(effectiveTitle);
      if (hc) {
        companySlug = hc.slug;
        companyName = hc.name;
      }
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

    const resolved = await helpers.resolveCanonicalCompanySlug?.(companySlug, companyName, numericCandidate);
    ({ companySlug, companyName } = resolved || { companySlug: null, companyName });
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
