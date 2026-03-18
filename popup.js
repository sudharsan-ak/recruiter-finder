const scanBtn      = document.getElementById('scanBtn');
const copyBtn      = document.getElementById('copyBtn');
const resultsDiv          = document.getElementById('results');
const resultsCompanyBanner = document.getElementById('resultsCompanyBanner');
const statusBox    = document.getElementById('statusBox');
const errorDiv     = document.getElementById('error');
const companyEl    = document.getElementById('companyName');
const progressBar  = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');

const tabSearchBtn  = document.getElementById('tabSearch');
const tabBulkBtn    = document.getElementById('tabBulk');
const tabHistoryBtn = document.getElementById('tabHistory');
const searchPanel   = document.getElementById('searchPanel');
const bulkPanel     = document.getElementById('bulkPanel');
const historyPanel  = document.getElementById('historyPanel');
const historyList   = document.getElementById('historyList');
const historySearch = document.getElementById('historySearch');
const clearSearchBtn   = document.getElementById('clearSearchBtn');
const clearHistBtn     = document.getElementById('clearHistoryBtn');
const exportCsvBtn     = document.getElementById('exportCsvBtn');
const exportBackupBtn  = document.getElementById('exportBackupBtn');
const importBackupBtn  = document.getElementById('importBackupBtn');
const importFileInput  = document.getElementById('importFileInput');
const addRecruiterBtn  = document.getElementById('addRecruiterBtn');
const refreshLogosBtn  = document.getElementById('refreshLogosBtn');

const observerNotif    = document.getElementById('observerNotification');
const obsText          = document.getElementById('obsText');
const obsShowBtn       = document.getElementById('obsShowBtn');
const obsDismissBtn    = document.getElementById('obsDismissBtn');
const observerModal    = document.getElementById('observerModal');
const obsModalTitle    = document.getElementById('obsModalTitle');
const obsModalList     = document.getElementById('obsModalList');
const obsModalSelCount = document.getElementById('obsModalSelCount');
const obsModalAddBtn   = document.getElementById('obsModalAddBtn');
const obsModalCloseBtn = document.getElementById('obsModalCloseBtn');
const obsSelectAll     = document.getElementById('obsSelectAll');
const obsDeselectAll   = document.getElementById('obsDeselectAll');

const bulkTextarea    = document.getElementById('bulkTextarea');
const bulkForceRescan = document.getElementById('bulkForceRescan');
const bulkSearchBtn   = document.getElementById('bulkSearchBtn');
const bulkProgressBar = document.getElementById('bulkProgressBar');
const bulkProgressFill = document.getElementById('bulkProgressFill');
const bulkStatus      = document.getElementById('bulkStatus');
const bulkResultsDiv  = document.getElementById('bulkResults');

const companyMetaEl  = document.getElementById('companyMeta');
const techStackEl    = document.getElementById('techStack');

const CACHE_KEY      = 'recruiterHistory';
const autoScanToggle = document.getElementById('autoScanToggle');
const asStatus       = document.getElementById('asStatus');

// ── Auto-scan toggle ──────────────────────────────────────────────────────────
chrome.storage.local.get(['autoScanEnabled'], ({ autoScanEnabled }) => {
  const on = autoScanEnabled === true; // default OFF
  autoScanToggle.checked = on;
  asStatus.textContent   = on ? 'ON' : 'OFF';
  asStatus.classList.toggle('off', !on);
});

autoScanToggle.addEventListener('change', () => {
  const on = autoScanToggle.checked;
  chrome.storage.local.set({ autoScanEnabled: on });
  asStatus.textContent = on ? 'ON' : 'OFF';
  asStatus.classList.toggle('off', !on);
});

// ── Queue state ───────────────────────────────────────────────────────────────
const scanQueue      = [];   // [{ slug }]
let   isScanning     = false;
let   currentScanSlug = null;

function saveQueue() {
  chrome.storage.session.set({ manualScanQueue: scanQueue.map(q => q.slug) }).catch(() => {});
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function activateTab(activeBtn, activePanel, extraInit) {
  [tabSearchBtn, tabBulkBtn, tabHistoryBtn].forEach(b => b.classList.remove('active'));
  [searchPanel, bulkPanel, historyPanel].forEach(p => p.classList.remove('active'));
  activeBtn.classList.add('active');
  activePanel.classList.add('active');
  if (extraInit) extraInit();
}

tabSearchBtn.addEventListener('click', () => {
  // Clear history search when leaving history tab
  historySearch.value = '';
  clearSearchBtn.style.display = 'none';
  activateTab(tabSearchBtn, searchPanel);
});

tabBulkBtn.addEventListener('click', () => {
  historySearch.value = '';
  clearSearchBtn.style.display = 'none';
  activateTab(tabBulkBtn, bulkPanel);
});

tabHistoryBtn.addEventListener('click', () => activateTab(tabHistoryBtn, historyPanel, () => {
  renderHistory();
  backfillLogos();
}));

// ── Cache helpers ─────────────────────────────────────────────────────────────
async function getCache() {
  return new Promise(resolve => {
    chrome.storage.local.get([CACHE_KEY], data => resolve(data[CACHE_KEY] || {}));
  });
}

async function saveToCache(slug, recruiters, logoUrl = null) {
  const cache = await getCache();
  cache[slug] = {
    recruiters,
    logoUrl,
    scannedAt: Date.now(),
    displayName: cache[slug]?.displayName || slug.replace(/-/g, ' ')
  };
  return new Promise(resolve => {
    chrome.storage.local.set({ [CACHE_KEY]: cache }, resolve);
  });
}

async function getCached(slug) {
  const cache = await getCache();
  return cache[slug] || null;
}

async function deleteFromCache(slug) {
  const cache = await getCache();
  delete cache[slug];
  return new Promise(resolve => {
    chrome.storage.local.set({ [CACHE_KEY]: cache }, resolve);
  });
}

async function removeRecruiterFromCache(slug, url) {
  const cache = await getCache();
  if (!cache[slug]) return;
  cache[slug].recruiters = cache[slug].recruiters.filter(r => r.url !== url);
  return new Promise(resolve => {
    chrome.storage.local.set({ [CACHE_KEY]: cache }, resolve);
  });
}

async function renameCompanyInCache(slug, newName) {
  const cache = await getCache();
  if (!cache[slug]) return;
  cache[slug].displayName = newName;
  return new Promise(resolve => {
    chrome.storage.local.set({ [CACHE_KEY]: cache }, resolve);
  });
}

// ── Classify for display grouping ─────────────────────────────────────────────
function classify(title) {
  const t = (title || '').toLowerCase();
  if (/technical|tech\b|sourcing|sourcer/.test(t)) return 'tech';
  if (/head\b|director|vp\b|vice president|lead\b|senior/.test(t)) return 'senior';
  if (/coord/i.test(t)) return 'coord';
  if (/\btalent\b|\bacquisition\b/.test(t)) return 'talent';
  return 'general';
}

// ── Company meta (employee count + visa status) ───────────────────────────────
let currentEmployeeCount = null;
let currentVisaStatus    = null; // 'yes' | 'no' | 'na' | null (not yet checked)
let currentExperience    = null; // string like '3+ yrs' | 'na' | null (not yet checked)

// "501-1,000 employees" → "501-1,000"
function fmtEmpCount(str) {
  if (!str) return '';
  return str.replace(/\s*employees?\s*/i, '').trim();
}

// ── Copy JD ───────────────────────────────────────────────────────────────────
async function getJobDetailsFromPage(tabId, tabUrl) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: (isLinkedIn) => {
        // ── Role ──────────────────────────────────────────────────────────────
        let role = '';
        if (isLinkedIn) {
          for (const sel of [
            '.job-details-jobs-unified-top-card__job-title h1',
            '.jobs-unified-top-card__job-title h1',
            '.topcard__title',
            '.job-details-jobs-unified-top-card__job-title',
            'h1',
          ]) {
            const el = document.querySelector(sel);
            const t = el?.innerText?.trim() || el?.textContent?.trim();
            if (t) { role = t; break; }
          }
          // Fallback: parse "Job Title | Company | LinkedIn" from page title
          if (!role && document.title) {
            role = document.title.split(' | ')[0].trim();
          }
        } else {
          role = document.querySelector('h1')?.textContent?.trim() || '';
        }

        // ── JD text ───────────────────────────────────────────────────────────
        let jd = '';

        if (isLinkedIn) {
          // Priority 1: specific JD content container (cleanest)
          // Note: /jobs/view/ direct pages use .show-more-less-html__markup or .description__text--rich
          const specific = document.querySelector(
            '.jobs-description-content__text, .jobs-description__content, ' +
            '.jobs-description-content, .jobs-box__html-content, ' +
            '.show-more-less-html__markup, .description__text--rich, .description__text'
          );
          if (specific?.innerText?.trim().length > 50) {
            jd = specific.innerText.trim();
          } else {
            // Priority 2: grab the full detail pane text, then slice out
            // just the "About the job" section and drop everything after it
            const pane = document.querySelector(
              '.jobs-search__job-details--wrapper, .scaffold-layout__detail, ' +
              '.job-view-layout, .jobs-details'
            );
            const raw = pane?.innerText || document.body.innerText || '';

            // Find "About the job" heading
            const startIdx = raw.search(/About the job\s*\n/i);
            let slice = startIdx !== -1 ? raw.slice(startIdx + raw.match(/About the job\s*\n/i)[0].length) : raw;

            // Cut off at the first noise section that follows the JD
            const endMarkers = [
              'About the company',
              'People you can reach out to',
              'Candidates who clicked apply',
              'Exclusive Job Seeker Insights',
              'Trending employee content',
              'Show more Premium insights',
            ];
            for (const marker of endMarkers) {
              const idx = slice.indexOf(marker);
              if (idx !== -1) slice = slice.slice(0, idx);
            }
            jd = slice.trim();
          }
        } else {
          // Non-LinkedIn: try common JD containers, then fall back to body
          let jdEl = null;
          for (const sel of [
            '#job-description', '#jobDescription', '#job_description',
            '[class*="job-description"]', '[class*="jobDescription"]',
            '[data-automation-id="job-description"]',
            '[data-testid*="description"]', 'article', 'main',
          ]) {
            const el = document.querySelector(sel);
            if (el?.innerText?.trim().length > 100) { jdEl = el; break; }
          }

          // ── Option A: DOM strip ───────────────────────────────────────────
          // Clone the container and remove all known noise elements before
          // reading text, so form fields, nav, buttons never make it in.
          const root = (jdEl || document.body).cloneNode(true);
          const noiseSelectors = [
            'form', 'nav', 'header', 'footer',
            'button', 'input', 'select', 'textarea', 'label',
            'script', 'style', 'noscript',
            '[class*="application"]', '[class*="Application"]',
            '[class*="demographic"]', '[class*="Demographic"]',
            '[class*="job-alert"]',   '[class*="jobAlert"]',
            '[class*="create-alert"]','[class*="legal"]',
            '[class*="privacy"]',     '[class*="equal-employment"]',
            '[id*="application"]',    '[id*="demographic"]',
          ];
          noiseSelectors.forEach(sel => {
            try { root.querySelectorAll(sel).forEach(el => el.remove()); } catch (e) {}
          });
          let raw = root.innerText || '';

          // ── Option B: text start/end markers ─────────────────────────────
          // Skip leading short/nav lines until we hit real content
          const lines = raw.split('\n');
          let startLine = 0;
          for (let i = 0; i < lines.length; i++) {
            const l = lines[i].trim();
            if (!l) continue;
            // Skip obvious UI / nav lines
            if (/^(back to|apply|save|share|sign in|log in|menu|home|jobs|careers)$/i.test(l)) continue;
            if (l.length < 20 && i < 15) continue; // short lines near the top
            startLine = i;
            break;
          }
          raw = lines.slice(startLine).join('\n');

          // Cut off at application form / noise section markers
          const stopMarkers = [
            'Create a Job Alert',
            'Apply for this job',
            'indicates a required field',
            'First Name*', 'First Name *',
            'Submit application',
            'U.S. Standard Demographic',
            'Create alert',
            'Attach\nAttach',
            'Accepted file types:',
            'By submitting my application',
          ];
          for (const marker of stopMarkers) {
            const idx = raw.indexOf(marker);
            if (idx !== -1) raw = raw.slice(0, idx);
          }

          jd = raw.trim();
        }

        jd = jd.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        return { role, jd };
      },
      args: [!!tabUrl?.includes('linkedin.com')]
    });
    return res[0]?.result || { role: '', jd: '' };
  } catch (e) {
    return { role: '', jd: '' };
  }
}

