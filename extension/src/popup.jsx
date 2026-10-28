// The toolbar popup: quick add (the same typing as the app's Add task box) and what's due
// today. Changes go through the open Checkmate tab when there is one (web/src/ext.js), so
// only one copy of the data is ever written; with no tab open the popup saves them itself
// and they sync the next time Checkmate opens.
import { render } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import * as store from '../../web/src/store.js';
import * as A from '../../web/src/actions.js';
import { applyOp } from '../../web/src/ext.js';
import { parseTask } from '../../web/src/quick.js';
import { tr } from '../../web/src/i18n.js';
import { dueLabel } from '../../web/src/dates.js';
import { taskExample } from '../../web/src/examples.js';
import { iconSvg } from '../../web/src/brand-icons.js';
import { accentHex } from '../../web/src/theme.js';

store.init();

// The Checkmate tab, when one is open.
function appWindow() {
  try {
    return chrome.extension.getViews({ type: 'tab' }).find((w) => w.__checkmateExt) || null;
  } catch {
    return null;
  }
}

function run(op) {
  const app = appWindow();
  let id;
  if (app) id = app.__checkmateExt.apply(op);
  else {
    store.init();
    id = applyOp(op);
  }
  store.init();
  return { id, viaApp: !!app };
}

const openApp = (taskId) => chrome.runtime.sendMessage({ type: 'checkmate:open', taskId }).finally(() => window.close());

function todayList() {
  return A.sortTasks(A.todayTasks().filter((t) => !t.parentId), 'priority');
}

function Popup() {
  const prefs = store.getPrefs();
  const [, redraw] = useState(0);
  const [text, setText] = useState('');
  const [note, setNote] = useState(null); // {text, undo?}
  const [example] = useState(() => taskExample());
  const [key, setKey] = useState('');
  const input = useRef(null);

  useEffect(() => {
    input.current && input.current.focus();
    chrome.commands.getAll((list) => {
      const c = (list || []).find((x) => x.name === '_execute_action');
      if (c && c.shortcut) setKey(c.shortcut);
    });
    // the Checkmate tab saved something (or synced): show it
    const onStorage = (e) => {
      if (e.key === 'tickwise.db.v1') {
        store.init();
        redraw((n) => n + 1);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const later = (viaApp) => (!viaApp && prefs.syncUid ? ` ${tr('It syncs when you next open Checkmate.')}` : '');

  const parsed = text.trim() ? parseTask(text) : null;
  const add = (e) => {
    e.preventDefault();
    if (!parsed || !parsed.title) return;
    const r = run({ type: 'add', text });
    const t = r.id && store.get(r.id);
    setText('');
    setNote({ text: tr('Added to {name}', { name: A.projectName(t && store.get(t.projectId)) }) + later(r.viaApp), open: r.id });
    redraw((n) => n + 1);
  };
  const complete = (t) => {
    const r = run({ type: 'complete', id: t.id });
    setNote({ text: tr('Completed “{name}”', { name: t.title }) + later(r.viaApp), undo: t.due && t.due.recur ? null : t.id });
    redraw((n) => n + 1);
  };
  const undo = (id) => {
    run({ type: 'uncomplete', id });
    setNote(null);
    redraw((n) => n + 1);
  };

  const list = todayList();
  const skin = prefs.skin || 'tickwise';
  const logo = iconSvg(skin, { accent: accentHex(prefs.accent), size: 26 });

  return (
    <div class="pop">
      <header>
        <span class="logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: logo }} />
        <b class="name">Checkmate</b>
        <button type="button" class="open" onClick={() => openApp()}>
          {tr('Open Checkmate')}
        </button>
      </header>
      <form class="add" onSubmit={add}>
        <input
          ref={input}
          type="text"
          value={text}
          placeholder={tr('Task name, e.g. {example}', { example })}
          aria-label={tr('Task name')}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <button type="submit" disabled={!parsed || !parsed.title}>
          {tr('Add')}
        </button>
      </form>
      {parsed && parsed.chips.length > 0 && (
        <div class="chips">
          {parsed.chips.map((c) => (
            <span key={c.key} class={`chip ${c.kind}`}>
              {c.label}
            </span>
          ))}
        </div>
      )}
      <h2>
        {tr('Today')} <span class="count">{list.length || ''}</span>
      </h2>
      {list.length ? (
        <ul class="tasks">
          {list.map((t) => {
            const due = dueLabel(t.due, prefs.timeFormat);
            const p = store.get(t.projectId);
            return (
              <li key={t.id} class={`p${t.priority || 4}`}>
                <button type="button" class="check" aria-label={tr('Complete “{name}”', { name: t.title })} onClick={() => complete(t)} />
                <button type="button" class="title" onClick={() => openApp(t.id)}>
                  <span class="t">{t.title}</span>
                  <span class="meta">
                    {due && <span class={`due ${due.tone}`}>{due.text}</span>}
                    <span class="proj">{A.projectName(p)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="empty">{tr('Nothing left for today.')}</p>
      )}
      <footer>
        {note ? (
          <span class="note" role="status">
            {note.text}
            {note.undo && (
              <button type="button" class="link" onClick={() => undo(note.undo)}>
                {tr('Undo')}
              </button>
            )}
            {note.open && (
              <button type="button" class="link" onClick={() => openApp(note.open)}>
                {tr('Open')}
              </button>
            )}
          </span>
        ) : (
          key && <span class="hint">{tr('{key} opens this from any page.', { key })}</span>
        )}
      </footer>
    </div>
  );
}

render(<Popup />, document.getElementById('popup'));
