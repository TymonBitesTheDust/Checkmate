// Filter queries, e.g. "(today | overdue) & #Work & !@waiting", "p1 | p2", "7 days"
import { today, addDays, diffDays } from './dates.js';
import { isZh, t } from './i18n.js';

// Chinese words accepted in filter queries, mapped to the English terms.
const ZH_TERMS = [
  [/^(今天|今日)$/, 'today'], [/^(明天|明日)$/, 'tomorrow'], [/^昨天$/, 'yesterday'],
  [/^(逾期|過期|已逾期)$/, 'overdue'], [/^(無日期|沒有日期|沒日期)$/, 'no date'], [/^有日期$/, 'has date'],
  [/^(無時間|沒有時間)$/, 'no time'], [/^(重複|週期|重複任務)$/, 'recurring'], [/^(無標籤|沒有標籤)$/, 'no labels'],
  [/^子任務$/, 'subtask'], [/^(無優先級|沒有優先級)$/, 'no priority'], [/^(全部|所有)$/, 'all'],
  [/^(本週|這週|這星期|本星期)$/, 'this week'], [/^(?:未來)?(\d+)\s*(?:天|日)(?:內)?$/, (m) => `${m[1]} days`],
  [/^優先級\s*([1-4])$/, (m) => `p${m[1]}`],
];
function zhTerm(v) {
  for (const [rx, to] of ZH_TERMS) {
    const m = v.match(rx);
    if (m) return typeof to === 'function' ? to(m) : to;
  }
  return v;
}

function tokenize(q) {
  const out = [];
  let buf = '';
  const push = () => {
    if (buf.trim()) out.push({ t: 'term', v: buf.trim() });
    buf = '';
  };
  for (const ch of q) {
    if ('&|!()'.includes(ch) || ch === ',') {
      push();
      out.push({ t: ch === ',' ? '|' : ch });
    } else buf += ch;
  }
  push();
  return out;
}

export function compileFilter(query, ctx) {
  const toks = tokenize(query || '');
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];

  function parseOr() {
    let left = parseAnd();
    while (peek() && peek().t === '|') {
      next();
      const right = parseAnd();
      const l = left;
      left = (t) => l(t) || right(t);
    }
    return left;
  }
  function parseAnd() {
    let left = parseNot();
    while (peek() && peek().t === '&') {
      next();
      const right = parseNot();
      const l = left;
      left = (t) => l(t) && right(t);
    }
    return left;
  }
  function parseNot() {
    if (peek() && peek().t === '!') {
      next();
      const inner = parseNot();
      return (t) => !inner(t);
    }
    return parseAtom();
  }
  function parseAtom() {
    const tok = next();
    if (!tok) return () => true;
    if (tok.t === '(') {
      const inner = parseOr();
      if (peek() && peek().t === ')') next();
      return inner;
    }
    if (tok.t === 'term') return term(tok.v, ctx);
    return () => true;
  }
  try {
    const fn = parseOr();
    return { fn, error: null };
  } catch (e) {
    return { fn: () => false, error: e.message };
  }
}

function term(raw, ctx) {
  const v = zhTerm(raw.toLowerCase().trim());
  const ref = today();
  const due = (t) => (t.due ? t.due.date : null);
  if (v === 'today') return (t) => due(t) === ref;
  if (v === 'tomorrow') return (t) => due(t) === addDays(ref, 1);
  if (v === 'yesterday') return (t) => due(t) === addDays(ref, -1);
  if (v === 'overdue' || v === 'od') return (t) => !!due(t) && due(t) < ref;
  if (v === 'no date' || v === 'no due date') return (t) => !due(t);
  if (v === 'has date' || v === 'dated') return (t) => !!due(t);
  if (v === 'no time') return (t) => !!due(t) && !t.due.time;
  if (v === 'recurring') return (t) => !!(t.due && t.due.recur);
  if (v === 'no labels') return (t) => !t.labels || t.labels.length === 0;
  if (v === 'subtask' || v === 'subtasks') return (t) => !!t.parentId;
  if (v === 'no priority') return (t) => t.priority === 4;
  if (v === 'all' || v === '*') return () => true;
  let m;
  if ((m = v.match(/^p([1-4])$/))) return (t) => t.priority === +m[1];
  if ((m = v.match(/^(?:next\s+)?(\d+)\s+days?$/))) {
    const n = +m[1];
    return (t) => !!due(t) && diffDays(due(t), ref) >= 0 && diffDays(due(t), ref) < n;
  }
  if (v === 'this week' || v === 'next 7 days') return (t) => !!due(t) && diffDays(due(t), ref) >= 0 && diffDays(due(t), ref) < 7;
  if ((m = v.match(/^(?:due\s+)?before:\s*(\d{4}-\d{2}-\d{2})$/))) return (t) => !!due(t) && due(t) < m[1];
  if ((m = v.match(/^(?:due\s+)?after:\s*(\d{4}-\d{2}-\d{2})$/))) return (t) => !!due(t) && due(t) > m[1];
  if (v.startsWith('##') || v.startsWith('#')) {
    const name = v.replace(/^#+/, '').trim();
    const inboxNames = ['inbox', t('Inbox').toLowerCase()];
    const ids = new Set(ctx.projects.filter((p) => p.name.toLowerCase() === name || (p.isInbox && inboxNames.includes(name))).map((p) => p.id));
    return (t) => ids.has(t.projectId);
  }
  if (v.startsWith('@')) {
    const name = v.slice(1).trim();
    if (name === '*' || name === '') return (t) => t.labels && t.labels.length > 0;
    const ids = new Set(ctx.labels.filter((l) => l.name.toLowerCase() === name).map((l) => l.id));
    return (t) => (t.labels || []).some((id) => ids.has(id));
  }
  if (v.startsWith('/')) {
    const name = v.slice(1).trim();
    const ids = new Set(ctx.sections.filter((s) => s.name.toLowerCase() === name).map((s) => s.id));
    return (t) => ids.has(t.sectionId);
  }
  const text = v.replace(/^search:\s*/, '');
  return (t) => (t.title || '').toLowerCase().includes(text) || (t.desc || '').toLowerCase().includes(text);
}

const HELP_EN = [
  ['today', 'Due today'],
  ['overdue', 'Past their due date'],
  ['7 days', 'Due in the next 7 days'],
  ['no date', 'Without a due date'],
  ['p1', 'Priority 1 (p1–p4)'],
  ['#Work', 'In the Work project'],
  ['@email', 'With the email label'],
  ['recurring', 'Repeating tasks'],
  ['&  |  !  ( )', 'And, or, not, grouping'],
];
const HELP_ZH = [
  ['今天', '今天到期'],
  ['逾期', '已過到期日'],
  ['7天', '未來 7 天內到期'],
  ['無日期', '沒有到期日'],
  ['p1', '優先級 1（p1–p4）'],
  ['#工作', '在「工作」專案中'],
  ['@電郵', '有「電郵」標籤'],
  ['重複', '重複的任務'],
  ['&  |  !  ( )', '且、或、非、分組'],
];
export const filterHelp = () => (isZh() ? HELP_ZH : HELP_EN);
export const FILTER_HELP = HELP_EN;