async function handleCopyJd() {
  const btn = document.getElementById('copyJdBtn');
  if (!btn) return;
  btn.textContent = '⏳';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { btn.textContent = '📋 JD'; return; }

  const { role, jd } = await getJobDetailsFromPage(tab.id, tab.url);
  const company = companyEl.textContent.trim() || 'Unknown Company';

  const text = [
    `Company - ${company}`,
    `Role - ${role || 'Unknown Role'}`,
    `JD:`,
    ``,
    jd,
  ].join('\n');

  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = '📋 JD'; }, 2000);
  }).catch(() => {
    btn.textContent = '❌ Failed';
    setTimeout(() => { btn.textContent = '📋 JD'; }, 2000);
  });
}

function updateCompanyMetaDisplay() {
  const parts = [];
  if (currentEmployeeCount) {
    parts.push(`<span>👥 ${currentEmployeeCount}</span>`);
  }
  if (currentExperience !== null) {
    if (currentExperience === 'na') {
      parts.push('<span class="meta-visa meta-visa-na">Exp: N/A</span>');
    } else {
      parts.push(`<span class="meta-visa">Exp: ${currentExperience}</span>`);
    }
  }
  if (currentVisaStatus !== null) {
    if (currentVisaStatus === 'yes') {
      parts.push('<span class="meta-visa meta-visa-yes">Visa: ✅ Yes</span>');
    } else if (currentVisaStatus === 'no') {
      parts.push('<span class="meta-visa meta-visa-no">Visa: ❌ No</span>');
    } else {
      parts.push('<span class="meta-visa meta-visa-na">Visa: N/A</span>');
    }
  }
  if (parts.length > 0) {
    companyMetaEl.innerHTML = parts.join('<span class="meta-sep"> · </span>') +
      '<button class="copy-jd-chip" id="copyJdBtn">📋 JD</button>';
    companyMetaEl.style.display = 'flex';
    document.getElementById('copyJdBtn').addEventListener('click', handleCopyJd);
  } else {
    companyMetaEl.style.display = 'none';
  }
}

function showCompanyMeta(employeeCount) {
  currentEmployeeCount = employeeCount || null;
  updateCompanyMetaDisplay();
}

function showVisaMeta(status) {
  currentVisaStatus = status; // 'yes', 'no', 'na'
  updateCompanyMetaDisplay();
}

function showExperienceMeta(exp) {
  currentExperience = exp || 'na';
  updateCompanyMetaDisplay();
}

async function updateCachedEmployeeCount(slug, employeeCount) {
  if (!employeeCount || !slug) return;
  const cache = await getCache();
  if (!cache[slug]) return;
  if (cache[slug].employeeCount === employeeCount) return;
  cache[slug].employeeCount = employeeCount;
  return new Promise(resolve => chrome.storage.local.set({ [CACHE_KEY]: cache }, resolve));
}

async function getEmployeeCountFromJobPage(tabId, attempt = 0) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Matches "501-1,000 employees", "10,001+ employees", etc.
        // Uses a capture group so we get only the matched portion, not the full line
        const pattern = /(\d[\d,]*[-–]\d[\d,]*\s*employees|\d[\d,]+\+?\s*employees)/i;
        const pane = document.querySelector(
          '.jobs-search__job-details--wrapper, .scaffold-layout__detail, .job-view-layout, .jobs-details'
        );
        const walker = document.createTreeWalker(pane || document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const m = node.textContent.match(pattern);
          if (m) return m[1];
        }
        return null;
      }
    });
    const result = res[0]?.result || null;
    // Retry a couple times — "About the company" section is often lazy-rendered
    if (!result && attempt < 3) {
      await new Promise(r => setTimeout(r, 1200));
      return getEmployeeCountFromJobPage(tabId, attempt + 1);
    }
    return result;
  } catch (e) {
    return null;
  }
}

async function getExperienceFromJobPage(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const pane = document.querySelector(
          '.jobs-search__job-details--wrapper, .scaffold-layout__detail, .job-view-layout, .jobs-details'
        );
        const text = (pane || document.body).innerText || '';
        let m;

        // Priority 1: "X-Y years of ... experience" (range + general)
        m = text.match(/\b(\d+)\s*[-–]\s*(\d+)\s*\+?\s*years?\s+of\s+(?:\w+\s+){0,3}?experience/i);
        if (m) return `${m[1]}-${m[2]} yrs`;

        // Priority 2: "X+ years of ... experience"
        m = text.match(/\b(\d+)\s*\+\s*years?\s+of\s+(?:\w+\s+){0,3}?experience/i);
        if (m) return `${m[1]}+ yrs`;

        // Priority 3: "X years of ... experience" (exact, no +)
        m = text.match(/\b(\d+)\s+years?\s+of\s+(?:\w+\s+){0,3}?experience/i);
        if (m) return `${m[1]}+ yrs`;

        // Priority 4: "at least X / minimum X years"
        m = text.match(/(?:at\s+least|minimum\s+(?:of\s+)?|at\s+minimum)\s+(\d+)\s+years?/i);
        if (m) return `${m[1]}+ yrs`;

        // Priority 5: "X or more years"
        m = text.match(/(\d+)\s+or\s+more\s+years?/i);
        if (m) return `${m[1]}+ yrs`;

        // Priority 6: "X-Y years" (any mention)
        m = text.match(/\b(\d+)\s*[-–]\s*(\d+)\s+years?/i);
        if (m) return `${m[1]}-${m[2]} yrs`;

        // Priority 7: "X+ years" (any mention)
        m = text.match(/\b(\d+)\s*\+\s*years?/i);
        if (m) return `${m[1]}+ yrs`;

        return null;
      }
    });
    return res[0]?.result || null;
  } catch (e) {
    return null;
  }
}

async function getVisaSponsorshipFromJobPage(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const NO_VISA = [
          /authorized? to work in the u\.?s\.? without.*visa/i,
          /no visa sponsorship/i,
          /visa sponsorship.*not\s+(available|offered|provided)/i,
          /not\s+(able to|in a position to)?\s*sponsor/i,
          /cannot\s+sponsor/i,
          /unable\s+to\s+sponsor/i,
          /we do not sponsor/i,
          /does not\s+(offer|provide)\s+sponsorship/i,
          /without\s+sponsorship/i,
          /\bno\s+sponsorship\b/i,
          /sponsorship\s+is\s+not\s+available/i,
          /must\s+not\s+require\s+(visa|sponsorship)/i,
          /security\s+clearance\s+required/i,
          /must\s+(hold|have|possess)\s+(an?\s+)?(active|current|valid)\s+.*(clearance|secret|ts\/sci)/i,
          /active\s+.*(secret|top\s+secret|ts\/sci|clearance)/i,
          /clearance\s+required/i,
          /must\s+be\s+eligible\s+for\s+.*(clearance|secret)/i,
          /eligible\s+for\s+security\s+clearance/i,
          /u\.?s\.?\s+citizens?\s+only/i,
          /\bcitizens?\s+only\b/i,
          /must\s+be\s+a\s+u\.?s\.?\s+citizen/i,
          /must\s+be\s+(a\s+)?u\.?s\.?\s+citizen/i,
          /work\s+authorization\s+(in|for)\s+the\s+u\.?s\.?/i,
          /will\s+not\s+(provide|offer)\s+immigration\s+sponsorship/i,
          /not\s+(provide|offer|support)\s+(immigration|visa)\s+sponsorship/i,
          /does\s+not\s+(provide|offer)\s+.*sponsorship/i,
        ];
        const YES_VISA = [
          /visa\s+sponsorship\s+(is\s+)?(available|offered|provided)/i,
          /we\s+(do\s+)?(offer|provide|support)\s+visa\s+sponsorship/i,
          /will\s+sponsor\s+.*(visa|h[-\s]?1b|work\s+authorization)/i,
          /sponsorship\s+(is\s+)?available/i,
          /open\s+to\s+sponsor/i,
          /we\s+sponsor\s+(h[-\s]?1b|work\s+visa)/i,
          /h[-\s]?1b\s+sponsorship\s+(is\s+)?(available|offered|provided|considered)/i,
          /will\s+(provide|offer|support)\s+immigration\s+sponsorship/i,
        ];

        const pane = document.querySelector(
          '.jobs-search__job-details--wrapper, .scaffold-layout__detail, .job-view-layout, .jobs-details'
        );
        const text = (pane || document.body).innerText || '';

        if (NO_VISA.some(p => p.test(text))) return 'no';
        if (YES_VISA.some(p => p.test(text))) return 'yes';
        return 'na';
      }
    });
    return res[0]?.result || 'na';
  } catch (e) {
    return 'na';
  }
}

