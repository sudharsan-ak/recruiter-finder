const modal        = document.getElementById('addRecruiterModal');
const modalError   = document.getElementById('modalError');
const modalSaveBtn = document.getElementById('modalSaveBtn');
const confirmModal = document.getElementById('confirmModal');
const confirmModalTitle = document.getElementById('confirmModalTitle');
const confirmModalMessage = document.getElementById('confirmModalMessage');
const confirmModalCancelBtn = document.getElementById('confirmModalCancelBtn');
const confirmModalConfirmBtn = document.getElementById('confirmModalConfirmBtn');
let _confirmResolver = null;

function openAddRecruiterModal() {
  ['mName','mTitle','mEmail','mUrl','mCompany','mCompanyUrl'].forEach(id => {
    document.getElementById(id).value = '';
  });
  modalError.textContent = '';
  modal.classList.add('open');
  document.getElementById('mName').focus();
}

function closeModal() {
  modal.classList.remove('open');
}

function closeConfirmModal(result = false) {
  confirmModal.classList.remove('open');
  if (_confirmResolver) {
    const resolve = _confirmResolver;
    _confirmResolver = null;
    resolve(result);
  }
}

function openConfirmModal({
  title = 'Confirm action',
  message = 'Are you sure?',
  confirmText = 'Delete'
} = {}) {
  if (_confirmResolver) closeConfirmModal(false);
  confirmModalTitle.textContent = title;
  confirmModalMessage.textContent = message;
  confirmModalConfirmBtn.textContent = confirmText;
  confirmModal.classList.add('open');
  confirmModalConfirmBtn.focus();
  return new Promise(resolve => {
    _confirmResolver = resolve;
  });
}
globalThis.openConfirmModal = openConfirmModal;

async function backfillLogos() {
  const cache = await getCache();
  const missing = Object.keys(cache).filter(slug => !cache[slug].logoUrl);
  if (missing.length === 0) return;

  for (const slug of missing) {
    try {
      const response = await new Promise(resolve =>
        chrome.runtime.sendMessage({ action: 'fetchLogo', companySlug: slug }, resolve)
      );
      const logo = response?.logoUrl || null;

      if (logo) {
        const fresh = await getCache();
        if (fresh[slug] && !fresh[slug].logoUrl) {
          fresh[slug].logoUrl = logo;
          await new Promise(r => chrome.storage.local.set({ [CACHE_KEY]: fresh }, r));
          const fallback = document.querySelector(`#hc-${slug} .company-logo-fallback`);
          if (fallback) {
            const img = document.createElement('img');
            img.className = 'company-logo';
            img.src = logo;
            img.alt = '';
            img.addEventListener('error', () => img.replaceWith(fallback));
            fallback.replaceWith(img);
          }
        }
      }
    } catch {}
  }
}
globalThis.backfillLogos = backfillLogos;

addRecruiterBtn.addEventListener('click', openAddRecruiterModal);

refreshLogosBtn.addEventListener('click', async () => {
  globalThis.setHistoryActionStatus?.('Refreshing logos…', 0);
  refreshLogosBtn.textContent = '⏳ Fetching...';
  refreshLogosBtn.disabled = true;
  await backfillLogos();
  globalThis.setHistoryActionStatus?.('Refresh logos done');
  refreshLogosBtn.textContent = '✅ Done';
  setTimeout(() => {
    refreshLogosBtn.textContent = '🖼 Refresh Logos';
    refreshLogosBtn.disabled = false;
  }, 2000);
});

document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
confirmModalCancelBtn.addEventListener('click', () => closeConfirmModal(false));
confirmModalConfirmBtn.addEventListener('click', () => closeConfirmModal(true));
confirmModal.addEventListener('click', e => { if (e.target === confirmModal) closeConfirmModal(false); });
confirmModal.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeConfirmModal(false);
  }
});

modalSaveBtn.addEventListener('click', async () => {
  const name       = document.getElementById('mName').value.trim();
  const title      = document.getElementById('mTitle').value.trim();
  const email      = document.getElementById('mEmail').value.trim().toLowerCase();
  const url        = document.getElementById('mUrl').value.trim();
  const company    = document.getElementById('mCompany').value.trim();
  const companyUrl = document.getElementById('mCompanyUrl').value.trim();

  if (!name)    { modalError.textContent = 'Name is required.'; return; }
  if (!url)     { modalError.textContent = 'Profile URL is required.'; return; }
  if (!company) { modalError.textContent = 'Company name is required.'; return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    modalError.textContent = 'Email must be a valid address.';
    return;
  }
  if (!url.includes('linkedin.com/in/')) {
    modalError.textContent = 'Profile URL must be a LinkedIn /in/ URL.';
    return;
  }

  let slug = null;
  if (companyUrl) {
    const m = companyUrl.match(/linkedin\.com\/company\/([^/?#]+)/);
    if (m) slug = m[1].toLowerCase().replace(/\/$/, '');
  }
  if (!slug) slug = company.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const profileUrl = url.split('?')[0].replace(/\/$/, '') + '/';

  const cache = await getCache();
  if (cache[slug]) {
    const exists = cache[slug].recruiters.some(r => r.url === profileUrl);
    if (exists) { modalError.textContent = 'This profile is already saved for this company.'; return; }
    cache[slug].recruiters.push({ name, title, url: profileUrl, photoUrl: '', email });
  } else {
    cache[slug] = {
      recruiters: [{ name, title, url: profileUrl, photoUrl: '', email }],
      logoUrl: null,
      scannedAt: Date.now(),
      displayName: company,
    };
  }

  await new Promise(r => chrome.storage.local.set({ [CACHE_KEY]: cache }, r));
  closeModal();
  globalThis.setHistoryActionStatus?.('Recruiter added');
  renderHistory(historySearch.value);
});
