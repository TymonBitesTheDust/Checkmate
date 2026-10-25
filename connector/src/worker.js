// Checkmate connector for Claude: a remote MCP server that runs on Cloudflare Workers.
//
// It lets Claude (claude.ai, the desktop and mobile apps, and Claude Code) read and change
// your Checkmate tasks and calendar. Claude signs in with OAuth: you're sent to a page
// served by this Worker, sign in with your Checkmate (Firebase) email and password, and
// the Worker hands Claude a token. Everything is read from and written to your own
// Firebase project as you, so your Firestore rules apply and the app syncs the changes.
//
// The Worker keeps no data of its own. Tokens are sealed with CONFIG.secret.
import { apis, signIn, refresh, UserDb, FirebaseError, signInMessage } from './firebase.js';
import { seal, unseal, mac, pkceOk, randomId, sameText } from './seal.js';
import { toolList, findTool, callTool, ToolError, AccessError, CONNECTOR_ID, SERVER_INSTRUCTIONS } from './tools.js';
import { consentPage, messagePage, homePage, langOf, words } from './pages.js';

// Filled in by Checkmate (Settings → Claude → Copy connector code).
const CONFIG = /*CHECKMATE_CONFIG*/ { apiKey: '', projectId: '', secret: '' } /*END_CHECKMATE_CONFIG*/;

const VERSION = '1.0.0';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const CODE_LIFE = 5 * 60 * 1000;
const PAGE_LIFE = 30 * 60 * 1000;
const SCOPE = 'checkmate';

const ready = () => !!(CONFIG.apiKey && CONFIG.projectId && CONFIG.secret && CONFIG.secret.length >= 16);

// ---------- responses ----------

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
  'access-control-max-age': '86400',
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...headers } });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}

const oauthError = (error, description, status = 400, headers = {}) => json({ error, error_description: description }, status, headers);