// ── Tech stack detection ──────────────────────────────────────────────────────
// Each entry: [displayLabel, regexSource, flags]
// Passed via args so executeScript can serialize it as JSON
const TECH_PATTERNS = [
  // Languages
  ['JavaScript', '\\bJavaScript\\b', 'i'],
  ['TypeScript', '\\bTypeScript\\b', 'i'],
  ['Python',     '\\bPython\\b', 'i'],
  ['Java',       '\\bJava\\b(?!Script)', 'i'],
  ['Kotlin',     '\\bKotlin\\b', 'i'],
  ['Swift',      '\\bSwift\\b', 'i'],
  ['Go',         '\\bGo(?:lang)?\\b', 'i'],
  ['Rust',       '\\bRust\\b', 'i'],
  ['Ruby',       '\\bRuby\\b', 'i'],
  ['PHP',        '\\bPHP\\b', ''],
  ['C#',         '\\bC#', ''],
  ['C++',        '\\bC\\+\\+', ''],
  ['Scala',      '\\bScala\\b', 'i'],
  ['Dart',       '\\bDart\\b', 'i'],
  ['Elixir',     '\\bElixir\\b', 'i'],
  ['Groovy',     '\\bGroovy\\b', 'i'],
  ['Perl',       '\\bPerl\\b', 'i'],
  ['Bash',       '\\bBash\\b|\\bShell\\s+script', 'i'],
  ['PowerShell', '\\bPowerShell\\b', 'i'],
  // Frontend
  ['React',      '\\bReact(?:\\.js)?\\b', 'i'],
  ['Angular',    '\\bAngular(?:JS)?\\b', 'i'],
  ['Vue',        '\\bVue(?:\\.js)?\\b', 'i'],
  ['Svelte',     '\\bSvelte\\b', 'i'],
  ['Next.js',    '\\bNext\\.js\\b', 'i'],
  ['Nuxt',       '\\bNuxt(?:\\.js)?\\b', 'i'],
  ['Redux',      '\\bRedux\\b', 'i'],
  ['GraphQL',    '\\bGraphQL\\b', 'i'],
  ['jQuery',     '\\bjQuery\\b', 'i'],
  ['HTML',       '\\bHTML5?\\b', 'i'],
  ['CSS',        '\\bCSS3?\\b', 'i'],
  ['SCSS',       '\\bSCSS\\b', 'i'],
  ['Tailwind',   '\\bTailwind(?:\\s*CSS)?\\b', 'i'],
  ['Bootstrap',  '\\bBootstrap\\b', 'i'],
  ['Webpack',    '\\bWebpack\\b', 'i'],
  ['Vite',       '\\bVite\\b', 'i'],
  // Backend / Server
  ['Node.js',    '\\bNode(?:\\.js)?\\b', 'i'],
  ['Node',       '\\bNode\\b', 'i'],
  ['NodeJS',     '\\bNodeJS\\b', 'i'],
  ['Express',    '\\bExpress(?:\\.js)?\\b', 'i'],
  ['Django',     '\\bDjango\\b', 'i'],
  ['Flask',      '\\bFlask\\b', 'i'],
  ['FastAPI',    '\\bFastAPI\\b', 'i'],
  ['Spring Boot','\\bSpring\\s*Boot\\b', 'i'],
  ['Spring',     '\\bSpring\\b(?!\\s*Boot)', 'i'],
  ['Rails',      '\\bRails\\b|\\bRuby on Rails\\b', 'i'],
  ['Laravel',    '\\bLaravel\\b', 'i'],
  ['NestJS',     '\\bNest(?:JS|\\.js)?\\b', 'i'],
  ['.NET',       '\\.NET\\b', 'i'],
  ['gRPC',       '\\bgRPC\\b', 'i'],
  ['REST API',   '\\bREST(?:ful)?\\s*API\\b', 'i'],
  // Databases
  ['PostgreSQL', '\\bPostgres(?:QL)?\\b', 'i'],
  ['MySQL',      '\\bMySQL\\b', 'i'],
  ['MongoDB',    '\\bMongoDB\\b', 'i'],
  ['Redis',      '\\bRedis\\b', 'i'],
  ['Elasticsearch', '\\bElasticsearch\\b', 'i'],
  ['DynamoDB',   '\\bDynamoDB\\b', 'i'],
  ['Cassandra',  '\\bCassandra\\b', 'i'],
  ['SQLite',     '\\bSQLite\\b', 'i'],
  ['SQL Server', '\\bSQL\\s+Server\\b', 'i'],
  ['BigQuery',   '\\bBigQuery\\b', 'i'],
  ['Snowflake',  '\\bSnowflake\\b', 'i'],
  ['Redshift',   '\\bRedshift\\b', 'i'],
  ['Oracle DB',  '\\bOracle\\s+DB\\b|\\bOracle\\s+Database\\b', 'i'],
  ['SQL',        '\\bSQL\\b(?!\\s+Server)', ''],
  ['NoSQL',      '\\bNoSQL\\b', 'i'],
  // Cloud & Infra
  ['AWS',        '\\bAWS\\b', ''],
  ['GCP',        '\\bGCP\\b|\\bGoogle\\s+Cloud\\b', 'i'],
  ['Azure',      '\\bAzure\\b', 'i'],
  ['Kubernetes', '\\bKubernetes\\b|\\bk8s\\b', 'i'],
  ['Docker',     '\\bDocker\\b', 'i'],
  ['Terraform',  '\\bTerraform\\b', 'i'],
  ['Ansible',    '\\bAnsible\\b', 'i'],
  ['Helm',       '\\bHelm\\b', 'i'],
  ['Kafka',      '\\bKafka\\b', 'i'],
  ['RabbitMQ',   '\\bRabbitMQ\\b', 'i'],
  ['Spark',      '\\bApache\\s+Spark\\b|\\bPySpark\\b', 'i'],
  ['Airflow',    '\\bAirflow\\b', 'i'],
  ['CI/CD',      '\\bCI\\/CD\\b', 'i'],
  ['Jenkins',    '\\bJenkins\\b', 'i'],
  ['GitHub Actions', '\\bGitHub\\s+Actions\\b', 'i'],
  ['GitLab CI',  '\\bGitLab\\s+CI\\b', 'i'],
  ['Prometheus', '\\bPrometheus\\b', 'i'],
  ['Grafana',    '\\bGrafana\\b', 'i'],
  ['Datadog',    '\\bDatadog\\b', 'i'],
  // Testing
  ['Jest',       '\\bJest\\b', 'i'],
  ['Vitest',     '\\bVitest\\b', 'i'],
  ['Pytest',     '\\bPytest\\b', 'i'],
  ['JUnit',      '\\bJUnit\\b', 'i'],
  ['Cypress',    '\\bCypress\\b', 'i'],
  ['Selenium',   '\\bSelenium\\b', 'i'],
  ['Playwright', '\\bPlaywright\\b', 'i'],
  ['Mocha',      '\\bMocha\\b', 'i'],
  // AI / ML
  ['TensorFlow', '\\bTensorFlow\\b', 'i'],
  ['PyTorch',    '\\bPyTorch\\b', 'i'],
  ['scikit-learn','\\bscikit[-\\s]learn\\b', 'i'],
  ['Pandas',     '\\bPandas\\b', 'i'],
  ['NumPy',      '\\bNumPy\\b', 'i'],
  ['LangChain',  '\\bLangChain\\b', 'i'],
  ['OpenAI',     '\\bOpenAI\\b', 'i'],
];

async function getTechStackFromJobPage(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: (patterns) => {
        const pane = document.querySelector(
          '.jobs-search__job-details--wrapper, .scaffold-layout__detail, .job-view-layout, .jobs-details'
        );
        const text = (pane || document.body).innerText || '';
        return patterns
          .filter(([, src, flags]) => new RegExp(src, flags).test(text))
          .map(([label]) => label);
      },
      args: [TECH_PATTERNS]
    });
    return res[0]?.result || [];
  } catch (e) {
    return [];
  }
}

function showTechStack(techList) {
  if (!techList || techList.length === 0) {
    techStackEl.style.display = 'none';
    return;
  }
  techStackEl.innerHTML =
    '<span class="tech-label">Tech:</span>' +
    techList.map(t => `<span class="tech-chip">${t}</span>`).join('');
  techStackEl.style.display = 'flex';
}

