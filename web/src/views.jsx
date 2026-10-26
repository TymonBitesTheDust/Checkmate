import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import * as store from './store.js';
import * as A from './actions.js';
import { ui } from './bus.js';
import { Icon } from './icons.jsx';
import { MenuButton, Menu, confirmDialog, toast } from './ui.jsx';
import { TaskTree, TaskRow, InlineAdder } from './tasks.jsx';
import { StyledTitle, RiotDate, isRiot, textOf } from './riot.jsx';
import { TideDate, TideStats, isTide, ribbonEms } from './tide.jsx';
import { FrontierDate, Tally, isFrontier } from './frontier.jsx';
import { NeonDate, isNeon } from './neon.jsx';
import { compileFilter } from './filters.js';
import {
  today, addDays, parseYmd, weekday, startOfWeek, diffDays, ymd, formatTime,
  dayName, dayShort, dayMin, monthYear, dayLong, dayShortDate, shortDate, monthShort,
} from './dates.js';
import { tr, isZh } from './i18n.js';
import { projectMenuItems, projectSubtitle } from './docsync.js';
import * as E from './events.js';

// ---------------------------------------------------------------------------
// events in Today, Upcoming and Search
// ---------------------------------------------------------------------------

function AgendaRow({ o, withDate }) {
  let el = null;
  return (
    <button
      type="button"
      ref={(x) => (el = x)}
      class={`agenda-row ${o.endMs <= Date.now() ? 'past' : ''}`}
      style={{ '--ev': o.color }}
      onClick={() => ui.showEvent(o, el)}
    >
      <span class="ev-bar" aria-hidden="true" />
      <span class="agenda-time">
        {withDate && <span class="agenda-date">{dayShortDate(o.startDate)} · </span>}
        {o.allDay ? tr('All day') : E.timeRangeText(o)}
      </span>
      <span class="agenda-title">{o.title}</span>
      {o.location && <span class="agenda-loc"><Icon name="pin" size={13} /> {o.location}</span>}
    </button>
  );
}

