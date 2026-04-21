// ── Answer Question via Groq ──────────────────────────────────────────────────

const ANSWER_SERVER   = 'http://127.0.0.1:4545';
const ANSWER_GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

let _cleanedJD   = '';
let _jdPrepReady = false;
let _answerQCount = 0; // tracks question row IDs

async function _getGroqModel() {
  const d = await new Promise(r => chrome.storage.local.get(['myGroqModel'], r));
  return d.myGroqModel || 'llama-3.3-70b-versatile';
}

// ── Groq direct call ──────────────────────────────────────────────────────────

async function _groqDirect(messages, groqKey, maxTokens = 350) {
  const model = await _getGroqModel();
  const res = await fetch(ANSWER_GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

// ── Question rows ─────────────────────────────────────────────────────────────

function _addQuestionRow(question = '') {
  const id = ++_answerQCount;
  const list = document.getElementById('answerQuestionsList');
  const row = document.createElement('div');
  row.className = 'answer-q-row';
  row.dataset.qid = id;
  row.innerHTML = `
    <div class="answer-q-input-wrap">
      <textarea class="answer-q-input" rows="2" placeholder="e.g. What makes you uniquely qualified for this role?">${question}</textarea>
      <button class="answer-q-remove" title="Remove">✕</button>
    </div>
    <div class="answer-q-output-wrap" style="display:none">
      <textarea class="answer-q-output" rows="4" readonly></textarea>
      <button class="answer-q-copy">📋 Copy</button>
    </div>
  `;
  row.querySelector('.answer-q-remove').addEventListener('click', () => {
    row.remove();
  });
  row.querySelector('.answer-q-copy').addEventListener('click', () => {
    const text = row.querySelector('.answer-q-output').value;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const btn = row.querySelector('.answer-q-copy');
      btn.textContent = '✓ Copied';
      setTimeout(() => { btn.textContent = '📋 Copy'; }, 1500);
    });
  });
  list.appendChild(row);
  row.querySelector('.answer-q-input').focus();
}

// ── Pre-clean JD in background ────────────────────────────────────────────────

async function _prepareJD(rawJD, groqKey) {
  if (!rawJD) return '';
  const messages = [
    {
      role: 'system',
      content: `You are a job description summarizer. Extract only what's relevant for answering application questions:
1. Role summary (1-2 sentences)
2. Key required skills and technologies
3. Years of experience required
4. Main responsibilities (bullet points)
Remove all fluff: benefits, company background, DEI statements, application instructions. Return plain text only.`,
    },
    { role: 'user', content: rawJD },
  ];
  try {
    const res = await fetch(`${ANSWER_SERVER}/answer-prep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawJD }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) { const d = await res.json(); if (d.cleaned) return d.cleaned; }
  } catch {}
  if (!groqKey) return rawJD;
  try { return await _groqDirect(messages, groqKey, 512); } catch { return rawJD; }
}

// ── Open modal ────────────────────────────────────────────────────────────────

globalThis.openAnswerModal = async function () {
  const modal = document.getElementById('answerModal');
  if (!modal) return;

  _cleanedJD   = '';
  _jdPrepReady = false;
  _answerQCount = 0;
  document.getElementById('answerQuestionsList').innerHTML = '';
  document.getElementById('answerStatus').textContent = '⏳ Preparing JD…';

  modal.classList.add('open');
  _addQuestionRow(); // start with one empty row

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const m = (activeTab?.url || '').match(/currentJobId=(\d+)|\/jobs\/view\/(\d+)/);
  const jobId = m ? (m[1] || m[2]) : null;
  const rawJD = (jobId && _jobJDCache?.[jobId]) || '';

  const d = await new Promise(r => chrome.storage.local.get(['myGroqKey'], r));
  const groqKey = (d.myGroqKey || '').trim();

  if (!rawJD) {
    _jdPrepReady = true;
    document.getElementById('answerStatus').textContent = '⚠ No cached JD — answers will use profile only.';
    return;
  }

  _cleanedJD   = await _prepareJD(rawJD, groqKey);
  _jdPrepReady = true;
  document.getElementById('answerStatus').textContent = '✓ JD ready. Add your questions and click Generate All.';
};

// ── Generate all answers ──────────────────────────────────────────────────────

async function _generateAll() {
  const rows = [...document.querySelectorAll('.answer-q-row')];
  const questions = rows.map(r => r.querySelector('.answer-q-input').value.trim()).filter(Boolean);

  if (!questions.length) {
    document.getElementById('answerStatus').textContent = 'Add at least one question.';
    return;
  }

  const d = await new Promise(r => chrome.storage.local.get(['myProfileText', 'myGroqKey'], r));
  const profileText = (d.myProfileText || '').trim();
  const groqKey     = (d.myGroqKey     || '').trim();

  if (!profileText) {
    document.getElementById('answerStatus').textContent = '⚠ No profile saved. Go to Jobs → Options → Settings.';
    return;
  }

  const generateBtn = document.getElementById('answerGenerateBtn');
  const statusEl    = document.getElementById('answerStatus');
  generateBtn.disabled = true;

  const jdSection = _cleanedJD
    ? `\n\nJob Description (for context — do not quote verbatim):\n${_cleanedJD}`
    : '';

  const systemPrompt = `You ghostwrite job application answers for a real person. Write exactly how a human would type it — casual, direct, confident, no fluff. Use their actual experience from the profile. 2-3 sentences max unless the question genuinely needs more. Rules: no "I am passionate", no "leverage", no "synergy", no corporate speak, no filler phrases like "I believe" or "I feel". Don't start with "I". Don't sound like ChatGPT wrote it. Just answer the question plainly like you're talking to someone.`;

  const model = await _getGroqModel();

  for (let i = 0; i < rows.length; i++) {
    const row      = rows[i];
    const question = row.querySelector('.answer-q-input').value.trim();
    if (!question) continue;

    statusEl.textContent = `Generating ${i + 1} of ${questions.length}…`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `My profile:\n${profileText}${jdSection}\n\nQuestion: ${question}` },
    ];

    try {
      let answer = null;

      // Try server first
      try {
        const res = await fetch(`${ANSWER_SERVER}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, profileText, jdText: _cleanedJD, model }),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) { const data = await res.json(); answer = data.answer || null; }
      } catch {}

      // Fallback: direct Groq
      if (!answer) {
        if (!groqKey) throw new Error('Server not running and no Groq API key in Settings.');
        answer = await _groqDirect(messages, groqKey, 350);
      }

      if (!answer) throw new Error('No response from Groq.');

      const outputWrap = row.querySelector('.answer-q-output-wrap');
      const outputEl   = row.querySelector('.answer-q-output');
      outputEl.value = answer;
      outputWrap.style.display = '';
    } catch (err) {
      const outputWrap = row.querySelector('.answer-q-output-wrap');
      const outputEl   = row.querySelector('.answer-q-output');
      outputEl.value = `⚠ ${err.message}`;
      outputWrap.style.display = '';
    }
  }

  statusEl.textContent = `✓ Done — ${questions.length} answer${questions.length > 1 ? 's' : ''} generated.`;
  generateBtn.disabled = false;
}

// ── Wire buttons ──────────────────────────────────────────────────────────────

document.getElementById('answerGenerateBtn')?.addEventListener('click', _generateAll);
document.getElementById('answerAddQuestionBtn')?.addEventListener('click', () => _addQuestionRow());
document.getElementById('answerCancelBtn')?.addEventListener('click', () => {
  document.getElementById('answerModal').classList.remove('open');
});
document.getElementById('answerModal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('answerModal'))
    document.getElementById('answerModal').classList.remove('open');
});
