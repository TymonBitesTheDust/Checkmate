// A stand-in for the Google APIs the Claude connector calls: Firebase Auth's REST API
// (sign in, refresh) and Firestore's REST API (batchGet, runQuery, commit). Documents are
// kept in the same `server.docs[uid][id]` shape the app's test double uses, so the app and
// the connector can share one "Firestore" in a test.
//
// It is strict where real Firestore is strict: tokens must be valid, users can only reach
// users/{their uid}/..., preconditions are checked, and queries that would need a
// composite index are refused, the way Firestore refuses them.
const http = require('http');

function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) {
    if (v.some(Array.isArray)) throw new Error('Firestore does not allow arrays inside arrays');
    return { arrayValue: v.length ? { values: v.map(encode) } : {} };
  }
  return { mapValue: { fields: fieldsOf(v) } };
}
const fieldsOf = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, encode(x)]));
function decode(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]));
  throw new Error('bad value ' + JSON.stringify(v));
}

// Firestore orders values by type first; range filters only match values of the same type.
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
function getPath(obj, path) {
  let cur = obj;
  for (const k of path.split('.')) {
    if (cur == null || typeof cur !== 'object' || !(k in cur)) return { missing: true };
    cur = cur[k];
  }
  return { value: cur };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function test(doc, f) {
  const got = getPath(doc, f.field.fieldPath);
  if (got.missing) return false;
  const want = decode(f.value);
  const v = got.value;
  switch (f.op) {
    case 'EQUAL': return same(v, want);
    case 'NOT_EQUAL': return v !== null && !same(v, want);
    case 'IN': return want.some((w) => same(v, w));
    case 'ARRAY_CONTAINS': return Array.isArray(v) && v.some((x) => same(x, want));
    default: {
      if (typeOf(v) !== typeOf(want) || v === null) return false;
      if (f.op === 'LESS_THAN') return v < want;
      if (f.op === 'LESS_THAN_OR_EQUAL') return v <= want;
      if (f.op === 'GREATER_THAN') return v > want;
      if (f.op === 'GREATER_THAN_OR_EQUAL') return v >= want;
      throw new Error('op ' + f.op);
    }
  }
}

function createFakeGoogle({ server, apiKey, project, deliver = () => {}, log = () => {} }) {
  server.users = server.users || {};
  server.docs = server.docs || {};
  server.clock = server.clock || 1_000_000;
  const ids = new Map(); // idToken -> { uid, exp }
  const refreshTokens = new Map(); // refreshToken -> uid
  const stats = { signIns: 0, refreshes: 0, queries: [], commits: 0, reads: 0, failNextCommit: null };
  let n = 0;
  const root = `projects/${project}/databases/(default)/documents`;
  const timeOf = (d) => new Date(Date.UTC(2026, 0, 1) + d.srv).toISOString();
  const docOut = (uid, id, d) => {
    const { srv, ...rest } = d;
    return { name: `${root}/users/${uid}/items/${id}`, fields: { ...fieldsOf(rest), srv: { timestampValue: timeOf(d) } }, createTime: timeOf(d), updateTime: timeOf(d) };
  };
  const mint = (uid, ttl = 3600) => {
    const t = `idt.${uid}.${++n}.${Math.random().toString(36).slice(2)}`;
    ids.set(t, { uid, exp: Date.now() + ttl * 1000 });
    return t;
  };
  const api = {
    stats,
    expireIdTokens() {
      for (const v of ids.values()) v.exp = 0;
    },
    revokeRefresh(uid) {
      for (const [k, v] of refreshTokens) if (v === uid) refreshTokens.delete(k);
    },
  };

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const fsError = (res, code, status, message) => send(res, code, { error: { code, status, message } });

  const httpServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    const url = new URL(req.url, 'http://x');
    const path = decodeURIComponent(url.pathname);
    try {
      // ----- Firebase Auth -----
      if (path === '/identitytoolkit/v1/accounts:signInWithPassword') {
        if (url.searchParams.get('key') !== apiKey) return send(res, 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } });
        const b = JSON.parse(raw);
        const u = server.users[b.email];
        stats.signIns++;
        if (!u || u.pw !== b.password) return send(res, 400, { error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } });
        const rt = `rt.${u.uid}.${++n}`;
        refreshTokens.set(rt, u.uid);
        return send(res, 200, { kind: 'identitytoolkit#VerifyPasswordResponse', localId: u.uid, email: b.email, idToken: mint(u.uid), refreshToken: rt, expiresIn: '3600', registered: true });
      }
      if (path === '/securetoken/v1/token') {
        if (url.searchParams.get('key') !== apiKey) return send(res, 400, { error: { code: 400, message: 'API key not valid.' } });
        const p = new URLSearchParams(raw);
        const uid = refreshTokens.get(p.get('refresh_token'));
        stats.refreshes++;
        if (p.get('grant_type') !== 'refresh_token' || !uid) return send(res, 400, { error: { code: 400, message: 'INVALID_REFRESH_TOKEN', status: 'INVALID_ARGUMENT' } });
        return send(res, 200, { access_token: 'x', expires_in: '3600', token_type: 'Bearer', refresh_token: p.get('refresh_token'), id_token: mint(uid), user_id: uid, project_id: '1' });
      }

      // ----- Firestore -----
      if (!path.startsWith('/firestore/v1/')) return send(res, 404, { error: { message: 'no such api' } });
      const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      const who = m && ids.get(m[1]);
      if (!who || who.exp < Date.now()) return fsError(res, 401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.');
      const rest = path.slice('/firestore/v1/'.length);
      const body = raw ? JSON.parse(raw) : {};
      const own = (uid) => uid === who.uid;
      const parseName = (name) => {
        const mm = new RegExp(`^${root.replace(/[()]/g, '\\$&')}/users/([^/]+)/items/([^/]+)$`).exec(name);
        if (!mm) throw Object.assign(new Error('bad name ' + name), { status: 400 });
        return { uid: mm[1], id: mm[2] };
      };

      if (rest === `${root}:batchGet`) {
        const out = [];
        for (const name of body.documents) {
          const { uid, id } = parseName(name);
          if (!own(uid)) return fsError(res, 403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.');
          const d = (server.docs[uid] || {})[id];
          stats.reads++;
          out.push(d ? { found: docOut(uid, id, d), readTime: new Date().toISOString() } : { missing: name, readTime: new Date().toISOString() });
        }
        return send(res, 200, out);
      }

      const q = new RegExp(`^${root.replace(/[()]/g, '\\$&')}/users/([^/]+):runQuery$`).exec(rest);
      if (q) {
        if (!own(q[1])) return fsError(res, 403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.');
        const sq = body.structuredQuery;
        if (!sq || !sq.from || sq.from[0].collectionId !== 'items') return fsError(res, 400, 'INVALID_ARGUMENT', 'bad query');
        const w = sq.where;
        const filters = !w ? [] : w.fieldFilter ? [w.fieldFilter] : w.compositeFilter.filters.map((f) => f.fieldFilter);
        // An inequality on one field may not be combined with a filter on another field
        // without a composite index (and no indexes exist in this project).
        const ineq = new Set(filters.filter((f) => !['EQUAL', 'IN', 'ARRAY_CONTAINS'].includes(f.op)).map((f) => f.field.fieldPath));
        const fieldsUsed = new Set(filters.map((f) => f.field.fieldPath));
        if (ineq.size > 1 || (ineq.size === 1 && fieldsUsed.size > 1) || sq.orderBy) {
          return fsError(res, 400, 'FAILED_PRECONDITION', 'The query requires an index.');
        }
        stats.queries.push(filters.map((f) => `${f.field.fieldPath} ${f.op}`).join(' & '));
        const docs = Object.entries(server.docs[q[1]] || {}).filter(([, d]) => filters.every((f) => test(d, f)));
        const limited = docs.slice(0, sq.limit || 1e9);
        stats.reads += Math.max(1, limited.length);
        const now = new Date().toISOString();
        return send(res, 200, limited.length ? limited.map(([id, d]) => ({ document: docOut(q[1], id, d), readTime: now })) : [{ readTime: now }]);
      }

      if (rest === `${root}:commit`) {
        stats.commits++;
        if (stats.failNextCommit) {
          const hook = stats.failNextCommit;
          stats.failNextCommit = null;
          hook();
        }
        const plan = [];
        for (const wr of body.writes) {
          const { uid, id } = parseName(wr.update.name);
          if (!own(uid)) return fsError(res, 403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.');
          const cur = (server.docs[uid] || {})[id];
          const pre = wr.currentDocument;
          if (pre && pre.exists === false && cur) return fsError(res, 409, 'ALREADY_EXISTS', `Document already exists: ${wr.update.name}`);
          if (pre && pre.exists === true && !cur) return fsError(res, 404, 'NOT_FOUND', 'No document to update');
          if (pre && pre.updateTime && (!cur || timeOf(cur) !== pre.updateTime)) return fsError(res, 400, 'FAILED_PRECONDITION', 'the stored version does not match the required base version.');
          const data = Object.fromEntries(Object.entries(wr.update.fields).map(([k, v]) => [k, decode(v)]));
          const t = (wr.updateTransforms || []).find((x) => x.fieldPath === 'srv');
          if (!t || t.setToServerValue !== 'REQUEST_TIME') return fsError(res, 400, 'INVALID_ARGUMENT', 'expected srv = REQUEST_TIME (test check)');
          plan.push({ uid, id, data });
        }
        const changed = {};
        for (const p of plan) {
          const d = { ...p.data, srv: ++server.clock };
          (server.docs[p.uid] = server.docs[p.uid] || {})[p.id] = d;
          (changed[p.uid] = changed[p.uid] || []).push(d);
        }
        log(`commit ${plan.length}`);
        setTimeout(() => Object.entries(changed).forEach(([uid, docs]) => deliver(uid, docs)), 5);
        return send(res, 200, { writeResults: plan.map(() => ({ updateTime: new Date().toISOString() })), commitTime: new Date().toISOString() });
      }
      return fsError(res, 404, 'NOT_FOUND', 'unknown firestore path ' + rest);
    } catch (e) {
      return send(res, e.status || 500, { error: { code: e.status || 500, message: e.message } });
    }
  });
  api.listen = () => new Promise((r) => httpServer.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${httpServer.address().port}`)));
  api.close = () => httpServer.close();
  return api;
}

module.exports = { createFakeGoogle, encode, decode };
