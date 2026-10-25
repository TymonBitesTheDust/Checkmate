// Talks to the user's own Firebase project over its public REST APIs, signed in as
// the user, so the same Firestore rules that guard the app guard the connector too.
//   Auth:      identitytoolkit (email + password) and securetoken (refresh)
//   Firestore: users/{uid}/items/{id}, exactly the documents the app syncs

export class FirebaseError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code || 'UNKNOWN';
    this.status = status || 0;
  }
}

export function apis(cfg, env) {
  // CM_GOOGLE_API points every call at a stand-in server; only the tests set it.
  const base = env && env.CM_GOOGLE_API ? String(env.CM_GOOGLE_API).replace(/\/$/, '') : null;
  return {
    key: cfg.apiKey,
    project: cfg.projectId,
    signIn: `${base ? `${base}/identitytoolkit` : 'https://identitytoolkit.googleapis.com'}/v1/accounts:signInWithPassword?key=${encodeURIComponent(cfg.apiKey)}`,
    refresh: `${base ? `${base}/securetoken` : 'https://securetoken.googleapis.com'}/v1/token?key=${encodeURIComponent(cfg.apiKey)}`,
    firestore: `${base ? `${base}/firestore` : 'https://firestore.googleapis.com'}/v1`,
  };
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: { message: text.slice(0, 200) } };
  }
}

// ---------- auth ----------

export async function signIn(api, email, password) {
  const res = await fetch(api.signIn, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await readJson(res);
  if (!res.ok || !j || !j.idToken) {
    const msg = (j && j.error && j.error.message) || `HTTP ${res.status}`;
    throw new FirebaseError(msg, msg.split(/[\s:]/)[0], res.status);
  }
  return {
    idToken: j.idToken,
    refreshToken: j.refreshToken,
    uid: j.localId,
    email: j.email || email,
    exp: Date.now() + (parseInt(j.expiresIn, 10) || 3600) * 1000,
  };
}

export async function refresh(api, refreshToken) {
  const res = await fetch(api.refresh, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  });
  const j = await readJson(res);
  if (!res.ok || !j || !j.id_token) {
    const msg = (j && j.error && (j.error.message || j.error)) || `HTTP ${res.status}`;
    throw new FirebaseError(String(msg), String(msg).split(/[\s:]/)[0], res.status);
  }
  return {
    idToken: j.id_token,
    refreshToken: j.refresh_token || refreshToken,
    uid: j.user_id,
    exp: Date.now() + (parseInt(j.expires_in, 10) || 3600) * 1000,
  };
}

// The friendly sentence for a sign-in failure.
export function signInMessage(e) {
  const c = (e && e.code) || '';
  if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL/.test(c)) return 'That email or password isn’t right. Use the account you sign in to Checkmate with.';
  if (/MISSING_PASSWORD/.test(c)) return 'Enter your password.';
  if (/TOO_MANY_ATTEMPTS/.test(c)) return 'Too many attempts. Wait a minute, then try again.';
  if (/USER_DISABLED/.test(c)) return 'This account has been turned off in your Firebase project.';
  if (/OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/.test(c)) return 'Email/Password sign-in is off in your Firebase project.';
  if (/REFERER|REFERRER/i.test(c + (e && e.message))) return 'Your Firebase API key is limited to certain websites, so the connector can’t use it. In Google Cloud console → APIs & Services → Credentials, remove the website restriction from the key (keep its API restrictions).';
  if (/API_KEY|API key/i.test(c + (e && e.message))) return 'The connector’s Firebase key isn’t accepted. Copy the connector code again from Checkmate.';
  return `Firebase didn’t accept the sign-in (${(e && e.message) || 'unknown error'}).`;
}

// ---------- Firestore values ----------

export function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!isFinite(v)) return { nullValue: null };
    return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) {
    const values = v.filter((x) => x !== undefined).map(encode);
    return { arrayValue: values.length ? { values } : {} };
  }
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v) } };
  return { nullValue: null };
}

export function encodeFields(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined || typeof obj[k] === 'function') continue;
    out[k] = encode(obj[k]);
  }
  return out;
}

