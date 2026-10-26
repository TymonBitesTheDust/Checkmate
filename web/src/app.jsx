import { useState, useEffect, useRef } from 'preact/hooks';
import * as store from './store.js';
import * as A from './actions.js';
import * as sync from './sync.js';
import { ui } from './bus.js';
import { Icon, Logo } from './icons.jsx';
import { NAV_ITEMS } from './nav-items.jsx';
import { useStoreVersion, useLayer, closeTopLayer, Toasts, toast, ConfirmHost, Modal, MenuButton, useNarrow, isNarrow } from './ui.jsx';
import { TaskEditor } from './editor.jsx';
import { TaskDetail } from './detail.jsx';
import { Settings } from './settings.jsx';
import { ProjectDialog, SectionDialog, LabelDialog, FilterDialog } from './dialogs.jsx';
import {
  TodayView, UpcomingView, ProjectView, LabelView, FilterView, FiltersLabelsView,
  SearchView, CompletedView, ProductivityView,
} from './views.jsx';
import { today, dueTimestamp, formatTime, dueLabel } from './dates.js';
import { taskReminderTimes } from './reminders.js';
import { birthdayReminders } from './birthdays.js';
import { setSystemBars, scheduleReminders, hasNativeReminders, nativeNotify, platform, setAppIcon } from './native.js';
import { iconSvg } from './brand-icons.js';
import { applyAccent, parseHex, contrast, accentHex } from './theme.js';
import { StyledTitle, PageWipe, Ransom, Shards, StarField, DateBox, HeroCount, reducedMotion } from './riot.jsx';
import { KeyHints } from './tide.jsx';
import { MenuCounter } from './frontier.jsx';
import { play } from './sound.js';
import { tr, lang } from './i18n.js';
import { seedTexts } from './seeds.js';
import { setNativeLanguage } from './native.js';
import { CalendarView, CalendarSidebar } from './calendar.jsx';
import { EventLayer } from './event-ui.jsx';
import { CalendarDialog } from './cal-settings.jsx';
import { BirthdaysView, BirthdayDialog } from './birthdays-ui.jsx';
import { upcomingEventReminders, findOccurrence } from './events.js';
import { setNav } from './calnav.js';

// ---------------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------------

function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [view, ...rest] = h.split('/');
  const arg = rest.join('/');
  const known = ['today', 'upcoming', 'calendar', 'birthdays', 'inbox', 'filters', 'completed', 'productivity', 'search', 'project', 'label', 'filter'];
  if (!known.includes(view)) return { view: store.getPrefs().startView || 'today' };
  return { view, arg };
}

function routeKey(r) {
  return r.view + (r.arg ? `/${r.arg}` : '');
}

function viewTitle(r) {
  switch (r.view) {
    case 'today': return tr('Today');
    case 'upcoming': return tr('Upcoming');
    case 'calendar': return tr('Calendar');
    case 'birthdays': return tr('Birthdays');
    case 'inbox': return tr('Inbox');
    case 'filters': return tr('Filters & labels');
    case 'completed': return tr('Completed');
    case 'productivity': return tr('Productivity');
    case 'search': return tr('Search');
    case 'project': { const p = store.get(r.arg); return p ? A.projectName(p) : tr('Project'); }
    case 'label': { const l = store.get(r.arg); return l ? `@${l.name}` : tr('Label'); }
    case 'filter': { const f = store.get(r.arg); return f ? f.name : tr('Filter'); }
    default: return 'Checkmate';
  }
}

// Defaults for "add task" based on where you are.
function contextDefaults(r) {
  if (r.view === 'project') return { projectId: r.arg };
  if (r.view === 'inbox') return { projectId: 'inbox' };
  if (r.view === 'today') return { due: { date: today(), time: null, recur: null } };
  if (r.view === 'label') return { labels: [r.arg] };
  return {};
}

// ---------------------------------------------------------------------------
// theme
// ---------------------------------------------------------------------------

