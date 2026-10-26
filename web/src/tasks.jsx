import { useState, useRef } from 'preact/hooks';
import * as store from './store.js';
import * as A from './actions.js';
import { ui } from './bus.js';
import { Icon } from './icons.jsx';
import { Menu, Linkify } from './ui.jsx';
import { TaskEditor, DuePicker, PriorityPicker, ProjectPicker, LabelPicker } from './editor.jsx';
import { dueLabel, today, addDays } from './dates.js';
import { Shatter } from './tide.jsx';
import { Stamp, Shards, isRiot, reducedMotion } from './riot.jsx';
import { play } from './sound.js';
import { tr } from './i18n.js';

// ---------------------------------------------------------------------------
// Drag and drop (pointer based, so it works with mouse and touch)
// ---------------------------------------------------------------------------

const drag = { id: null, ghost: null, line: null, target: null, startY: 0, startX: 0, moved: false, scroller: null, raf: 0, pointer: null };

function findScroller(el) {
  while (el && el !== document.body) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return document.scrollingElement;
}

function beginDrag(e, task, rowEl) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  drag.id = task.id;
  drag.row = rowEl;
  drag.startX = e.clientX;
  drag.startY = e.clientY;
  drag.moved = false;
  drag.scroller = findScroller(rowEl);
  drag.rowRect = rowEl.getBoundingClientRect();
  drag.pointer = { x: e.clientX, y: e.clientY };
  window.addEventListener('pointermove', onDragMove, { passive: false });
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragCancel);
  window.addEventListener('touchmove', blockTouch, { passive: false });
}

// Once a drag has started, stop the page from scrolling under the finger.
function blockTouch(e) {
  if (drag.id && drag.moved) e.preventDefault();
}

function startVisuals() {
  const r = drag.row.getBoundingClientRect();
  const ghost = drag.row.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width = `${r.width}px`;
  ghost.style.left = `${r.left}px`;
  ghost.style.top = `${r.top}px`;
  drag.offY = drag.startY - r.top;
  drag.offX = drag.startX - r.left;
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  const line = document.createElement('div');
  line.className = 'drop-line';
  document.body.appendChild(line);
  drag.line = line;
  drag.row.classList.add('dragging');
  document.body.classList.add('is-dragging');
  autoScroll();
}

function autoScroll() {
  cancelAnimationFrame(drag.raf);
  const step = () => {
    if (!drag.id || !drag.scroller) return;
    const sc = drag.scroller;
    const rect = sc === document.scrollingElement ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
    const y = drag.pointer.y;
    const edge = 60;
    let dy = 0;
    if (y < rect.top + edge) dy = -Math.ceil((rect.top + edge - y) / 6);
    else if (y > rect.bottom - edge) dy = Math.ceil((y - (rect.bottom - edge)) / 6);
    if (dy) {
      sc.scrollTop += dy;
      updateTarget();
    }
    drag.raf = requestAnimationFrame(step);
  };
  drag.raf = requestAnimationFrame(step);
}

function onDragMove(e) {
  if (!drag.id) return;
  e.preventDefault();
  drag.pointer = { x: e.clientX, y: e.clientY };
  if (!drag.moved) {
    if (Math.abs(e.clientY - drag.startY) + Math.abs(e.clientX - drag.startX) < 4) return;
    drag.moved = true;
    startVisuals();
  }
  drag.ghost.style.top = `${e.clientY - drag.offY}px`;
  drag.ghost.style.left = `${e.clientX - drag.offX}px`;
  updateTarget();
}

function hitTest(x, y) {
  const el = document.elementFromPoint(x, y);
  return el && (el.closest('[data-drop-row]') || el.closest('[data-zone]')) ? el : null;
}

