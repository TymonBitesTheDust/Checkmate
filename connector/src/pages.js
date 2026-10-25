// The few web pages the connector shows: the sign-in page Claude sends you to, and a
// small "it's running" page at the connector's address. English or Traditional Chinese,
// following the browser.
import { iconSvg } from '../../web/src/brand-icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function langOf(request) {
  const al = (request.headers.get('accept-language') || '').toLowerCase();
  const first = al.split(',').map((x) => x.trim().split(';')[0]).find((x) => /^(zh|en)/.test(x)) || '';
  return /^zh-(tw|hk|mo|hant)/.test(first) || first === 'zh-hant' ? 'zh' : 'en';
}

const T = {
  en: {
    title: 'Connect Claude to Checkmate',
    asks: 'Claude is asking to use your Checkmate account. Once you allow it, Claude can:',
    can1: 'See your tasks, projects, labels and calendar',
    can2: 'Add, change, complete and delete tasks and events for you',
    back: (host) => `After you allow, you’ll go back to <b>${esc(host)}</b>.`,
    local: 'This sign-in was started by an app on this computer (such as Claude Code). Only continue if you started it.',
    email: 'Email',
    password: 'Password',
    allow: 'Sign in and allow',
    cancel: 'Cancel',
    note: (p) => `Use the email and password you sign in to Checkmate with. They go only to your own Firebase project (<code>${esc(p)}</code>) — Claude never sees your password.`,
    expired: 'This sign-in page has expired. Go back to Claude and choose Connect again.',
    badRedirect: 'This link didn’t come from Claude, so the connector won’t sign anyone in through it.',
    notSetUp: 'This connector has no Checkmate settings yet. In Checkmate, open Settings → Claude, copy the connector code again and paste it into this Worker.',
    noConn: 'Claude isn’t turned on for this account yet. In Checkmate, open Settings → Claude and follow the steps, then come back and try again.',
    runningTitle: 'Your Checkmate connector is running',
    runningBody: 'Add this address to Claude as a custom connector:',
    runningSteps: 'In Claude, open Customize → Connectors → Add → Add custom connector, name it “Checkmate”, paste the address and choose Add. Then choose Connect and sign in with your Checkmate account.',
    project: 'Firebase project',
    version: 'Connector version',
    copy: 'Copy',
    copied: 'Copied',
  },
  zh: {
    title: '將 Claude 連接到 Checkmate',
    asks: 'Claude 要求使用你的 Checkmate 帳戶。允許後，Claude 可以：',
    can1: '查看你的任務、專案、標籤和日曆',
    can2: '為你新增、更改、完成和刪除任務及活動',
    back: (host) => `允許後，你會返回 <b>${esc(host)}</b>。`,
    local: '這次登入是由這部電腦上的應用程式（例如 Claude Code）發起的。只有在是你自己發起時才繼續。',
    email: '電郵',
    password: '密碼',
    allow: '登入並允許',
    cancel: '取消',
    note: (p) => `請使用你登入 Checkmate 的電郵和密碼。它們只會傳送到你自己的 Firebase 專案（<code>${esc(p)}</code>），Claude 不會看到你的密碼。`,
    expired: '這個登入頁面已過期。請返回 Claude，再按一次「連接」。',
    badRedirect: '這個連結不是來自 Claude，所以連接器不會經它登入任何人。',
    notSetUp: '這個連接器還沒有 Checkmate 的設定。請在 Checkmate 打開「設定 → Claude」，再次複製連接器程式碼並貼到這個 Worker。',
    noConn: '這個帳戶還沒有開啟 Claude。請在 Checkmate 打開「設定 → Claude」並按步驟完成，然後回來再試。',
    runningTitle: '你的 Checkmate 連接器正在運作',
    runningBody: '把這個網址加到 Claude 作為自訂連接器：',
    runningSteps: '在 Claude 打開 Customize → Connectors → Add → Add custom connector，名稱填「Checkmate」，貼上網址並按 Add。然後按 Connect，用你的 Checkmate 帳戶登入。',
    project: 'Firebase 專案',
    version: '連接器版本',
    copy: '複製',
    copied: '已複製',
  },
};
export const words = (lang) => T[lang] || T.en;