function applyTheme(pref, accent, skin) {
  // Persona 5 (the Calling Card design) is always dark.
  const dark = skin === 'riot' || pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  // Tide is dark-surfaced in both variants, so native pickers should be dark too.
  root.style.colorScheme = dark || skin === 'tide' ? 'dark' : 'light';
  if (skin && skin !== 'tickwise') root.dataset.skin = skin;
  else delete root.dataset.skin;
  // Settings → Theme → Animations (shown for Persona 5): Match device, Full or Reduced
  root.dataset.motion = reducedMotion() ? 'reduced' : 'full';
  // Archive and Riot bring their own colours, so the theme colour only applies to the default style.
  applyAccent(skin && skin !== 'tickwise' ? null : accent, dark);
  const css = getComputedStyle(root);
  const bar = css.getPropertyValue('--bar').trim() || css.getPropertyValue(isNarrow() ? '--bg' : '--side').trim() || (dark ? '#171b19' : '#ffffff');
  const rgb = parseHex(bar);
  setSystemBars(bar, rgb ? contrast(rgb, [0, 0, 0]) > contrast(rgb, [255, 255, 255]) : !dark);
}

// ---------------------------------------------------------------------------
// reminders
// ---------------------------------------------------------------------------

const NOTIFIED_KEY = 'tickwise.notified.v1';
function upcomingReminders() {
  const now = Date.now();
  const horizon = now + 8 * 86400000;
  const tasks = [];
  for (const t of A.openTasks()) {
    for (const r of taskReminderTimes(t)) {
      if (r.at <= now - 60000 || r.at >= horizon) continue;
      // at the due time the id is the task's own (as before 2.2.0), so it isn't shown twice
      tasks.push({ id: r.timed && r.m === 0 ? t.id : `task:${t.id}:${r.m}`, at: r.at, title: t.title, body: reminderBody(t), now: r.timed && r.m === 0 });
    }
  }
  tasks.push(...birthdayReminders(now, horizon));
  let events = [];
  try {
    events = upcomingEventReminders(now, 8 * 86400000);
  } catch (e) {
    console.warn('Checkmate event reminders', e);
  }
  return [...tasks, ...events].sort((a, b) => a.at - b.at).slice(0, 60);
}

// A reminder id is a task id, "task:<task>:<minutes>", "bd:<birthday>:<date>:<minutes>",
// or "ev:<event>:<occurrence start>:<minutes>" for an event.
function openReminder(id) {
  if (id && id.startsWith('task:')) id = id.split(':')[1];
  if (id && id.startsWith('bd:')) {
    const bid = id.split(':')[1];
    if (!store.get(bid)) return false;
    location.hash = '#/birthdays';
    setTimeout(() => ui.openBirthday && ui.openBirthday(bid), 60);
    return true;
  }
  if (id && id.startsWith('ev:')) {
    const parts = id.split(':');
    const evId = parts[1];
    const orig = parts.slice(2, -1).join(':') || null;
    const occ = findOccurrence(evId, orig);
    if (!occ) return false;
    setNav({ date: occ.startDate });
    if (!location.hash.startsWith('#/calendar')) location.hash = '#/calendar';
    setTimeout(() => ui.openEvent(evId, orig), 60);
    return true;
  }
  if (store.get(id)) {
    ui.openTask(id);
    return true;
  }
  return false;
}
function reminderBody(t) {
  const p = store.get(t.projectId);
  const when = dueLabel(t.due, store.getPrefs().timeFormat);
  return `${tr('Due {time}', { time: when ? when.text : '' })}${p ? ` · ${A.projectName(p)}` : ''}`;
}

