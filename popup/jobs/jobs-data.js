// ── Jobs Shared State & Data Layer ───────────────────────────────────────────

const JOBS_STACK_KEY    = 'myJobStack';
const JOBS_RESULTS_KEY  = 'jobScanResults';
const JOBS_STATE_KEY    = 'jobScanState';
const JOBS_MAX_KEY      = 'jobScanMax';
const JOBS_HASH_KEY     = 'jobScanHashIndex';   // Tier 1: flat hash array
const JOBS_HISTORY_KEY  = 'jobScanHistory';     // Tier 2: metadata array (capped 10k)
const JOBS_HISTORY_CAP  = 10000;
const JOBS_MATCH_CACHE  = 'jobMatchCache';      // { [jobId]: string[] } matched tag names
const JOBS_JD_CACHE     = 'jobJDCache';         // [[jobId, jdText], ...] newest first, cap 500
const JOBS_JD_CACHE_CAP = 10000;

// ── Shared mutable state (read/written by results + seen tabs) ────────────────
let _jobStack            = [];
let _jobResults          = [];
let _jobState            = { running: false, total: 0, done: 0 };
let _selectedIds         = new Set();
let _filterMatchingOnly  = false;
let _visibleJobIds       = null;
let _urlMismatch         = false;
let _maxJobs             = 25;
let _expandedCardId      = null;
let _collapseListener    = null;
let _companyFilter       = '';
let _resultsSortOrder    = 'scan';     // 'scan' | 'score'
let _activeJobsSubTab    = 'results';  // 'results' | 'seen'
let _jobMatchCache       = {};         // jobId → matched tag names[]
let _onLinkedInJobsPage  = false;      // true only when active tab is linkedin.com/jobs
let _jobJDCache          = {};         // jobId → jdText (built from _jobJDCacheArr)
let _jobJDCacheArr       = [];         // [[jobId, jdText], ...] newest first, capped

const jobsMain = document.getElementById('jobsMain');

// ── Storage helpers ───────────────────────────────────────────────────────────

async function loadJobsData() {
  const d = await new Promise(r =>
    chrome.storage.local.get([JOBS_STACK_KEY, JOBS_RESULTS_KEY, JOBS_STATE_KEY, JOBS_MAX_KEY, JOBS_MATCH_CACHE, JOBS_JD_CACHE], r)
  );
  _jobStack      = d[JOBS_STACK_KEY]   || [];
  _jobResults    = d[JOBS_RESULTS_KEY] || [];
  _jobState      = d[JOBS_STATE_KEY]   || { running: false, total: 0, done: 0 };
  _maxJobs       = d[JOBS_MAX_KEY]     ?? 25;
  _jobMatchCache = d[JOBS_MATCH_CACHE] || {};
  _jobJDCacheArr = d[JOBS_JD_CACHE]    || [];
  _jobJDCache    = Object.fromEntries(_jobJDCacheArr);
}

// Save new JD texts into the persistent cache (newest first, capped)
function saveJDCache(newEntries) {
  // newEntries: { [jobId]: jdText }
  const existing = new Map(_jobJDCacheArr);
  for (const [id, text] of Object.entries(newEntries)) {
    if (text) existing.set(id, text);
  }
  // Rebuild newest-first by prepending new ones, keeping order stable for old ones
  const newIds = new Set(Object.keys(newEntries));
  const kept   = _jobJDCacheArr.filter(([id]) => !newIds.has(id));
  const added  = Object.entries(newEntries).filter(([, t]) => t);
  _jobJDCacheArr = [...added, ...kept].slice(0, JOBS_JD_CACHE_CAP);
  _jobJDCache    = Object.fromEntries(_jobJDCacheArr);
  chrome.storage.local.set({ [JOBS_JD_CACHE]: _jobJDCacheArr }).catch(() => {});
}

async function saveStack() {
  await chrome.storage.local.set({ [JOBS_STACK_KEY]: _jobStack });
}