// ── Extract company slug ──────────────────────────────────────────────────────
function extractCompanySlug(tab) {
  const m = tab.url.match(/linkedin\.com\/company\/([^/?#]+)/);
  return m ? m[1] : null;
}

// ── External page state ───────────────────────────────────────────────────────
let detectedExternalCompanyName = null; // set on init; used when button is clicked

// ── External page: extract company name from any job posting page ─────────────
async function extractCompanyNameFromPage(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // 1. JSON-LD hiringOrganization (Greenhouse, Lever, Workday, etc.)
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const d = JSON.parse(s.textContent);
            const objs = Array.isArray(d) ? d : [d];
            for (const obj of objs) {
              const name = obj?.hiringOrganization?.name;
              if (name) return name;
              if (obj?.['@type'] === 'Organization' && obj?.name) return obj.name;
            }
          } catch (e) {}
        }

        // 2. og:site_name meta tag
        const ogSite = document.querySelector('meta[property="og:site_name"]')?.content;
        if (ogSite) return ogSite;

        // 3. URL patterns for common ATS platforms
        const url = window.location.href;
        let um;
        um = url.match(/jobs\.lever\.co\/([^/?#]+)/);
        if (um) return um[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        um = url.match(/boards\.greenhouse\.io\/([^/?#]+)/);
        if (um) return um[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        um = url.match(/ats\.rippling\.com\/([^/?#]+)/);
        if (um) return um[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        um = url.match(/^https?:\/\/([^.]+)\.[^.]*\.myworkdayjobs\.com/);
        if (um) return um[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        um = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
        if (um) return um[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        um = url.match(/apply\.workable\.com\/([^/?#]+)/);
        if (um) return um[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        // 4. Page title: "Job Title at Company" pattern
        const title = document.title || '';
        let m2 = title.match(/\bat\s+([A-Z][^|–\-·]{2,40}?)(?:\s*[|–\-·]|$)/);
        if (m2) return m2[1].trim();

        // 5. Domain name as last resort (skip generic words)
        const domain = window.location.hostname.replace(/^www\./, '').split('.')[0];
        const skip = ['jobs', 'careers', 'ats', 'apply', 'boards', 'hire', 'recruiting'];
        if (domain && !skip.includes(domain)) {
          return domain.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }

        return null;
      }
    });
    return res[0]?.result || null;
  } catch (e) {
    return null;
  }
}

// ── External page: after company is confirmed, check cache then scan ──────────
async function resolveExternalCompanyAndScan(slug, displayName) {
  document.getElementById('disambigPanel').innerHTML = '';
  document.getElementById('disambigPanel').style.display = 'none';

  currentSlug = slug;
  companyEl.textContent = displayName;
  currentVisaStatus = null;
  currentExperience = null;

  const cached = await getCached(slug);
  if (cached) {
    const age     = Math.round((Date.now() - cached.scannedAt) / 60000);
    const ageText = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    statusBox.textContent = `✅ Loaded from cache (scanned ${ageText}). ${cached.recruiters.length} recruiters.`;
    progressBar.style.display = 'block';
    progressFill.style.width  = '100%';
    renderResults(cached.recruiters);
    scanBtn.disabled    = false;
    scanBtn.textContent = '🔄 Re-scan';
    errorDiv.style.display = 'block';
    errorDiv.style.color   = '#0a66c2';
    errorDiv.textContent   = `💡 Showing cached results. Click "Re-scan" to fetch fresh data.`;
    return;
  }

  // No cache — run the scan
  await runQueuedScan(slug);
  if (scanQueue.length > 0) {
    processQueue();
  } else {
    isScanning = false;
    currentScanSlug = null;
    scanBtn.disabled    = false;
    scanBtn.textContent = '🔄 Re-scan';
    renderQueue();
  }
}

// ── External page: show company picker when multiple matches found ────────────
function showDisambiguationPanel(companies, searchedName) {
  statusBox.textContent = `Multiple companies found for "${searchedName}" — pick the right one:`;

  const panel = document.getElementById('disambigPanel');
  panel.innerHTML = companies.map(c => {
    const initials = c.name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    const logoHtml = c.logoUrl
      ? `<img class="disambig-logo" src="${c.logoUrl}" alt="" />`
      : `<div class="disambig-logo-fallback">${initials}</div>`;
    return `
      <div class="disambig-card">
        ${logoHtml}
        <div class="disambig-info">
          <div class="disambig-name">${c.name}</div>
          ${c.subtitle  ? `<div class="disambig-sub">${c.subtitle}</div>`  : ''}
          ${c.secondary ? `<div class="disambig-sec">${c.secondary}</div>` : ''}
        </div>
        <button class="disambig-pick-btn" data-slug="${c.slug}" data-name="${c.name}">Select</button>
      </div>`;
  }).join('');

  panel.querySelectorAll('.disambig-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => resolveExternalCompanyAndScan(btn.dataset.slug, btn.dataset.name));
  });

  panel.style.display = 'block';
}

// ── External page: search LinkedIn then disambiguate (triggered by button) ────
async function performExternalSearch() {
  scanBtn.disabled    = true;
  scanBtn.textContent = '🔍 Searching...';
  errorDiv.style.display = 'none';
  statusBox.textContent = `🔍 Searching LinkedIn for "${detectedExternalCompanyName}"...`;

  const response = await new Promise(resolve =>
    chrome.runtime.sendMessage({ action: 'searchCompanies', companyName: detectedExternalCompanyName }, resolve)
  );

  if (!response?.success || !response.companies?.length) {
    scanBtn.disabled    = false;
    scanBtn.textContent = '🚀 Find Recruiters';
    statusBox.textContent = `⚠️ No LinkedIn companies found for "${detectedExternalCompanyName}".`;
    errorDiv.textContent  = `💡 Try the Bulk tab — enter the company's LinkedIn slug (e.g. "vercel", "braze").`;
    errorDiv.style.color  = '#0a66c2';
    errorDiv.style.display = 'block';
    return;
  }

  if (response.companies.length === 1) {
    await resolveExternalCompanyAndScan(response.companies[0].slug, response.companies[0].name);
  } else {
    scanBtn.disabled    = false;
    scanBtn.textContent = '🚀 Find Recruiters';
    showDisambiguationPanel(response.companies, detectedExternalCompanyName);
  }
}

// ── External page: on panel open — detect name only, wait for button click ────
async function handleExternalPage(tab) {
  scanBtn.disabled = true;
  statusBox.textContent = '🔍 Detecting company from page...';

  // Run meta extraction in parallel (visa, tech, exp — all read from current page)
  getVisaSponsorshipFromJobPage(tab.id).then(s => showVisaMeta(s));
  getTechStackFromJobPage(tab.id).then(s => showTechStack(s));
  getExperienceFromJobPage(tab.id).then(e => showExperienceMeta(e));
  getEmployeeCountFromJobPage(tab.id).then(c => showCompanyMeta(c));

  const companyName = await extractCompanyNameFromPage(tab.id);
  if (!companyName) {
    statusBox.textContent = '⚠️ Could not detect company. Are you on a job posting page?';
    return;
  }

  detectedExternalCompanyName = companyName;
  companyEl.textContent = companyName;
  statusBox.textContent = `Click "Find Recruiters" to search LinkedIn for "${companyName}".`;
  scanBtn.disabled    = false;
  scanBtn.textContent = '🚀 Find Recruiters';
}

async function getCompanySlugFromJobPage(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const url = window.location.href;
      let jobId = (url.match(/\/jobs\/view\/(\d+)/) || [])[1];
      if (!jobId) jobId = (url.match(/currentJobId=(\d+)/) || [])[1];
      if (!jobId) jobId = (url.match(/\/jobs\/(\d+)/) || [])[1];
      if (!jobId) return null;
      try {
        const apiUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
        const res = await fetch(apiUrl, { headers: { 'Accept': 'text/html' }, credentials: 'include' });
        const html = await res.text();
        const m = html.match(/\/company\/([a-zA-Z0-9_-]+)/);
        if (m && m[1] && !['linkedin'].includes(m[1])) return m[1];
      } catch (e) {}
      function isVisible(el) {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      const allCompanyLinks = [...document.querySelectorAll('a[href*="/company/"]')];
      for (const el of allCompanyLinks) {
        if (!isVisible(el)) continue;
        const m = el.href.match(/\/company\/([^/?#]+)/);
        if (!m || !m[1]) continue;
        if (['linkedin', 'jobs'].includes(m[1].toLowerCase())) continue;
        return m[1];
      }
      return null;
    }
  });
  return results[0]?.result || null;
}

// ── Shared copy helper ────────────────────────────────────────────────────────
function copyLink(url, btn, originalText) {
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = originalText; }, 2000);
  });
}

// ── CSV export ────────────────────────────────────────────────────────────────
function escapeCSV(val) {
  const str = (val || '').toString().replace(/"/g, '""');
  // Wrap in quotes if it contains comma, newline or quote
  return /[",\n]/.test(str) ? `"${str}"` : str;
}

async function exportToCSV() {
  const cache = await getCache();
  const keys  = Object.keys(cache).sort((a, b) => cache[b].scannedAt - cache[a].scannedAt);

  if (keys.length === 0) {
    exportCsvBtn.textContent = '⚠️ Nothing to export';
    setTimeout(() => { exportCsvBtn.textContent = '⬇️ Export to CSV'; }, 2000);
    return;
  }

  // Header row
  const rows = [['Name', 'Company', 'Company LinkedIn Page', 'Role', 'LinkedIn URL']];

  keys.forEach(slug => {
    const entry           = cache[slug];
    const companyName     = entry.displayName || slug.replace(/-/g, ' ');
    const companyLinkedIn = `https://www.linkedin.com/company/${slug}/`;

    if (entry.recruiters.length === 0) {
      // Still include the company row with empty recruiter fields
      rows.push(['', companyName, companyLinkedIn, '', '']);
    } else {
      entry.recruiters.forEach(r => {
        rows.push([
          escapeCSV(r.name),
          escapeCSV(companyName),
          escapeCSV(companyLinkedIn),
          escapeCSV(r.title),
          escapeCSV(r.url)
        ]);
      });
    }
  });

  const csvContent = rows.map(row => row.join(',')).join('\n');
  const blob       = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const blobUrl    = URL.createObjectURL(blob);

  // Build filename with today's date
  const date     = new Date();
  const datePart = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const filename = `linkedin-recruiters-${datePart}.csv`;

  // Trigger download via a temporary <a> tag
  const a    = document.createElement('a');
  a.href     = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);

  exportCsvBtn.textContent = '✅ Exported!';
  setTimeout(() => { exportCsvBtn.textContent = '⬇️ Export to CSV'; }, 2000);
}

exportCsvBtn.addEventListener('click', exportToCSV);

// ── Search highlight helper ────────────────────────────────────────────────────
function hl(text, term) {
  if (!term || !text) return text || '';
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${safe})`, 'gi'), '<mark class="hl">$1</mark>');
}

// ── Backup export ─────────────────────────────────────────────────────────────
async function exportBackup() {
  const cache = await getCache();
  const blob  = new Blob([JSON.stringify(cache, null, 2)], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);
  const date  = new Date();
  const dp    = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const a     = document.createElement('a');
  a.href = url; a.download = `recruiter-backup-${dp}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  exportBackupBtn.textContent = '✅ Exported!';
  setTimeout(() => { exportBackupBtn.textContent = '⬇ Export Backup'; }, 2000);
}

async function importBackup(file) {
  try {
    const text   = await file.text();
    const data   = JSON.parse(text);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error();
    const merged = { ...(await getCache()), ...data };
    await new Promise(r => chrome.storage.local.set({ [CACHE_KEY]: merged }, r));
    importBackupBtn.textContent = `✅ Imported ${Object.keys(data).length} companies`;
    setTimeout(() => { importBackupBtn.textContent = '⬆ Import Backup'; }, 3000);
    renderHistory(historySearch.value);
  } catch {
    importBackupBtn.textContent = '❌ Invalid file';
    setTimeout(() => { importBackupBtn.textContent = '⬆ Import Backup'; }, 2500);
  }
}

exportBackupBtn.addEventListener('click', exportBackup);
importBackupBtn.addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) { importBackup(file); importFileInput.value = ''; }
});

// ── Render search results ─────────────────────────────────────────────────────
async function renderResults(data, passedLogoUrl = null) {
  // ── Company banner ────────────────────────────────────────────────────────
  if (currentSlug) {
    const cached      = await getCached(currentSlug);
    const displayName = cached?.displayName || (currentSlug.replace(/-/g, ' '));
    const logoUrl     = passedLogoUrl || cached?.logoUrl || null;
    const initials    = displayName.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    const logoHtml    = logoUrl
      ? `<img class="rcb-logo" src="${logoUrl}" alt="" /><div class="rcb-logo-fallback" style="display:none">${initials}</div>`
      : `<div class="rcb-logo-fallback">${initials}</div>`;
    const empHtml     = currentEmployeeCount ? `<span class="rcb-emp">👥 ${currentEmployeeCount}</span>` : '';
    resultsCompanyBanner.innerHTML = `${logoHtml}<span class="rcb-name">${displayName}</span><span class="rcb-count">${data?.length ?? 0} recruiters</span>${empHtml}`;
    resultsCompanyBanner.style.display = 'flex';
  } else {
    resultsCompanyBanner.style.display = 'none';
  }

  if (!data || data.length === 0) {
    resultsDiv.innerHTML = '<div style="text-align:center;color:#888;font-size:12px;padding:20px 0">No recruiters found.<br>Try on a different company.</div>';
    return;
  }

  const groups = { tech: [], senior: [], general: [], coord: [], talent: [], hiring: [] };
  data.forEach(r => {
    if (r.hiringFrame) { groups.hiring.push(r); return; }
    groups[classify(r.title)].push(r);
  });

  const sectionDefs = [
    { key: 'tech',    label: '🔵 Technical Recruiters',        cls: '',        badge: 'b-tech',   badgeText: 'Technical'   },
    { key: 'senior',  label: '🟣 Senior / Head of Recruiting', cls: 'senior',  badge: 'b-senior', badgeText: 'Senior'      },
    { key: 'general', label: '🟢 Recruiters',                  cls: 'general', badge: '',         badgeText: ''            },
    { key: 'coord',   label: '🟡 Recruiting Coordinators',     cls: 'coord',   badge: 'b-coord',  badgeText: 'Coordinator' },
    { key: 'talent',  label: '🩷 Talent',                     cls: 'talent',  badge: 'b-talent', badgeText: 'Talent'      },
    { key: 'hiring',  label: '🟠 Hiring Managers (#Hiring)',   cls: 'coord',   badge: 'b-coord',  badgeText: '#Hiring'     },
  ];

  // Show the persistent search wrapper now that results are loaded
  const resultsSearchWrap = document.getElementById('resultsSearchWrap');
  if (resultsSearchWrap) { resultsSearchWrap.style.display = ''; }
  const resultsSearchEl = document.getElementById('resultsSearch');
  if (resultsSearchEl) { resultsSearchEl.value = ''; }
  const clearRSBtn = document.getElementById('clearResultsSearch');
  if (clearRSBtn) clearRSBtn.style.display = 'none';

  let html = `<div class="collapse-controls">
    <div class="collapse-btns">
      <button class="ctrl-btn" id="expandAllSections">▾ Expand All</button>
      <button class="ctrl-btn" id="collapseAllSections">▸ Collapse All</button>
      <button class="ctrl-btn open-all-btn" id="openAllRecruiters">↗ Open All</button>
      <button class="ctrl-btn" id="copyAllLinks">📋 Copy All</button>
    </div>
  </div>
  <div class="copy-selected-row" id="copySelectedRow">
    <button class="ctrl-btn copy-selected-btn" id="copySelectedBtn">📋 Copy Selected (<span id="copySelectedCount">0</span>)</button>
    <button class="ctrl-btn clear-selection-btn" id="clearSelectionBtn">✕ Clear Selection</button>
  </div>`;
  let copyText = '';
  let secIdx = 0;

  sectionDefs.forEach(({ key, label, cls, badge, badgeText }) => {
    const people = groups[key];
    if (!people.length) return;
    const gid = `sec-${secIdx++}`;
    html += `<div class="section-label" data-gid="${gid}"><span class="section-label-text">${label} (${people.length})</span><span class="section-label-actions"><button class="copy-section-btn" data-gid="${gid}">📋 Copy</button><button class="open-section-btn" data-gid="${gid}">↗ Open All</button><span class="chevron">▾</span></span></div>`;
    html += `<div class="section-cards" id="${gid}">`;
    people.forEach(r => {
      const badgeHtml  = badge ? `<span class="badge ${badge}">${badgeText}</span>` : '';
      const photoHtml  = r.photoUrl
        ? `<img class="recruiter-photo" src="${r.photoUrl}" alt="" />`
        : '';
      const photoClass = r.photoUrl ? 'has-photo' : '';
      html += `
        <div class="card ${cls} ${photoClass}" data-url="${r.url}" data-name="${r.name}" data-title="${r.title || ''}">
          ${photoHtml}
          <div class="card-name-row"><input type="checkbox" class="recruiter-check" /><div class="card-name">${r.name}${badgeHtml}</div></div>
          <div class="card-title" title="${r.title}">${r.title || '—'}</div>
          <div class="card-url"><a href="${r.url}" target="_blank">${r.url}</a></div>
          <button class="card-copy-btn" data-url="${r.url}">🔗 Copy Link</button>
          <button class="card-remove-btn" data-url="${r.url}">✕ Remove</button>
        </div>`;
      copyText += `${r.name}\n${r.title}\n${r.url}\n\n`;
    });
    html += `</div>`;
  });

  resultsDiv.innerHTML = html;

  // Fix broken images (CSP blocks onerror= attributes)
  resultsDiv.querySelectorAll('img.recruiter-photo').forEach(img => {
    img.addEventListener('error', () => {
      img.style.display = 'none';
      img.closest('.card')?.classList.remove('has-photo');
    });
  });

  // Fix results company banner logo
  const rcbLogo = resultsCompanyBanner.querySelector('img.rcb-logo');
  if (rcbLogo) {
    rcbLogo.addEventListener('error', () => {
      rcbLogo.nextElementSibling?.style && (rcbLogo.nextElementSibling.style.display = 'flex');
      rcbLogo.remove();
    });
  }

  if (copyBtn) { copyBtn.style.display = 'block'; copyBtn.dataset.text = copyText.trim(); }

  // Section collapse toggles
  resultsDiv.querySelectorAll('.section-label').forEach(label => {
    label.addEventListener('click', () => {
      const cards = document.getElementById(label.dataset.gid);
      const isNowCollapsed = cards.classList.toggle('collapsed');
      label.classList.toggle('collapsed', isNowCollapsed);
    });
  });

  document.getElementById('expandAllSections')?.addEventListener('click', () => {
    resultsDiv.querySelectorAll('.section-cards').forEach(c => c.classList.remove('collapsed'));
    resultsDiv.querySelectorAll('.section-label').forEach(l => l.classList.remove('collapsed'));
  });

  document.getElementById('collapseAllSections')?.addEventListener('click', () => {
    resultsDiv.querySelectorAll('.section-cards').forEach(c => c.classList.add('collapsed'));
    resultsDiv.querySelectorAll('.section-label').forEach(l => l.classList.add('collapsed'));
  });

  document.getElementById('openAllRecruiters')?.addEventListener('click', () => {
    resultsDiv.querySelectorAll('.card[data-url]').forEach(card => {
      chrome.tabs.create({ url: card.dataset.url, active: false });
    });
  });

  document.getElementById('copyAllLinks')?.addEventListener('click', () => {
    const urls = [...resultsDiv.querySelectorAll('.card[data-url]')].map(c => c.dataset.url);
    navigator.clipboard.writeText(urls.join('\n')).then(() => {
      const btn = document.getElementById('copyAllLinks');
      const orig = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  });

  function updateCopySelectedBtn() {
    const checked = resultsDiv.querySelectorAll('.recruiter-check:checked');
    const row = document.getElementById('copySelectedRow');
    const countEl = document.getElementById('copySelectedCount');
    if (row) row.classList.toggle('visible', checked.length > 0);
    if (countEl) countEl.textContent = checked.length;
  }

  resultsDiv.querySelectorAll('.recruiter-check').forEach(cb => {
    cb.addEventListener('change', updateCopySelectedBtn);
  });

  document.getElementById('copySelectedBtn')?.addEventListener('click', () => {
    const urls = [...resultsDiv.querySelectorAll('.recruiter-check:checked')].map(cb =>
      cb.closest('.card')?.dataset.url || ''
    ).filter(Boolean);
    navigator.clipboard.writeText(urls.join('\n')).then(() => {
      const btn = document.getElementById('copySelectedBtn');
      const orig = btn.innerHTML;
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 1500);
    });
  });

  document.getElementById('clearSelectionBtn')?.addEventListener('click', () => {
    resultsDiv.querySelectorAll('.recruiter-check:checked').forEach(cb => { cb.checked = false; });
    updateCopySelectedBtn();
  });

  resultsDiv.querySelectorAll('.copy-section-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const section = document.getElementById(btn.dataset.gid);
      const urls = [...(section?.querySelectorAll('.card[data-url]') || [])].map(c => c.dataset.url);
      navigator.clipboard.writeText(urls.join('\n')).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✅ Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    });
  });

  resultsDiv.querySelectorAll('.open-section-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const section = document.getElementById(btn.dataset.gid);
      section?.querySelectorAll('.card[data-url]').forEach(card => {
        chrome.tabs.create({ url: card.dataset.url, active: false });
      });
    });
  });

  // ── Live filter ───────────────────────────────────────────────────────────
  function runFilter(term) {
    resultsDiv.querySelectorAll('.card').forEach(card => {
      const rawName  = card.dataset.name  || '';
      const rawTitle = card.dataset.title || '';
      const matches  = !term || rawName.toLowerCase().includes(term) || rawTitle.toLowerCase().includes(term);
      card.style.display = matches ? '' : 'none';
      const nameEl  = card.querySelector('.card-name');
      const titleEl = card.querySelector('.card-title');
      const badge   = nameEl?.querySelector('.badge')?.outerHTML || '';
      if (nameEl)  nameEl.innerHTML  = hl(rawName, term) + badge;
      if (titleEl) titleEl.innerHTML = hl(rawTitle || '—', term);
    });
    resultsDiv.querySelectorAll('.section-cards').forEach(section => {
      const label = resultsDiv.querySelector(`.section-label[data-gid="${section.id}"]`);
      const hasVisible = [...section.querySelectorAll('.card')].some(c => c.style.display !== 'none');
      if (!hasVisible) {
        // Hide entire section (header + cards) when no matches
        section.style.display = 'none';
        if (label) label.style.display = 'none';
      } else {
        // Show section
        section.style.display = '';
        if (label) label.style.display = '';
        // If section was user-collapsed, keep it collapsed (just show the header)
      }
    });
    if (!term) {
      // On clear, restore all hidden sections
      resultsDiv.querySelectorAll('.section-cards').forEach(section => {
        section.style.display = '';
        const label = resultsDiv.querySelector(`.section-label[data-gid="${section.id}"]`);
        if (label) label.style.display = '';
      });
    }
  }

  const _rsEl = document.getElementById('resultsSearch');
  if (_rsEl) {
    const newEl = _rsEl.cloneNode(true);
    _rsEl.parentNode.replaceChild(newEl, _rsEl);
  }
  document.getElementById('resultsSearch')?.addEventListener('input', function () {
    const term = this.value.trim().toLowerCase();
    const clearBtn = document.getElementById('clearResultsSearch');
    if (clearBtn) clearBtn.style.display = term ? '' : 'none';
    runFilter(term);
  });

  document.getElementById('clearResultsSearch')?.addEventListener('click', () => {
    const input = document.getElementById('resultsSearch');
    if (input) { input.value = ''; input.focus(); }
    document.getElementById('clearResultsSearch').style.display = 'none';
    runFilter('');
  });

  resultsDiv.querySelectorAll('.card-copy-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      copyLink(btn.dataset.url, btn, '🔗 Copy Link');
    });
  });

  resultsDiv.querySelectorAll('.card-remove-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const url = btn.dataset.url;
      const card = btn.closest('.card');
      if (card) card.remove();
      if (currentSlug) await removeRecruiterFromCache(currentSlug, url);
      // Rebuild copy-all text from remaining cards
      const remaining = [...resultsDiv.querySelectorAll('.card[data-url]')].map(c => {
        const name  = c.querySelector('.card-name')?.firstChild?.textContent?.trim() || '';
        const title = c.querySelector('.card-title')?.textContent?.trim() || '';
        const u     = c.dataset.url;
        return `${name}\n${title}\n${u}`;
      }).join('\n\n');
      if (copyBtn) { copyBtn.dataset.text = remaining; if (!remaining) copyBtn.style.display = 'none'; }
    });
  });
}