function DayEvents({ date, from }) {
  if (store.getPrefs().calInLists === false) return null;
  // Upcoming asks once for its whole range and passes it down
  const list = (from || E.occurrences(E.midnight(date), E.midnight(addDays(date, 1)), { withTasks: false }))
    .filter((o) => o.startDate <= date && o.endDate > date);
  if (!list.length) return null;
  return (
    <div class="day-events" aria-label={tr('Events')}>
      {list.map((o) => <AgendaRow key={o.key} o={o} />)}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ViewHeader({ title, subtitle, actions, children, badge }) {
  return (
    <header class="view-head">
      <div class="view-head-row">
        <h1 class="view-title"><StyledTitle>{title}</StyledTitle></h1>
        <span class="ghost-title" aria-hidden="true" style={{ '--len': ribbonEms(textOf(title)) }}>{textOf(title)}</span>
        {badge}
        <div class="view-actions">{actions}</div>
      </div>
      {subtitle && <p class="view-sub">{subtitle}</p>}
      {children}
    </header>
  );
}

function Empty({ title, body, action }) {
  return (
    <div class="empty">
      <div class="empty-mark" aria-hidden="true">
        <svg viewBox="0 0 120 80" width="120" height="80">
          <rect x="18" y="14" width="84" height="56" rx="12" fill="var(--accent-soft)" />
          <path d="M40 42l11 11 27-27" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <h2><StyledTitle>{title}</StyledTitle></h2>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

function SortMenu({ value, onChange, options }) {
  const labels = { manual: 'Manually', priority: 'Priority', date: 'Due date', name: 'Name', added: 'Date added', time: 'Time', project: 'Project' };
  return (
    <MenuButton
      icon="sort"
      label={tr('Sort tasks')}
      title={tr('Sort by')}
      items={[{ heading: tr('Sort by') }, ...options.map((o) => ({ label: tr(labels[o]), checked: value === o, onSelect: () => onChange(o) }))]}
    />
  );
}

function Group({ id, title, count, right, children, defaultOpen = true, zone }) {
  const prefs = store.getPrefs();
  const key = `group:${id}`;
  const collapsed = prefs.collapsed[key] ?? !defaultOpen;
  if (!title) return <div class="group-body" {...(zone || {})}>{children}</div>;
  return (
    <section class={`group ${collapsed ? 'collapsed' : ''}`} data-group={id}>
      <div class="group-head">
        <button
          type="button"
          class="group-toggle"
          aria-expanded={!collapsed}
          onClick={() => store.setPrefs({ collapsed: { ...prefs.collapsed, [key]: !collapsed } })}
        >
          <Icon name="chevron" size={14} class="twist" />
          <span class="group-title">{title}</span>
          {count != null && <span class="group-count">{count}</span>}
        </button>
        <div class="group-right">{right}</div>
      </div>
      {!collapsed && <div class="group-body" {...(zone || {})}>{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

function sortToday(list, mode) {
  const time = (t) => (t.due && t.due.time) || '99:99';
  const s = [...list];
  if (mode === 'name') return A.sortTasks(s, 'name');
  if (mode === 'project') {
    const pname = (t) => A.projectName(store.get(t.projectId));
    return s.sort((a, b) => pname(a).localeCompare(pname(b)) || a.priority - b.priority);
  }
  if (mode === 'time') return s.sort((a, b) => time(a).localeCompare(time(b)) || a.priority - b.priority);
  return s.sort((a, b) => a.priority - b.priority || time(a).localeCompare(time(b)) || (a.order || 0) - (b.order || 0));
}

export function TodayView() {
  const prefs = store.getPrefs();
  const ref = today();
  const open = A.openTasks();
  const overdue = sortToday(open.filter((t) => t.due && t.due.date < ref), prefs.todaySort);
  const todays = sortToday(open.filter((t) => t.due && t.due.date === ref), prefs.todaySort);
  const doneToday = A.completionEvents().filter((e) => ymd(new Date(e.at)) === ref).length;
  const d = parseYmd(ref);
  const total = overdue.length + todays.length;

  return (
    <div class="view">
      <ViewHeader
        title={tr('Today')}
        badge={isRiot() ? <RiotDate date={ref} /> : isTide() ? <TideDate date={ref} /> : isFrontier() ? <FrontierDate date={ref} /> : isNeon() ? <NeonDate date={ref} /> : null}
        subtitle={
          <>
            <span>{dayLong(ref)}</span>
            {doneToday > 0 && <span class="sub-pill"><Icon name="done" size={14} /> {tr('{n} done', { n: doneToday })}</span>}
          </>
        }
        actions={<SortMenu value={prefs.todaySort} options={['priority', 'time', 'project', 'name']} onChange={(v) => store.setPrefs({ todaySort: v })} />}
      >
        {(isTide() || isNeon()) && <TideStats done={doneToday} left={total} />}
        {isFrontier() && <Tally done={doneToday} goal={prefs.dailyGoal} />}
      </ViewHeader>
      <DayEvents date={ref} />
      {overdue.length > 0 && (
        <Group
          id="today-overdue"
          title={tr('Overdue')}
          count={overdue.length}
          right={
            <button type="button" class="link-btn accent" onClick={() => A.rescheduleOverdue()}>
              {tr('Move to today')}
            </button>
          }
        >
          <div class="task-list">
            {overdue.map((t) => <TaskRow key={t.id} task={t} showProject showParent />)}
          </div>
        </Group>
      )}
      <Group id="today-today" title={overdue.length ? `${tr('Today')} · ${dayShortDate(ref)}` : null} count={overdue.length ? todays.length : null} defaultOpen>
        <div class="task-list">
          {todays.map((t) => <TaskRow key={t.id} task={t} showProject showParent />)}
        </div>
        <InlineAdder defaults={{ due: { date: ref, time: null, recur: null } }} />
      </Group>
      {total === 0 && (
        <Empty
          title={doneToday ? tr('All clear for today') : tr('Nothing due today')}
          body={doneToday ? tr('You finished {n} task{s}. Plan tomorrow in Upcoming, or take the rest of the day.', { n: doneToday }) : tr('Add something above, or look ahead in Upcoming.')}
          action={<a class="btn ghost sm" href="#/upcoming">{tr('Open Upcoming')}</a>}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upcoming
// ---------------------------------------------------------------------------

export function UpcomingView() {
  const prefs = store.getPrefs();
  const ref = today();
  const ws = prefs.weekStart ?? 1;
  const [weekOf, setWeekOf] = useState(startOfWeek(ref, ws));
  const [span, setSpan] = useState(21);
  const listRef = useRef(null);
  const open = A.openTasks();
  const byDate = {};
  open.forEach((t) => {
    if (t.due) (byDate[t.due.date] = byDate[t.due.date] || []).push(t);
  });
  const from = weekOf < ref ? ref : weekOf;
  const days = Array.from({ length: span }, (_, i) => addDays(from, i));
  const rangeEvents = E.occurrences(E.midnight(from), E.midnight(addDays(from, span)), { withTasks: false });
  const overdue = sortToday(open.filter((t) => t.due && t.due.date < ref), 'time');
  const strip = Array.from({ length: 7 }, (_, i) => addDays(weekOf, i));
  const m = parseYmd(weekOf);
  const mEnd = parseYmd(addDays(weekOf, 6));
  const monthLabel = m.getMonth() === mEnd.getMonth()
    ? monthYear(m)
    : isZh()
      ? `${mEnd.getFullYear()}年${m.getMonth() + 1}月 – ${mEnd.getMonth() + 1}月`
      : `${monthShort(m.getMonth())} – ${monthShort(mEnd.getMonth())} ${mEnd.getFullYear()}`;

  const jump = (date) => {
    const el = listRef.current && listRef.current.querySelector(`[data-day="${date}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  useEffect(() => {
    if (weekOf > ref) setTimeout(() => jump(weekOf), 30);
  }, [weekOf]);

  return (
    <div class="view upcoming">
      <ViewHeader title={tr('Upcoming')}>
        <div class="week-nav">
          <span class="week-month">{monthLabel}</span>
          <div class="week-btns">
            <button type="button" class="icon-btn sm" aria-label={tr('Previous week')} disabled={weekOf <= startOfWeek(ref, ws)} onClick={() => setWeekOf(addDays(weekOf, -7))}>
              <Icon name="left" size={18} />
            </button>
            <button type="button" class="btn ghost xs" onClick={() => (setWeekOf(startOfWeek(ref, ws)), listRef.current && listRef.current.scrollIntoView({ block: 'start' }))}>{tr('Today')}</button>
            <button type="button" class="icon-btn sm" aria-label={tr('Next week')} onClick={() => setWeekOf(addDays(weekOf, 7))}>
              <Icon name="right" size={18} />
            </button>
          </div>
        </div>
        <div class="week-strip" role="tablist" aria-label={tr('Days')}>
          {strip.map((dte) => {
            const d = parseYmd(dte);
            const past = dte < ref;
            const n = (byDate[dte] || []).length;
            return (
              <button type="button" key={dte} class={`week-day ${dte === ref ? 'today' : ''} ${past ? 'past' : ''}`} disabled={past} onClick={() => jump(dte)}>
                <span class="wd">{dayShort(d.getDay())}</span>
                <span class="dn">{d.getDate()}</span>
                <span class={`wdots ${n ? 'on' : ''}`}>{n > 0 ? '•'.repeat(Math.min(3, n)) : ''}</span>
              </button>
            );
          })}
        </div>
      </ViewHeader>
      <div ref={listRef}>
        {weekOf <= ref && overdue.length > 0 && (
          <Group id="up-overdue" title={tr('Overdue')} count={overdue.length} right={<button type="button" class="link-btn accent" onClick={() => A.rescheduleOverdue()}>{tr('Move to today')}</button>}>
            <div class="task-list">
              {overdue.map((t) => <TaskRow key={t.id} task={t} showProject showParent />)}
            </div>
          </Group>
        )}
        {days.map((dte) => {
          const d = parseYmd(dte);
          const diff = diffDays(dte, ref);
          const rel = diff === 0 ? tr('Today') : diff === 1 ? tr('Tomorrow') : dayName(d.getDay());
          const list = sortToday(byDate[dte] || [], 'time');
          return (
            <section class={`day ${dte === ref ? 'is-today' : ''}`} key={dte} data-day={dte}>
              <h2 class="day-head">
                <span class="day-date">{shortDate(dte, ref)}</span>
                <span class="day-rel">{rel}</span>
                {list.length > 0 && <span class="group-count">{list.length}</span>}
              </h2>
              <DayEvents date={dte} from={rangeEvents} />
              <div class="day-zone" data-zone="date" data-date={dte}>
                <div class="task-list">
                  {list.map((t) => <TaskRow key={t.id} task={t} showProject showParent draggable />)}
                </div>
                <InlineAdder defaults={{ due: { date: dte, time: null, recur: null } }} />
              </div>
            </section>
          );
        })}
        <div class="more-days">
          <button type="button" class="btn ghost sm" onClick={() => setSpan(span + 14)}>{tr('Show 2 more weeks')}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project (list + board)
// ---------------------------------------------------------------------------

function projectMenu(p) {
  const items = [];
  if (!p.isInbox) items.push({ label: tr('Edit project'), icon: 'edit', onSelect: () => ui.editProject(p.id) });
  items.push({ label: tr('Add section'), icon: 'section', onSelect: () => ui.editSection(null, p.id) });
  // with Settings → General → Hide completed tasks on, no project shows them, so the switch goes
  if (!store.getPrefs().hideDoneTasks) {
    items.push({
      label: p.showCompleted ? tr('Hide completed tasks') : tr('Show completed tasks'),
      icon: 'done',
      onSelect: () => store.patch(p.id, { showCompleted: !p.showCompleted }),
    });
  }
  items.push(...projectMenuItems(p));
  if (!p.isInbox) {
    items.push({ label: p.favorite ? tr('Remove from favourites') : tr('Add to favourites'), icon: 'star', onSelect: () => store.patch(p.id, { favorite: !p.favorite }) });
    items.push({ divider: true });
    items.push({
      label: tr('Archive project'), icon: 'archive', onSelect: () => {
        store.patch(p.id, { archived: true });
        toast(tr('Archived “{name}”', { name: p.name }), () => store.patch(p.id, { archived: false }));
        ui.navigate('#/inbox');
      },
    });
    items.push({
      label: tr('Delete project'), icon: 'trash', danger: true, onSelect: async () => {
        const n = A.countFor(p.id);
        const ok = await confirmDialog({ title: tr('Delete “{name}”?', { name: p.name }), body: n ? tr('Its {n} open task{s} will be deleted too.', { n }) : tr('This project has no open tasks.'), confirm: tr('Delete'), danger: true });
        if (ok) {
          A.deleteProject(p.id);
          ui.navigate('#/inbox');
        }
      },
    });
  }
  return items;
}

export function ProjectView({ id }) {
  const p = store.get(id);
  if (!p) {
    return (
      <div class="view">
        <Empty title={tr('This project isn’t here any more')} body={tr('It may have been deleted or archived on another device.')} action={<a class="btn ghost sm" href="#/inbox">{tr('Go to Inbox')}</a>} />
      </div>
    );
  }
  const sort = p.sort || 'manual';
  const board = p.view === 'board';
  const prefs = store.getPrefs();
  const showDone = !!p.showCompleted && !prefs.hideDoneTasks;
  const showDoneSubs = showDone && !prefs.hideDoneSubtasks;
  const secs = A.sections(id);
  const top = A.tasks().filter((t) => t.projectId === id && !t.parentId && (showDone || !t.done));
  const bySec = (sid) => A.sortTasks(top.filter((t) => (t.sectionId || null) === sid), sort).sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
  const draggable = sort === 'manual';
  const n = A.countFor(id);

  return (
    <div class={`view ${board ? 'board-view' : ''}`}>
      <ViewHeader
        title={
          <>
            {!p.isInbox && <span class="title-dot" style={{ background: A.colorOf(p.color) }} />}
            {A.projectName(p)}
          </>
        }
        subtitle={projectSubtitle(id, n ? tr('{n} open task{s}', { n }) : null)}
        actions={
          <>
            <div class="seg" role="group" aria-label={tr('Layout')}>
              <button type="button" class={!board ? 'on' : ''} aria-pressed={!board} title={tr('List')} aria-label={tr('List layout')} onClick={() => store.patch(id, { view: 'list' })}>
                <Icon name="list" size={18} />
              </button>
              <button type="button" class={board ? 'on' : ''} aria-pressed={board} title={tr('Board')} aria-label={tr('Board layout')} onClick={() => store.patch(id, { view: 'board' })}>
                <Icon name="board" size={18} />
              </button>
            </div>
            <SortMenu value={sort} options={['manual', 'date', 'priority', 'name', 'added']} onChange={(v) => store.patch(id, { sort: v })} />
            <MenuButton items={() => projectMenu(p)} label={tr('Project actions')} title={A.projectName(p)} />
          </>
        }
      />
      {board ? (
        <div class="board">
          {(secs.length === 0 || bySec(null).length > 0) && (
            <Column project={p} section={null} tasks={bySec(null)} draggable={draggable} showDoneSubs={showDoneSubs} />
          )}
          {secs.map((s) => (
            <Column key={s.id} project={p} section={s} tasks={bySec(s.id)} draggable={draggable} showDoneSubs={showDoneSubs} />
          ))}
          <div class="board-col add-col">
            <button type="button" class="add-row" onClick={() => ui.editSection(null, id)}>
              <span class="add-plus"><Icon name="plus" size={16} /></span>
              <span>{tr('Add section')}</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          <div class="zone" data-zone="section" data-project={id} data-section="">
            <div class="task-list">
              <TaskTree list={bySec(null)} draggable={draggable} showCompleted={showDoneSubs} />
            </div>
            <InlineAdder defaults={{ projectId: id, sectionId: null }} />
          </div>
          {secs.map((s) => {
            const list = bySec(s.id);
            const open = list.filter((t) => !t.done).length;
            return (
              <Group
                key={s.id}
                id={`sec:${s.id}`}
                title={s.name}
                count={open || null}
                right={<MenuButton label={tr('Section actions')} title={s.name} items={() => sectionMenu(s)} />}
              >
                <div class="zone" data-zone="section" data-project={id} data-section={s.id}>
                  <div class="task-list">
                    <TaskTree list={list} draggable={draggable} showCompleted={showDoneSubs} />
                  </div>
                  <InlineAdder defaults={{ projectId: id, sectionId: s.id }} />
                </div>
              </Group>
            );
          })}
          <button type="button" class="add-section" onClick={() => ui.editSection(null, id)}>
            <span>{tr('Add section')}</span>
          </button>
          {n === 0 && secs.length === 0 && !showDone && (
            <Empty
              title={p.isInbox ? tr('Your Inbox is clear') : tr('No tasks here yet')}
              body={p.isInbox ? tr('New tasks land here unless you pick a project. Press Q to add one from anywhere.') : tr('Add a task above. Sections help split a project into stages.')}
            />
          )}
        </>
      )}
    </div>
  );
}

function sectionMenu(s) {
  return [
    { label: tr('Rename section'), icon: 'edit', onSelect: () => ui.editSection(s.id, s.projectId) },
    {
      label: tr('Move section up'), icon: 'left', onSelect: () => {
        const list = A.sections(s.projectId);
        const i = list.findIndex((x) => x.id === s.id);
        if (i > 0) store.patch(s.id, { order: A.orderBetween(list[i - 2] ? list[i - 2].order : null, list[i - 1].order) });
      },
    },
    {
      label: tr('Move section down'), icon: 'right', onSelect: () => {
        const list = A.sections(s.projectId);
        const i = list.findIndex((x) => x.id === s.id);
        if (i < list.length - 1) store.patch(s.id, { order: A.orderBetween(list[i + 1].order, list[i + 2] ? list[i + 2].order : null) });
      },
    },
    { divider: true },
    {
      label: tr('Delete section'), icon: 'trash', danger: true, onSelect: async () => {
        const n = A.tasks().filter((t) => t.sectionId === s.id && !t.done).length;
        const ok = await confirmDialog({ title: tr('Delete “{name}”?', { name: s.name }), body: n ? tr('Its {n} open task{s} will be deleted too.', { n }) : null, confirm: tr('Delete'), danger: true });
        if (ok) A.deleteSection(s.id);
      },
    },
  ];
}

function Column({ project, section, tasks, draggable, showDoneSubs }) {
  const open = tasks.filter((t) => !t.done).length;
  return (
    <div class="board-col">
      <div class="col-head">
        <span class="col-title">{section ? section.name : tr('No section')}</span>
        {open > 0 && <span class="group-count">{open}</span>}
        <span class="spacer" />
        {section && <MenuButton label={tr('Section actions')} title={section.name} items={() => sectionMenu(section)} />}
      </div>
      <div class="col-body zone" data-zone="section" data-project={project.id} data-section={section ? section.id : ''}>
        <div class="task-list cards">
          <TaskTree list={tasks} draggable={draggable} showCompleted={showDoneSubs} />
        </div>
        <InlineAdder defaults={{ projectId: project.id, sectionId: section ? section.id : null }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Labels & filters
// ---------------------------------------------------------------------------

export function LabelView({ id }) {
  const l = store.get(id);
  if (!l) return <div class="view"><Empty title={tr('This label isn’t here any more')} action={<a class="btn ghost sm" href="#/filters">{tr('Filters & labels')}</a>} /></div>;
  const list = A.sortTasks(A.openTasks().filter((t) => (t.labels || []).includes(id)), 'date');
  return (
    <div class="view">
      <ViewHeader
        title={<><Icon name="tag" size={24} class="title-ic" style={{ color: A.colorOf(l.color) }} />{l.name}</>}
        subtitle={list.length ? tr('{n} open task{s}', { n: list.length }) : null}
        actions={<MenuButton label={tr('Label actions')} title={l.name} items={() => [
          { label: tr('Edit label'), icon: 'edit', onSelect: () => ui.editLabel(l.id) },
          { label: l.favorite ? tr('Remove from favourites') : tr('Add to favourites'), icon: 'star', onSelect: () => store.patch(l.id, { favorite: !l.favorite }) },
          { divider: true },
          { label: tr('Delete label'), icon: 'trash', danger: true, onSelect: () => (A.deleteLabel(l.id), ui.navigate('#/filters')) },
        ]} />}
      />
      <div class="task-list">
        {list.map((t) => <TaskRow key={t.id} task={t} showProject showParent />)}
      </div>
      <InlineAdder defaults={{ labels: [id] }} />
      {!list.length && <Empty title={tr('Nothing tagged @{name}', { name: l.name })} body={tr('Type @{name} while adding a task to tag it.', { name: l.name })} />}
    </div>
  );
}

export function FilterView({ id }) {
  const f = store.get(id);
  if (!f) return <div class="view"><Empty title={tr('This filter isn’t here any more')} action={<a class="btn ghost sm" href="#/filters">{tr('Filters & labels')}</a>} /></div>;
  const ctx = { projects: A.projects(), labels: A.labels(), sections: store.all('section') };
  const { fn } = compileFilter(f.query, ctx);
  const list = A.sortTasks(A.openTasks().filter((t) => {
    try {
      return fn(t);
    } catch {
      return false;
    }
  }), 'date');
  return (
    <div class="view">
      <ViewHeader
        title={<><Icon name="filter" size={24} class="title-ic" style={{ color: A.colorOf(f.color) }} />{f.name}</>}
        subtitle={<code class="query">{f.query}</code>}
        actions={<MenuButton label={tr('Filter actions')} title={f.name} items={() => [
          { label: tr('Edit filter'), icon: 'edit', onSelect: () => ui.editFilter(f.id) },
          { label: f.favorite ? tr('Remove from favourites') : tr('Add to favourites'), icon: 'star', onSelect: () => store.patch(f.id, { favorite: !f.favorite }) },
          { divider: true },
          { label: tr('Delete filter'), icon: 'trash', danger: true, onSelect: () => (A.deleteFilter(f.id), ui.navigate('#/filters')) },
        ]} />}
      />
      <div class="task-list">
        {list.map((t) => <TaskRow key={t.id} task={t} showProject showParent />)}
      </div>
      {!list.length && <Empty title={tr('No tasks match this filter')} body={tr('Edit the filter to widen it, or add tasks that fit.')} />}
    </div>
  );
}

export function FiltersLabelsView() {
  const fl = A.filters();
  const lb = A.labels();
  const ctx = { projects: A.projects(), labels: lb, sections: store.all('section') };
  const open = A.openTasks();
  return (
    <div class="view">
      <ViewHeader title={tr('Filters & labels')} />
      <Group id="fl-filters" title={tr('Filters')} right={<button type="button" class="icon-btn sm" aria-label={tr('Add filter')} title={tr('Add filter')} onClick={() => ui.editFilter(null)}><Icon name="plus" size={18} /></button>}>
        <div class="entity-list">
          {fl.map((f) => {
            const { fn } = compileFilter(f.query, ctx);
            const n = open.filter((t) => { try { return fn(t); } catch { return false; } }).length;
            return (
              <a class="entity-row" href={`#/filter/${f.id}`} key={f.id}>
                <Icon name="filter" size={18} class="tint" style={{ color: A.colorOf(f.color) }} />
                <span class="entity-name">{f.name}</span>
                <span class="entity-count">{n || ''}</span>
              </a>
            );
          })}
          {!fl.length && (
            <p class="hint-text">
              {isZh() ? <>篩選器按規則收集任務，例如 <code>今天 | 逾期</code> 或 <code>p1 &amp; #工作</code>。</> : <>Filters gather tasks by rule, like <code>today | overdue</code> or <code>p1 &amp; #Work</code>.</>}
              <button type="button" class="link-btn accent" onClick={() => ui.editFilter(null)}>{tr('Create a filter')}</button>
            </p>
          )}
        </div>
      </Group>
      <Group id="fl-labels" title={tr('Labels')} right={<button type="button" class="icon-btn sm" aria-label={tr('Add label')} title={tr('Add label')} onClick={() => ui.editLabel(null)}><Icon name="plus" size={18} /></button>}>
        <div class="entity-list">
          {lb.map((l) => (
            <a class="entity-row" href={`#/label/${l.id}`} key={l.id}>
              <Icon name="tag" size={18} class="tint" style={{ color: A.colorOf(l.color) }} />
              <span class="entity-name">{l.name}</span>
              <span class="entity-count">{open.filter((t) => (t.labels || []).includes(l.id)).length || ''}</span>
            </a>
          ))}
          {!lb.length && <p class="hint-text">{isZh() ? <>在任務名稱輸入 <code>@雜務</code> 就會建立並套用標籤。</> : <>Type <code>@errand</code> in a task name to create and apply a label.</>}</p>}
        </div>
      </Group>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function SearchView({ q: initial = '' }) {
  const [q, setQ] = useState(initial);
  const [withDone, setWithDone] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    ref.current && ref.current.focus();
  }, []);
  const needle = q.trim().toLowerCase();
  const tasks = needle
    ? A.tasks().filter((t) => (withDone || !t.done) && store.get(t.projectId) && ((t.title || '').toLowerCase().includes(needle) || (t.desc || '').toLowerCase().includes(needle)))
    : [];
  const projects = needle ? A.projects().filter((p) => A.projectName(p).toLowerCase().includes(needle)) : [];
  const lbls = needle ? A.labels().filter((l) => l.name.toLowerCase().includes(needle)) : [];
  const evs = needle ? E.searchEvents(needle, 50) : [];
  return (
    <div class="view">
      <ViewHeader title={tr('Search')} />
      <div class="search-box">
        <Icon name="search" size={18} />
        <input
          ref={ref}
          type="search"
          value={q}
          placeholder={tr('Search tasks, events, projects and labels')}
          aria-label={tr('Search')}
          onInput={(e) => {
            setQ(e.currentTarget.value);
            history.replaceState(null, '', `#/search/${encodeURIComponent(e.currentTarget.value)}`);
          }}
        />
      </div>
      <label class="check-line">
        <input type="checkbox" checked={withDone} onChange={(e) => setWithDone(e.currentTarget.checked)} /> {tr('Include completed tasks')}
      </label>
      {(projects.length > 0 || lbls.length > 0) && (
        <div class="entity-list">
          {projects.map((p) => (
            <a class="entity-row" key={p.id} href={p.isInbox ? '#/inbox' : `#/project/${p.id}`}>
              {p.isInbox ? <Icon name="inbox" size={18} /> : <span class="pdot" style={{ background: A.colorOf(p.color) }} />}
              <span class="entity-name">{A.projectName(p)}</span>
              <span class="entity-count">{tr('Project')}</span>
            </a>
          ))}
          {lbls.map((l) => (
            <a class="entity-row" key={l.id} href={`#/label/${l.id}`}>
              <Icon name="tag" size={18} class="tint" style={{ color: A.colorOf(l.color) }} />
              <span class="entity-name">{l.name}</span>
              <span class="entity-count">{tr('Label')}</span>
            </a>
          ))}
        </div>
      )}
      {tasks.length > 0 && (
        <div class="task-list">
          {A.sortTasks(tasks, 'date').slice(0, 200).map((t) => <TaskRow key={t.id} task={t} showProject showParent />)}
        </div>
      )}
      {evs.length > 0 && (
        <section class="search-events">
          <h2 class="day-head"><span class="day-date">{tr('Events')}</span><span class="group-count">{evs.length}</span></h2>
          <div class="day-events">{evs.map((o) => <AgendaRow key={o.key} o={o} withDate />)}</div>
        </section>
      )}
      {needle && !tasks.length && !projects.length && !lbls.length && !evs.length && <Empty title={tr('No results for “{q}”', { q: q.trim() })} body={tr('Try fewer words, or include completed tasks.')} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Completed
// ---------------------------------------------------------------------------

export function CompletedView() {
  const [limit, setLimit] = useState(100);
  const prefs = store.getPrefs();
  const ev = A.completionEvents().filter((e) => store.get(e.task.projectId));
  const ref = today();
  const groups = [];
  ev.slice(0, limit).forEach((e) => {
    const day = ymd(new Date(e.at));
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) groups.push((g = { day, items: [] }));
    g.items.push(e);
  });
  return (
    <div class="view">
      <ViewHeader title={tr('Completed')} subtitle={ev.length ? tr('{n} completion{s} in total', { n: ev.length }) : null} />
      {groups.map((g) => {
        const d = parseYmd(g.day);
        const diff = diffDays(g.day, ref);
        const label = diff === 0 ? tr('Today') : diff === -1 ? tr('Yesterday') : dayShortDate(g.day);
        return (
          <section class="day" key={g.day}>
            <h2 class="day-head"><span class="day-date">{label}</span><span class="group-count">{g.items.length}</span></h2>
            <div class="done-list">
              {g.items.map((e) => {
                const p = store.get(e.task.projectId);
                const time = new Date(e.at);
                return (
                  <div class="done-item" key={e.task.id + e.at}>
                    {e.recurring ? (
                      <span class="done-ic" title={tr('Repeating task')}><Icon name="repeat" size={16} /></span>
                    ) : (
                      <button type="button" class="check on prio-4 sm" role="checkbox" aria-checked="true" aria-label={tr('Mark “{title}” as not done', { title: e.task.title })} title={tr('Mark as not done')} onClick={() => A.uncompleteTask(e.task.id)}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m7.8 12.3 2.9 2.9 5.5-6" /></svg>
                      </button>
                    )}
                    <button type="button" class="done-title" onClick={() => ui.openTask(e.task.id)}>{e.task.title}</button>
                    <span class="done-meta">
                      {formatTime(`${time.getHours()}:${time.getMinutes()}`, prefs.timeFormat)}
                      {p && <span> · {A.projectName(p)}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {ev.length > limit && (
        <div class="more-days"><button type="button" class="btn ghost sm" onClick={() => setLimit(limit + 200)}>{tr('Show older')}</button></div>
      )}
      {!ev.length && <Empty title={tr('Nothing completed yet')} body={tr('Ticked-off tasks show up here, grouped by day.')} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Productivity
// ---------------------------------------------------------------------------

export function ProductivityView() {
  const prefs = store.getPrefs();
  const goal = Math.max(1, prefs.dailyGoal || 5);
  const ref = today();
  const ev = A.completionEvents();
  const perDay = {};
  ev.forEach((e) => {
    const d = ymd(new Date(e.at));
    perDay[d] = (perDay[d] || 0) + 1;
  });
  const todayN = perDay[ref] || 0;
  let streak = 0;
  let d = (perDay[ref] || 0) >= goal ? ref : addDays(ref, -1);
  while ((perDay[d] || 0) >= goal) {
    streak++;
    d = addDays(d, -1);
  }
  let best = 0;
  let run = 0;
  const daysSorted = Object.keys(perDay).sort();
  if (daysSorted.length) {
    for (let x = daysSorted[0]; x <= ref; x = addDays(x, 1)) {
      run = (perDay[x] || 0) >= goal ? run + 1 : 0;
      best = Math.max(best, run);
    }
  }
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(ref, i - 6));
  const max = Math.max(goal, ...last7.map((x) => perDay[x] || 0));
  const weekTotal = last7.reduce((s, x) => s + (perDay[x] || 0), 0);
  const pct = Math.min(1, todayN / goal);
  const R = 52;
  const C = 2 * Math.PI * R;

  const byProject = {};
  ev.filter((e) => diffDays(ymd(new Date(e.at)), ref) > -7).forEach((e) => {
    byProject[e.task.projectId] = (byProject[e.task.projectId] || 0) + 1;
  });
  const top = Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div class="view">
      <ViewHeader title={tr('Productivity')} subtitle={tr('Completed tasks over the last week')} />
      <div class="prod-top">
        <div class="ring" role="img" aria-label={tr('{done} of {goal} tasks done today', { done: todayN, goal })}>
          <svg viewBox="0 0 128 128" width="128" height="128">
            <circle cx="64" cy="64" r={R} fill="none" stroke="var(--line)" stroke-width="12" />
            <circle cx="64" cy="64" r={R} fill="none" stroke="var(--accent)" stroke-width="12" stroke-linecap="round" stroke-dasharray={`${C * pct} ${C}`} transform="rotate(-90 64 64)" />
          </svg>
          <div class="ring-text">
            <strong>{todayN}</strong>
            <span>{tr('of {goal} today', { goal })}</span>
          </div>
        </div>
        <div class="prod-stats">
          <div class="stat"><strong>{streak}</strong><span>{tr('day streak')}</span></div>
          <div class="stat"><strong>{best}</strong><span>{tr('best streak')}</span></div>
          <div class="stat"><strong>{weekTotal}</strong><span>{tr('last 7 days')}</span></div>
          <label class="goal-input">
            <span>{tr('Daily goal')}</span>
            <input type="number" min="1" max="99" value={goal} onChange={(e) => store.setPrefs({ dailyGoal: Math.max(1, Math.min(99, +e.currentTarget.value || 1)) })} />
          </label>
        </div>
      </div>
      <div class="bars" role="img" aria-label={tr('Tasks completed per day for the last 7 days')}>
        <div class="goal-line" style={{ bottom: `${(goal / max) * 100}%` }}><span>{tr('goal')}</span></div>
        {last7.map((x) => {
          const n = perDay[x] || 0;
          const dd = parseYmd(x);
          return (
            <div class="bar-col" key={x}>
              <div class="bar-track">
                <div class={`bar ${n >= goal ? 'met' : ''}`} style={{ height: `${(n / max) * 100}%` }}>
                  {n > 0 && <span>{n}</span>}
                </div>
              </div>
              <span class={`bar-label ${x === ref ? 'today' : ''}`}>{dayShort(dd.getDay())}</span>
            </div>
          );
        })}
      </div>
      {top.length > 0 && (
        <section class="detail-section">
          <h3>{tr('Where the work went this week')}</h3>
          <div class="entity-list">
            {top.map(([pid, n]) => {
              const p = store.get(pid);
              if (!p) return null;
              return (
                <div class="entity-row static" key={pid}>
                  {p.isInbox ? <Icon name="inbox" size={18} /> : <span class="pdot" style={{ background: A.colorOf(p.color) }} />}
                  <span class="entity-name">{A.projectName(p)}</span>
                  <span class="entity-count">{n}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
