let currentEmployeeCount = null;
let currentVisaStatus = null;
let currentExperience = null;
let currentTechStack = null;
let currentJobDetails = null;
let externalCompanyEditEnabled = false;

function fmtEmpCount(str) {
  if (!str) return '';
  return str.replace(/\s*employees?\s*/i, '').trim();
}

function updateCompanyMetaDisplay() {
  const parts = [];
  const companyName = companyEl?.textContent?.trim();
  if (externalCompanyEditEnabled) {
    parts.push(`<input type="text" class="meta-company-input" value="${(companyName || '').replace(/"/g, '&quot;')}" placeholder="Enter company..." />`);
  } else if (companyName) {
    parts.push(`<span class="meta-company">${companyName}</span>`);
  }
  if (currentEmployeeCount) {
    parts.push(`<span class="emp-count-chip" title="Click to edit">&#128101; ${currentEmployeeCount}</span>`);
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
        parts.push('<span class="meta-visa meta-visa-yes">Visa: &#9989; Yes</span>');
      } else if (currentVisaStatus === 'no') {
        parts.push('<span class="meta-visa meta-visa-no">Visa: &#10060; No</span>');
      } else {
        parts.push('<span class="meta-visa meta-visa-na">Visa: N/A</span>');
      }
    }
  }
  if (parts.length > 0) {
    let html = parts.join('<span class="meta-sep"> | </span>');
    if (_onJobPage) html += `<button class="copy-jd-chip" id="copyJdBtn">&#128203; JD</button><a class="copy-jd-chip" id="openJobBtn" href="${_currentJobUrl}" target="_blank">&#8599; Open</a>`;
    companyMetaEl.innerHTML = html;
    companyMetaEl.style.display = 'flex';
    if (_onJobPage) {
      document.getElementById('copyJdBtn').addEventListener('click', handleCopyJd);
    }

    const companyInput = companyMetaEl.querySelector('.meta-company-input');
    if (companyInput) {
      companyInput.addEventListener('input', () => {
        companyEl.textContent = companyInput.value.trim();
      });
    }

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
          if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
          }
          if (e.key === 'Escape') {
            updateCompanyMetaDisplay();
          }
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

function setExternalCompanyEdit(enabled) {
  externalCompanyEditEnabled = !!enabled;
  updateCompanyMetaDisplay();
}

function showVisaMeta(status) {
  currentVisaStatus = status;
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
        const pattern = /(\d[\d,]*(?:[-�]\d[\d,]*|\+)\s*employees)/i;
        const pathname = location.pathname || '';

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
    if (!result && attempt < 3) {
      await new Promise(r => setTimeout(r, 1200));
      return getEmployeeCountFromJobPage(tabId, attempt + 1);
    }
    return result;
  } catch {
    return null;
  }
}
