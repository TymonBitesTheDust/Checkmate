// Settings → Claude: set up the Claude connector so Claude can add and find tasks,
// like Claude's Todoist connector. The connector runs on the person's own (free)
// Cloudflare account and signs in to their own Firebase project.
import { useState, useEffect, useMemo } from 'preact/hooks';
import * as store from './store.js';
import * as sync from './sync.js';
import * as C from './claude.js';
import { Icon } from './icons.jsx';
import { Field, confirmDialog, toast, useStoreVersion } from './ui.jsx';
import { copyText, saveFile, openExternal } from './native.js';
import { allZones, localTz } from './tz.js';
import { play } from './sound.js';
import { tr, isZh } from './i18n.js';

function useSyncState() {
  const [s, setS] = useState(sync.getSyncState());
  useEffect(() => sync.onSyncState(setS), []);
  return s;
}

function when(ts) {
  const d = new Date(ts);
  return d.toLocaleString(isZh() ? 'zh-Hant' : [], { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined, hour: 'numeric', minute: '2-digit' });
}

const EXAMPLES_EN = [
  'Add “Pay rent” to Checkmate every month on the 1st at 9am, p1, in my Home project',
  'What’s overdue in Checkmate? Move it all to tomorrow',
  'Turn this email into Checkmate tasks with due dates',
  'Block 9–11am every weekday next week on my Checkmate calendar for focus time',
  'What did I finish in Checkmate this week?',
];
const EXAMPLES_ZH = [
  '在 Checkmate 新增「交租」，每月1號上午9點，p1，放在「家」專案',
  'Checkmate 裡有甚麼逾期了？全部改到明天',
  '把這封電郵變成 Checkmate 任務，並加上到期日',
  '在 Checkmate 日曆下星期每個工作日上午9點到11點留作專注時間',
  '我這星期在 Checkmate 完成了甚麼？',
];