const STYLE = `
:root{color-scheme:light dark;--bg:#f4f6f3;--card:#fff;--ink:#1c1f1d;--ink2:#5b625e;--line:#dfe4e0;--accent:#c4501a;--accent-ink:#fff;--warn:#9a5b00;--warn-bg:#fff5e0;--err:#b3261e;--err-bg:#fdecea}
@media (prefers-color-scheme:dark){:root{--bg:#121513;--card:#1b1f1c;--ink:#e8ece9;--ink2:#a3aca6;--line:#2c332e;--accent:#ff8a4c;--accent-ink:#1f0d03;--warn:#f0b65a;--warn-bg:#2b2213;--err:#ff8a80;--err-bg:#2c1614}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans TC","Microsoft JhengHei",sans-serif;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px}
.card{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:17px;margin-bottom:18px}.brand svg{width:34px;height:34px}
h1{font-size:21px;line-height:1.3;margin:0 0 10px}p{margin:0 0 12px;color:var(--ink2)}ul{margin:0 0 14px;padding-left:20px}li{margin:4px 0}
label{display:block;font-weight:600;font-size:13.5px;margin:14px 0 6px}input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}input:focus{outline:2px solid var(--accent);outline-offset:1px}
.row{display:flex;gap:10px;margin-top:20px}button{font:inherit;font-weight:600;border-radius:10px;padding:10px 16px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);flex:1}
.note{font-size:13px;margin-top:16px}.warn{background:var(--warn-bg);color:var(--warn);border-radius:10px;padding:10px 12px;font-size:13.5px;margin:0 0 12px}.err{background:var(--err-bg);color:var(--err);border-radius:10px;padding:10px 12px;font-size:14px;margin:12px 0 0}
code{font-size:12.5px;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:1px 5px;word-break:break-all}
.copy{display:flex;gap:8px;margin:6px 0 14px}.copy input{font-family:ui-monospace,Consolas,monospace;font-size:13px}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px;color:var(--ink2);margin:14px 0 0}dt{font-weight:600}dd{margin:0}`;

function shell(lang, title, body) {
  return `<!doctype html><html lang="${lang === 'zh' ? 'zh-Hant' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="icon" href="data:image/svg+xml,${encodeURIComponent(iconSvg('tickwise'))}"><style>${STYLE}</style></head><body><main class="card"><div class="brand">${iconSvg('tickwise', { size: 34 })}<span>Checkmate</span></div>${body}</main></body></html>`;
}

export function consentPage({ lang, req, host, loopback, projectId, email = '', error = '' }) {
  const w = words(lang);
  return shell(
    lang,
    w.title,
    `<h1>${esc(w.title)}</h1>
<p>${esc(w.asks)}</p>
<ul><li>${esc(w.can1)}</li><li>${esc(w.can2)}</li></ul>
${loopback ? `<p class="warn">${esc(w.local)}</p>` : ''}
<p>${w.back(host)}</p>
<form method="post" action="/authorize" autocomplete="on">
<input type="hidden" name="req" value="${esc(req)}">
<label for="email">${esc(w.email)}</label><input id="email" name="email" type="email" autocomplete="username" required value="${esc(email)}" ${email ? '' : 'autofocus'}>
<label for="password">${esc(w.password)}</label><input id="password" name="password" type="password" autocomplete="current-password" required ${email ? 'autofocus' : ''}>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<div class="row"><button class="primary" type="submit" name="action" value="allow">${esc(w.allow)}</button><button type="submit" name="action" value="cancel" formnovalidate>${esc(w.cancel)}</button></div>
</form>
<p class="note">${w.note(projectId)}</p>`,
  );
}

export function messagePage({ lang, title, text }) {
  return shell(lang, title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`);
}

export function homePage({ lang, mcpUrl, projectId, version, ready }) {
  const w = words(lang);
  if (!ready) return messagePage({ lang, title: 'Checkmate', text: w.notSetUp });
  return shell(
    lang,
    w.runningTitle,
    `<h1>${esc(w.runningTitle)}</h1>
<p>${esc(w.runningBody)}</p>
<div class="copy"><input id="u" readonly value="${esc(mcpUrl)}" onfocus="this.select()"><button type="button" onclick="navigator.clipboard.writeText(document.getElementById('u').value).then(()=>{this.textContent='${esc(w.copied)}'})">${esc(w.copy)}</button></div>
<p>${esc(w.runningSteps)}</p>
<dl><dt>${esc(w.project)}</dt><dd><code>${esc(projectId)}</code></dd><dt>${esc(w.version)}</dt><dd>${esc(version)}</dd></dl>`,
  );
}
