// ── Email builder → recruiter cache update ────────────────────────────────────
const emailCheckBtn  = document.getElementById('emailCheckBtn');
const emailNotif     = document.getElementById('emailNotif');
const emailUsername  = document.getElementById('emailUsername');
const emailDomain    = document.getElementById('emailDomain');
const emailUsernameDropdown = document.getElementById('emailUsernameDropdown');
const emailDomainDropdown   = document.getElementById('emailDomainDropdown');

let _pendingEmailUpdate  = null;
let _domainFetchTimer    = null;
let _usernameVariants    = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function _isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.trim());
}

function hideEmailNotif() {
  emailNotif.style.display = 'none';
  emailNotif.innerHTML = '';
  emailNotif.className = '';
  _pendingEmailUpdate = null;
}

function _hideDropdowns() {
  emailUsernameDropdown.style.display = 'none';
  emailDomainDropdown.style.display   = 'none';
}

function _buildUsernameVariants(fullName) {
  const parts = fullName.trim().toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts.length === 1 ? [parts[0]] : [];
  const [first, ...rest] = parts;
  const last = rest[rest.length - 1];
  return [
    `${first}.${last}`,
    `${first}${last}`,
    `${first[0]}${last}`,
    `${first}${last[0]}`,
  ];
}

function _renderUsernameDropdown(variants) {
  if (!variants.length) { emailUsernameDropdown.style.display = 'none'; return; }
  emailUsernameDropdown.innerHTML = variants.map(v =>
    `<div class="email-dd-item" data-value="${v}">${v}</div>`
  ).join('');
  emailUsernameDropdown.style.display = 'block';
  emailUsernameDropdown.querySelectorAll('.email-dd-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      emailUsername.value = item.dataset.value;
      emailUsernameDropdown.style.display = 'none';
    });
  });
}

function _renderDomainDropdown(suggestions) {
  if (!suggestions.length) { emailDomainDropdown.style.display = 'none'; return; }
  emailDomainDropdown.innerHTML = suggestions.map(s =>
    `<div class="email-dd-item" data-value="${s.domain}">
      <span class="email-dd-domain">${s.domain}</span>
      <span class="email-dd-company">${s.name}</span>
    </div>`
  ).join('');
  emailDomainDropdown.style.display = 'block';
  emailDomainDropdown.querySelectorAll('.email-dd-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      emailDomain.value = item.dataset.value;
      emailDomainDropdown.style.display = 'none';
    });
  });
}

async function _fetchClearbit(query) {
  if (!query || query.length < 2) return [];
  try {
    const res = await fetch(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data || []).filter(d => d.domain).slice(0, 6);
  } catch { return []; }
}

// ── Init: called when panel detects a profile page ───────────────────────────

function initEmailBuilderFromName(fullName, existingEmail) {
  emailUsername.value = '';
  _usernameVariants   = [];
  _hideDropdowns();
  if (!fullName) return;

  const generated = _buildUsernameVariants(fullName);

  if (existingEmail && _isValidEmail(existingEmail)) {
    const [existingUser, existingDomain] = existingEmail.split('@');
    // Existing email first, then generated variants (deduped)
    _usernameVariants = [existingUser, ...generated.filter(v => v !== existingUser)];
    emailUsername.value = existingUser;
    // Prefill domain from existing email, Clearbit will only be fallback
    if (!emailDomain.value) emailDomain.value = existingDomain;
  } else {
    _usernameVariants = generated;
    if (_usernameVariants.length) emailUsername.value = _usernameVariants[0];
  }
}

async function initEmailBuilder() {
  emailUsername.value = '';
  emailDomain.value   = '';
  _usernameVariants   = [];
  _hideDropdowns();

  // Prefill domain from company name via Clearbit (only if not already set from existing email)
  const tryPrefillDomain = async () => {
    if (emailDomain.value) return;
    const companyName = companyEl?.textContent?.trim();
    if (companyName) {
      const suggestions = await _fetchClearbit(companyName);
      if (suggestions.length && !emailDomain.value) emailDomain.value = suggestions[0].domain;
    }
  };
  tryPrefillDomain();
  setTimeout(tryPrefillDomain, 1000);
}

globalThis.initEmailBuilder         = initEmailBuilder;
globalThis.initEmailBuilderFromName = initEmailBuilderFromName;

// ── Username input events ─────────────────────────────────────────────────────

emailUsername.addEventListener('focus', () => {
  if (_usernameVariants.length) _renderUsernameDropdown(_usernameVariants);
});

emailUsername.addEventListener('input', () => {
  const q = emailUsername.value.toLowerCase();
  const filtered = _usernameVariants.filter(v => v.startsWith(q));
  if (filtered.length && q) _renderUsernameDropdown(filtered);
  else if (!q && _usernameVariants.length) _renderUsernameDropdown(_usernameVariants);
  else emailUsernameDropdown.style.display = 'none';
});

emailUsername.addEventListener('blur', () => {
  setTimeout(() => { emailUsernameDropdown.style.display = 'none'; }, 150);
});