function redirectTo(uri, params) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { location: u.toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

// ---------- OAuth ----------

// Claude's hosted apps come back to claude.ai; Claude Code (and other local apps) use a
// loopback address on any port.
function redirectKind(uri) {
  let u;
  try {
    u = new URL(uri);
  } catch {
    return null;
  }
  if (u.hash || u.username || u.password) return null;
  if (u.protocol === 'https:' && (u.hostname === 'claude.ai' || u.hostname === 'claude.com') && u.pathname === '/api/mcp/auth_callback') return 'claude';
  if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return 'loopback';
  return null;
}

function resourceMeta(origin, path) {
  return {
    resource: resourceUrl(origin, path),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Checkmate',
    resource_documentation: `${origin}/`,
  };
}

function serverMeta(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    revocation_endpoint: `${origin}/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [SCOPE, 'offline_access'],
    client_id_metadata_document_supported: true,
    service_documentation: `${origin}/`,
  };
}

// The MCP endpoint is /mcp; the bare address works too, with metadata that names it.
const resourceUrl = (origin, path) => (path === '/' ? origin : `${origin}/mcp`);

const unauthorized = (origin, path, error, description) =>
  json(
    { error: error || 'unauthorized', error_description: description || 'Sign in to Checkmate to use this connector.' },
    401,
    {
      'www-authenticate': `Bearer ${error ? `error="${error}", error_description="${description || ''}", ` : ''}resource_metadata="${origin}/.well-known/oauth-protected-resource${path === '/' ? '' : '/mcp'}", scope="${SCOPE}"`,
    },
  );

async function register(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return oauthError('invalid_client_metadata', 'Send the client metadata as JSON.');
  }
  const uris = Array.isArray(body && body.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length || uris.some((u) => typeof u !== 'string' || !redirectKind(u))) {
    return oauthError('invalid_redirect_uri', 'Only Claude (https://claude.ai/api/mcp/auth_callback) and apps on this computer (http://localhost) can connect.');
  }
  const method = ['client_secret_post', 'client_secret_basic'].includes(body.token_endpoint_auth_method) ? body.token_endpoint_auth_method : 'none';
  const clientId = `cmk_${randomId(12)}`;
  const out = {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: typeof body.client_name === 'string' ? body.client_name.slice(0, 100) : 'Claude',
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: method,
    scope: SCOPE,
  };
  if (method !== 'none') {
    out.client_secret = await mac(CONFIG.secret, `client:${clientId}`);
    out.client_secret_expires_at = 0;
  }
  return json(out, 201);
}

async function authorizeStart(request, url) {
  const lang = langOf(request);
  const w = words(lang);
  const q = url.searchParams;
  const ru = q.get('redirect_uri') || '';
  const kind = redirectKind(ru);
  if (!kind) return html(messagePage({ lang, title: w.title, text: w.badRedirect }), 400);
  if (q.get('response_type') !== 'code') return redirectTo(ru, { error: 'unsupported_response_type', state: q.get('state') });
  if (!q.get('code_challenge') || q.get('code_challenge_method') !== 'S256') {
    return redirectTo(ru, { error: 'invalid_request', error_description: 'PKCE with S256 is required.', state: q.get('state') });
  }
  if (!q.get('client_id')) return redirectTo(ru, { error: 'invalid_request', error_description: 'client_id is missing.', state: q.get('state') });
  const req = await seal(CONFIG.secret, 'request', {
    cid: q.get('client_id'),
    ru,
    cc: q.get('code_challenge'),
    st: q.get('state') || '',
    exp: Date.now() + PAGE_LIFE,
  });
  return html(consentPage({ lang, req, host: new URL(ru).host, loopback: kind === 'loopback', projectId: CONFIG.projectId }));
}

async function authorizeFinish(request, env) {
  const lang = langOf(request);
  const w = words(lang);
  const form = await request.formData();
  const r = await unseal(CONFIG.secret, 'request', String(form.get('req') || ''));
  if (!r || r.expired || !redirectKind(r.ru)) return html(messagePage({ lang, title: w.title, text: w.expired }), 400);
  const page = (error, email) => html(consentPage({ lang, req: String(form.get('req')), host: new URL(r.ru).host, loopback: redirectKind(r.ru) === 'loopback', projectId: CONFIG.projectId, email, error }), 400);
  if (form.get('action') === 'cancel') return redirectTo(r.ru, { error: 'access_denied', error_description: 'You chose Cancel.', state: r.st });
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  if (!email || !password) return page(lang === 'zh' ? '請輸入電郵和密碼。' : 'Enter your email and password.', email);
  const api = apis(CONFIG, env);
  let auth;
  try {
    auth = await signIn(api, email, password);
  } catch (e) {
    return page(zhSignIn(lang, e) || signInMessage(e), email);
  }
  const db = new UserDb(api, auth.uid, auth.idToken);
  let conn;
  try {
    conn = await db.get(CONNECTOR_ID);
  } catch (e) {
    return page(firestoreMessage(e), email);
  }
  if (!conn || conn.deleted || conn.type !== 'connector') return page(w.noConn, email);
  // Note when Claude was connected so the app can show it.
  try {
    await db.save([{ ...conn, authAt: Date.now(), authEmail: auth.email, updatedAt: Math.max(Date.now(), (conn.updatedAt || 0) + 1), dev: 'claude' }]);
  } catch {}
  const code = await seal(CONFIG.secret, 'code', {
    u: auth.uid, r: auth.refreshToken, i: auth.idToken, ie: auth.exp, g: conn.gen, cc: r.cc, ru: r.ru, cid: r.cid, exp: Date.now() + CODE_LIFE,
  });
  return redirectTo(r.ru, { code, state: r.st });
}

function zhSignIn(lang, e) {
  if (lang !== 'zh') return null;
  const c = (e && e.code) || '';
  if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL/.test(c)) return '電郵或密碼不正確。請使用你登入 Checkmate 的帳戶。';
  if (/TOO_MANY_ATTEMPTS/.test(c)) return '嘗試次數太多，請等一分鐘再試。';
  return null;
}

function firestoreMessage(e) {
  if (e instanceof FirebaseError && /PERMISSION_DENIED|^403$/.test(e.code)) return 'Your Firestore rules blocked the connector. Use the rules from Checkmate’s sync guide (Settings → Sync).';
  if (e instanceof FirebaseError && /NOT_FOUND|^404$/.test(e.code)) return 'There’s no Firestore database in this Firebase project yet.';
  return `Couldn’t reach your Firebase project (${(e && e.message) || 'unknown error'}).`;
}

async function readTokenRequest(request) {
  const type = request.headers.get('content-type') || '';
  let p = {};
  if (type.includes('application/json')) {
    try {
      p = await request.json();
    } catch {}
  } else {
    const text = await request.text();
    p = Object.fromEntries(new URLSearchParams(text));
  }
  const basic = /^Basic\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  if (basic) {
    try {
      const [id, secret] = atob(basic[1]).split(':').map(decodeURIComponent);
      p.client_id = p.client_id || id;
      p.client_secret = secret;
    } catch {}
  }
  return p;
}

async function issueTokens(uid, idToken, idExp, refreshToken, gen) {
  const exp = Math.max(Date.now() + 60000, idExp - 60000);
  const access = await seal(CONFIG.secret, 'access', { u: uid, i: idToken, g: gen, exp });
  const refreshTok = await seal(CONFIG.secret, 'refresh', { u: uid, r: refreshToken, g: gen, at: Date.now() });
  return json({ access_token: access, token_type: 'Bearer', expires_in: Math.floor((exp - Date.now()) / 1000), refresh_token: refreshTok, scope: SCOPE });
}

async function token(request, env) {
  const p = await readTokenRequest(request);
  if (p.client_secret && p.client_id && !String(p.client_id).startsWith('http')) {
    if (!sameText(String(p.client_secret), await mac(CONFIG.secret, `client:${p.client_id}`))) return oauthError('invalid_client', 'The client secret is wrong.', 401);
  }
  const api = apis(CONFIG, env);
  if (p.grant_type === 'authorization_code') {
    const c = await unseal(CONFIG.secret, 'code', String(p.code || ''));
    if (!c) return oauthError('invalid_grant', 'The sign-in code isn’t valid.');
    if (c.expired) return oauthError('invalid_grant', 'The sign-in code has expired. Connect again.');
    if (p.redirect_uri && p.redirect_uri !== c.ru) return oauthError('invalid_grant', 'redirect_uri doesn’t match.');
    if (p.client_id && p.client_id !== c.cid) return oauthError('invalid_grant', 'client_id doesn’t match.');
    if (!(await pkceOk(p.code_verifier, c.cc))) return oauthError('invalid_grant', 'The PKCE code_verifier doesn’t match.');
    return issueTokens(c.u, c.i, c.ie, c.r, c.g);
  }
  if (p.grant_type === 'refresh_token') {
    const r = await unseal(CONFIG.secret, 'refresh', String(p.refresh_token || ''));
    if (!r) return oauthError('invalid_grant', 'The refresh token isn’t valid. Connect again.');
    let fresh;
    try {
      fresh = await refresh(api, r.r);
    } catch (e) {
      if (e instanceof FirebaseError && e.status >= 400 && e.status < 500) return oauthError('invalid_grant', 'Your Checkmate sign-in has ended (for example, the password changed). Connect again.');
      return oauthError('temporarily_unavailable', 'Couldn’t reach Firebase. Try again shortly.', 503);
    }
    let conn;
    try {
      conn = await new UserDb(api, fresh.uid, fresh.idToken).get(CONNECTOR_ID);
    } catch (e) {
      if (e instanceof FirebaseError && e.status >= 500) return oauthError('temporarily_unavailable', 'Couldn’t reach Firestore. Try again shortly.', 503);
      return oauthError('invalid_grant', firestoreMessage(e));
    }
    if (!conn || conn.deleted || conn.gen !== r.g) return oauthError('invalid_grant', 'Claude’s access was turned off in Checkmate. Connect again.');
    return issueTokens(fresh.uid, fresh.idToken, fresh.exp, fresh.refreshToken, r.g);
  }
  return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

// ---------- MCP ----------

const result = (id, r) => ({ jsonrpc: '2.0', id, result: r });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handleRpc(msg, session) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    // a client's reply to something we never asked: nothing to do
    if (msg && msg.jsonrpc === '2.0' && ('result' in msg || 'error' in msg)) return null;
    return rpcError(msg && msg.id, -32600, 'Invalid request');
  }
  const note = msg.id === undefined;
  const p = msg.params || {};
  switch (msg.method) {
    case 'initialize': {
      const want = p.protocolVersion;
      return result(msg.id, {
        protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'checkmate', title: 'Checkmate', version: VERSION },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case 'ping':
      return note ? null : result(msg.id, {});
    case 'tools/list':
      return result(msg.id, { tools: toolList() });
    case 'resources/list':
      return result(msg.id, { resources: [] });
    case 'prompts/list':
      return result(msg.id, { prompts: [] });
    case 'tools/call': {
      const tool = findTool(p.name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${p.name}`);
      const args = p.arguments && typeof p.arguments === 'object' && !Array.isArray(p.arguments) ? p.arguments : {};
      try {
        const out = await callTool(tool, args, session);
        return result(msg.id, { content: [{ type: 'text', text: JSON.stringify(out) }] });
      } catch (e) {
        if (e instanceof AccessError) throw e;
        if (e instanceof ToolError) return result(msg.id, { content: [{ type: 'text', text: e.message }], isError: true });
        if (e instanceof FirebaseError) {
          if (e.status === 401 || /UNAUTHENTICATED/.test(e.code)) throw new AccessError('sign-in expired');
          return result(msg.id, { content: [{ type: 'text', text: firestoreMessage(e) }], isError: true });
        }
        console.error('tool failed', p.name, e && e.stack);
        return result(msg.id, { content: [{ type: 'text', text: `Something went wrong in the Checkmate connector: ${(e && e.message) || e}` }], isError: true });
      }
    }
    default:
      if (note || msg.method.startsWith('notifications/')) return null;
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

