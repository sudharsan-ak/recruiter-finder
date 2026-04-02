const fs = require('fs');
const path = require('path');
const http = require('http');

const outputArg = process.argv[2];
const portArg = Number(process.argv[3] || 4545);

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

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/jd') {
    send(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 5 * 1024 * 1024) {
      req.destroy();
    }
  });

  req.on('end', () => {
    try {
      const payload = raw ? JSON.parse(raw) : {};
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (!text.trim()) {
        send(res, 400, { ok: false, error: 'Missing text payload' });
        return;
      }

      const existing = fs.existsSync(outputFile)
        ? fs.readFileSync(outputFile, 'utf8')
        : '';
      const separator = '\n\n\n\n';
      const trimmedText = text.replace(/^\n+/, '');
      const nextText = existing.length === 0
        ? trimmedText
        : `${existing.replace(/\n*$/, '')}${separator}${trimmedText}`;

      fs.writeFileSync(outputFile, nextText, 'utf8');
      console.log(`[${new Date().toISOString()}] Wrote JD to ${outputFile}`);
      send(res, 200, { ok: true, outputFile });
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
  console.log(`JD writer listening at http://127.0.0.1:${port}/jd`);
  console.log(`Writing latest JD to ${outputFile}`);
});