function useReminders(version) {
  const timer = useRef(null);
  // Hand the schedule to Android so alarms fire with the app closed.
  useEffect(() => {
    if (!hasNativeReminders()) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => scheduleReminders(upcomingReminders()), 1500);
  }, [version]);
  // While the app is open: in-app banner + system notification where possible.
  useEffect(() => {
    let notified;
    try {
      notified = new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]'));
    } catch {
      notified = new Set();
    }
    const tick = () => {
      const now = Date.now();
      for (const r of upcomingReminders()) {
        const key = `${r.id}@${r.at}`;
        if (r.at <= now && now - r.at < 5 * 60000 && !notified.has(key)) {
          notified.add(key);
          play('reminder');
          toast(r.now ? `${r.title} · ${tr('due now')}` : `${r.title} · ${r.body}`, () => openReminder(r.id), { label: tr('Open'), icon: 'bell', duration: 15000 });
          if (!hasNativeReminders() && !nativeNotify(r.title, r.body) && 'Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(r.title, { body: r.body, tag: key });
            } catch {}
          }
        }
      }
      localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notified].slice(-200)));
    };
    tick();
    const iv = setInterval(tick, 20000);
    return () => clearInterval(iv);
  }, []);
}

// ---------------------------------------------------------------------------
// sidebar
// ---------------------------------------------------------------------------

// cut: Persona 5 shows the page names as cut-out letters (the plain name stays for screen readers)
function NavItem({ href, icon, label, count, active, onNav, children, cut = false }) {
  const showCount = store.getPrefs().sidebarCounts !== false;
  return (
    <a href={href} class={`nav-item ${active ? 'on' : ''} ${cut ? 'cut' : ''} ${cut && [...label].length > 11 ? 'long' : ''}`} aria-current={active ? 'page' : undefined} onClick={onNav}>
      <Shards />
      {icon}
      <span class="nav-label">
        {cut ? <><span class="title-normal">{label}</span><Ransom text={label} seed="nav" /></> : label}
      </span>
      {showCount && count > 0 && <span class="nav-count">{count}</span>}
      {children}
    </a>
  );
}

function SyncBadge() {
  const [s, setS] = useState(sync.getSyncState());
  useEffect(() => sync.onSyncState(setS), []);
  if (s.status === 'off') {
    return (
      <button type="button" class="icon-btn sync-badge off" title={tr('Sync is off. Set it up in Settings.')} aria-label={tr('Sync is off. Set up sync')} onClick={() => ui.openSettings('sync')}>
        <Icon name="cloudOff" size={20} />
      </button>
    );
  }
  const map = {
    synced: ['cloud', tr('Synced')],
    syncing: ['cloud', tr('Syncing…')],
    connecting: ['cloud', tr('Connecting…')],
    offline: ['cloudOff', tr('Offline. Changes will sync later.')],
    error: ['cloudOff', s.error || tr('Sync problem')],
    'signed-out': ['cloudOff', tr('Signed out of sync')],
  };
  const [icon, text] = map[s.status] || ['cloud', s.status];
  return (
    <button type="button" class={`icon-btn sync-badge st-${s.status}`} title={text} aria-label={text} onClick={() => ui.openSettings('sync')}>
      <Icon name={icon} size={20} />
      <i class="sync-dot" />
    </button>
  );
}

