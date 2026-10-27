// The Chrome/Edge extension's side of the app (native.js handles reminders, fetching and the
// toolbar icon). The toolbar popup changes tasks through the open Checkmate tab when there is
// one, so only one copy of the data is ever being written; the service worker asks the tab to
// open a task when a reminder is clicked.
import * as store from './store.js';
import * as A from './actions.js';
import { addFromText } from './quick.js';
import { isExtension } from './native.js';

// op: {type: 'add', text} | {type: 'complete', id} | {type: 'uncomplete', id}
export function applyOp(op) {
  let id = null;
  if (op.type === 'add') id = addFromText(op.text)?.id || null;
  else if (op.type === 'complete') A.completeTask(op.id);
  else if (op.type === 'uncomplete') A.uncompleteTask(op.id);
  store.flush();
  return id;
}

export function wireExtension() {
  if (!isExtension()) return;
  window.__checkmateExt = { apply: (op) => applyOp({ ...op }) };
  // app.html?task=<id>: opened from a reminder or the popup while no Checkmate tab was open
  const task = new URLSearchParams(location.search).get('task');
  if (task) {
    window.__openTask = task;
    history.replaceState(null, '', location.pathname + location.hash);
  }
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.type === 'checkmate:open-task' && m.id) window.tickwiseOpenTask(m.id);
  });
}
