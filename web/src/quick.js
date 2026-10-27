// Quick add without the editor: turns typed text into a task the way the Add task box does
// (dates, times, repeats, p1–p4, #project, /section, @label). The extension's popup uses it.
import * as store from './store.js';
import * as A from './actions.js';
import { parseQuickAdd } from './parse.js';
import { isZh } from './i18n.js';

function context() {
  const prefs = store.getPrefs();
  return {
    // The Inbox answers to its English name and its translated one.
    projects: [...A.projects().map((p) => ({ id: p.id, name: A.projectName(p) })), ...(isZh() ? [{ id: 'inbox', name: 'Inbox' }] : [])],
    sections: A.sections('inbox').map((s) => ({ id: s.id, name: s.name })),
    labels: A.labels().map((l) => ({ id: l.id, name: l.name })),
    dateOrder: prefs.dateOrder,
    timeFormat: prefs.timeFormat,
    keepTime: prefs.keepTimeInName !== false,
  };
}

export const parseTask = (text) => parseQuickAdd(text, context());

// Adds the task and returns it, or null when there's no name.
export function addFromText(text) {
  const parsed = parseTask(text);
  if (!parsed.title) return null;
  let projectId = 'inbox';
  let sectionId = null;
  if (parsed.project) projectId = parsed.project.id || A.saveProject(null, { name: parsed.project.name }).id;
  if (parsed.section) {
    const s = A.sections(projectId).find((x) => x.name.toLowerCase() === parsed.section.name.toLowerCase());
    if (s) sectionId = s.id;
  }
  const due = parsed.due;
  return A.addTask({
    title: parsed.title,
    desc: '',
    due: due ? { date: due.date, time: due.time || null, recur: due.recur || null } : null,
    priority: parsed.priority || 4,
    labels: A.ensureLabels(parsed.labels),
    projectId,
    sectionId,
    parentId: null,
  });
}