// ── Queue renderer ────────────────────────────────────────────────────────────
const queuePanel = document.getElementById('queuePanel');

function renderQueue() {
  if (!currentScanSlug && scanQueue.length === 0) {
    queuePanel.innerHTML = '';
    return;
  }

  const items = [];
  if (currentScanSlug) {
    items.push({ slug: currentScanSlug, state: 'scanning' });
  }
  scanQueue.forEach(({ slug }) => items.push({ slug, state: 'queued' }));

  queuePanel.innerHTML = items.map(({ slug, state }) => {
    const icon = state === 'scanning' ? '🔄' : '⏳';
    const name = slug.replace(/-/g, ' ');
    return `<div class="queue-item ${state}">
      <span class="queue-item-icon">${icon}</span>
      <span class="queue-item-name">${name}</span>
    </div>`;
  }).join('');
}

// ── Run a single scan (used by queue processor) ───────────────────────────────
async function runQueuedScan(slug) {
  currentScanSlug = slug;
  isScanning = true;
  renderQueue();

  resultsDiv.innerHTML = '';
  resultsCompanyBanner.style.display = 'none';
  const _rsh = document.getElementById('resultsSearchWrap'); if (_rsh) _rsh.style.display = 'none';
  if (copyBtn) copyBtn.style.display = 'none';
  errorDiv.style.display = 'none';
  errorDiv.style.color = '#c0392b';
  progressBar.style.display = 'block';
  progressFill.style.width = '0%';
  currentSlug = slug;
  companyEl.textContent = slug.replace(/-/g, ' ');
  statusBox.textContent = `Scanning ${slug.replace(/-/g, ' ')}...`;
  scanBtn.disabled = false;
  scanBtn.textContent = '➕ Add to Queue';

  await chrome.storage.session.set({ manualScanDone: false, manualScanError: false, status: '' });

  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'start', companySlug: slug }, async response => {
      if (chrome.runtime.lastError || !response?.success) {
        statusBox.textContent = `❌ Error scanning ${slug.replace(/-/g, ' ')}.`;
        errorDiv.textContent = '❌ Something went wrong. Refresh the job page and try again.';
        errorDiv.style.display = 'block';
      } else {
        progressFill.style.width = '100%';
        statusBox.textContent = `✅ Done! Found ${response.data.length} recruiters for ${slug.replace(/-/g, ' ')}.`;
        renderResults(response.data, response.logoUrl);
        if (response.data.length > 0) await saveToCache(slug, response.data, response.logoUrl);
      }
      resolve();
    });
    pollStatus(false);
  });
}

async function processQueue() {
  while (scanQueue.length > 0) {
    const { slug } = scanQueue.shift();
    saveQueue();
    await runQueuedScan(slug);
  }
  isScanning = false;
  currentScanSlug = null;
  scanBtn.disabled = false;
  scanBtn.textContent = '🔄 Re-scan';
  renderQueue();
}

// ── Scan button ───────────────────────────────────────────────────────────────
let currentSlug   = null;