async function mcp(request, env, origin, path) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  if (!m) return unauthorized(origin, path);
  const a = await unseal(CONFIG.secret, 'access', m[1].trim());
  if (!a) return unauthorized(origin, path, 'invalid_token', 'The access token is not valid.');
  if (a.expired) return unauthorized(origin, path, 'invalid_token', 'The access token has expired.');
  let body;
  try {
    body = await request.json();
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }
  const api = apis(CONFIG, env);
  const session = { gen: a.g, db: () => new UserDb(api, a.u, a.i) };
  const batch = Array.isArray(body);
  const msgs = batch ? body : [body];
  if (!msgs.length) return json(rpcError(null, -32600, 'Empty batch'), 400);
  const replies = [];
  try {
    for (const msg of msgs) {
      const r = await handleRpc(msg, session);
      if (r) replies.push(r);
    }
  } catch (e) {
    if (e instanceof AccessError) return unauthorized(origin, path, 'invalid_token', 'Checkmate needs you to connect again.');
    throw e;
  }
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? replies : replies[0]);
}

// ---------- routing ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = url.origin;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (path === '/health') {
        return json({ ok: ready(), app: 'checkmate-connector', version: VERSION, projectId: CONFIG.projectId || null, mcp: `${origin}/mcp` });
      }
      if (path === '/' && method === 'GET') {
        return html(homePage({ lang: langOf(request), mcpUrl: `${origin}/mcp`, projectId: CONFIG.projectId, version: VERSION, ready: ready() }));
      }
      if (!ready()) return json({ error: 'not_configured', error_description: words('en').notSetUp }, 503);
      if (path.startsWith('/.well-known/oauth-protected-resource')) return json(resourceMeta(origin, path.endsWith('/mcp') ? '/mcp' : '/'));
      if (path.startsWith('/.well-known/oauth-authorization-server') || path.startsWith('/.well-known/openid-configuration')) return json(serverMeta(origin));
      if (path === '/register' && method === 'POST') return register(request);
      if (path === '/authorize' && method === 'GET') return authorizeStart(request, url);
      if (path === '/authorize' && method === 'POST') return authorizeFinish(request, env);
      if (path === '/token' && method === 'POST') return token(request, env);
      if (path === '/revoke' && method === 'POST') return json({});
      if (path === '/mcp' || path === '/') {
        if (method === 'POST') return mcp(request, env, origin, path);
        if (method === 'GET' && /text\/html/.test(request.headers.get('accept') || '')) {
          return html(homePage({ lang: langOf(request), mcpUrl: `${origin}/mcp`, projectId: CONFIG.projectId, version: VERSION, ready: true }));
        }
        return new Response('Use POST for MCP messages.', { status: 405, headers: { allow: 'POST', ...CORS } });
      }
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      console.error(e && e.stack);
      return json({ error: 'server_error', error_description: (e && e.message) || 'Unexpected error' }, 500);
    }
  },
};
