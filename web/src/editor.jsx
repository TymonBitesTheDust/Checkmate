import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'preact/hooks';
import { taskExample } from './examples.js';
import * as store from './store.js';
import * as A from './actions.js';
import { Icon } from './icons.jsx';
import { Popover, Menu, autoGrow, isNarrow } from './ui.jsx';
import { play } from './sound.js';
import { parseQuickAdd, parseDateText, recurText, ordinal, describeRecur } from './parse.js';
import {
  today, addDays, ymd, parseYmd, weekday, nextWeekday, startOfWeek, dueLabel, formatTime,
  dayName, dayShort, dayMin, monthYear, shortDate, dayLong,
} from './dates.js';
import { tr, isZh } from './i18n.js';

export const PRIORITY_NAMES = { 1: 'Priority 1', 2: 'Priority 2', 3: 'Priority 3', 4: 'Priority 4' };

// ---------- due date picker ----------

export function DuePicker({ anchor, value, onChange, onClose }) {
  const prefs = store.getPrefs();
  const ref = today();
  const [text, setText] = useState('');
  const [month, setMonth] = useState(() => {
    const d = parseYmd(value && value.date ? value.date : ref);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const parsed = useMemo(() => (text.trim() ? parseDateText(text, { dateOrder: prefs.dateOrder }) : null), [text]);
  const cur = value || null;

  const set = (patch) => {
    if (patch === null) return onChange(null);
    const base = cur || { date: ref, time: null, recur: null };
    const next = { ...base, ...patch };
    if (next.recur) {
      // keep weekly/monthly rules anchored to the chosen date
      if (patch.date && next.recur.unit === 'week' && next.recur.days && next.recur.days.length === 1) {
        next.recur = { ...next.recur, days: [weekday(next.date)] };
        next.recur.text = recurText(next.recur);
      }
      if (patch.date && next.recur.unit === 'month' && next.recur.monthDay) {
        next.recur = { ...next.recur, monthDay: parseYmd(next.date).getDate() };
        next.recur.text = recurText(next.recur);
      }
    }
    onChange(next);
  };

  const nextMon = addDays(startOfWeek(ref, 1), 7);
  const quick = [
    { label: tr('Today'), icon: 'today', date: ref, hint: dayShort(weekday(ref)) },
    { label: tr('Tomorrow'), icon: 'sun', date: addDays(ref, 1), hint: dayShort(weekday(addDays(ref, 1))) },
    weekday(ref) >= 1 && weekday(ref) <= 4
      ? { label: tr('This weekend'), icon: 'sofa', date: nextWeekday(ref, 6), hint: dayShort(6) }
      : null,
    { label: tr('Next week'), icon: 'arrowRight', date: nextMon, hint: `${dayShort(1)} ${shortDate(nextMon, ref)}` },
  ].filter(Boolean);

  // calendar grid
  const ws = prefs.weekStart ?? 1;
  const first = ymd(month);
  const gridStart = addDays(first, -((weekday(first) - ws + 7) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const dayNames = Array.from({ length: 7 }, (_, i) => dayMin((ws + i) % 7));
  const selDate = cur && cur.date;
  const busy = useMemo(() => {
    const m = {};
    A.openTasks().forEach((t) => t.due && (m[t.due.date] = (m[t.due.date] || 0) + 1));
    return m;
  }, []);

  const d0 = (cur && cur.date) || ref;
  const wd0 = weekday(d0);
  const dm0 = parseYmd(d0).getDate();
  const mo0 = parseYmd(d0).getMonth();
  const repeatOpts = [
    { key: 'none', label: tr('Doesn’t repeat'), recur: null },
    { key: 'day', label: tr('Every day'), recur: { unit: 'day', every: 1 } },
    { key: 'weekday', label: tr('Every weekday (Mon–Fri)'), recur: { unit: 'weekday', every: 1 } },
    { key: 'week', label: tr('Every week on {day}', { day: dayName(wd0) }), recur: { unit: 'week', every: 1, days: [wd0] } },
    { key: 'week2', label: tr('Every 2 weeks on {day}', { day: dayName(wd0) }), recur: { unit: 'week', every: 2, days: [wd0] } },
    { key: 'month', label: tr('Every month on the {nth}', { nth: isZh() ? `${dm0}日` : ordinal(dm0) }), recur: { unit: 'month', every: 1, monthDay: dm0 } },
    { key: 'year', label: tr('Every year on {date}', { date: shortDate(d0, d0) }), recur: { unit: 'year', every: 1, month: mo0, monthDay: dm0 } },
  ];
  const recKey = (() => {
    const r = cur && cur.recur;
    if (!r) return 'none';
    for (const o of repeatOpts) {
      if (!o.recur) continue;
      if (o.recur.unit === r.unit && (o.recur.every || 1) === (r.every || 1) && !r.fromDone) {
        if (r.unit === 'week' && (r.days || []).join() !== (o.recur.days || []).join()) continue;
        return o.key;
      }
    }
    return 'custom';
  })();

  const applyText = () => {
    if (!parsed) return;
    onChange(parsed);
    setText('');
    onClose();
  };

  return (
    <Popover anchor={anchor} onClose={onClose} class="due-picker" sheetTitle={tr('Due date')} width={300}>
      <div class="due-text">
        <input
          type="text"
          placeholder={tr('Type a date: fri 3pm, every mon')}
          value={text}
          aria-label={tr('Type a due date')}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyText();
            }
          }}
          autoFocus={!isNarrow()}
        />
        {text.trim() && (
          <div class={`due-preview ${parsed ? '' : 'none'}`}>
            {parsed ? (
              <button type="button" class="link-btn" onClick={applyText}>
                <Icon name="calendar" size={16} />
                {dueLabel(parsed, prefs.timeFormat).text}
                {parsed.recur && <span class="muted"> · {describeRecur(parsed.recur)}</span>}
              </button>
            ) : (
              tr('No date recognised yet')
            )}
          </div>
        )}
      </div>
      <div class="due-quick">
        {quick.map((q) => (
          <button type="button" key={q.label} class="due-quick-item" onClick={() => (set({ date: q.date }), onClose())}>
            <Icon name={q.icon} size={18} />
            <span>{q.label}</span>
            <span class="muted">{q.hint}</span>
          </button>
        ))}
        {cur && (
          <button type="button" class="due-quick-item" onClick={() => (onChange(null), onClose())}>
            <Icon name="ban" size={18} />
            <span>{tr('No date')}</span>
          </button>
        )}
      </div>
      <div class="cal">
        <div class="cal-head">
          <strong>{monthYear(month)}</strong>
          <div>
            <button type="button" class="icon-btn sm" aria-label={tr('Previous month')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
              <Icon name="left" size={18} />
            </button>
            <button type="button" class="icon-btn sm" aria-label={tr('Next month')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              <Icon name="right" size={18} />
            </button>
          </div>
        </div>
        <div class="cal-grid" role="grid">
          {dayNames.map((d) => (
            <span class="cal-dn" key={d}>{d}</span>
          ))}
          {cells.map((c) => {
            const d = parseYmd(c);
            const out = d.getMonth() !== month.getMonth();
            return (
              <button
                type="button"
                key={c}
                class={`cal-day ${out ? 'out' : ''} ${c === ref ? 'today' : ''} ${c === selDate ? 'sel' : ''} ${c < ref ? 'past' : ''}`}
                aria-label={dayLong(c)}
                aria-pressed={c === selDate}
                onClick={() => set({ date: c })}
              >
                {d.getDate()}
                {busy[c] && <i class="cal-dot" />}
              </button>
            );
          })}
        </div>
      </div>
      <div class="due-extra">
        <label class="due-row">
          <Icon name="clock" size={18} />
          <input
            type="time"
            value={(cur && cur.time) || ''}
            aria-label={tr('Time')}
            onChange={(e) => set({ time: e.currentTarget.value || null })}
          />
          {cur && cur.time && (
            <button type="button" class="icon-btn sm" aria-label={tr('Remove time')} onClick={() => set({ time: null })}>
              <Icon name="close" size={16} />
            </button>
          )}
        </label>
        <label class="due-row">
          <Icon name="repeat" size={18} />
          <select
            value={recKey}
            aria-label={tr('Repeat')}
            onChange={(e) => {
              const o = repeatOpts.find((x) => x.key === e.currentTarget.value);
              if (!o) return;
              const recur = o.recur ? { ...o.recur, text: recurText(o.recur) } : null;
              set({ recur });
            }}
          >
            {repeatOpts.map((o) => (
              <option value={o.key} key={o.key}>{o.label}</option>
            ))}
            {recKey === 'custom' && <option value="custom">{describeRecur(cur.recur)}</option>}
          </select>
        </label>
      </div>
      <div class="pop-foot">
        <button type="button" class="btn primary sm" onClick={onClose}>{tr('Done')}</button>
      </div>
    </Popover>
  );
}

// ---------- labels ----------

export function LabelPicker({ anchor, value = [], onChange, onClose }) {
  const [q, setQ] = useState('');
  const all = A.labels();
  const shown = all.filter((l) => l.name.toLowerCase().includes(q.toLowerCase()));
  const exact = all.find((l) => l.name.toLowerCase() === q.trim().toLowerCase());
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const create = () => {
    const name = q.trim().replace(/^@/, '').replace(/\s+/g, '_');
    if (!name) return;
    const l = A.saveLabel(null, { name });
    onChange([...value, l.id]);
    setQ('');
  };
  return (
    <Popover anchor={anchor} onClose={onClose} class="picker" sheetTitle={tr('Labels')} width={260}>
      <div class="picker-search">
        <input
          type="text"
          placeholder={tr('Find or create a label')}
          value={q}
          aria-label={tr('Find or create a label')}
          autoFocus={!isNarrow()}
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (exact) toggle(exact.id);
              else if (q.trim()) create();
            }
          }}
        />
      </div>
      <div class="picker-list">
        {shown.map((l) => (
          <label class="picker-item" key={l.id}>
            <Icon name="tag" size={18} class="tint" />
            <span class="picker-name" style={{ '--tint': A.colorOf(l.color) }}>{l.name}</span>
            <input type="checkbox" checked={value.includes(l.id)} onChange={() => toggle(l.id)} />
          </label>
        ))}
        {!shown.length && !q && <div class="picker-empty">{tr('No labels yet. Type a name to create one.')}</div>}
        {q.trim() && !exact && (
          <button type="button" class="picker-item create" onClick={create}>
            <Icon name="plus" size={18} />
            <span>{tr('Create “{name}”', { name: q.trim().replace(/^@/, '') })}</span>
          </button>
        )}
      </div>
    </Popover>
  );
}