scanBtn.addEventListener('click', async () => {
  const isRescan = scanBtn.textContent.includes('Re-scan');

  errorDiv.style.display = 'none';
  errorDiv.style.color = '#c0392b';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  let slug = extractCompanySlug(tab);
  if (!slug) {
    statusBox.textContent = 'Detecting company from job posting...';
    slug = await getCompanySlugFromJobPage(tab.id);
  }

  // ── Non-LinkedIn page handling ──────────────────────────────────────────────
  if (!tab.url?.includes('linkedin.com')) {
    if (currentSlug) {
      // Already resolved via disambiguation — use it (covers re-scan)
      slug = currentSlug;
    } else {
      // Slug not resolved yet — run LinkedIn search + disambiguation flow
      await performExternalSearch();
      return;
    }
  }

  if (!slug) {
    errorDiv.textContent = '❌ Could not detect the company. Make sure a job is selected on the right pane.';
    errorDiv.style.display = 'block';
    return;
  }

  // If already scanning, add to queue instead
  if (isScanning) {
    const alreadyQueued = scanQueue.some(q => q.slug === slug) || currentScanSlug === slug;
    if (!alreadyQueued) {
      scanQueue.push({ slug });
      saveQueue();
      renderQueue();
      statusBox.textContent = `⏳ Added "${slug.replace(/-/g, ' ')}" to queue (position ${scanQueue.length}).`;
    } else {
      statusBox.textContent = `ℹ️ "${slug.replace(/-/g, ' ')}" is already in the queue.`;
    }
    return;
  }

  // Not scanning — check cache first (unless re-scan)
  if (!isRescan) {
    const cached = await getCached(slug);
    if (cached) {
      currentSlug = slug;
      companyEl.textContent = slug.replace(/-/g, ' ');
      const age     = Math.round((Date.now() - cached.scannedAt) / 60000);
      const ageText = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
      statusBox.textContent = `✅ Loaded from cache (scanned ${ageText}). ${cached.recruiters.length} recruiters.`;
      progressBar.style.display = 'block';
      progressFill.style.width = '100%';
      renderResults(cached.recruiters);
      scanBtn.textContent = '🔄 Re-scan';
      errorDiv.style.display = 'block';
      errorDiv.style.color = '#0a66c2';
      errorDiv.textContent = `💡 Showing cached results. Click "Re-scan" to fetch fresh data.`;
      return;
    }
  } else {
    await deleteFromCache(slug);
  }

  // Start scan immediately
  await runQueuedScan(slug);

  // Process any queued items after the first scan
  if (scanQueue.length > 0) {
    processQueue();
  } else {
    isScanning = false;
    currentScanSlug = null;
    scanBtn.disabled = false;
    scanBtn.textContent = '🔄 Re-scan';
    renderQueue();
  }
});

// ── Poll for live background status ──────────────────────────────────────────
function pollStatus(done) {
  if (done) return;
  setTimeout(() => {
    chrome.storage.session.get(['status', 'progress', 'total', 'done'], data => {
      if (data.status) statusBox.textContent = data.status;
      if (data.progress && data.total) {
        progressFill.style.width = `${(data.progress / data.total) * 100}%`;
      }
      if (!data.done) pollStatus(false);
    });
  }, 500);
}

// ── Copy all button ───────────────────────────────────────────────────────────
copyBtn?.addEventListener('click', () => {
  navigator.clipboard.writeText(copyBtn?.dataset.text || '').then(() => {
    if (copyBtn) { copyBtn.textContent = '✅ Copied!'; setTimeout(() => { copyBtn.textContent = '📋 Copy All as Text'; }, 2000); }
  });
});

// ── Bulk search ───────────────────────────────────────────────────────────────
function parseCompanyNames(text) {
  return text
    .split(/[\n,]+/)
    .map(s => s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean);
}

bulkSearchBtn.addEventListener('click', async () => {
  const slugs = parseCompanyNames(bulkTextarea.value);
  if (slugs.length === 0) {
    bulkStatus.textContent = '⚠️ Enter at least one company name.';
    return;
  }

  const forceRescan = bulkForceRescan.checked;
  bulkSearchBtn.disabled = true;
  bulkResultsDiv.innerHTML = '';
  bulkProgressBar.style.display = 'block';
  bulkProgressFill.style.width = '0%';

  const summary = [];

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const displayName = slug.replace(/-/g, ' ');
    bulkStatus.textContent = `Scanning ${i + 1} / ${slugs.length}: ${displayName}...`;
    bulkProgressFill.style.width = `${(i / slugs.length) * 100}%`;

    if (!forceRescan) {
      const cached = await getCached(slug);
      if (cached) {
        summary.push({ slug, count: cached.recruiters.length, fromCache: true });
        continue;
      }
    } else {
      await deleteFromCache(slug);
    }

    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'start', companySlug: slug }, resolve);
    });

    if (response?.success) {
      if (response.data.length > 0) await saveToCache(slug, response.data);
      summary.push({ slug, count: response.data.length, fromCache: false });
    } else {
      summary.push({ slug, count: null, fromCache: false });
    }
  }

  bulkProgressFill.style.width = '100%';
  bulkStatus.textContent = `✅ Done! Scanned ${slugs.length} compan${slugs.length === 1 ? 'y' : 'ies'}.`;
  bulkSearchBtn.disabled = false;

  bulkResultsDiv.innerHTML = summary.map(({ slug, count, fromCache }) => {
    const name = slug.replace(/-/g, ' ');
    if (count === null) {
      return `<div class="bulk-result-card error">
        <span class="bulk-result-name">${name}</span>
        <span class="bulk-result-count" style="color:#c0392b">Error</span>
      </div>`;
    }
    const cls = fromCache ? 'cached' : '';
    const label = fromCache
      ? `${count} recruiters (cached)`
      : `${count} recruiters found`;
    return `<div class="bulk-result-card ${cls}">
      <span class="bulk-result-name">${name}</span>
      <span class="bulk-result-count">${label}</span>
    </div>`;
  }).join('');
});

// ── Add Recruiter Modal ───────────────────────────────────────────────────────
const modal        = document.getElementById('addRecruiterModal');
const modalError   = document.getElementById('modalError');
const modalSaveBtn = document.getElementById('modalSaveBtn');

function openAddRecruiterModal() {
  ['mName','mTitle','mUrl','mCompany','mCompanyUrl'].forEach(id => {
    document.getElementById(id).value = '';
  });
  modalError.textContent = '';
  modal.classList.add('open');
  document.getElementById('mName').focus();
}

function closeModal() {
  modal.classList.remove('open');
}

addRecruiterBtn.addEventListener('click', openAddRecruiterModal);

refreshLogosBtn.addEventListener('click', async () => {
  refreshLogosBtn.textContent = '⏳ Fetching...';
  refreshLogosBtn.disabled = true;
  await backfillLogos();
  refreshLogosBtn.textContent = '✅ Done';
  setTimeout(() => {
    refreshLogosBtn.textContent = '🖼 Refresh Logos';
    refreshLogosBtn.disabled = false;
  }, 2000);
});
document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