export function decode(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(decode);
  if ('mapValue' in v) return decodeFields((v.mapValue && v.mapValue.fields) || {});
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('bytesValue' in v) return v.bytesValue;
  return null;
}

export function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields || {})) out[k] = decode(fields[k]);
  return out;
}

// ---------- Firestore client for one user ----------

export class UserDb {
  constructor(api, uid, idToken) {
    this.api = api;
    this.uid = uid;
    this.idToken = idToken;
    this.root = `projects/${api.project}/databases/(default)/documents`;
    // updateTime of every document read, so writes can check nobody changed it since
    this.seen = new Map();
    this.reads = 0;
  }

  name(id) {
    return `${this.root}/users/${this.uid}/items/${id}`;
  }

  async call(path, body, method = 'POST') {
    const res = await fetch(`${this.api.firestore}/${path}`, {
      method,
      headers: { authorization: `Bearer ${this.idToken}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await readJson(res);
    const err = j && (j.error || (Array.isArray(j) && j[0] && j[0].error));
    if (!res.ok || err) {
      const e = err || {};
      throw new FirebaseError(e.message || `Firestore HTTP ${res.status}`, e.status || String(res.status), res.status);
    }
    return j;
  }

  take(doc) {
    if (!doc || !doc.name) return null;
    const id = doc.name.slice(doc.name.lastIndexOf('/') + 1);
    this.seen.set(id, doc.updateTime || null);
    this.reads++;
    const data = decodeFields(doc.fields);
    delete data.srv;
    data.id = data.id || id;
    return data;
  }

  async getMany(ids) {
    const want = [...new Set(ids.filter(Boolean))];
    if (!want.length) return [];
    const out = [];
    for (let i = 0; i < want.length; i += 100) {
      const chunk = want.slice(i, i + 100);
      const j = await this.call(`${this.root}:batchGet`, { documents: chunk.map((id) => this.name(id)) });
      for (const r of j || []) {
        if (r.found) out.push(this.take(r.found));
        else if (r.missing) this.seen.set(r.missing.slice(r.missing.lastIndexOf('/') + 1), false);
      }
    }
    return out;
  }

  async get(id) {
    return (await this.getMany([id]))[0] || null;
  }

  // where: [field, op, value] or a list of them (joined with AND).
  async query(where, limit = 5000) {
    const list = Array.isArray(where[0]) ? where : [where];
    const filters = list.map(([field, op, value]) => ({
      fieldFilter: { field: { fieldPath: field }, op: OPS[op] || op, value: encode(value) },
    }));
    const structuredQuery = {
      from: [{ collectionId: 'items' }],
      where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } },
      limit,
    };
    const j = await this.call(`${this.root}/users/${this.uid}:runQuery`, { structuredQuery });
    return (j || []).filter((r) => r.document).map((r) => this.take(r.document));
  }

  // Saves whole items. Each write checks the document hasn't changed since it was read
  // (or still doesn't exist), and stamps srv with the server's clock like the app does.
  async save(items) {
    if (!items.length) return;
    for (let i = 0; i < items.length; i += 400) {
      const writes = items.slice(i, i + 400).map((it) => {
        const w = {
          update: { name: this.name(it.id), fields: encodeFields(it) },
          updateTransforms: [{ fieldPath: 'srv', setToServerValue: 'REQUEST_TIME' }],
        };
        const was = this.seen.get(it.id);
        if (was) w.currentDocument = { updateTime: was };
        else if (was === false || was === undefined) w.currentDocument = { exists: false };
        return w;
      });
      await this.call(`${this.root}:commit`, { writes });
    }
  }
}

const OPS = {
  '==': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL',
  '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', in: 'IN', 'array-contains': 'ARRAY_CONTAINS',
};

// A write lost a race with another device (or the doc was never read): try again.
export const isConflict = (e) => e instanceof FirebaseError && /FAILED_PRECONDITION|ABORTED|ALREADY_EXISTS|NOT_FOUND|^409$/.test(e.code);
export const isAuthError = (e) => e instanceof FirebaseError && (e.status === 401 || /UNAUTHENTICATED/.test(e.code));
