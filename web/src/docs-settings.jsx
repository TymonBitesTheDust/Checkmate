// Settings → Docs & Sheets: link a Google Doc or Sheet to a project and manage linked ones.
import { useState } from 'preact/hooks';
import * as store from './store.js';
import * as A from './actions.js';
import * as D from './docsync.js';
import { ui } from './bus.js';
import { Icon } from './icons.jsx';
import { Field, Switch, confirmDialog, toast, useStoreVersion } from './ui.jsx';
import { openExternal } from './native.js';
import { play } from './sound.js';
import { tr } from './i18n.js';

const MODES = [
  ['auto', 'Bullets and checklists (every line if there are none)'],
  ['lists', 'Only bullets and checklists'],
  ['all', 'Every line'],
];

export function DocsPanel() {
  useStoreVersion();
  const prefs = store.getPrefs();
  const linked = D.sources();
  const projects = A.projects();
  const [url, setUrl] = useState('');
  const [target, setTarget] = useState(() => {
    const id = D.takePresetProject();
    return id && store.get(id) ? id : 'new';
  });
  const [name, setName] = useState('');
  const [mode, setMode] = useState('auto');
  const [removeMissing, setRemoveMissing] = useState(true);
  const [parseText, setParseText] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [guide, setGuide] = useState(false);
  const [key, setKey] = useState(prefs.docsApiKey || '');

  let link = null;
  try {
    link = url.trim() ? D.parseLink(url) : null;
  } catch {}
  const taken = target !== 'new' && D.sourceFor(target);

  const submit = async (e) => {
    if (e) e.preventDefault();
    setErr('');
    setOk('');
    let l;
    try {
      l = D.parseLink(url);
    } catch (x) {
      play('error');
      setErr(x.message);
      return;
    }
    const fk = D.fileKey(l);
    const dup = store.all('docsource').find((s) => (s.fkey || D.fileKey(s)) === fk);
    if (dup) {
      play('error');
      setErr(tr('This link is already synced to “{name}”.', { name: A.projectName(store.get(dup.projectId)) }));
      return;
    }
    if (taken) {
      play('error');
      setErr(tr('“{name}” is already synced to another doc. Pick a different project.', { name: A.projectName(store.get(target)) }));
      return;
    }
    setBusy(true);
    try {
      const result = await D.load({ ...l, mode, parseText });
      if (
        !result.entries.length &&
        !(await confirmDialog({
          title: tr('No tasks found'),
          body:
            result.kind === 'sheet'
              ? tr('The sheet has no rows with a task name. Link it anyway? Rows you add later will appear.')
              : tr('The doc has no lines that look like tasks. Link it anyway? Lines you add later will appear.'),
          confirm: tr('Link anyway'),
        }))
      ) {
        setBusy(false);
        return;
      }
      let pid = target;
      if (pid === 'new' || !store.get(pid)) pid = A.saveProject(null, { name: name.trim() || result.title || D.kindName(result.kind) }).id;
      const src = store.create('docsource', {
        url: l.url,
        kind: result.kind,
        fileId: l.fileId || null,
        pubId: l.pubId || null,
        gid: l.gid || null,
        rk: l.rk || null,
        fkey: fk,
        projectId: pid,
        mode,
        parseText,
        removeMissing,
        apiKey: result.apiKey || null,
        rows: {},
      });
      const s = D.apply(src, result);
      D.setStatus(src.id, { ok: true, at: Date.now(), n: s.total, via: result.via });
      play('add');
      setUrl('');
      setName('');
      setTarget('new');
      const pname = A.projectName(store.get(pid));
      setOk(tr('Linked. {n} task{s} from the {kind} are in “{name}”.', { n: s.total, kind: D.kindName(result.kind), name: pname }));
      toast(tr('Linked to “{name}”', { name: pname }), () => ui.navigate(`#/project/${pid}`), { label: tr('Open') });
    } catch (x) {
      play('error');
      setErr(x && x.twUser ? x.message : tr('Couldn’t reach Google. Check your connection and try again.'));
      if (!(x && x.twUser)) console.warn(x);
    }
    setBusy(false);
  };

  const docLike = link && (link.kind === 'doc' || link.kind === 'any');
  return (
    <div class="panel-stack">
      <p class="lead">
        {tr('Turn a Google Doc or Google Sheet into tasks. Checkmate checks the link for changes and keeps the project up to date. Changes flow one way: from the doc into Checkmate.')}
      </p>
      <form class="panel-stack ds-form" onSubmit={submit}>
        <Field
          label={tr('Link to a Google Doc or Sheet')}
          hint={
            link
              ? link.kind === 'sheet'
                ? tr('Google Sheet · each row becomes a task.')
                : link.kind === 'doc'
                  ? tr('Google Doc · each bullet or checklist line becomes a task.')
                  : tr('Google Drive file · Checkmate checks whether it’s a Doc or a Sheet.')
              : tr('Share it with “Anyone with the link” first.')
          }
        >
          <input
            type="text"
            class="ds-url"
            inputMode="url"
            autocomplete="off"
            spellcheck={false}
            value={url}
            placeholder="https://docs.google.com/…"
            onInput={(e) => {
              setUrl(e.currentTarget.value);
              setErr('');
            }}
          />
        </Field>
        <Field label={tr('Put the tasks in')}>
          <select value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
            <option value="new">{tr('A new project')}</option>
            {projects.map((p) => (
              <option value={p.id} key={p.id}>{A.projectName(p)}</option>
            ))}
          </select>
        </Field>
        {target === 'new' && (
          <Field label={tr('Project name')} hint={tr('Leave empty to use the doc’s title.')}>
            <input
              type="text"
              class="ds-name"
              maxLength={120}
              value={name}
              placeholder={link && link.kind === 'sheet' ? tr('Google Sheet') : tr('Google Doc')}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </Field>
        )}
        {docLike && (
          <Field label={tr('Which lines become tasks')}>
            <select value={mode} onChange={(e) => setMode(e.currentTarget.value)}>
              {MODES.map(([v, l]) => (
                <option value={v} key={v}>{tr(l)}</option>
              ))}
            </select>
          </Field>
        )}
        <div class="field">
          <Switch label={tr('Understand dates, priorities and @labels in the text')} checked={parseText} onChange={setParseText} />
          <Switch label={tr('Remove tasks that are deleted from the doc')} checked={removeMissing} onChange={setRemoveMissing} />
          <span class="field-hint">{tr('Completed tasks are never removed.')}</span>
        </div>
        {err && <p class="form-error" role="alert">{err}</p>}
        {ok && <p class="form-ok" role="status">{ok}</p>}
        <div class="row-actions">
          <button type="submit" class="btn primary" disabled={!url.trim() || busy}>
            <Icon name={busy ? 'refresh' : 'link'} size={18} class={busy ? 'ds-spin' : ''} /> {busy ? tr('Reading…') : tr('Link and sync')}
          </button>
        </div>
      </form>
      {linked.length > 0 && (
        <>
          <hr class="sep" />
          <Field group label={tr('Synced links')}>
            <div class="ds-list">
              {linked.map((s) => (
                <SourceCard src={s} key={s.id} />
              ))}
            </div>
          </Field>
          <Field label={tr('Check for changes')} hint={tr('Checkmate also checks when you open the app.')}>
            <select value={String(prefs.docSyncEvery ?? 15)} onChange={(e) => store.setPrefs({ docSyncEvery: +e.currentTarget.value })}>
              <option value="5">{tr('Every 5 minutes')}</option>
              <option value="15">{tr('Every 15 minutes')}</option>
              <option value="60">{tr('Every hour')}</option>
              <option value="0">{tr('Only when I choose Sync now')}</option>
            </select>
          </Field>
        </>
      )}
      <hr class="sep" />
      <Field
        label={tr('Reading Google Docs')}
        hint={tr('Sheets work without this. In a web browser, Google only lets Checkmate read a Doc through a Google API key with the Google Drive API turned on. The key is kept on this device and in the link.')}
      >
        <div class="copy-row">
          <input
            type="text"
            class="mono"
            autocomplete="off"
            spellcheck={false}
            value={key}
            placeholder={tr('Google API key (AIza…)')}
            onInput={(e) => setKey(e.currentTarget.value)}
            aria-label={tr('Google API key')}
          />
          <button
            type="button"
            class="btn ghost sm"
            disabled={key.trim() === (prefs.docsApiKey || '')}
            onClick={() => {
              store.setPrefs({ docsApiKey: key.trim() || null });
              toast(key.trim() ? tr('API key saved') : tr('API key removed'));
            }}
          >
            {tr('Save')}
          </button>
        </div>
      </Field>
      <div class="row-actions">
        <button type="button" class="btn ghost" onClick={() => setGuide(!guide)} aria-expanded={guide}>
          {guide ? tr('Hide the guide') : tr('How should my doc or sheet look?')}
        </button>
      </div>
      {guide && <Guide />}
    </div>
  );
}