modalSaveBtn.addEventListener('click', async () => {
  const name       = document.getElementById('mName').value.trim();
  const title      = document.getElementById('mTitle').value.trim();
  const url        = document.getElementById('mUrl').value.trim();
  const company    = document.getElementById('mCompany').value.trim();
  const companyUrl = document.getElementById('mCompanyUrl').value.trim();

  if (!name)    { modalError.textContent = 'Name is required.'; return; }
  if (!url)     { modalError.textContent = 'Profile URL is required.'; return; }
  if (!company) { modalError.textContent = 'Company name is required.'; return; }
  if (!url.includes('linkedin.com/in/')) {
    modalError.textContent = 'Profile URL must be a LinkedIn /in/ URL.';
    return;
  }

  // Derive slug from company URL if given, else from company name
  let slug = null;
  if (companyUrl) {
    const m = companyUrl.match(/linkedin\.com\/company\/([^/?#]+)/);
    if (m) slug = m[1].toLowerCase().replace(/\/$/, '');
  }
  if (!slug) slug = company.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  // Normalise profile URL
  const profileUrl = url.split('?')[0].replace(/\/$/, '') + '/';

  const cache = await getCache();
  if (cache[slug]) {
    // Append to existing company — avoid duplicates
    const exists = cache[slug].recruiters.some(r => r.url === profileUrl);
    if (exists) { modalError.textContent = 'This profile is already saved for this company.'; return; }
    cache[slug].recruiters.push({ name, title, url: profileUrl, photoUrl: '' });
  } else {
    // Create new company entry
    cache[slug] = {
      recruiters: [{ name, title, url: profileUrl, photoUrl: '' }],
      logoUrl: null,
      scannedAt: Date.now(),
      displayName: company,
    };
  }

  await new Promise(r => chrome.storage.local.set({ [CACHE_KEY]: cache }, r));
  closeModal();
  renderHistory(historySearch.value);
});

// ── Backfill missing logos for cached companies ───────────────────────────────
async function backfillLogos() {
  const cache = await getCache();
  const missing = Object.keys(cache).filter(slug => !cache[slug].logoUrl);
  if (missing.length === 0) return;

  for (const slug of missing) {
    try {
      // Ask background to open a real tab, extract logo via scripting, and close it.
      // This works because background has an authenticated LinkedIn session.
      const response = await new Promise(resolve =>
        chrome.runtime.sendMessage({ action: 'fetchLogo', companySlug: slug }, resolve)
      );
      const logo = response?.logoUrl || null;

      if (logo) {
        const fresh = await getCache();
        if (fresh[slug] && !fresh[slug].logoUrl) {
          fresh[slug].logoUrl = logo;
          await new Promise(r => chrome.storage.local.set({ [CACHE_KEY]: fresh }, r));
          // Swap the fallback letter-div for a real img in the rendered history row
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
    } catch (e) {}
  }
}

// ── History rendering ─────────────────────────────────────────────────────────
async function renderHistory(filter = '') {
  const cache = await getCache();
  const keys  = Object.keys(cache).sort((a, b) => cache[b].scannedAt - cache[a].scannedAt);
  const lf    = filter.toLowerCase();

  // ── Stats bar ────────────────────────────────────────────────────────────────
  const historyStats = document.getElementById('historyStats');
  if (historyStats && keys.length > 0) {
    const totalRecruiters = keys.reduce((s, k) => s + cache[k].recruiters.length, 0);
    const lastTs  = Math.max(...keys.map(k => cache[k].scannedAt));
    const lastMin = Math.round((Date.now() - lastTs) / 60000);
    const lastStr = lastMin < 60
      ? `${lastMin}m ago`
      : lastMin < 1440
        ? `${Math.round(lastMin / 60)}h ago`
        : `${Math.round(lastMin / 1440)}d ago`;
    historyStats.textContent = `${keys.length} companies · ${totalRecruiters} recruiters · Last scan ${lastStr}`;
    historyStats.style.display = 'block';
  } else if (historyStats) {
    historyStats.style.display = 'none';
  }

  const filtered = keys.filter(slug => {
    if (!lf) return true;
    const entry = cache[slug];
    if ((entry.displayName || slug).toLowerCase().includes(lf)) return true;
    return entry.recruiters.some(r =>
      r.name.toLowerCase().includes(lf) || (r.title || '').toLowerCase().includes(lf)
    );
  });

  if (filtered.length === 0) {
    historyList.innerHTML = `<div class="empty-history">${lf ? 'No matches found.' : 'No history yet.<br>Run a scan to populate this.'}</div>`;
    return;
  }

  historyList.innerHTML = filtered.map(slug => {
    const entry      = cache[slug];
    const dateStr    = new Date(entry.scannedAt).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const recruiters  = entry.recruiters;
    const copyText    = recruiters.map(r => r.url).join('\n');

    const rows = recruiters.length > 0
      ? recruiters.map(r => {
          const photo = r.photoUrl
            ? `<img class="h-photo" src="${r.photoUrl}" alt="" />`
            : '';
          return `
            <div class="history-recruiter-row" id="hr-${slug}-${encodeURIComponent(r.url)}" data-url="${r.url}">
              <input type="checkbox" class="h-check" data-url="${r.url}" />
              ${photo}
              <div class="h-info">
                <span class="h-name">${hl(r.name, lf)}</span>
                <span class="h-title">${hl(r.title || '—', lf)}</span>
              </div>
              <div class="h-actions">
                <span class="h-link"><a href="${r.url}" target="_blank">Profile →</a></span>
                <button class="h-copy-link" data-url="${r.url}" title="Copy profile link">🔗</button>
                <button class="h-delete-recruiter" data-slug="${slug}" data-url="${r.url}" title="Remove from history">🗑</button>
              </div>
            </div>`;
        }).join('')
      : '<div style="font-size:11px;color:#aaa;padding:4px 0">No recruiters found in this scan.</div>';

    const displayName = entry.displayName || slug.replace(/-/g, ' ');
    const initials    = displayName.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    const logoHtml    = entry.logoUrl
      ? `<img class="company-logo" src="${entry.logoUrl}" alt="" data-initials="${initials}" />`
      : `<div class="company-logo-fallback">${initials}</div>`;

    return `
      <div class="history-company" id="hc-${slug}">
        <div class="history-company-header" data-slug="${slug}">
          <div class="history-company-name-wrap">
            ${logoHtml}
            <div class="history-company-name" id="hn-${slug}">${hl(displayName, lf)}</div>
            ${entry.employeeCount ? `<span class="history-emp-count">(${fmtEmpCount(entry.employeeCount)})</span>` : ''}
            <button class="rename-company-btn" data-slug="${slug}" title="Rename company">✏️</button>
          </div>
          <div class="history-meta">${recruiters.length} recruiters<br>${dateStr}</div>
          <button class="delete-entry-btn" data-slug="${slug}" title="Delete this entry">🗑</button>
        </div>
        <div class="history-recruiters" id="hist-${slug}">
          ${rows}
          ${recruiters.length > 0
            ? `<div class="history-company-actions">
                <button class="copy-history-btn" data-copy="${encodeURIComponent(copyText)}">📋 Copy All</button>
                <button class="open-history-btn" data-slug="${slug}">↗ Open All</button>
               </div>`
            : ''}
        </div>
      </div>
    `;
  }).join('');

  // Fix broken images (CSP blocks onerror= attributes)
  historyList.querySelectorAll('img.company-logo').forEach(img => {
    img.addEventListener('error', () => {
      const fallback = document.createElement('div');
      fallback.className = 'company-logo-fallback';
      fallback.textContent = img.dataset.initials || '?';
      img.replaceWith(fallback);
    });
  });
  historyList.querySelectorAll('img.h-photo').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });

  // Toggle expand/collapse
  document.querySelectorAll('.history-company-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-entry-btn')) return;
      document.getElementById(`hist-${header.dataset.slug}`).classList.toggle('open');
    });
  });

  // Copy all text per company
  document.querySelectorAll('.copy-history-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(decodeURIComponent(btn.dataset.copy)).then(() => {
        btn.textContent = '✅ Copied!';
        setTimeout(() => { btn.textContent = '📋 Copy All'; }, 2000);
      });
    });
  });

  // Open All per company
  document.querySelectorAll('.open-history-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const cache = await getCache();
      const recruiters = cache[btn.dataset.slug]?.recruiters || [];
      recruiters.forEach(r => chrome.tabs.create({ url: r.url, active: false }));
    });
  });

  // Checkbox selection → show/hide selection bar
  function updateHistSelectionBar() {
    const checked = historyList.querySelectorAll('.h-check:checked');
    const bar = document.getElementById('historySelectionBar');
    const countEl = document.getElementById('histSelCount');
    bar?.classList.toggle('visible', checked.length > 0);
    if (countEl) countEl.textContent = `${checked.length} selected`;
  }
  document.querySelectorAll('.h-check').forEach(cb => {
    cb.addEventListener('change', e => { e.stopPropagation(); updateHistSelectionBar(); });
  });

  document.getElementById('histCopySelected')?.addEventListener('click', () => {
    const urls = [...historyList.querySelectorAll('.h-check:checked')].map(cb => cb.dataset.url);
    navigator.clipboard.writeText(urls.join('\n')).then(() => {
      const btn = document.getElementById('histCopySelected');
      const orig = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  });

  document.getElementById('histOpenSelected')?.addEventListener('click', () => {
    historyList.querySelectorAll('.h-check:checked').forEach(cb => {
      chrome.tabs.create({ url: cb.dataset.url, active: false });
    });
  });

  // Per-recruiter copy link
  document.querySelectorAll('.h-copy-link').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      copyLink(btn.dataset.url, btn, '🔗');
    });
  });

  // Per-recruiter delete
  document.querySelectorAll('.h-delete-recruiter').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const { slug, url } = btn.dataset;
      await removeRecruiterFromCache(slug, url);
      const rowId = `hr-${slug}-${encodeURIComponent(url)}`;
      const row = document.getElementById(rowId);
      if (row) row.remove();
      // Update recruiter count in header
      const meta = document.querySelector(`#hc-${slug} .history-meta`);
      if (meta) {
        const remaining = document.querySelectorAll(`#hist-${slug} .history-recruiter-row`).length;
        meta.innerHTML = meta.innerHTML.replace(/^\d+/, remaining);
      }
    });
  });

  // Per-entry delete
  document.querySelectorAll('.delete-entry-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const slug = btn.dataset.slug;
      await deleteFromCache(slug);
      const card = document.getElementById(`hc-${slug}`);
      if (card) card.remove();
      if (document.querySelectorAll('.history-company').length === 0) {
        historyList.innerHTML = '<div class="empty-history">No history yet.<br>Run a scan to populate this.</div>';
      }
    });
  });

  // Rename company
  document.querySelectorAll('.rename-company-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const slug    = btn.dataset.slug;
      const nameEl  = document.getElementById(`hn-${slug}`);
      const current = nameEl.textContent;

      const input = document.createElement('input');
      input.type      = 'text';
      input.value     = current;
      input.className = 'rename-input';
      nameEl.replaceWith(input);
      btn.style.visibility = 'hidden';
      input.focus();
      input.select();

      const save = async () => {
        const newName = input.value.trim() || current;
        await renameCompanyInCache(slug, newName);
        const newEl       = document.createElement('div');
        newEl.className   = 'history-company-name';
        newEl.id          = `hn-${slug}`;
        newEl.textContent = newName;
        input.replaceWith(newEl);
        btn.style.visibility = '';
      };

      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = current; input.blur(); }
      });
    });
  });
}

historySearch.addEventListener('input', () => {
  clearSearchBtn.style.display = historySearch.value ? 'block' : 'none';
  renderHistory(historySearch.value);
});

clearSearchBtn.addEventListener('click', () => {
  historySearch.value = '';
  clearSearchBtn.style.display = 'none';
  renderHistory();
  historySearch.focus();
});

clearHistBtn.addEventListener('click', async () => {
  if (!confirm('Clear all history? This cannot be undone.')) return;
  await chrome.storage.local.remove(CACHE_KEY);
  renderHistory();
});

// ── Reactive company change ───────────────────────────────────────────────────
async function onCompanyChange(slug) {
  if (!slug || slug === currentSlug) return;
  if (isScanning) {
    // Manual scan in progress — update display and show cached results if available
    companyEl.textContent = slug.replace(/-/g, ' ');
    const cachedDuringScan = await getCached(slug);
    if (cachedDuringScan) {
      const age     = Math.round((Date.now() - cachedDuringScan.scannedAt) / 60000);
      const ageText = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
      statusBox.textContent = `✅ Loaded from cache (scanned ${ageText}). ${cachedDuringScan.recruiters.length} recruiters.`;
      progressBar.style.display = 'block';
      progressFill.style.width = '100%';
      renderResults(cachedDuringScan.recruiters, cachedDuringScan.logoUrl);
      if (copyBtn) copyBtn.style.display = 'block';
      scanBtn.textContent = '🔄 Re-scan (Queue)';
    } else {
      statusBox.textContent = `⏳ Scanning in progress. Click "Add to Queue" to queue ${slug.replace(/-/g, ' ')}.`;
      resultsDiv.innerHTML = '';
      resultsCompanyBanner.style.display = 'none';
      if (copyBtn) copyBtn.style.display = 'none';
    }
    return;
  }

  currentSlug = slug;
  companyEl.textContent = slug.replace(/-/g, ' ');
  resultsDiv.innerHTML = '';
  resultsCompanyBanner.style.display = 'none';
  const _rsh = document.getElementById('resultsSearchWrap'); if (_rsh) _rsh.style.display = 'none';
  if (copyBtn) copyBtn.style.display = 'none';
  errorDiv.style.display = 'none';
  progressBar.style.display = 'none';
  progressFill.style.width = '0%';
  currentVisaStatus = null;
  currentExperience = null;
  showCompanyMeta(null);
  showTechStack([]);

  const cached = await getCached(slug);
  if (cached) {
    const age     = Math.round((Date.now() - cached.scannedAt) / 60000);
    const ageText = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    statusBox.textContent = `✅ Loaded from cache (scanned ${ageText}). ${cached.recruiters.length} recruiters.`;
    progressBar.style.display = 'block';
    progressFill.style.width = '100%';
    renderResults(cached.recruiters);
    scanBtn.disabled    = false;
    scanBtn.textContent = '🔄 Re-scan';
    errorDiv.style.display = 'block';
    errorDiv.style.color = '#0a66c2';
    errorDiv.textContent = `💡 Showing cached results. Click "Re-scan" to fetch fresh data.`;
  } else {
    if (autoScanToggle.checked) {
      statusBox.textContent = `⚡ Auto-scanning ${slug.replace(/-/g, ' ')} in background…`;
    } else {
      statusBox.textContent = `Ready! Click "Find Recruiters" to scan ${slug.replace(/-/g, ' ')}.`;
    }
    scanBtn.disabled    = false;
    scanBtn.textContent = '🚀 Find Recruiters';
  }
  // Always read employee count, visa status, and tech stack from the current page DOM in parallel
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    getEmployeeCountFromJobPage(activeTab.id).then(count => {
      showCompanyMeta(count);
      updateCachedEmployeeCount(slug, count);
    });
    getVisaSponsorshipFromJobPage(activeTab.id).then(status => showVisaMeta(status));
    getTechStackFromJobPage(activeTab.id).then(stack => showTechStack(stack));
    getExperienceFromJobPage(activeTab.id).then(exp => showExperienceMeta(exp));
  }
}

// ── Listen for background scan completion + Option B observer events ─────────

let _obsPending = { slug: null, recruiters: [] };

function updateObserverNotif() {
  const { slug, recruiters } = _obsPending;
  if (!slug || !recruiters.length) { observerNotif.classList.remove('visible'); return; }
  const displayName = slug.replace(/-/g, ' ');
  const n = recruiters.length;
  obsText.textContent = `👤 ${n} new recruiter${n !== 1 ? 's' : ''} spotted at ${displayName}`;
  observerNotif.classList.add('visible');
}

function normalizeUrl(url) {
  return (url || '').split('?')[0].replace(/\/$/, '').toLowerCase();
}

async function showObserverNotif(slug, recruiters) {
  // Filter to only recruiters not already saved in cache for this company.
  // Normalize both sides (trailing slash, query params, case) to avoid mismatches.
  const cached = await getCached(slug);
  const cachedUrls = new Set((cached?.recruiters || []).map(r => normalizeUrl(r.url)));
  const newOnes = recruiters.filter(r => !cachedUrls.has(normalizeUrl(r.url)));
  if (!newOnes.length) {
    // Everything has been added — make sure banner is hidden
    observerNotif.classList.remove('visible');
    _obsPending = { slug: null, recruiters: [] };
    return;
  }
  _obsPending = { slug, recruiters: newOnes };
  updateObserverNotif(); // shows banner with updated count
  // If modal is already open for this slug, refresh its list
  if (observerModal.classList.contains('open') && _obsModalSlug === slug) {
    populateObsModal();
  }
}

