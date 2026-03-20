// -Company meta state ────────────────────────────────────────────────────────
let currentEmployeeCount = null;
let currentVisaStatus    = null; // 'yes' | 'no' | 'na' | null (not yet checked)
let currentExperience    = null; // string like '3+ yrs' | 'na' | null (not yet checked)
let currentTechStack     = null;
let currentJobDetails    = null;

// "501-1,000 employees" → "501-1,000"
function fmtEmpCount(str) {
  if (!str) return '';
  return str.replace(/\s*employees?\s*/i, '').trim();
}

// -Copy JD ───────────────────────────────────────────────────────────────────
async function getJobDetailsFromPage(tabId, tabUrl) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: (isLinkedIn) => {
        // -Role ──────────────────────────────────────────────────────────────
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

        // -JD text ───────────────────────────────────────────────────────────
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

          // -Option A: DOM strip ───────────────────────────────────────────
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

          // -Option B: text start/end markers ─────────────────────────────
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
    parts.push(`<span class="emp-count-chip" title="Click to edit">👥 ${currentEmployeeCount}</span>`);
  }
  if (_onJobPage) {
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
  }
  if (parts.length > 0) {
    let html = parts.join('<span class="meta-sep"> · </span>');
    if (_onJobPage) html += '<button class="copy-jd-chip" id="copyJdBtn">📋 JD</button>';
    companyMetaEl.innerHTML = html;
    companyMetaEl.style.display = 'flex';
    if (_onJobPage) {
      document.getElementById('copyJdBtn').addEventListener('click', handleCopyJd);
    }
    // Make employee count chip editable
    const empChip = companyMetaEl.querySelector('.emp-count-chip');
    if (empChip) {
      empChip.style.cursor = 'pointer';
      empChip.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentEmployeeCount;
        input.className = 'emp-count-input';
        empChip.replaceWith(input);
        input.focus();
        input.select();
        const save = () => {
          const val = input.value.trim();
          if (val && val !== currentEmployeeCount) {
            currentEmployeeCount = val;
            updateCachedEmployeeCount(currentSlug, val);
          }
          updateCompanyMetaDisplay();
        };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
          if (e.key === 'Escape') { updateCompanyMetaDisplay(); }
        });
      });
    }
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
        // Matches "501-1,000 employees", "10K+ employees", etc.
        const pattern = /(\d[\d,]*(?:[-�]\d[\d,]*|\+)\s*employees)/i;
        const pathname = location.pathname || '';

        // On LinkedIn company pages, prefer the hero/main-content text.
        // A generic body walk can grab side-module text like
        // "6,309 employees on LinkedIn" instead of the top-card company band.
        if (/^\/company\/[^/?#]+\/?$/.test(pathname)) {
          const mainText = document.querySelector('main')?.innerText || '';
          if (mainText) {
            const lines = mainText
              .split('\n')
              .map(s => s.trim())
              .filter(Boolean)
              .slice(0, 40);
            for (const line of lines) {
              const m = line.match(pattern);
              if (m) return m[1];
            }
          }
        }

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
    // Retry a couple times. "About the company" is often lazy-rendered.
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

// -Tech stack detection ──────────────────────────────────────────────────────
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
  if (!_onJobPage || !techList || techList.length === 0) {
    techStackEl.style.display = 'none';
    return;
  }
  techStackEl.innerHTML =
    '<span class="tech-label">Tech:</span>' +
    techList.map(t => `<span class="tech-chip">${t}</span>`).join('');
  techStackEl.style.display = 'flex';
}


