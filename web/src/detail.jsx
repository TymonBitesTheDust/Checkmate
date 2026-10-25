import { useState, useEffect, useRef } from 'preact/hooks';
import * as store from './store.js';
import * as A from './actions.js';
import { ui } from './bus.js';
import { Icon } from './icons.jsx';
import { Modal, autoGrow, Linkify, confirmDialog } from './ui.jsx';
import { DuePicker, PriorityPicker, LabelPicker, ProjectPicker, PRIORITY_NAMES } from './editor.jsx';
import { TaskTree, InlineAdder, completionSound } from './tasks.jsx';
import { play } from './sound.js';
import { tr, isZh } from './i18n.js';
import { describeRecur } from './parse.js';
import { dueLabel } from './dates.js';
import { TaskReminders, reminderSummary } from './reminders-ui.jsx';
import { TaskFiles } from './files-ui.jsx';

function useDebouncedSave(id, field, value) {
  const timer = useRef(null);
  const latest = useRef(value);
  latest.current = value;
  const flush = () => {
    clearTimeout(timer.current);
    const t = store.get(id);
    if (t && t[field] !== latest.current) A.updateTask(id, { [field]: latest.current });
  };
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  }, [value]);
  useEffect(() => () => flush(), [id]);
  return flush;
}

function when(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString(isZh() ? 'zh-Hant' : [], { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined, hour: 'numeric', minute: '2-digit' });
}