function hideObserverNotif() {
  observerNotif.classList.remove('visible');
  _obsPending = { slug: null, recruiters: [] };
}

// ── Observer modal ────────────────────────────────────────────────────────────
let _obsModalSlug = null;

function populateObsModal() {
  const { slug, recruiters } = _obsPending;
  _obsModalSlug = slug;
  const displayName = slug.replace(/-/g, ' ');
  obsModalTitle.textContent = `👤 New Recruiters at ${displayName}`;
  obsModalList.innerHTML = recruiters.map((r, i) => `
    <div class="obs-row">
      <input type="checkbox" class="obs-check" data-i="${i}" checked />
      <div class="obs-row-info">
        <div class="obs-row-name">${r.name}</div>
        <div class="obs-row-title">${r.title || ''}</div>
      </div>
    </div>`).join('');
  updateObsModalCount();
  obsModalList.querySelectorAll('.obs-check').forEach(cb =>
    cb.addEventListener('change', updateObsModalCount)
  );
}

function updateObsModalCount() {
  const n = obsModalList.querySelectorAll('.obs-check:checked').length;
  obsModalSelCount.textContent = n;
}

obsShowBtn.addEventListener('click', () => {
  if (!_obsPending.slug) return;
  populateObsModal();
  observerModal.classList.add('open');
});

obsSelectAll.addEventListener('click', () => {
  obsModalList.querySelectorAll('.obs-check').forEach(cb => { cb.checked = true; });
  updateObsModalCount();
});

obsDeselectAll.addEventListener('click', () => {
  obsModalList.querySelectorAll('.obs-check').forEach(cb => { cb.checked = false; });
  updateObsModalCount();
});

obsModalCloseBtn.addEventListener('click', () => {
  observerModal.classList.remove('open');
  _obsModalSlug = null;
});

obsModalAddBtn.addEventListener('click', async () => {
  const { slug } = _obsPending;
  if (!slug) return;
  const checked = [...obsModalList.querySelectorAll('.obs-check:checked')];
  const indices = new Set(checked.map(cb => parseInt(cb.dataset.i)));
  const toAdd      = _obsPending.recruiters.filter((_, i) => indices.has(i));
  const remaining  = _obsPending.recruiters.filter((_, i) => !indices.has(i));
  if (!toAdd.length) return;

  // Merge selected into cache
  const cache = await getCache();
  const existing = cache[slug]?.recruiters || [];
  const existingUrls = new Set(existing.map(r => normalizeUrl(r.url)));
  const merged = [...existing, ...toAdd.filter(r => !existingUrls.has(normalizeUrl(r.url)))];
  await saveToCache(slug, merged, cache[slug]?.logoUrl || null);

  // Update pending — keep unselected ones
  _obsPending.recruiters = remaining;
  observerModal.classList.remove('open');
  _obsModalSlug = null;
  updateObserverNotif(); // hide banner if nothing left, else update count

  if (slug === currentSlug) {
    renderResults(merged);
    statusBox.textContent = `✅ Added ${toAdd.length}! ${merged.length} recruiter${merged.length !== 1 ? 's' : ''} total.`;
  }
});

obsDismissBtn.addEventListener('click', async () => {
  // Tell content script to un-mark these URLs so the observer can re-detect them
  const urls = _obsPending.recruiters.map(r => r.url);
  if (urls.length) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { action: 'unmarkObservedUrls', urls }).catch(() => {});
  }
  hideObserverNotif();
});

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'scanComplete') {
    if (request.companySlug !== currentSlug) return;
    // Background finished scanning the company currently shown — update display
    getCached(request.companySlug).then(cached => {
      if (!cached) return;
      const count = cached.recruiters.length;
      statusBox.textContent = `⚡ Auto-scanned! Found ${count} recruiter${count !== 1 ? 's' : ''}.`;
      progressBar.style.display = 'block';
      progressFill.style.width  = '100%';
      if (count > 0) {
        renderResults(cached.recruiters);
        scanBtn.textContent = '🔄 Re-scan';
      }
    });
  }

  if (request.action === 'observedRecruiters') {
    const { companySlug, recruiters } = request;
    if (!recruiters?.length) return;
    // Combine incoming with any previously pending (not-yet-added) recruits for this slug.
    // showObserverNotif re-evaluates the whole set against cache each time,
    // so the banner always reflects the true "spotted but not added" count.
    let combined = recruiters;
    if (_obsPending.slug === companySlug && _obsPending.recruiters.length) {
      const incomingUrls = new Set(recruiters.map(r => r.url));
      const prevOnly = _obsPending.recruiters.filter(r => !incomingUrls.has(r.url));
      combined = [...recruiters, ...prevOnly];
    }
    showObserverNotif(companySlug, combined);
  }
});

// ── Poll active tab URL — detects SPA navigation without a content script ─────
let _lastPollUrl = '';
let _lastPeopleUrl = '';
let _peopleRequestTimer = null;

setInterval(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // ── People tab URL change detector ───────────────────────────────────────
  // When the URL changes on a company people page (new keyword search, filter, etc.)
  // ask the content script for a fresh scrape 2s later (DOM needs time to settle).
  // This bypasses the content.js pushState timing entirely.
  if (tab?.url?.match(/linkedin\.com\/company\/[^/?#]+\/people/)) {
    if (tab.url !== _lastPeopleUrl) {
      _lastPeopleUrl = tab.url;
      clearTimeout(_peopleRequestTimer);
      _peopleRequestTimer = setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { action: 'requestPeopleState' }).catch(() => {});
      }, 2000);
    }
  }

  if (!tab?.url?.includes('linkedin.com/jobs')) return;
  if (tab.url === _lastPollUrl) return;
  _lastPollUrl = tab.url;

  // Wait for the DOM to settle after SPA navigation, then detect company
  setTimeout(async () => {
    const [freshTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!freshTab) return;
    let slug = extractCompanySlug(freshTab);
    if (!slug) {
      try { slug = await getCompanySlugFromJobPage(freshTab.id); } catch (e) {}
    }
    if (!slug) return;
    if (slug !== currentSlug) {
      onCompanyChange(slug);
    } else if (!isScanning) {
      // Same company, different job — refresh only job-specific meta
      getVisaSponsorshipFromJobPage(freshTab.id).then(status => showVisaMeta(status));
      getTechStackFromJobPage(freshTab.id).then(stack => showTechStack(stack));
      getExperienceFromJobPage(freshTab.id).then(exp => showExperienceMeta(exp));
    }
  }, 400);
}, 300);

// ── Resume a manual scan that was running while the panel was closed ──────────
function pollForManualScanCompletion(slug) {
  const interval = setInterval(async () => {
    const sd = await new Promise(r =>
      chrome.storage.session.get(['manualScanSlug', 'manualScanDone', 'manualScanError', 'status'], r)
    );
    if (sd.status) statusBox.textContent = sd.status;
    if (sd.manualScanSlug !== slug) { clearInterval(interval); return; }
    if (!sd.manualScanDone) return; // still running

    clearInterval(interval);
    isScanning = false;
    currentScanSlug = null;
    progressFill.style.width = '100%';
    renderQueue();

    if (sd.manualScanError) {
      statusBox.textContent = `❌ Error scanning ${slug.replace(/-/g, ' ')}.`;
      errorDiv.textContent = '❌ Something went wrong. Refresh the job page and try again.';
      errorDiv.style.display = 'block';
      scanBtn.disabled = false;
      scanBtn.textContent = '🚀 Find Recruiters';
      return;
    }

    const cached = await getCached(slug);
    if (cached) {
      statusBox.textContent = `✅ Done! Found ${cached.recruiters.length} recruiters for ${slug.replace(/-/g, ' ')}.`;
      renderResults(cached.recruiters, cached.logoUrl);
      scanBtn.disabled = false;
      scanBtn.textContent = '🔄 Re-scan';
    }
    // Continue any queued items that survived a panel close
    if (scanQueue.length > 0) {
      processQueue();
    }
  }, 500);
}

// ── On panel open ─────────────────────────────────────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
  const url = tab?.url || '';
  if (!url.includes('linkedin.com')) {
    handleExternalPage(tab);
    return;
  }

  // Try to detect company slug from current URL or page
  let slug = extractCompanySlug(tab);
  if (!slug) {
    try { slug = await getCompanySlugFromJobPage(tab.id); } catch (e) {}
  }

  if (!slug) {
    statusBox.textContent = 'Ready! Click "Find Recruiters" from any LinkedIn job posting.';
    return;
  }

  companyEl.textContent = slug.replace(/-/g, ' ');
  currentSlug = slug;

  // Check if a manual scan for this company is still running in the background
  const sd = await new Promise(r =>
    chrome.storage.session.get(['manualScanSlug', 'manualScanDone', 'status', 'manualScanQueue'], r)
  );

  // Restore any pending queue that survived a panel close
  const savedQueue = Array.isArray(sd.manualScanQueue) ? sd.manualScanQueue : [];
  savedQueue.forEach(s => {
    if (!scanQueue.some(q => q.slug === s)) scanQueue.push({ slug: s });
  });

  if (sd.manualScanSlug && !sd.manualScanDone) {
    // Scan is in progress — show scanning state and wait for it to finish
    statusBox.textContent = sd.status || `Scanning ${sd.manualScanSlug.replace(/-/g, ' ')}...`;
    progressBar.style.display = 'block';
    progressFill.style.width = '30%';
    scanBtn.disabled = false;
    scanBtn.textContent = '➕ Add to Queue';
    isScanning = true;
    currentScanSlug = sd.manualScanSlug;
    currentSlug = sd.manualScanSlug;
    companyEl.textContent = sd.manualScanSlug.replace(/-/g, ' ');
    renderQueue();
    pollForManualScanCompletion(sd.manualScanSlug);
    return;
  }

  // Scan finished while panel was closed — restore queue and continue
  if (savedQueue.length > 0) {
    isScanning = true;
    processQueue();
    return;
  }

  const cached = await getCached(slug);
  if (cached) {
    const age     = Math.round((Date.now() - cached.scannedAt) / 60000);
    const ageText = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    statusBox.textContent = `✅ Loaded from cache (scanned ${ageText}). ${cached.recruiters.length} recruiters.`;
    progressBar.style.display = 'block';
    progressFill.style.width  = '100%';
    renderResults(cached.recruiters);
    scanBtn.textContent = '🔄 Re-scan';
    errorDiv.style.display = 'block';
    errorDiv.style.color = '#0a66c2';
    errorDiv.textContent = `💡 Showing cached results. Click "Re-scan" to fetch fresh data.`;
  } else {
    statusBox.textContent = `Ready! Click "Find Recruiters" to scan ${slug.replace(/-/g, ' ')}.`;
  }
  // Always read employee count, visa status, and tech stack from the current page DOM in parallel
  getEmployeeCountFromJobPage(tab.id).then(count => {
    showCompanyMeta(count);
    updateCachedEmployeeCount(slug, count);
  });
  getVisaSponsorshipFromJobPage(tab.id).then(status => showVisaMeta(status));
  getTechStackFromJobPage(tab.id).then(stack => showTechStack(stack));
  getExperienceFromJobPage(tab.id).then(exp => showExperienceMeta(exp));

  // Option B: if the active tab is on a company people page, ask content script
  // for whatever recruiters are currently visible (restores state after panel reopen)
  if (tab.url?.match(/linkedin\.com\/company\/[^/?#]+\/people/)) {
    chrome.tabs.sendMessage(tab.id, { action: 'requestPeopleState' }).catch(() => {});
  }
});