export function ClaudePanel({ goTo }) {
  useStoreVersion();
  const s = useSyncState();
  const prefs = store.getPrefs();
  const cfg = prefs.firebaseConfig;
  const signedIn = !!(cfg && prefs.syncUid && s.status !== 'signed-out' && s.status !== 'off');
  const conn = C.connector();
  const [url, setUrl] = useState(conn && conn.url ? conn.url : '');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [guideOpen, setGuideOpen] = useState(!(conn && conn.authAt));
  const zones = useMemo(() => allZones(), []);
  const base = (result && result.ok && result.base) || (conn && conn.url) || null;
  const mcp = C.mcpUrl(base);

  if (!signedIn) {
    return (
      <div class="panel-stack cl-panel">
        <Intro />
        <div class="sync-card st-offline">
          <Icon name="cloudOff" size={28} />
          <div>
            <strong>{tr('Turn on sync first')}</strong>
            <span>{tr('Claude reaches your tasks through your Firebase project, the same way your other devices do. Sign in to sync on this device, then come back here.')}</span>
          </div>
        </div>
        <div class="row-actions">
          <button type="button" class="btn primary" onClick={() => goTo && goTo('sync')}>
            <Icon name="cloud" size={18} /> {tr('Open Sync settings')}
          </button>
        </div>
      </div>
    );
  }

  const copyCode = async () => {
    const code = C.connectorCode(cfg);
    if (await copyText(code)) {
      play('add');
      toast(tr('Connector code copied'));
    } else toast(tr('Couldn’t copy. Use “Save as file” instead.'));
  };
  const saveCode = () => saveFile('checkmate-connector.js', 'text/javascript', C.connectorCode(cfg));

  const runCheck = async (e) => {
    if (e) e.preventDefault();
    setChecking(true);
    setResult(null);
    try {
      const r = await C.check(url, cfg);
      C.saveUrl(r.base);
      setUrl(r.base);
      setResult(r);
      play('complete');
    } catch (x) {
      play('error');
      setResult({ ok: false, error: tr(x.message, { host: x.host, other: x.other, mine: x.mine }) });
    }
    setChecking(false);
  };

  const disconnect = async () => {
    const ok = await confirmDialog({
      title: tr('Disconnect Claude?'),
      body: tr('Claude loses access to Checkmate straight away, on every device. To use it again, choose Connect next to Checkmate in Claude’s connector settings.'),
      confirm: tr('Disconnect'),
      danger: true,
    });
    if (!ok) return;
    C.disconnect();
    toast(tr('Claude is disconnected'));
  };

  const connected = conn && conn.authAt;
  const examples = isZh() ? EXAMPLES_ZH : EXAMPLES_EN;
  return (
    <div class="panel-stack cl-panel">
      <Intro />
      {connected ? (
        <div class="sync-card st-synced cl-status">
          <Icon name="plug" size={28} />
          <div>
            <strong>{tr('Claude is connected')}</strong>
            <span role="status">{tr('Signed in as {email} on {when}', { email: conn.authEmail || prefs.syncEmail || '', when: when(conn.authAt) })}</span>
          </div>
          <button type="button" class="btn ghost sm" onClick={disconnect}>{tr('Disconnect')}</button>
        </div>
      ) : (
        <div class="sync-card cl-status off">
          <Icon name="plug" size={28} />
          <div>
            <strong>{tr('Not connected yet')}</strong>
            <span>{tr('Follow the four steps below. It takes about five minutes, once.')}</span>
          </div>
        </div>
      )}

      <details class="cl-guide" open={guideOpen} onToggle={(e) => setGuideOpen(e.currentTarget.open)}>
        <summary>{connected ? tr('Set-up steps') : tr('Set up')}</summary>
        <ol class="cl-steps">
          <li>
            <strong>{tr('Copy your connector')}</strong>
            <p>{tr('The connector is a small program that runs for free on your own Cloudflare account. It signs in to your Firebase project as you, so your tasks never pass through anyone else’s server. The code includes a private key just for you, so don’t share it.')}</p>
            <div class="row-actions">
              <button type="button" class="btn primary" onClick={copyCode}>
                <Icon name="copy" size={18} /> {tr('Copy connector code')}
              </button>
              <button type="button" class="btn ghost" onClick={saveCode}>
                <Icon name="download" size={18} /> {tr('Save as file')}
              </button>
            </div>
          </li>
          <li>
            <strong>{tr('Put it on Cloudflare')}</strong>
            <CloudflareSteps />
          </li>
          <li>
            <strong>{tr('Check it')}</strong>
            <form class="cl-check" onSubmit={runCheck}>
              <Field label={tr('Your connector’s address')} hint={tr('Cloudflare shows it after you deploy. It ends in .workers.dev.')}>
                <div class="copy-row">
                  <input type="text" class="mono" inputMode="url" autoComplete="off" spellcheck={false} placeholder="https://checkmate.yourname.workers.dev" value={url} onInput={(e) => setUrl(e.currentTarget.value)} />
                  <button type="submit" class="btn primary sm" disabled={checking || !url.trim()}>
                    {checking ? <Icon name="refresh" size={16} class="ds-spin" /> : null}
                    {checking ? tr('Checking…') : tr('Check')}
                  </button>
                </div>
              </Field>
              {result && result.ok && (
                <p class="form-ok" role="status">
                  {result.outdated
                    ? tr('It works, but a newer connector ({v}) is available. Copy the code again, paste it over the old code in Cloudflare and Deploy.', { v: C.CONNECTOR_VERSION })
                    : tr('Your connector is working.')}
                </p>
              )}
              {result && !result.ok && <p class="form-error" role="alert">{result.error}</p>}
            </form>
          </li>
          <li>
            <strong>{tr('Add it to Claude')}</strong>
            {mcp ? (
              <>
                <div class="copy-row cl-mcp">
                  <input type="text" class="mono" readOnly value={mcp} onFocus={(e) => e.currentTarget.select()} aria-label={tr('Connector URL for Claude')} />
                  <button type="button" class="btn ghost sm" onClick={async () => (await copyText(mcp)) && toast(tr('Address copied'))}>{tr('Copy')}</button>
                </div>
                <div class="row-actions">
                  <button type="button" class="btn primary" onClick={() => openExternal(C.addToClaudeUrl(mcp))}>
                    <Icon name="open" size={18} /> {tr('Add to Claude')}
                  </button>
                </div>
              </>
            ) : (
              <p class="muted">{tr('Check your connector’s address first; its Claude address appears here.')}</p>
            )}
            <ClaudeSteps />
          </li>
        </ol>
      </details>

      <Field group label={tr('Try asking Claude')}>
        <ul class="cl-examples">
          {examples.map((x) => (
            <li key={x}>{isZh() ? x : `“${x}”`}</li>
          ))}
        </ul>
      </Field>

      <Field label={tr('Time zone Claude uses')} hint={tr('So Claude knows what “today” and “9am” mean. Times on your calendar still show in each device’s own zone.')}>
        <select value={(conn && conn.tz) || localTz()} onChange={(e) => C.setTimeZone(e.currentTarget.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </Field>

      <p class="about">
        {tr('Changes Claude makes sync to your devices like any other change, and tasks it adds say “Added by Claude”. Claude only sees what it looks up while helping you. Your password goes to your Firebase project, never to Claude.')}
      </p>
    </div>
  );
}

function Intro() {
  return (
    <p class="lead">
      {tr('Connect Checkmate to Claude, then just ask Claude to add tasks, plan your day or tidy your lists. It works in Claude on the web, the desktop app and the phone apps, much like Claude’s Todoist connector.')}
    </p>
  );
}

function CloudflareSteps() {
  const link = <button type="button" class="link-btn accent" onClick={() => openExternal(C.CLOUDFLARE_URL)}>dash.cloudflare.com</button>;
  if (isZh()) {
    return (
      <ul class="steps">
        <li>打開 {link}，免費註冊或登入。</li>
        <li>前往<b>Workers & Pages</b>（可能在<b>Compute</b>下）→<b>Create</b>→<b>Start with Hello World!</b>，名稱填 <code>checkmate</code>，然後按<b>Deploy</b>。</li>
        <li>按<b>Edit code</b>，刪除 worker.js 裡的所有內容，貼上連接器程式碼，再按<b>Deploy</b>。</li>
        <li>複製以 <code>.workers.dev</code> 結尾的網址，貼到下一步。</li>
      </ul>
    );
  }
  return (
    <ul class="steps">
      <li>Open {link} and sign up or sign in. The free plan is enough.</li>
      <li>Go to <b>Workers & Pages</b> (it may be under <b>Compute</b>) → <b>Create</b> → <b>Start with Hello World!</b>, name it <code>checkmate</code> and choose <b>Deploy</b>.</li>
      <li>Choose <b>Edit code</b>, delete everything in worker.js, paste the connector code and choose <b>Deploy</b>.</li>
      <li>Copy the address that ends in <code>.workers.dev</code> and paste it in the next step.</li>
    </ul>
  );
}

function ClaudeSteps() {
  if (isZh()) {
    return (
      <ul class="steps">
        <li>按<b>新增到 Claude</b>，或在 Claude 打開<b>Customize → Connectors</b>，按<b>Add custom connector</b>，名稱填「Checkmate」並貼上上面的網址。</li>
        <li>如 Claude 詢問登入方式，選<b>Sign in now</b>及<b>Use Claude’s published identity</b>，然後按<b>Add</b>。</li>
        <li>按<b>Connect</b>，用你的 Checkmate 電郵和密碼登入，再按<b>登入並允許</b>。</li>
        <li>在對話中按<b>＋ → Connectors</b>開啟 Checkmate。手機上的 Claude 應用程式會自動出現它。</li>
        <li>免費方案可加一個自訂連接器。Team 和 Enterprise 方案需由擁有者（Owner）加入。</li>
      </ul>
    );
  }
  return (
    <ul class="steps">
      <li>Choose <b>Add to Claude</b>, or in Claude open <b>Customize → Connectors</b>, choose <b>Add custom connector</b>, name it “Checkmate” and paste the address above.</li>
      <li>If Claude asks how to sign in, pick <b>Sign in now</b> and <b>Use Claude’s published identity</b>, then choose <b>Add</b>.</li>
      <li>Choose <b>Connect</b>, sign in with your Checkmate email and password, and choose <b>Sign in and allow</b>.</li>
      <li>In a chat, turn Checkmate on from <b>+ → Connectors</b>. It shows up in the Claude phone apps by itself.</li>
      <li>Free plans can add one custom connector. On Team and Enterprise plans an Owner adds it.</li>
    </ul>
  );
}
