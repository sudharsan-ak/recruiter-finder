(function () {
  const helpers = globalThis.__recruiterFinderProfileHelpers || (globalThis.__recruiterFinderProfileHelpers = {});

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

  helpers.fetchVoyagerProfileData = async function fetchVoyagerProfileData() {
    const handle = helpers.getProfileHandleFromPath();
    const csrf = helpers.getLinkedInCsrfToken();
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
  };

  helpers.resolveCanonicalCompanySlug = async function resolveCanonicalCompanySlug(companySlug, companyName, numericCandidate) {
    const normalizedForLookup = (companySlug || '').replace(/-/g, '');
    const normalizedName = (companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const lowerCompanyName = (companyName || '').toLowerCase().trim();

    let storageData;
    try {
      storageData = await new Promise(r => chrome.storage.local.get(['companySlugMap', 'recruiterHistory'], r));
    } catch {
      return { companySlug: null, companyName };
    }

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
  };
})();