async function findLinkedInJobsTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/jobs/*' });
  return tabs[0] || null;
}

function normalizeJobUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('currentJobId');
    return u.origin + u.pathname + u.search;
  } catch { return url; }
}

function matchStack(jdText, stack) {
  if (!jdText || !stack.length) return [];
  return stack.filter(tag => {
    const pat = (typeof TECH_PATTERNS !== 'undefined')
      ? TECH_PATTERNS.find(([label]) => label === tag)
      : null;
    if (pat) return new RegExp(pat[1], pat[2]).test(jdText);
    return new RegExp(`\\b${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(jdText);
  });
}

// ── Seen jobs history helpers ─────────────────────────────────────────────────

async function loadSeenHistory() {
  const d = await new Promise(r =>
    chrome.storage.local.get([JOBS_HASH_KEY, JOBS_HISTORY_KEY], r)
  );
  return {
    hashIndex: d[JOBS_HASH_KEY]   || [],
    history:   d[JOBS_HISTORY_KEY] || [],
  };
}

async function saveSeenHistory(hashIndex, history) {
  await chrome.storage.local.set({
    [JOBS_HASH_KEY]:   hashIndex,
    [JOBS_HISTORY_KEY]: history,
  });
}

// Remove entries matching a predicate from both tiers, return count removed
async function clearSeenByPredicate(predicate) {
  const { hashIndex, history } = await loadSeenHistory();
  const toRemove = new Set(history.filter(predicate).map(e => e[0]));
  const newHistory  = history.filter(e => !toRemove.has(e[0]));
  const newHashIndex = hashIndex.filter(h => !toRemove.has(h));
  await saveSeenHistory(newHashIndex, newHistory);
  return toRemove.size;
}

function formatSeenDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Visa sponsorship detection ────────────────────────────────────────────────

const _NO_VISA_PATTERNS = [
  /authorized?\s+to\s+work\s+in\s+the\s+u\.?s\.?\s+without.*visa/i,
  /no\s+visa\s+sponsorship/i,
  /visa\s+sponsorship.*not\s+(available|offered|provided)/i,
  /not\s+(able\s+to|in\s+a\s+position\s+to)?\s*sponsor/i,
  /cannot\s+sponsor/i,
  /unable\s+to\s+sponsor/i,
  /we\s+do\s+not\s+sponsor/i,
  /does\s+not\s+(offer|provide)\s+sponsorship/i,
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
  /must\s+be\s+(a\s+)?u\.?s\.?\s+citizen/i,
  /work\s+authorization\s+(in|for)\s+the\s+u\.?s\.?/i,
  /will\s+not\s+(provide|offer)\s+immigration\s+sponsorship/i,
  /not\s+(provide|offer|support)\s+(immigration|visa)\s+sponsorship/i,
  /does\s+not\s+(provide|offer)\s+.*sponsorship/i,
  /permanent\s+work\s+authorization/i,
  /without\s+employer\s+(assistance|support|sponsorship)/i,
  /must\s+have\s+(authorization|authorization)\s+to\s+work/i,
  /not\s+eligible\s+to\s+sponsor/i,
  /requires?\s+work\s+authorization/i,
  /must\s+be\s+legally\s+authorized/i,
  /authorized\s+to\s+work\s+without\s+(employer|company)/i,
  /employment\s+eligibility\s+verification/i,
  /not\s+sponsor\s+(work\s+)?visas?/i,
  /applicants?\s+must\s+be\s+eligible\s+to\s+work/i,
  /must\s+be\s+eligible\s+to\s+work\s+in\s+the\s+u\.?s\.?/i,
];

const _YES_VISA_PATTERNS = [
  /visa\s+sponsorship\s+(is\s+)?(available|offered|provided)/i,
  /we\s+(do\s+)?(offer|provide|support)\s+visa\s+sponsorship/i,
  /will\s+sponsor\s+.*(visa|h[-\s]?1b|work\s+authorization)/i,
  /sponsorship\s+(is\s+)?available/i,
  /open\s+to\s+sponsor/i,
  /we\s+sponsor\s+(h[-\s]?1b|work\s+visa)/i,
  /h[-\s]?1b\s+sponsorship\s+(is\s+)?(available|offered|provided|considered)/i,
  /will\s+(provide|offer|support)\s+immigration\s+sponsorship/i,
  /willing\s+to\s+sponsor/i,
  /able\s+to\s+sponsor/i,
  /sponsorship\s+(will\s+be\s+)?(considered|offered)/i,
  /immigration\s+assistance\s+(is\s+)?(provided|available|offered)/i,
  /relocation\s+and\s+visa\s+support/i,
  /we\s+support\s+(visa|immigration)/i,
  /sponsorship\s+for\s+qualified\s+candidates/i,
];

function detectVisaStatus(text) {
  if (!text) return 'na';
  if (_NO_VISA_PATTERNS.some(p => p.test(text))) return 'no';
  if (_YES_VISA_PATTERNS.some(p => p.test(text))) return 'yes';
  return 'na';
}

globalThis.detectVisaStatus = detectVisaStatus;