function updateTarget() {
  const { y } = drag.pointer;
  let { x } = drag.pointer;
  drag.ghost.style.display = 'none';
  let el = hitTest(x, y);
  // The grip sits left of the row, so a straight vertical drag can miss every row:
  // fall back to the middle of the column the drag started in.
  if (!el && drag.rowRect) {
    x = drag.rowRect.left + drag.rowRect.width / 2;
    el = hitTest(x, y);
  }
  drag.ghost.style.display = '';
  drag.target = null;
  drag.line.style.display = 'none';
  if (!el) return;
  const row = el.closest('[data-drop-row]');
  if (row && row.dataset.id !== drag.id && !row.closest('.dragging')) {
    const r = row.getBoundingClientRect();
    const after = y > r.top + r.height / 2;
    drag.target = { kind: 'row', id: row.dataset.id, after, zone: row.closest('[data-zone]') };
    const top = after ? r.bottom : r.top;
    Object.assign(drag.line.style, { display: 'block', left: `${r.left + 8}px`, width: `${r.width - 16}px`, top: `${top - 1}px` });
    return;
  }
  const zone = el.closest('[data-zone]');
  if (zone) {
    drag.target = { kind: 'zone', zone };
    const r = zone.getBoundingClientRect();
    const rows = [...zone.querySelectorAll(':scope [data-drop-row]')].filter((x) => x.dataset.id !== drag.id);
    const lastRow = rows[rows.length - 1];
    const top = lastRow ? lastRow.getBoundingClientRect().bottom : r.top + 6;
    Object.assign(drag.line.style, { display: 'block', left: `${r.left + 8}px`, width: `${r.width - 16}px`, top: `${top - 1}px` });
  }
}

function cleanup() {
  cancelAnimationFrame(drag.raf);
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragCancel);
  window.removeEventListener('touchmove', blockTouch);
  drag.ghost && drag.ghost.remove();
  drag.line && drag.line.remove();
  drag.row && drag.row.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
  Object.assign(drag, { id: null, ghost: null, line: null, target: null, row: null, moved: false });
}

function onDragCancel() {
  cleanup();
}

function onDragEnd() {
  const id = drag.id;
  const target = drag.target;
  const moved = drag.moved;
  cleanup();
  if (!moved || !target) return;
  const task = store.get(id);
  if (!task) return;
  const zone = target.zone;
  const zkind = zone ? zone.dataset.zone : null;

  play('drop');
  if (zkind === 'date') {
    const date = zone.dataset.date;
    const due = { ...(task.due || { time: null, recur: null }), date };
    store.patch(id, { due });
    return;
  }

  if (target.kind === 'row') {
    const ref = store.get(target.id);
    if (!ref) return;
    if (A.descendants(id).some((d) => d.id === ref.id)) return;
    const sibs = A.sortTasks(
      A.tasks().filter((t) => t.id !== id && t.projectId === ref.projectId && (t.sectionId || null) === (ref.sectionId || null) && (t.parentId || null) === (ref.parentId || null)),
    );
    const i = sibs.findIndex((t) => t.id === ref.id);
    const prev = target.after ? sibs[i] : sibs[i - 1];
    const next = target.after ? sibs[i + 1] : sibs[i];
    const order = A.orderBetween(prev ? prev.order : null, next ? next.order : null);
    A.moveTask(id, { projectId: ref.projectId, sectionId: ref.sectionId || null, parentId: ref.parentId || null, order });
    return;
  }

  if (zkind === 'section') {
    const projectId = zone.dataset.project;
    const sectionId = zone.dataset.section || null;
    const sibs = A.tasks().filter((t) => t.id !== id && t.projectId === projectId && (t.sectionId || null) === sectionId && !t.parentId);
    A.moveTask(id, { projectId, sectionId, parentId: null, order: A.nextOrder(sibs) });
  }
}