function SourceCard({ src }) {
  const st = D.statusOf(src.id);
  const project = store.get(src.projectId);
  const busy = D.isSyncing(src.id);
  const bad = st && st.ok === false && !busy;
  const icon = src.kind === 'sheet' ? 'sheet' : src.kind === 'doc' ? 'doc' : 'link';
  const status = busy
    ? tr('Syncing…')
    : st
      ? st.ok
        ? tr('Synced {time} · {n} task{s}', { time: D.when(st.at), n: st.n || 0 })
        : st.msg
      : tr('Not synced on this device yet.');
  const resync = () => setTimeout(() => D.syncSource(src.id), 0);
  return (
    <div class={`ds-card${bad ? ' bad' : ''}`}>
      <div class="ds-head">
        <Icon name={icon} size={22} />
        <div class="ds-meta">
          <strong>{project ? A.projectName(project) : tr('Deleted project')}</strong>
          <span class="muted">
            {D.kindName(src.kind)} ·{' '}
            <button type="button" class="link-btn" onClick={() => openExternal(src.url)}>
              {tr('Open in Google')}
            </button>
          </span>
        </div>
      </div>
      <span class={bad ? 'form-error' : 'muted ds-status'} role="status">{status}</span>
      <div class="row-actions">
        <button type="button" class="btn ghost sm" disabled={busy || !project} onClick={() => D.syncSource(src.id, { manual: true })}>
          <Icon name="refresh" size={16} class={busy ? 'ds-spin' : ''} /> {tr('Sync now')}
        </button>
        {project && (
          <button
            type="button"
            class="btn ghost sm"
            onClick={() => {
              ui.navigate(project.isInbox ? '#/inbox' : `#/project/${project.id}`);
              ui.openSettings(null);
            }}
          >
            {tr('Go to project')}
          </button>
        )}
        <button
          type="button"
          class="btn danger-ghost sm"
          onClick={async () => {
            const ok = await confirmDialog({
              title: tr('Stop syncing “{name}”?', { name: project ? A.projectName(project) : D.kindName(src.kind) }),
              body: tr('The tasks stay in Checkmate. They won’t change when the doc changes.'),
              confirm: tr('Stop syncing'),
            });
            if (!ok) return;
            store.remove(src.id);
            D.setStatus(src.id, null);
            toast(tr('Stopped syncing'));
          }}
        >
          {tr('Stop syncing')}
        </button>
      </div>
      <details class="ds-opts">
        <summary>{tr('Options')}</summary>
        <div class="ds-opts-body">
          <Switch
            label={tr('Understand dates, priorities and @labels in the text')}
            checked={src.parseText !== false}
            onChange={(v) => {
              // Re-read every row, since each one may now read differently.
              store.patch(src.id, { parseText: v, rows: {} });
              resync();
            }}
          />
          <Switch label={tr('Remove tasks that are deleted from the doc')} checked={src.removeMissing !== false} onChange={(v) => store.patch(src.id, { removeMissing: v })} />
          {src.kind !== 'sheet' && (
            <Field label={tr('Which lines become tasks')}>
              <select
                value={src.mode || 'auto'}
                onChange={(e) => {
                  store.patch(src.id, { mode: e.currentTarget.value });
                  resync();
                }}
              >
                {MODES.map(([v, l]) => (
                  <option value={v} key={v}>{tr(l)}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </details>
    </div>
  );
}

function Guide() {
  const consoleLink = (
    <button type="button" class="link-btn accent" onClick={() => openExternal('https://console.cloud.google.com/apis/library/drive.googleapis.com')}>
      console.cloud.google.com
    </button>
  );
  const share = tr('Choose Share → General access → “Anyone with the link” (Viewer).');
  return (
    <div class="panel-stack ds-guide">
      <div>
        <strong>{tr('Google Sheets')}</strong>
        <ul class="steps">
          <li>{share}</li>
          <li>{tr('Put headings in the first row. Checkmate understands Task, Done, Due, Time, Priority, Labels, Section, Notes and ID.')}</li>
          <li>{tr('Each row becomes a task. A ticked checkbox or “Done” in the Done or Status column completes it. Priority can be 1–4, P1–P4 or Urgent, High, Medium, Low.')}</li>
          <li>{tr('Using another tab? Copy the link while that tab is open, so it ends in #gid=…')}</li>
        </ul>
      </div>
      <div>
        <strong>{tr('Google Docs')}</strong>
        <ul class="steps">
          <li>{share}</li>
          <li>{tr('Each bullet or checklist line becomes a task. Headings become sections and indented bullets become subtasks.')}</li>
          <li>{tr('Ticked checklist items and struck-through lines are completed.')}</li>
          <li>{tr('Write dates and priorities the way you would in Checkmate, for example “Send invoice fri 3pm p1 @work”.')}</li>
        </ul>
      </div>
      <div>
        <strong>{tr('Getting a Google API key (for Docs)')}</strong>
        <ol class="steps">
          <li>
            {tr('Open')} {consoleLink} {tr('and sign in. Pick or create a project (your Firebase project works).')}
          </li>
          <li>{tr('On the Google Drive API page choose Enable.')}</li>
          <li>{tr('Open APIs & Services → Credentials → Create credentials → API key.')}</li>
          <li>{tr('Optional: edit the key and limit it to the Google Drive API.')}</li>
          <li>{tr('Copy the key, paste it above and choose Save.')}</li>
        </ol>
      </div>
      <p class="muted">
        {tr('Checkmate only reads the doc. Edits you make to these tasks in Checkmate stay in Checkmate; when a line changes in the doc, the task is updated to match it.')}
      </p>
    </div>
  );
}