export function TaskDetail({ id, onClose, addSub }) {
  const t = store.get(id);
  const prefs = store.getPrefs();
  const [title, setTitle] = useState(t ? t.title : '');
  const [desc, setDesc] = useState(t ? t.desc || '' : '');
  const [pop, setPop] = useState(null);
  const [comment, setComment] = useState('');
  const titleRef = useRef(null);
  const descRef = useRef(null);
  const flushTitle = useDebouncedSave(id, 'title', title.trim() || (t && t.title) || tr('Untitled'));
  const flushDesc = useDebouncedSave(id, 'desc', desc);

  useEffect(() => {
    setTitle(t ? t.title : '');
    setDesc(t ? t.desc || '' : '');
  }, [id]);
  useEffect(() => {
    autoGrow(titleRef.current);
    autoGrow(descRef.current);
  });
  useEffect(() => {
    if (!t) onClose();
  }, [t]);
  if (!t) return null;

  const close = () => {
    flushTitle();
    flushDesc();
    onClose();
  };

  const proj = store.get(t.projectId);
  const sec = t.sectionId ? store.get(t.sectionId) : null;
  const parent = t.parentId ? store.get(t.parentId) : null;
  const due = dueLabel(t.due, prefs.timeFormat);
  const lbls = (t.labels || []).map((x) => store.get(x)).filter(Boolean);
  const kids = A.children(t.id);
  const doneKids = kids.filter((k) => k.done).length;
  const comments = A.comments(t.id);
  const open = (kind) => (e) => setPop({ kind, anchor: e.currentTarget });

  return (
    <Modal onClose={close} class="detail" label={tr('Task details')} initialFocus={false}>
      <header class="detail-head">
        <div class="crumbs">
          <a href={proj && proj.isInbox ? '#/inbox' : `#/project/${t.projectId}`} onClick={close}>
            {proj && proj.isInbox ? <Icon name="inbox" size={16} /> : <span class="pdot" style={{ background: A.colorOf(proj && proj.color) }} />}
            {A.projectName(proj)}
          </a>
          {sec && <span class="crumb-sep">/</span>}
          {sec && <span>{sec.name}</span>}
          {parent && <span class="crumb-sep">/</span>}
          {parent && (
            <button type="button" class="link-btn" onClick={() => ui.openTask(parent.id)}>
              {parent.title}
            </button>
          )}
        </div>
        <div class="detail-head-actions">
          <button
            type="button"
            class="icon-btn"
            aria-label={tr('Delete task')}
            title={tr('Delete task')}
            onClick={async () => {
              const ok = kids.length
                ? await confirmDialog({ title: tr('Delete this task?'), body: tr('Its {n} subtask{s} will be deleted too.', { n: kids.length }), confirm: tr('Delete'), danger: true })
                : true;
              if (ok) {
                onClose();
                A.deleteTask(t.id);
              }
            }}
          >
            <Icon name="trash" />
          </button>
          <button type="button" class="icon-btn" aria-label={tr('Close')} title={tr('Close')} onClick={close}>
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div class="detail-body">
        <div class="detail-main">
          <div class="detail-title-row">
            <button
              type="button"
              class={`check big prio-${t.priority || 4} ${t.done ? 'on' : ''}`}
              role="checkbox"
              aria-checked={t.done}
              aria-label={t.done ? tr('Mark as not done') : tr('Complete task')}
              onClick={() => {
                play(t.done ? 'uncomplete' : completionSound(t));
                flushTitle();
                A.toggleTask(t.id);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="m7.8 12.3 2.9 2.9 5.5-6" />
              </svg>
            </button>
            <textarea
              ref={titleRef}
              class={`detail-title ${t.done ? 'is-done' : ''}`}
              rows={1}
              value={title}
              aria-label={tr('Task name')}
              onInput={(e) => {
                setTitle(e.currentTarget.value.replace(/\n/g, ' '));
                autoGrow(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  descRef.current && descRef.current.focus();
                }
              }}
              onBlur={flushTitle}
            />
          </div>
          <textarea
            ref={descRef}
            class="detail-desc"
            rows={1}
            value={desc}
            placeholder={tr('Add a description')}
            aria-label={tr('Description')}
            onInput={(e) => {
              setDesc(e.currentTarget.value);
              autoGrow(e.currentTarget);
            }}
            onBlur={flushDesc}
          />
          {t.desc && /https?:\/\//.test(t.desc) && (
            <div class="detail-links"><Linkify text={t.desc.match(/https?:\/\/[^\s)]+/g).join('  ')} /></div>
          )}

          <TaskFiles task={t} />

          <section class="detail-section">
            <h3>
              {tr('Subtasks')}
              {kids.length > 0 && <span class="muted"> {doneKids}/{kids.length}</span>}
            </h3>
            {kids.length > 0 && (
              <div class="sub-progress" aria-hidden="true">
                <i style={{ width: `${(doneKids / kids.length) * 100}%` }} />
              </div>
            )}
            <div class="task-list">
              <TaskTree list={A.sortTasks(kids)} showCompleted draggable />
            </div>
            <SubAdder task={t} autoOpen={addSub} />
          </section>

          <section class="detail-section">
            <h3>{tr('Comments')} {comments.length > 0 && <span class="muted">{comments.length}</span>}</h3>
            {comments.map((c) => (
              <div class="comment" key={c.id}>
                <div class="comment-meta">
                  <span>{when(c.createdAt)}</span>
                  <button type="button" class="icon-btn xs" aria-label={tr('Delete comment')} title={tr('Delete comment')} onClick={() => store.remove(c.id)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
                <div class="comment-text"><Linkify text={c.text} /></div>
              </div>
            ))}
            <form
              class="comment-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                A.addComment(t.id, comment.trim());
                setComment('');
              }}
            >
              <textarea
                rows={1}
                value={comment}
                placeholder={tr('Write a comment')}
                aria-label={tr('Write a comment')}
                onInput={(e) => {
                  setComment(e.currentTarget.value);
                  autoGrow(e.currentTarget);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey) && !e.isComposing) {
                    if (window.matchMedia('(pointer: coarse)').matches && !e.ctrlKey) return;
                    e.preventDefault();
                    e.currentTarget.form.requestSubmit();
                  }
                }}
              />
              <button type="submit" class="btn primary sm" disabled={!comment.trim()}>{tr('Comment')}</button>
            </form>
          </section>
        </div>

        <aside class="detail-side">
          <div class="side-field">
            <span class="side-label">{tr('Project')}</span>
            <button type="button" class="side-btn" onClick={open('project')}>
              {proj && proj.isInbox ? <Icon name="inbox" size={16} /> : <span class="pdot" style={{ background: A.colorOf(proj && proj.color) }} />}
              <span>{A.projectName(proj)}{sec ? ` / ${sec.name}` : ''}</span>
            </button>
          </div>
          <div class="side-field">
            <span class="side-label">{tr('Date')}</span>
            <button type="button" class={`side-btn ${due ? `tone-${due.tone}` : 'muted'}`} onClick={open('due')}>
              <Icon name={t.due && t.due.recur ? 'repeat' : 'calendar'} size={16} />
              <span>{due ? due.text : tr('No date')}</span>
            </button>
            {t.due && t.due.recur && <span class="side-note">{describeRecur(t.due.recur)}</span>}
          </div>
          <div class="side-field">
            <span class="side-label">{tr('Reminders')}</span>
            <button type="button" class={`side-btn rem-btn ${t.due ? '' : 'muted'}`} onClick={open('reminders')}>
              <Icon name="bell" size={16} />
              <span>{reminderSummary(t)}</span>
            </button>
          </div>
          <div class="side-field">
            <span class="side-label">{tr('Priority')}</span>
            <button type="button" class="side-btn" onClick={open('priority')}>
              <Icon name="flag" size={16} class={`prio-${t.priority || 4}`} />
              <span>{tr('Priority {n}', { n: t.priority || 4 })}</span>
            </button>
          </div>
          <div class="side-field">
            <span class="side-label">{tr('Labels')}</span>
            <div class="side-labels">
              {lbls.map((l) => (
                <span class="label-chip" key={l.id} style={{ '--tint': A.colorOf(l.color) }}>
                  {l.name}
                  <button type="button" aria-label={tr('Remove {name}', { name: l.name })} onClick={() => A.updateTask(t.id, { labels: t.labels.filter((x) => x !== l.id) })}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
              <button type="button" class="side-btn add" onClick={open('labels')} aria-label={tr('Add labels')}>
                <Icon name="plus" size={16} />
                {lbls.length ? '' : <span>{tr('Add label')}</span>}
              </button>
            </div>
          </div>
          <div class="side-meta">
            <div>{t.createdAt ? (t.via === 'claude' ? tr('Added by Claude {when}', { when: when(t.createdAt) }) : tr('Added {when}', { when: when(t.createdAt) })) : tr('Added with the welcome tour')}</div>
            {t.done && t.doneAt && <div>{tr('Completed {when}', { when: when(t.doneAt) })}</div>}
            {t.completions && t.completions.length > 0 && <div>{tr('Done {n} time{s}', { n: t.completions.length })}</div>}
          </div>
          <button type="button" class="btn ghost sm side-dup" onClick={() => A.duplicateTask(t.id)}>
            <Icon name="copy" size={16} /> {tr('Duplicate')}
          </button>
        </aside>
      </div>
      {pop && pop.kind === 'due' && <DuePicker anchor={pop.anchor} value={t.due} onChange={(d) => A.updateTask(t.id, { due: d })} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'reminders' && <TaskReminders task={t} anchor={pop.anchor} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'priority' && <PriorityPicker anchor={pop.anchor} value={t.priority} onChange={(p) => A.updateTask(t.id, { priority: p })} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'labels' && <LabelPicker anchor={pop.anchor} value={t.labels || []} onChange={(l) => A.updateTask(t.id, { labels: l })} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'project' && (
        <ProjectPicker anchor={pop.anchor} projectId={t.projectId} sectionId={t.sectionId} onChange={(w) => A.moveTask(t.id, { ...w, parentId: null })} onClose={() => setPop(null)} />
      )}
    </Modal>
  );
}

function SubAdder({ task, autoOpen }) {
  const ref = useRef(null);
  useEffect(() => {
    if (autoOpen && ref.current) {
      const b = ref.current.querySelector('.add-row');
      b && b.click();
    }
  }, []);
  return (
    <div ref={ref}>
      <InlineAdder
        label={tr('Add subtask')}
        defaults={{ projectId: task.projectId, sectionId: task.sectionId, parentId: task.id }}
      />
    </div>
  );
}
