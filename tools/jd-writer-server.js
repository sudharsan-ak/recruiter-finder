const fs   = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// Load .env from repo root
try {
  const envFile = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
  envFile.split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
} catch {}

// ── Config ────────────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''; // set via .env or GROQ_API_KEY env var
const GROQ_MODEL   = 'llama-3.1-8b-instant';
// ─────────────────────────────────────────────────────────────────────────────

const outputArg = process.argv[2];
const portArg   = Number(process.argv[3] || 4545);

if (!outputArg) {
  console.error('Usage: node tools/jd-writer-server.js "<output-file>" [port]');
  process.exit(1);
}

const outputFile = path.resolve(outputArg);
const port = Number.isFinite(portArg) && portArg > 0 ? portArg : 4545;

fs.mkdirSync(path.dirname(outputFile), { recursive: true });

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

async function cleanJdWithGroq(rawText) {
  if (!GROQ_API_KEY || GROQ_API_KEY === 'YOUR_GROQ_API_KEY') return null;

  const body = JSON.stringify({
    model: GROQ_MODEL,
    messages: [
      {
        role: 'system',
        content: `You are a job description cleaner. Extract and return in this exact order:

1. A brief role summary (1-2 sentences max)
2. A heading "Skills:" followed by two sub-sections:
   - "Required:" with a bullet list of hard requirements (must-have skills / tech)
   - "Nice to have:" with a bullet list of preferred / bonus skills (omit this sub-section if none mentioned)
3. Years of experience required (one line, e.g. "Experience: 5+ years")
4. A heading "Responsibilities:" followed by a bullet list of key responsibilities
5. Then these three lines back-to-back with NO blank lines between them:
   Location: City, State - Onsite/Remote/Hybrid (if source says "Off (onsite)" use Onsite, "On (remote)" use Remote)
   Visa: Yes / No / Not mentioned
   Education: <requirement>

Remove everything else: company background, mission/values, benefits, perks, salary ranges, DEI statements, equal opportunity boilerplate, application instructions, and any other fluff.
Do NOT repeat the job title at the top — start directly with the role summary.
Return only plain text. No commentary.`,
      },
      { role: 'user', content: rawText },
    ],
    temperature: 0,
    max_tokens: 1024,
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const cleaned = json?.choices?.[0]?.message?.content?.trim();
          if (!cleaned) console.error('[Groq] Response:', JSON.stringify(json).slice(0, 300));
          resolve(cleaned || null);
        } catch (e) {
          console.error('[Groq] Parse error:', e.message, data.slice(0, 200));
          resolve(null);
        }
      });
    });

    req.on('error', (e) => { console.error('[Groq] Request error:', e.message); resolve(null); });
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function answerQuestionWithGroq(question, profileText, jdText, model) {
  if (!GROQ_API_KEY || GROQ_API_KEY === 'YOUR_GROQ_API_KEY') return null;

  const jdSection = jdText
    ? `\n\nJob Description (for context — do not quote verbatim):\n${jdText.slice(0, 3000)}`
    : '';

  const body = JSON.stringify({
    model: model || GROQ_MODEL,
    messages: [
      {
        role: 'system',
        content: `You ghostwrite job application answers for a real person. Write exactly how a human would type it — casual, direct, confident, no fluff. Use their actual experience from the profile. 2-3 sentences max unless the question genuinely needs more. Rules: no "I am passionate", no "leverage", no "synergy", no corporate speak, no filler phrases like "I believe" or "I feel". Don't start with "I". Don't sound like ChatGPT wrote it. Just answer the question plainly like you're talking to someone.`,
      },
      {
        role: 'user',
        content: `My profile:\n${profileText}${jdSection}\n\nQuestion: ${question}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 300,
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const answer = json?.choices?.[0]?.message?.content?.trim();
          if (!answer) console.error('[Groq/answer] Response:', JSON.stringify(json).slice(0, 300));
          resolve(answer || null);
        } catch (e) {
          console.error('[Groq/answer] Parse error:', e.message, data.slice(0, 200));
          resolve(null);
        }
      });
    });

    req.on('error', (e) => { console.error('[Groq/answer] Request error:', e.message); resolve(null); });
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 200, { ok: true });
    return;
  }

  const urlPath = req.url.split('?')[0].replace(/\/$/, '') || '/';

  if (req.method === 'POST' && urlPath === '/answer-prep') {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; if (raw.length > 2 * 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const payload = raw ? JSON.parse(raw) : {};
        const rawJD   = typeof payload.rawJD === 'string' ? payload.rawJD.trim() : '';
        if (!rawJD) { send(res, 400, { ok: false, error: 'Missing rawJD' }); return; }
        const cleaned = await cleanJdWithGroq(rawJD);
        if (!cleaned) { send(res, 500, { ok: false, error: 'Groq unavailable' }); return; }
        console.log(`[${new Date().toISOString()}] Prep-cleaned JD for answer (${rawJD.length} → ${cleaned.length} chars)`);
        send(res, 200, { ok: true, cleaned });
      } catch (error) {
        send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
    req.on('error', error => send(res, 500, { ok: false, error: error.message }));
    return;
  }

  if (req.method === 'POST' && urlPath === '/answer') {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; if (raw.length > 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const payload     = raw ? JSON.parse(raw) : {};
        const question    = typeof payload.question    === 'string' ? payload.question.trim()    : '';
        const profileText = typeof payload.profileText === 'string' ? payload.profileText.trim() : '';
        const jdText      = typeof payload.jdText      === 'string' ? payload.jdText.trim()      : '';
        const model       = typeof payload.model       === 'string' ? payload.model.trim()       : '';
        if (!question || !profileText) {
          send(res, 400, { ok: false, error: 'Missing question or profileText' });
          return;
        }
        const answer = await answerQuestionWithGroq(question, profileText, jdText, model);
        if (!answer) { send(res, 500, { ok: false, error: 'Groq unavailable or no key set' }); return; }
        console.log(`[${new Date().toISOString()}] Answered question (${question.length} chars)`);
        send(res, 200, { ok: true, answer });
      } catch (error) {
        send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
    req.on('error', error => send(res, 500, { ok: false, error: error.message }));
    return;
  }

  if (req.method !== 'POST' || urlPath !== '/jd') {
    send(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 5 * 1024 * 1024) req.destroy();
  });

  req.on('end', async () => {
    try {
      const payload  = raw ? JSON.parse(raw) : {};
      const rawText  = typeof payload.text === 'string' ? payload.text : '';
      if (!rawText.trim()) {
        send(res, 400, { ok: false, error: 'Missing text payload' });
        return;
      }

      const cleaned = await cleanJdWithGroq(rawText);
      if (cleaned) {
        console.log(`[${new Date().toISOString()}] Groq cleaned JD (${rawText.length} → ${cleaned.length} chars)`);
      } else {
        console.log(`[${new Date().toISOString()}] Groq unavailable — using raw text`);
      }

      const company = typeof payload.company === 'string' ? payload.company : '';
      const role    = typeof payload.role    === 'string' ? payload.role    : '';
      let body      = (cleaned || rawText).replace(/^\n+/, '');
      // Strip duplicate title if Groq repeats it as the first line
      const firstLine = body.split('\n')[0].trim();
      if (role && firstLine.toLowerCase() === role.toLowerCase()) {
        body = body.slice(firstLine.length).replace(/^\n+/, '');
      }
      const existing    = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '';
      const headerNums  = existing.length === 0 ? [] : [...existing.matchAll(/^(\d+)\. Company -/gm)].map(m => parseInt(m[1], 10));
      const entryNum    = headerNums.length === 0 ? 1 : Math.max(...headerNums) + 1;
      const header      = `${entryNum}. Company - ${company}\nRole - ${role}`;
      const textToWrite = `${header}\n\n${body}`.trim();
      const separator   = '\n\n\n';
      const nextText    = existing.trim().length === 0
        ? textToWrite
        : `${existing.replace(/\s*$/, '')}${separator}${textToWrite}`;

      fs.writeFileSync(outputFile, nextText, 'utf8');
      console.log(`[${new Date().toISOString()}] Wrote JD to ${outputFile}`);
      send(res, 200, { ok: true, outputFile, geminiCleaned: !!cleaned });
    } catch (error) {
      send(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  req.on('error', error => {
    send(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`JD writer listening at http://127.0.0.1:${port}`);
  console.log(`  POST /jd          — clean + write JD to file`);
  console.log(`  POST /answer-prep — pre-clean JD for answer modal`);
  console.log(`  POST /answer      — answer application questions`);
  console.log(`Writing to: ${outputFile}`);
  console.log(`Groq: ${GROQ_API_KEY ? 'enabled' : 'DISABLED (no key set)'}`);
});