// ---------- project / section ----------

export function ProjectPicker({ anchor, projectId, sectionId, onChange, onClose }) {
  const [q, setQ] = useState('');
  const list = A.projects();
  const match = (s) => s.toLowerCase().includes(q.toLowerCase());
  const rows = [];
  for (const p of list) {
    const secs = A.sections(p.id);
    const pm = match(A.projectName(p));
    const sm = secs.filter((s) => match(s.name) || pm);
    if (!pm && !sm.length) continue;
    rows.push({ p, s: null });
    sm.forEach((s) => rows.push({ p, s }));
  }
  return (
    <Popover anchor={anchor} onClose={onClose} class="picker" sheetTitle={tr('Move to')} width={280}>
      <div class="picker-search">
        <input type="text" placeholder={tr('Type a project name')} value={q} aria-label={tr('Find a project')} autoFocus={!isNarrow()} onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      <div class="picker-list">
        {rows.map(({ p, s }) => {
          const on = p.id === projectId && (s ? s.id === sectionId : !sectionId);
          return (
            <button
              type="button"
              key={p.id + (s ? s.id : '')}
              class={`picker-item ${s ? 'indent' : ''} ${on ? 'on' : ''}`}
              onClick={() => {
                onChange({ projectId: p.id, sectionId: s ? s.id : null });
                onClose();
              }}
            >
              {s ? <Icon name="section" size={16} /> : p.isInbox ? <Icon name="inbox" size={18} /> : <span class="pdot" style={{ background: A.colorOf(p.color) }} />}
              <span class="picker-name">{s ? s.name : A.projectName(p)}</span>
              {on && <span class="menu-check">✓</span>}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

export function PriorityPicker({ anchor, value, onChange, onClose }) {
  return (
    <Menu
      anchor={anchor}
      onClose={onClose}
      title={tr('Priority')}
      items={[1, 2, 3, 4].map((p) => ({
        label: tr('Priority {n}', { n: p }),
        icon: 'flag',
        iconClass: `prio-${p}`,
        hint: `p${p}`,
        checked: value === p,
        onSelect: () => onChange(p),
      }))}
    />
  );
}

// ---------- task editor (adding tasks) ----------

// A long hint is cut at a word with "…" when the box is too narrow to show it all
// (the browser would just chop it mid-letter, since the box has focus).
function fitHint(input, full) {
  if (!input || !input.clientWidth) return full;
  let cs;
  try {
    cs = getComputedStyle(input, '::placeholder');
  } catch {
    cs = getComputedStyle(input);
  }
  const box = getComputedStyle(input);
  const avail = input.clientWidth - parseFloat(box.paddingLeft || 0) - parseFloat(box.paddingRight || 0) - 2;
  const c = fitHint.ctx || (fitHint.ctx = document.createElement('canvas').getContext('2d'));
  if (!c) return full;
  c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  if ('letterSpacing' in c) c.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
  const up = cs.textTransform === 'uppercase';
  const w = (t) => c.measureText(up ? t.toUpperCase() : t).width;
  if (w(full) <= avail) return full;
  const chars = [...full];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (w(chars.slice(0, mid).join('') + '…') <= avail) lo = mid;
    else hi = mid - 1;
  }
  let cut = chars.slice(0, lo).join('');
  const sp = cut.lastIndexOf(' ');
  // end on a whole word when the next character doesn't already start one
  // (Chinese has no spaces between words, so it's cut at any character)
  if (sp > cut.length * 0.6 && chars[lo] && chars[lo] !== ' ' && !/[\u3000-\u9fff\uff00-\uffef]/.test(cut.slice(sp))) cut = cut.slice(0, sp);
  return cut.replace(/[\s,，、。.:：]+$/, '') + '…';
}

function useFittedHint(ref, full) {
  const [shown, setShown] = useState(full);
  useLayoutEffect(() => {
    const el = ref.current;
    const fit = () => setShown(fitHint(ref.current, full));
    fit();
    let ro;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(fit);
      ro.observe(el);
    }
    let live = true;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => live && fit());
    return () => {
      live = false;
      ro && ro.disconnect();
    };
  }, [full]);
  return shown;
}

export function TaskEditor({ defaults = {}, onSubmit, onCancel, submitLabel, compact = false, autoFocus = true, keepOpen = true }) {
  const prefs = store.getPrefs();
  const [text, setText] = useState('');
  const [desc, setDesc] = useState('');
  const [due, setDue] = useState(defaults.due === undefined ? undefined : defaults.due);
  const [dueTouched, setDueTouched] = useState(false);
  const [priority, setPriority] = useState(defaults.priority || 4);
  const [labelIds, setLabelIds] = useState(defaults.labels || []);
  const [where, setWhere] = useState({ projectId: defaults.projectId || 'inbox', sectionId: defaults.sectionId || null });
  const [disabled, setDisabled] = useState(new Set());
  const [pop, setPop] = useState(null); // {kind, anchor}
  const [example, setExample] = useState(() => taskExample());
  const inputRef = useRef(null);
  const descRef = useRef(null);
  const hint = defaults.parentId ? tr('Subtask name') : tr('Task name, e.g. {example}', { example });
  const shownHint = useFittedHint(inputRef, hint);

  // Focus before the next keystroke arrives, so fast typing after Q isn't lost.
  useLayoutEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, []);

  const ctx = {
    // The Inbox answers to its English name and its translated one.
    projects: [...A.projects().map((p) => ({ id: p.id, name: A.projectName(p) })), ...(isZh() ? [{ id: 'inbox', name: 'Inbox' }] : [])],
    sections: A.sections(where.projectId).map((s) => ({ id: s.id, name: s.name })),
    labels: A.labels().map((l) => ({ id: l.id, name: l.name })),
    dateOrder: prefs.dateOrder,
    timeFormat: prefs.timeFormat,
    keepTime: prefs.keepTimeInName !== false,
    disabled,
  };
  const parsed = parseQuickAdd(text, ctx);
  const effDue = dueTouched ? due : parsed.due || due || null;
  const effPriority = parsed.priority || priority;
  const proj = A.projects().find((p) => p.id === where.projectId) || A.projects()[0];
  const sec = where.sectionId && store.get(where.sectionId);

  const submit = (e) => {
    e && e.preventDefault();
    if (!parsed.title) return;
    let projectId = where.projectId;
    let sectionId = where.sectionId;
    if (parsed.project) {
      projectId = parsed.project.id || A.saveProject(null, { name: parsed.project.name }).id;
      if (projectId !== where.projectId) sectionId = null;
    }
    if (parsed.section) {
      const s = A.sections(projectId).find((x) => x.name.toLowerCase() === parsed.section.name.toLowerCase());
      if (s) sectionId = s.id;
    }
    const lbls = [...new Set([...labelIds, ...A.ensureLabels(parsed.labels)])];
    play('add');
    onSubmit({
      title: parsed.title,
      desc: desc.trim(),
      due: effDue ? { date: effDue.date, time: effDue.time || null, recur: effDue.recur || null } : null,
      priority: effPriority,
      labels: lbls,
      projectId,
      sectionId,
      parentId: defaults.parentId || null,
    });
    setText('');
    setExample(taskExample());
    setDesc('');
    setDisabled(new Set());
    setDue(defaults.due === undefined ? undefined : defaults.due);
    setDueTouched(false);
    setPriority(defaults.priority || 4);
    setLabelIds(defaults.labels || []);
    if (descRef.current) descRef.current.style.height = '';
    if (!keepOpen) onCancel && onCancel();
    else inputRef.current && inputRef.current.focus();
  };

  const open = (kind) => (e) => setPop({ kind, anchor: e.currentTarget });
  const dueInfo = effDue ? dueLabel(effDue, prefs.timeFormat) : null;
  const labelNames = [...new Set([...labelIds.map((id) => store.get(id)).filter(Boolean).map((l) => l.name)])];
  const dateChip = !dueTouched && parsed.chips.find((c) => c.kind === 'date');
  const prioChip = parsed.chips.find((c) => c.kind === 'priority');
  const otherChips = parsed.chips.filter((c) => c.kind !== 'date' && c.kind !== 'priority');
  const keepAsText = (key) => {
    const n = new Set(disabled);
    n.add(key);
    setDisabled(n);
    inputRef.current && inputRef.current.focus();
  };
  const shownProj = parsed.project ? (parsed.project.id ? store.get(parsed.project.id) : { name: parsed.project.name, color: 'pine' }) : proj;
  const shownName = shownProj ? (shownProj.isInbox ? A.projectName(shownProj) : shownProj.name) : tr('Inbox');

  return (
    <form class={`editor ${compact ? 'compact' : ''}`} onSubmit={submit} onKeyDown={(e) => {
      if (e.key === 'Escape' && !pop) {
        e.preventDefault();
        e.stopPropagation();
        onCancel && onCancel();
      }
    }}>
      <div class="editor-body">
        <input
          ref={inputRef}
          class="editor-title"
          type="text"
          value={text}
          placeholder={shownHint}
          title={shownHint !== hint ? hint : undefined}
          aria-label={tr('Task name')}
          enterkeyhint="done"
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) submit(e);
          }}
        />
        <textarea
          ref={descRef}
          class="editor-desc"
          rows={1}
          value={desc}
          placeholder={tr('Description')}
          aria-label={tr('Description')}
          onInput={(e) => {
            setDesc(e.currentTarget.value);
            autoGrow(e.currentTarget);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
          }}
        />
        {otherChips.length > 0 && (
          <div class="chips" aria-label={tr('Recognised in the task name')}>
            {otherChips.map((c) => (
              <span class={`chip chip-${c.kind}`} key={c.key}>
                {c.kind === 'project' && <Icon name="hash" size={14} />}
                {c.kind === 'label' && <Icon name="tag" size={14} />}
                {c.kind === 'section' && <Icon name="section" size={14} />}
                {c.label}
                <button type="button" class="chip-x" aria-label={tr('Keep “{text}” as plain text', { text: c.label })} title={tr('Keep as plain text')} onClick={() => keepAsText(c.key)}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div class="editor-tools">
          <span class={`tool-wrap ${dateChip ? 'parsed' : ''}`}>
            <button type="button" class={`tool ${dueInfo ? `has tone-${dueInfo.tone}` : ''}`} onClick={open('due')} title={dateChip ? tr('Recognised from the task name') : tr('Due date')}>
              <Icon name={effDue && effDue.recur ? 'repeat' : 'calendar'} size={16} />
              <span>{dueInfo ? dueInfo.text : tr('Date')}{effDue && effDue.recur ? ` · ${describeRecur(effDue.recur)}` : ''}</span>
            </button>
            {dateChip && (
              <button type="button" class="tool-x" aria-label={tr('Keep the date words as plain text')} title={tr('Keep as plain text')} onClick={() => keepAsText('date')}>
                <Icon name="close" size={12} />
              </button>
            )}
          </span>
          <span class={`tool-wrap ${prioChip ? 'parsed' : ''}`}>
            <button type="button" class={`tool ${effPriority < 4 ? `has prio-${effPriority}` : ''}`} onClick={open('priority')} aria-label={tr('Priority')}>
              <Icon name="flag" size={16} />
              <span>{effPriority < 4 ? `P${effPriority}` : tr('Priority')}</span>
            </button>
            {prioChip && (
              <button type="button" class="tool-x" aria-label={tr('Keep the priority as plain text')} title={tr('Keep as plain text')} onClick={() => keepAsText('priority')}>
                <Icon name="close" size={12} />
              </button>
            )}
          </span>
          <button type="button" class={`tool ${labelNames.length ? 'has' : ''}`} onClick={open('labels')}>
            <Icon name="tag" size={16} />
            <span>{labelNames.length ? labelNames.join(isZh() ? '、' : ', ') : tr('Labels')}</span>
          </button>
        </div>
      </div>
      <div class="editor-foot">
        {!defaults.parentId ? (
          <button type="button" class="tool where" onClick={open('project')}>
            {shownProj && shownProj.isInbox ? <Icon name="inbox" size={16} /> : <span class="pdot" style={{ background: A.colorOf(shownProj && shownProj.color) }} />}
            <span>{shownName}{parsed.section ? ` / ${parsed.section.name}` : sec && !parsed.project ? ` / ${sec.name}` : ''}</span>
            <Icon name="down" size={14} />
          </button>
        ) : (
          <span />
        )}
        <div class="editor-actions">
          {onCancel && (
            <button type="button" class="btn ghost sm" onClick={onCancel}>{tr('Cancel')}</button>
          )}
          <button type="submit" class="btn primary sm" disabled={!parsed.title}>{submitLabel || tr('Add task')}</button>
        </div>
      </div>
      {pop && pop.kind === 'due' && (
        <DuePicker
          anchor={pop.anchor}
          value={effDue}
          onChange={(d) => {
            setDue(d);
            setDueTouched(true);
            if (parsed.due) {
              const n = new Set(disabled);
              n.add('date');
              setDisabled(n);
            }
          }}
          onClose={() => setPop(null)}
        />
      )}
      {pop && pop.kind === 'priority' && (
        <PriorityPicker anchor={pop.anchor} value={effPriority} onClose={() => setPop(null)} onChange={(p) => {
          setPriority(p);
          if (parsed.priority) {
            const n = new Set(disabled);
            n.add('priority');
            setDisabled(n);
          }
        }} />
      )}
      {pop && pop.kind === 'labels' && <LabelPicker anchor={pop.anchor} value={labelIds} onChange={setLabelIds} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'project' && (
        <ProjectPicker anchor={pop.anchor} projectId={where.projectId} sectionId={where.sectionId} onChange={setWhere} onClose={() => setPop(null)} />
      )}
    </form>
  );
}