// Long-press to drag on touch screens.
function useLongPress(task, enabled) {
  const timer = useRef(null);
  if (!enabled) return {};
  return {
    onPointerDown: (e) => {
      if (e.pointerType !== 'touch') return;
      const row = e.currentTarget;
      const start = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, button: 0 };
      clearTimeout(timer.current);
      const cancel = (ev) => {
        if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 8) clear();
      };
      const clear = () => {
        clearTimeout(timer.current);
        row.removeEventListener('pointermove', cancel);
        row.removeEventListener('pointerup', clear);
        row.removeEventListener('pointercancel', clear);
      };
      row.addEventListener('pointermove', cancel);
      row.addEventListener('pointerup', clear);
      row.addEventListener('pointercancel', clear);
      timer.current = setTimeout(() => {
        clear();
        if (navigator.vibrate) navigator.vibrate(12);
        row.dataset.longpress = '1';
        beginDrag({ ...start, preventDefault() {}, stopPropagation() {} }, task, row);
        drag.moved = true;
        startVisuals();
        const r = row.getBoundingClientRect();
        drag.ghost.style.top = `${r.top}px`;
      }, 420);
    },
  };
}

// ---------------------------------------------------------------------------
// Task row
// ---------------------------------------------------------------------------

export function TaskRow({ task: t, depth = 0, showProject = false, showParent = false, draggable = false, childCount = 0, doneChildCount = 0, collapsed = false, canExpand = childCount > 0 }) {
  const prefs = store.getPrefs();
  const [completing, setCompleting] = useState(false);
  const [pop, setPop] = useState(null);
  const rowRef = useRef(null);
  const due = dueLabel(t.due, prefs.timeFormat);
  const proj = showProject ? store.get(t.projectId) : null;
  const parent = showParent && t.parentId ? store.get(t.parentId) : null;
  const lbls = (t.labels || []).map((id) => store.get(id)).filter(Boolean);
  const ncomments = store.all('comment').filter((c) => c.taskId === t.id).length;
  const nfiles = (t.files || []).length;
  const hasOwnReminders = !!(t.due && Array.isArray(t.reminders) && t.reminders.length);
  const lp = useLongPress(t, draggable);

  const onCheck = (e) => {
    e.stopPropagation();
    if (t.done) {
      play('uncomplete');
      A.uncompleteTask(t.id);
      return;
    }
    setCompleting(true);
    play(completionSound(t));
    // Persona 5 waits for the slash and the stamp to land
    setTimeout(() => {
      A.completeTask(t.id);
      setCompleting(false);
    }, isRiot() ? (reducedMotion() ? 200 : 520) : 380);
  };

  const open = (e) => {
    if (rowRef.current && rowRef.current.dataset.longpress) {
      delete rowRef.current.dataset.longpress;
      return;
    }
    if (e.target.closest('button, a, input')) return;
    ui.openTask(t.id);
  };

  const menuItems = () => [
    { label: tr('Edit task'), icon: 'edit', onSelect: () => ui.openTask(t.id) },
    { label: tr('Add subtask'), icon: 'sub', onSelect: () => ui.openTask(t.id, { addSub: true }) },
    { divider: true },
    { label: tr('Today'), icon: 'today', hint: tr('Due'), onSelect: () => A.updateTask(t.id, { due: { ...(t.due || { time: null, recur: null }), date: today() } }) },
    { label: tr('Tomorrow'), icon: 'sun', onSelect: () => A.updateTask(t.id, { due: { ...(t.due || { time: null, recur: null }), date: addDays(today(), 1) } }) },
    { label: tr('Pick a date…'), icon: 'calendar', onSelect: () => setPop({ kind: 'due', anchor: rowRef.current.querySelector('.task-actions') || rowRef.current }) },
    t.due && { label: tr('Remove date'), icon: 'ban', onSelect: () => A.updateTask(t.id, { due: null }) },
    { divider: true },
    { label: tr('Priority…'), icon: 'flag', iconClass: `prio-${t.priority}`, onSelect: () => setPop({ kind: 'priority', anchor: rowRef.current.querySelector('.task-actions') || rowRef.current }) },
    { label: tr('Labels…'), icon: 'tag', onSelect: () => setPop({ kind: 'labels', anchor: rowRef.current.querySelector('.task-actions') || rowRef.current }) },
    { label: tr('Move to…'), icon: 'arrowRight', onSelect: () => setPop({ kind: 'move', anchor: rowRef.current.querySelector('.task-actions') || rowRef.current }) },
    { label: tr('Duplicate'), icon: 'copy', onSelect: () => A.duplicateTask(t.id) },
    { divider: true },
    { label: tr('Delete task'), icon: 'trash', danger: true, onSelect: () => A.deleteTask(t.id) },
  ];

  return (
    <div
      ref={rowRef}
      class={`task-row ${completing ? 'completing' : ''} ${t.done ? 'is-done' : ''}`}
      style={{ '--depth': depth }}
      data-id={t.id}
      data-prio={t.priority || 4}
      data-drop-row={draggable ? '1' : undefined}
      onClick={open}
      {...lp}
    >
      <Shards />
      {completing && <Shatter />}
      {completing && <Stamp repeat={!!(t.due && t.due.recur)} />}
      {/* the strip left of the row (handle and arrow) counts as the row, so hovering there is steady */}
      <span class="row-gutter" aria-hidden="true" />
      {draggable && (
        <button type="button" class="grip" aria-label={tr('Drag to reorder')} tabIndex={-1} onPointerDown={(e) => beginDrag(e, t, rowRef.current)}>
          <Icon name="grip" size={16} />
        </button>
      )}
      {canExpand ? (
        <button
          type="button"
          class={`twisty ${collapsed ? '' : 'open'}`}
          aria-label={collapsed ? tr('Show subtasks') : tr('Hide subtasks')}
          aria-expanded={!collapsed}
          onClick={(e) => {
            e.stopPropagation();
            A.updateTask(t.id, { collapsed: !collapsed });
          }}
        >
          <Icon name="chevron" size={14} />
        </button>
      ) : (
        <span class="twisty-space" />
      )}
      <button
        type="button"
        class={`check prio-${t.priority || 4} ${t.done || completing ? 'on' : ''}`}
        role="checkbox"
        aria-checked={t.done || completing}
        aria-label={t.done ? tr('Mark “{title}” as not done', { title: t.title }) : tr('Complete “{title}”', { title: t.title })}
        onClick={onCheck}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="m7.8 12.3 2.9 2.9 5.5-6" />
        </svg>
      </button>
      <div class="task-main">
        <div class="task-title"><Linkify text={t.title} /></div>
        {t.desc && <div class="task-desc">{t.desc.split('\n')[0]}</div>}
        {(due || childCount > 0 || ncomments > 0 || nfiles > 0 || lbls.length > 0 || proj || parent) && (
          <div class="task-meta">
            {due && (
              <span class={`meta-due tone-${t.done ? 'later' : due.tone}`}>
                <Icon name={t.due.recur ? 'repeat' : 'calendar'} size={13} />
                {due.text}
              </span>
            )}
            {childCount > 0 && (
              <span class="meta-sub">
                <Icon name="sub" size={13} />
                {doneChildCount}/{childCount}
              </span>
            )}
            {ncomments > 0 && (
              <span class="meta-sub">
                <Icon name="comment" size={13} />
                {ncomments}
              </span>
            )}
            {nfiles > 0 && (
              <span class="meta-sub" title={tr('{n} file{s}', { n: nfiles })}>
                <Icon name="clip" size={13} />
                {nfiles}
              </span>
            )}
            {hasOwnReminders && (
              <span class="meta-sub" title={tr('Reminders')}>
                <Icon name="bell" size={13} />
              </span>
            )}
            {lbls.map((l) => (
              <a
                key={l.id}
                class="meta-label"
                href={`#/label/${l.id}`}
                style={{ '--tint': A.colorOf(l.color) }}
                onClick={(e) => e.stopPropagation()}
              >
                <Icon name="tag" size={12} />
                {l.name}
              </a>
            ))}
            {parent && <span class="meta-parent">↳ {parent.title}</span>}
            {proj && (
              <a class="meta-project" href={proj.isInbox ? '#/inbox' : `#/project/${proj.id}`} onClick={(e) => e.stopPropagation()}>
                {A.projectName(proj)}
                {proj.isInbox ? <Icon name="inbox" size={13} /> : <span class="pdot sm" style={{ background: A.colorOf(proj.color) }} />}
              </a>
            )}
          </div>
        )}
      </div>
      <div class="task-actions">
        <button type="button" class="icon-btn sm hover-only" aria-label={tr('Edit task')} title={tr('Edit')} onClick={(e) => (e.stopPropagation(), ui.openTask(t.id))}>
          <Icon name="edit" size={18} />
        </button>
        <button
          type="button"
          class="icon-btn sm hover-only"
          aria-label={tr('Set due date')}
          title={tr('Due date')}
          onClick={(e) => {
            e.stopPropagation();
            setPop({ kind: 'due', anchor: e.currentTarget });
          }}
        >
          <Icon name="calendar" size={18} />
        </button>
        <button
          type="button"
          class="icon-btn sm"
          aria-label={tr('Task actions')}
          title={tr('More')}
          onClick={(e) => {
            e.stopPropagation();
            setPop({ kind: 'menu', anchor: e.currentTarget });
          }}
        >
          <Icon name="more" size={18} />
        </button>
      </div>
      {pop && pop.kind === 'menu' && <Menu anchor={pop.anchor} align="end" title={t.title} items={menuItems()} onClose={() => setPop((p) => (p && p.kind === 'menu' ? null : p))} />}
      {pop && pop.kind === 'due' && <DuePicker anchor={pop.anchor} value={t.due} onChange={(d) => A.updateTask(t.id, { due: d })} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'priority' && <PriorityPicker anchor={pop.anchor} value={t.priority} onChange={(p) => A.updateTask(t.id, { priority: p })} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'labels' && <LabelPicker anchor={pop.anchor} value={t.labels || []} onChange={(l) => A.updateTask(t.id, { labels: l })} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'move' && (
        <ProjectPicker anchor={pop.anchor} projectId={t.projectId} sectionId={t.sectionId} onChange={(w) => A.moveTask(t.id, { ...w, parentId: null })} onClose={() => setPop(null)} />
      )}
    </div>
  );
}

