// Runs the Claude connector for tests, in Node or in workerd (the Cloudflare Workers
// runtime, through `wrangler dev`), and connects to it like Claude does: an MCP client
// that registers itself, opens the sign-in page, signs in and swaps the code for tokens.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const SDK = '/home/claude/tools/mcp/node_modules/@modelcontextprotocol/sdk/dist/cjs';
const { Client } = require(`${SDK}/client/index.js`);
const { StreamableHTTPClientTransport } = require(`${SDK}/client/streamableHttp.js`);
const { UnauthorizedError } = require(`${SDK}/client/auth.js`);

const ROOT = path.resolve(__dirname, '..');
const SCRATCH = process.env.SCRATCH || '/tmp/claude-0/-home-claude/ea44315e-fc01-53a8-96ed-f547afb31a4f/scratchpad';

// The same substitution the app makes when you choose "Copy connector code".
function personalise(code, cfg) {
  const a = code.indexOf('/*CHECKMATE_CONFIG*/');
  const b = code.indexOf('/*END_CHECKMATE_CONFIG*/');
  if (a < 0 || b < 0) throw new Error('no CONFIG markers');
  return code.slice(0, a + '/*CHECKMATE_CONFIG*/'.length) + JSON.stringify(cfg) + code.slice(b);
}

async function startWorker({ cfg, googleBase, runtime = process.env.RUNTIME || 'node', code }) {
  const raw = code || fs.readFileSync(path.join(ROOT, 'connector/dist/checkmate-connector.js'), 'utf8');
  const src = cfg ? personalise(raw, cfg) : raw;
  const file = path.join(SCRATCH, `connector-test-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(file, src);
  const env = { CM_GOOGLE_API: googleBase };
  if (runtime === 'node') {
    const http = require('http');
    const worker = (await import(pathToFileURL(file).href)).default;
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      try {
        const r = await worker.fetch(request, env, {});
        const h = {};
        r.headers.forEach((v, k) => (h[k] = v));
        res.writeHead(r.status, h);
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch (e) {
        res.writeHead(500);
        res.end(String(e && e.stack));
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { base: `http://127.0.0.1:${server.address().port}`, stop: () => server.close(), file };
  }
  // workerd through wrangler dev
  const port = 18700 + Math.floor(Math.random() * 800);
  const wr = spawn('/home/claude/tools/mcp/node_modules/.bin/wrangler', [
    'dev', file, '--port', String(port), '--ip', '127.0.0.1', '--compatibility-date', '2026-10-01',
    '--name', 'checkmate', '--var', `CM_GOOGLE_API:${googleBase}`, '--show-interactive-dev-session=false', '--log-level', 'warn',
  ], { env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' }, cwd: SCRATCH });
  let out = '';
  wr.stdout.on('data', (d) => (out += d));
  wr.stderr.on('data', (d) => (out += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok || r.status === 503) return { base, stop: () => wr.kill('SIGINT'), file, logs: () => out };
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  wr.kill('SIGKILL');
  throw new Error('wrangler dev did not start:\n' + out);
}

class Provider {
  constructor(redirect = 'http://localhost:3118/callback') {
    this.redirect = redirect;
    this.client = undefined;
    this.saved = undefined;
    this.verifier = undefined;
    this.authUrl = null;
  }
  get redirectUrl() {
    return this.redirect;
  }
  get clientMetadata() {
    return { client_name: 'Test client', redirect_uris: [this.redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  }
  clientInformation() {
    return this.client;
  }
  saveClientInformation(c) {
    this.client = c;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(t) {
    this.saved = t;
  }
  redirectToAuthorization(url) {
    this.authUrl = String(url);
  }
  saveCodeVerifier(v) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
}

const formValue = (page, name) => {
  const m = new RegExp(`name="${name}" value="([^"]*)"`).exec(page);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"') : null;
};

// What a person does on the sign-in page: returns the code from the redirect (or the page).
async function signInPage(authUrl, { email, password, action = 'allow', lang } = {}) {
  const page = await (await fetch(authUrl, { headers: lang ? { 'accept-language': lang } : {} })).text();
  const req = formValue(page, 'req');
  if (!req) return { page };
  const origin = new URL(authUrl).origin;
  const r = await fetch(`${origin}/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(lang ? { 'accept-language': lang } : {}) },
    body: new URLSearchParams({ req, email, password, action }),
  });
  const loc = r.headers.get('location');
  if (!loc) return { page: await r.text(), status: r.status, firstPage: page };
  const u = new URL(loc);
  return { location: loc, code: u.searchParams.get('code'), error: u.searchParams.get('error'), state: u.searchParams.get('state'), firstPage: page };
}

// Connects like Claude: 401 → discovery → registration → sign-in → tokens → MCP.
async function connect(base, { email, password, provider = new Provider() } = {}) {
  const url = new URL(`${base}/mcp`);
  let client = new Client({ name: 'checkmate-test', version: '1.0.0' });
  let transport = new StreamableHTTPClientTransport(url, { authProvider: provider });
  try {
    await client.connect(transport);
    return { client, provider, transport };
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
  }
  const s = await signInPage(provider.authUrl, { email, password });
  if (!s.code) throw new Error('sign-in failed: ' + (s.error || s.page));
  await transport.finishAuth(s.code);
  client = new Client({ name: 'checkmate-test', version: '1.0.0' });
  transport = new StreamableHTTPClientTransport(url, { authProvider: provider });
  await client.connect(transport);
  return { client, provider, transport };
}

async function call(client, name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content && r.content[0] && r.content[0].text;
  if (r.isError) return { error: text };
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

module.exports = { personalise, startWorker, Provider, connect, call, signInPage, formValue, Client, StreamableHTTPClientTransport, UnauthorizedError };