function Sidebar({ route, onNav, onHide }) {
  const prefs = store.getPrefs();
  const projects = A.userProjects();
  const archived = A.archivedProjects();
  const [showArchived, setShowArchived] = useState(false);
  const favs = [
    ...projects.filter((p) => p.favorite).map((p) => ({ kind: 'project', item: p })),
    ...A.labels().filter((l) => l.favorite).map((l) => ({ kind: 'label', item: l })),
    ...A.filters().filter((f) => f.favorite).map((f) => ({ kind: 'filter', item: f })),
  ];
  const open = A.openTasks();
  const ref = today();
  const todayCount = open.filter((t) => t.due && t.due.date <= ref).length;
  const inboxCount = open.filter((t) => t.projectId === 'inbox').length;
  const key = routeKey(route);
  const collapsedProjects = !!prefs.collapsed['sb:projects'];
  const hiddenNav = prefs.sidebarHidden || {};

  const projectItems = (p, i) => [
    { label: tr('Edit project'), icon: 'edit', onSelect: () => ui.editProject(p.id) },
    { label: p.favorite ? tr('Remove from favourites') : tr('Add to favourites'), icon: 'star', onSelect: () => store.patch(p.id, { favorite: !p.favorite }) },
    i > 0 && { label: tr('Move up'), icon: 'left', onSelect: () => store.patch(p.id, { order: A.orderBetween(projects[i - 2] ? projects[i - 2].order : null, projects[i - 1].order) }) },
    i < projects.length - 1 && { label: tr('Move down'), icon: 'right', onSelect: () => store.patch(p.id, { order: A.orderBetween(projects[i + 1].order, projects[i + 2] ? projects[i + 2].order : null) }) },
    { divider: true },
    {
      label: tr('Archive'), icon: 'archive', onSelect: () => {
        store.patch(p.id, { archived: true });
        toast(tr('Archived “{name}”', { name: p.name }), () => store.patch(p.id, { archived: false }));
      },
    },
  ];

  return (
    <aside class="sidebar" aria-label={tr('Navigation')}>
      <div class="sb-top">
        <a class="brand" href="#/today" onClick={onNav}>
          <Logo size={26} />
          <span><StyledTitle firstRed={false}>Checkmate</StyledTitle></span>
        </a>
        <SyncBadge />
        <button type="button" class="icon-btn sb-hide" aria-label={tr('Hide sidebar')} title={tr('Hide sidebar (M)')} onClick={onHide}>
          <Icon name="left" size={20} />
        </button>
      </div>
      <DateBox />
      <button type="button" class="sb-add" onClick={() => (onNav(), ui.quickAdd())}>
        <span class="sb-add-plus"><Icon name="plus" size={16} /></span>
        {tr('Add task')}
      </button>
      <nav class="nav">
        {NAV_ITEMS.filter((it) => !hiddenNav[it.key]).map((it) => (
          <NavItem
            key={it.key}
            href={it.href}
            icon={it.icon()}
            label={tr(it.label)}
            count={it.key === 'inbox' ? inboxCount : it.key === 'today' ? todayCount : 0}
            active={it.key === 'inbox' ? key === 'inbox' || key === 'project/inbox' : route.view === it.key}
            onNav={onNav}
            cut={prefs.skin === 'riot'}
          />
        ))}
      </nav>
      <MenuCounter on={NAV_ITEMS.filter((it) => !hiddenNav[it.key]).map((it) => (it.key === 'inbox' ? key === 'inbox' || key === 'project/inbox' : route.view === it.key))} />

      {route.view === 'calendar' && <CalendarSidebar onNav={onNav} />}

      {favs.length > 0 && (
        <div class="sb-group">
          <div class="sb-group-head"><span>{tr('Favourites')}</span></div>
          {favs.map(({ kind, item }) => (
            <NavItem
              key={item.id}
              href={`#/${kind}/${item.id}`}
              icon={kind === 'project' ? <span class="pdot" style={{ background: A.colorOf(item.color) }} /> : <Icon name={kind === 'label' ? 'tag' : 'filter'} size={18} style={{ color: A.colorOf(item.color) }} />}
              label={item.name}
              count={kind === 'project' ? A.countFor(item.id) : 0}
              active={key === `${kind}/${item.id}`}
              onNav={onNav}
            />
          ))}
        </div>
      )}

      <div class="sb-group">
        <div class="sb-group-head">
          <button type="button" class="sb-group-toggle" aria-expanded={!collapsedProjects} onClick={() => store.setPrefs({ collapsed: { ...prefs.collapsed, 'sb:projects': !collapsedProjects } })}>
            <span>{tr('My projects')}</span>
            <Icon name="chevron" size={14} class={`twist ${collapsedProjects ? '' : 'open'}`} />
          </button>
          <button type="button" class="icon-btn xs" aria-label={tr('Add project')} title={tr('Add project')} onClick={() => ui.editProject(null)}>
            <Icon name="plus" size={18} />
          </button>
        </div>
        {!collapsedProjects && (
          <>
            {projects.map((p, i) => (
              <div class={`nav-row ${key === `project/${p.id}` ? 'on' : ''}`} key={p.id}>
                <NavItem
                  href={`#/project/${p.id}`}
                  icon={<span class="pdot" style={{ background: A.colorOf(p.color) }} />}
                  label={p.name}
                  count={A.countFor(p.id)}
                  active={key === `project/${p.id}`}
                  onNav={onNav}
                />
                <MenuButton class="xs nav-more" label={tr('Actions for {name}', { name: p.name })} title={p.name} items={() => projectItems(p, i)} />
              </div>
            ))}
            {!projects.length && (
              <button type="button" class="sb-empty" onClick={() => ui.editProject(null)}>{tr('Add your first project')}</button>
            )}
            {archived.length > 0 && (
              <button type="button" class="sb-archived" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}>
                <Icon name="archive" size={16} /> {tr('Archived ({n})', { n: archived.length })}
              </button>
            )}
            {showArchived &&
              archived.map((p) => (
                <div class="nav-row archived" key={p.id}>
                  <span class="nav-item static">
                    <span class="pdot" style={{ background: A.colorOf(p.color) }} />
                    <span class="nav-label">{p.name}</span>
                  </span>
                  <button type="button" class="link-btn accent sm" onClick={() => store.patch(p.id, { archived: false })}>{tr('Restore')}</button>
                </div>
              ))}
          </>
        )}
      </div>

      <div class="sb-foot">
        <KeyHints view={route.view} />
        <HeroCount due={todayCount} late={open.filter((t) => t.due && t.due.date < ref).length} />
        <button type="button" class="nav-item" onClick={() => (onNav(), ui.openSettings('general'))}>
          <Icon name="settings" />
          <span class="nav-label">{tr('Settings')}</span>
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// app
// ---------------------------------------------------------------------------

export function App() {
  const version = useStoreVersion();
  const prefs = store.getPrefs();
  const narrow = useNarrow();
  const [route, setRoute] = useState(parseHash());
  const [drawer, setDrawer] = useState(false);
  const [detail, setDetail] = useState(null);
  const [quick, setQuick] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [, setDay] = useState(today());
  const gKey = useRef(0);
  const mainRef = useRef(null);
  const sidebarHidden = !!prefs.collapsed['sb:hidden'];
  const [scrolled, setScrolled] = useState(false);

  // wire the app-wide UI actions
  ui.openTask = (id, opts = {}) => setDetail({ id, ...opts });
  ui.quickAdd = (defaults) => setQuick({ defaults: defaults || contextDefaults(route) });
  ui.editProject = (id) => setDialog({ kind: 'project', id });
  ui.editSection = (id, projectId) => setDialog({ kind: 'section', id, projectId });
  ui.editLabel = (id) => setDialog({ kind: 'label', id });
  ui.editFilter = (id) => setDialog({ kind: 'filter', id });
  ui.openSettings = (tab = 'general') => setSettings(tab);
  ui.closeSettings = () => setSettings(null);
  ui.editCalendar = (id) => setDialog({ kind: 'calendar', id });
  ui.openBirthday = (id, preset) => setDialog({ kind: 'birthday', id, preset });

  useEffect(() => {
    A.setToaster((m, undo) => toast(m, undo));
    if (!location.hash) history.replaceState(null, '', `#/${prefs.startView || 'today'}`);
    const onHash = () => {
      play('nav');
      setRoute(parseHash());
      setDrawer(false);
      if (mainRef.current) mainRef.current.scrollTop = 0;
    };
    window.addEventListener('hashchange', onHash);
    // day rollover
    const iv = setInterval(() => setDay(today()), 60000);
    return () => {
      window.removeEventListener('hashchange', onHash);
      clearInterval(iv);
    };
  }, []);

  // theme
  useEffect(() => {
    applyTheme(prefs.theme, prefs.accent, prefs.skin);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const mm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fn = () => applyTheme(store.getPrefs().theme, store.getPrefs().accent, store.getPrefs().skin);
    const on = (q) => (q.addEventListener ? q.addEventListener('change', fn) : q.addListener(fn));
    const off = (q) => (q.removeEventListener ? q.removeEventListener('change', fn) : q.removeListener(fn));
    on(mq);
    on(mm);
    return () => {
      off(mq);
      off(mm);
    };
  }, [prefs.theme, prefs.accent, prefs.skin, prefs.motion, narrow]);

  // interface language
  useEffect(() => {
    const l = lang();
    document.documentElement.lang = l === 'zh-Hant' ? 'zh-Hant' : 'en';
    store.relabelSeeds(seedTexts());
    setNativeLanguage(l);
  }, [prefs.language]);

  // app icon follows the style
  useEffect(() => {
    const skin = prefs.skin || 'tickwise';
    setAppIcon(skin, { tabIconSvg: iconSvg(skin, { accent: accentHex(prefs.accent) }), follow: prefs.iconFollowsStyle !== false });
  }, [prefs.skin, prefs.accent, prefs.iconFollowsStyle]);

  // title
  useEffect(() => {
    const n = A.todayTasks().length;
    document.title = `${viewTitle(route)}${n ? ` (${n})` : ''} – Checkmate`;
  });

  useReminders(version);

  // drawer acts as a layer on phones, so Back closes it first
  useLayer(() => setDrawer(false), drawer && narrow);

  // In the Windows app, open web links in the default browser instead of a popup window.
  useEffect(() => {
    if (!window.chrome || !window.chrome.webview) return;
    const onClick = (e) => {
      const a = e.target.closest && e.target.closest('a[href^="http"]');
      if (!a || !window.twOpenExternal) return;
      e.preventDefault();
      window.twOpenExternal(a.href);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Notification taps on Android open the task.
  useEffect(() => {
    window.__openTaskNow = (id) => {
      window.__openTask = null;
      openReminder(id);
    };
    if (window.__openTask) window.__openTaskNow(window.__openTask);
  }, []);

  // Android back button
  useEffect(() => {
    window.appBack = () => {
      if (closeTopLayer()) return true;
      const start = store.getPrefs().startView || 'today';
      if (parseHash().view !== start) {
        location.hash = `#/${start}`;
        return true;
      }
      return false;
    };
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('.modal-wrap, .popover, .sheet-wrap')) return;
      const k = e.key.toLowerCase();
      if (Date.now() - gKey.current < 1200) {
        gKey.current = 0;
        const go = { t: 'today', i: 'inbox', u: 'upcoming', l: 'calendar', b: 'birthdays', f: 'filters', c: 'completed', p: 'productivity', s: 'search' }[k];
        if (go) {
          e.preventDefault();
          location.hash = `#/${go}`;
        }
        return;
      }
      if (k === 'g') gKey.current = Date.now();
      else if (k === 'q' || k === 'a') {
        e.preventDefault();
        ui.quickAdd();
      } else if (k === '/') {
        e.preventDefault();
        location.hash = '#/search';
      } else if (e.key === '?') {
        e.preventDefault();
        setSettings('keys');
      } else if (k === 'm') {
        store.setPrefs({ collapsed: { ...store.getPrefs().collapsed, 'sb:hidden': !store.getPrefs().collapsed['sb:hidden'] } });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  let view;
  switch (route.view) {
    case 'today': view = <TodayView />; break;
    case 'upcoming': view = <UpcomingView />; break;
    case 'calendar': view = <CalendarView arg={route.arg} />; break;
    case 'inbox': view = <ProjectView id="inbox" />; break;
    case 'project': view = <ProjectView id={route.arg} key={route.arg} />; break;
    case 'label': view = <LabelView id={route.arg} key={route.arg} />; break;
    case 'filter': view = <FilterView id={route.arg} key={route.arg} />; break;
    case 'filters': view = <FiltersLabelsView />; break;
    case 'search': view = <SearchView q={route.arg || ''} />; break;
    case 'completed': view = <CompletedView />; break;
    case 'productivity': view = <ProductivityView />; break;
    case 'birthdays': view = <BirthdaysView />; break;
    default: view = <TodayView />;
  }

  const toggleSidebar = () => {
    if (narrow) setDrawer(!drawer);
    else store.setPrefs({ collapsed: { ...prefs.collapsed, 'sb:hidden': !sidebarHidden } });
  };
  ui.toggleSidebar = toggleSidebar;

  return (
    <div class={`app ${drawer ? 'drawer-open' : ''} ${sidebarHidden ? 'sb-hidden' : ''} ${scrolled ? 'scrolled' : ''} ${route.view === 'calendar' ? 'on-cal' : ''}`} data-platform={platform()}>
      <StarField />
      <Sidebar route={route} onNav={() => setDrawer(false)} onHide={toggleSidebar} />
      <div class="scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
      <main class="main" ref={mainRef} id="main" onScroll={(e) => {
        const s = e.currentTarget.scrollTop > 56;
        if (s !== scrolled) setScrolled(s);
      }}>
        <div class="topbar">
          <button type="button" class="icon-btn" aria-label={narrow ? tr('Open menu') : sidebarHidden ? tr('Show sidebar') : tr('Hide sidebar')} title={tr('Menu (M)')} onClick={toggleSidebar}>
            <Icon name="menu" />
          </button>
          <span class="topbar-title">{viewTitle(route)}</span>
          <span class="spacer" />
          {narrow && <SyncBadge />}
          <a class="icon-btn" href="#/search" aria-label={tr('Search')} title={tr('Search (/)')}>
            <Icon name="search" />
          </a>
        </div>
        <div class="content">{view}</div>
      </main>
      {route.view !== 'calendar' && (
        <button type="button" class="fab" aria-label={tr('Add task')} title={tr('Add task (Q)')} onClick={() => ui.quickAdd()}>
          <Icon name="plus" size={26} />
        </button>
      )}

      {quick && (
        <Modal onClose={() => setQuick(null)} class="quick" label={tr('Add task')}>
          <TaskEditor defaults={quick.defaults} keepOpen={false} onCancel={() => setQuick(null)} onSubmit={(f) => {
            const t = A.addTask(f);
            const where = store.get(t.projectId);
            toast(tr('Added to {name}', { name: A.projectName(where) }), () => ui.openTask(t.id), { label: tr('Open') });
          }} />
        </Modal>
      )}
      {detail && <TaskDetail key={detail.id} id={detail.id} addSub={detail.addSub} onClose={() => setDetail(null)} />}
      {settings && <Settings tab={settings} onClose={() => setSettings(null)} />}
      {dialog && dialog.kind === 'project' && <ProjectDialog id={dialog.id} onClose={() => setDialog(null)} />}
      {dialog && dialog.kind === 'section' && <SectionDialog id={dialog.id} projectId={dialog.projectId} onClose={() => setDialog(null)} />}
      {dialog && dialog.kind === 'label' && <LabelDialog id={dialog.id} onClose={() => setDialog(null)} />}
      {dialog && dialog.kind === 'filter' && <FilterDialog id={dialog.id} onClose={() => setDialog(null)} />}
      {dialog && dialog.kind === 'calendar' && <CalendarDialog id={dialog.id} onClose={() => setDialog(null)} />}
      {dialog && dialog.kind === 'birthday' && <BirthdayDialog key={dialog.id || 'new'} id={dialog.id} preset={dialog.preset} onClose={() => setDialog(null)} />}
      <EventLayer />
      <ConfirmHost />
      <Toasts />
      <PageWipe routeKey={routeKey(route)} />
    </div>
  );
}
