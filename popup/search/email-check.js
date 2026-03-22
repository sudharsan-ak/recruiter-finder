// ── Email paste → recruiter cache update ──────────────────────────────────────
const emailCheckInput = document.getElementById('emailCheckInput');
const emailCheckBtn   = document.getElementById('emailCheckBtn');
const emailNotif      = document.getElementById('emailNotif');

let _pendingEmailUpdate = null;

function _isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.trim());
}

function hideEmailNotif() {
  emailNotif.style.display = 'none';
  emailNotif.innerHTML = '';
  emailNotif.className = '';
  _pendingEmailUpdate = null;
}

async function checkEmailForCurrentRecruiter() {
  const email = emailCheckInput.value.trim().toLowerCase();

  if (!_isValidEmail(email)) {
    emailNotif.innerHTML = 'Enter a valid email address.';
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

  // Search cache for recruiter with matching LinkedIn handle
  const cache = await getCache();
  let foundSlug = null;
  let foundRecruiter = null;

  for (const [slug, entry] of Object.entries(cache)) {
    for (const r of (entry.recruiters || [])) {
      const rHandle = (r.url || '').match(/linkedin\.com\/in\/([^/?#]+)/)?.[1]
        ?.toLowerCase().replace(/\/$/, '');
      if (rHandle === handle) {
        foundSlug = slug;
        foundRecruiter = r;
        break;
      }
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

  const mode = existingEmail ? 'replace' : 'add';
  const verb = mode === 'replace' ? 'Replace' : 'Add';
  const detail = mode === 'replace' ? ` <span style="color:#888">(was: ${existingEmail})</span>` : '';

  _pendingEmailUpdate = {
    slug: foundSlug,
    recruiterUrl: foundRecruiter.url,
    recruiterName: foundRecruiter.name,
    email,
    mode
  };

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
    emailCheckInput.value = '';
    emailNotif.innerHTML = `✅ Email saved for <strong>${recruiterName}</strong>.`;
    emailNotif.className = 'email-notif email-notif-ok';
    emailNotif.style.display = 'flex';
    _pendingEmailUpdate = null;
    setTimeout(hideEmailNotif, 3000);
  });

  emailNotif.querySelector('.email-notif-skip').addEventListener('click', () => {
    emailCheckInput.value = '';
    hideEmailNotif();
  });
}

emailCheckBtn.addEventListener('click', checkEmailForCurrentRecruiter);

emailCheckInput.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { e.preventDefault(); checkEmailForCurrentRecruiter(); }
  if (e.key === 'Escape') { emailCheckInput.value = ''; hideEmailNotif(); }
});

// Clear error notif when user starts typing again
emailCheckInput.addEventListener('input', () => {
  if (emailNotif.classList.contains('email-notif-error')) hideEmailNotif();
});