// Nested list of tasks with their subtasks. showCompleted decides whether finished subtasks
// are listed; the "2/5" count on a row always counts all of them. A row gets its expand
// arrow only when it has subtasks to show.
export function TaskTree({ list, depth = 0, draggable = false, showCompleted = false, showProject = false }) {
  return (
    <>
      {list.map((t) => {
        const allKids = A.children(t.id);
        const kids = allKids.filter((k) => showCompleted || !k.done);
        const collapsed = !!t.collapsed;
        return (
          <div class="task-node" key={t.id}>
            <TaskRow
              task={t}
              depth={depth}
              draggable={draggable && !t.done}
              showProject={showProject}
              childCount={allKids.length}
              doneChildCount={allKids.filter((k) => k.done).length}
              canExpand={kids.length > 0}
              collapsed={collapsed}
            />
            {!collapsed && kids.length > 0 && (
              <TaskTree list={A.sortTasks(kids)} depth={depth + 1} draggable={draggable} showCompleted={showCompleted} />
            )}
          </div>
        );
      })}
    </>
  );
}

// "+ Add task" that expands into an inline editor.
export function InlineAdder({ defaults, label, onAdded }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" class="add-row" onClick={() => setOpen(true)}>
        <span class="add-plus"><Icon name="plus" size={16} /></span>
        <span>{label || tr('Add task')}</span>
      </button>
    );
  }
  return (
    <div class="inline-editor">
      <TaskEditor
        defaults={defaults}
        onCancel={() => setOpen(false)}
        onSubmit={(fields) => {
          const t = A.addTask(fields);
          onAdded && onAdded(t);
        }}
      />
    </div>
  );
}

// Finishing the last task due today, or reaching the daily goal, gets a fanfare.
export function completionSound(task) {
  const ref = today();
  const goal = Math.max(1, store.getPrefs().dailyGoal || 5);
  const doneToday = A.completionEvents().filter((e) => e.at >= new Date().setHours(0, 0, 0, 0)).length;
  const dueLeft = A.todayTasks().filter((t) => !t.parentId).length;
  const thisDue = task.due && task.due.date <= ref && !task.parentId;
  if (doneToday + 1 === goal || (thisDue && dueLeft === 1)) return 'goal';
  return 'complete';
}