emailUsername.addEventListener('keydown', e => {
  if (e.key === 'Escape') { emailUsername.value = ''; _hideDropdowns(); hideEmailNotif(); }
  if (e.key === 'Enter')  { e.preventDefault(); checkEmailForCurrentRecruiter(); }
});

// ── Domain input events ───────────────────────────────────────────────────────

emailDomain.addEventListener('input', () => {
  const q = emailDomain.value.trim();
  clearTimeout(_domainFetchTimer);
  if (!q) { emailDomainDropdown.style.display = 'none'; return; }
  _domainFetchTimer = setTimeout(async () => {
    const suggestions = await _fetchClearbit(q);
    _renderDomainDropdown(suggestions);
  }, 300);
});

emailDomain.addEventListener('blur', () => {
  setTimeout(() => { emailDomainDropdown.style.display = 'none'; }, 150);
});

emailDomain.addEventListener('keydown', e => {
  if (e.key === 'Escape') { emailDomain.value = ''; _hideDropdowns(); hideEmailNotif(); }
  if (e.key === 'Enter')  { e.preventDefault(); checkEmailForCurrentRecruiter(); }
});

// ── Submit ────────────────────────────────────────────────────────────────────

async function checkEmailForCurrentRecruiter() {
  const username = emailUsername.value.trim().toLowerCase();
  const domain   = emailDomain.value.trim().toLowerCase();
  const email    = username && domain ? `${username}@${domain}` : '';

  if (!_isValidEmail(email)) {
    emailNotif.innerHTML = 'Enter a valid username and domain.';
    emailNotif.className = 'email-notif email-notif-error';
    emailNotif.style.display = 'flex';
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const profileMatch = (tab?.url || '').match(/linkedin\.com\/in\/([^/?#]+)/);

  if (!profileMatch) {
    emailNotif.innerHTML = 'Open a LinkedIn recruiter profile page first.';
    emailNotif.className = 'email-notif email-notif-error';
    emailNotif.style.display = 'flex';
    return;
  }

  const handle = profileMatch[1].toLowerCase().replace(/\/$/, '');
  const cache  = await getCache();
  let foundSlug = null;
  let foundRecruiter = null;

  for (const [slug, entry] of Object.entries(cache)) {
    for (const r of (entry.recruiters || [])) {
      const rHandle = (r.url || '').match(/linkedin\.com\/in\/([^/?#]+)/)?.[1]
        ?.toLowerCase().replace(/\/$/, '');
      if (rHandle === handle) { foundSlug = slug; foundRecruiter = r; break; }
    }
    if (foundSlug) break;
  }

  if (!foundRecruiter) {
    emailNotif.innerHTML = 'Recruiter not found in cache. Scan their company first.';
    emailNotif.className = 'email-notif email-notif-error';
    emailNotif.style.display = 'flex';
    return;
  }

  const existingEmail = (foundRecruiter.email || '').toLowerCase().trim();

  if (existingEmail === email) {
    emailNotif.innerHTML = `✅ <strong>${email}</strong> is already saved for ${foundRecruiter.name}.`;
    emailNotif.className = 'email-notif email-notif-ok';
    emailNotif.style.display = 'flex';
    setTimeout(hideEmailNotif, 3000);
    return;
  }

  const mode   = existingEmail ? 'replace' : 'add';
  const verb   = mode === 'replace' ? 'Replace' : 'Add';
  const detail = mode === 'replace' ? ` <span style="color:#888">(was: ${existingEmail})</span>` : '';

  _pendingEmailUpdate = { slug: foundSlug, recruiterUrl: foundRecruiter.url, recruiterName: foundRecruiter.name, email, mode };

  emailNotif.innerHTML = `
    <span class="email-notif-msg">📧 ${verb} <strong>${email}</strong> for <strong>${foundRecruiter.name}</strong>${detail}?</span>
    <button class="email-notif-confirm">${verb}</button>
    <button class="email-notif-skip">Skip</button>
  `;
  emailNotif.className = 'email-notif email-notif-prompt';
  emailNotif.style.display = 'flex';

  emailNotif.querySelector('.email-notif-confirm').addEventListener('click', async () => {
    const { slug, recruiterUrl, email: em, recruiterName } = _pendingEmailUpdate;
    const c = await getCache();
    const entry = c[slug];
    if (entry) {
      const rec = entry.recruiters.find(r => normalizeUrl(r.url) === normalizeUrl(recruiterUrl));
      if (rec) {
        rec.email = em;
        await new Promise(r => chrome.storage.local.set({ [CACHE_KEY]: c }, r));
        if (slug === currentSlug) renderResults(entry.recruiters);
      }
    }
    emailUsername.value = '';
    emailDomain.value   = '';
    emailNotif.innerHTML = `✅ Email saved for <strong>${recruiterName}</strong>.`;
    emailNotif.className = 'email-notif email-notif-ok';
    emailNotif.style.display = 'flex';
    _pendingEmailUpdate = null;
    setTimeout(hideEmailNotif, 3000);
  });

  emailNotif.querySelector('.email-notif-skip').addEventListener('click', () => {
    emailUsername.value = '';
    emailDomain.value   = '';
    hideEmailNotif();
  });
}

emailCheckBtn.addEventListener('click', checkEmailForCurrentRecruiter);
