async function getJobDetailsFromPage(tabId, tabUrl) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: (isLinkedIn) => {
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
            if (t) {
              role = t;
              break;
            }
          }
          if (!role && document.title) {
            role = document.title.split(' | ')[0].trim();
          }
        } else {
          role = document.querySelector('h1')?.textContent?.trim() || '';
        }

        let jd = '';

        if (isLinkedIn) {
          const specific = document.querySelector(
            '.jobs-description-content__text, .jobs-description__content, ' +
            '.jobs-description-content, .jobs-box__html-content, ' +
            '.show-more-less-html__markup, .description__text--rich, .description__text'
          );
          if (specific?.innerText?.trim().length > 50) {
            jd = specific.innerText.trim();
          } else {
            const pane = document.querySelector(
              '.jobs-search__job-details--wrapper, .scaffold-layout__detail, ' +
              '.job-view-layout, .jobs-details'
            );
            const raw = pane?.innerText || document.body.innerText || '';
            const startIdx = raw.search(/About the job\s*\n/i);
            let slice = startIdx !== -1 ? raw.slice(startIdx + raw.match(/About the job\s*\n/i)[0].length) : raw;
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
          let jdEl = null;
          for (const sel of [
            '#job-description', '#jobDescription', '#job_description',
            '[class*="job-description"]', '[class*="jobDescription"]',
            '[data-automation-id="job-description"]',
            '[data-testid*="description"]', 'article', 'main',
          ]) {
            const el = document.querySelector(sel);
            if (el?.innerText?.trim().length > 100) {
              jdEl = el;
              break;
            }
          }

          const root = (jdEl || document.body).cloneNode(true);
          const noiseSelectors = [
            'form', 'nav', 'header', 'footer',
            'button', 'input', 'select', 'textarea', 'label',
            'script', 'style', 'noscript',
            '[class*="application"]', '[class*="Application"]',
            '[class*="demographic"]', '[class*="Demographic"]',
            '[class*="job-alert"]', '[class*="jobAlert"]',
            '[class*="create-alert"]', '[class*="legal"]',
            '[class*="privacy"]', '[class*="equal-employment"]',
            '[id*="application"]', '[id*="demographic"]',
          ];
          noiseSelectors.forEach(sel => {
            try { root.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
          });
          let raw = root.innerText || '';

          const lines = raw.split('\n');
          let startLine = 0;
          for (let i = 0; i < lines.length; i++) {
            const l = lines[i].trim();
            if (!l) continue;
            if (/^(back to|apply|save|share|sign in|log in|menu|home|jobs|careers)$/i.test(l)) continue;
            if (l.length < 20 && i < 15) continue;
            startLine = i;
            break;
          }
          raw = lines.slice(startLine).join('\n');

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
  } catch {
    return { role: '', jd: '' };
  }
}

async function handleCopyJd() {
  const btn = document.getElementById('copyJdBtn');
  if (!btn) return;
  btn.textContent = '?';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    btn.textContent = '?? JD';
    return;
  }

  const { role, jd } = await getJobDetailsFromPage(tab.id, tab.url);
  const company = companyEl.textContent.trim() || 'Unknown Company';

  const text = [
    `Company - ${company}`,
    `Role - ${role || 'Unknown Role'}`,
    'JD:',
    '',
    jd,
  ].join('\n');

  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '? Copied!';
    setTimeout(() => { btn.textContent = '?? JD'; }, 2000);
  }).catch(() => {
    btn.textContent = '? Failed';
    setTimeout(() => { btn.textContent = '?? JD'; }, 2000);
  });
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

        m = text.match(/\b(\d+)\s*[-–]\s*(\d+)\s*\+?\s*years?\s+of\s+(?:\w+\s+){0,3}?experience/i);
        if (m) return `${m[1]}-${m[2]} yrs`;

        m = text.match(/\b(\d+)\s*\+\s*years?\s+of\s+(?:\w+\s+){0,3}?experience/i);
        if (m) return `${m[1]}+ yrs`;

        m = text.match(/\b(\d+)\s+years?\s+of\s+(?:\w+\s+){0,3}?experience/i);
        if (m) return `${m[1]}+ yrs`;

        m = text.match(/(?:at\s+least|minimum\s+(?:of\s+)?|at\s+minimum)\s+(\d+)\s+years?/i);
        if (m) return `${m[1]}+ yrs`;

        m = text.match(/(\d+)\s+or\s+more\s+years?/i);
        if (m) return `${m[1]}+ yrs`;

        m = text.match(/\b(\d+)\s*[-–]\s*(\d+)\s+years?/i);
        if (m) return `${m[1]}-${m[2]} yrs`;

        m = text.match(/\b(\d+)\s*\+\s*years?/i);
        if (m) return `${m[1]}+ yrs`;

        return null;
      }
    });
    return res[0]?.result || null;
  } catch {
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
  } catch {
    return 'na';
  }
}
