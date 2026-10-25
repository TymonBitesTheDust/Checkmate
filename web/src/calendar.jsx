// The Calendar page: day, 3/4-day, week, month, year and schedule views, in the
// manner of Google Calendar, plus the sidebar's mini month and calendar list.
import { Fragment } from 'preact';
import { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'preact/hooks';
import * as store from './store.js';
import * as A from './actions.js';
import * as E from './events.js';
import { ui } from './bus.js';
import { Icon } from './icons.jsx';
import { MenuButton, useStoreVersion, useNarrow, isNarrow, confirmDialog, toast } from './ui.jsx';
import { StyledTitle } from './riot.jsx';
import { MiniMonth, retime, CENTER } from './event-ui.jsx';
import { useNav, setNav, nav, viewOf, setView } from './calnav.js';
import { play } from './sound.js';
import { tr, isZh } from './i18n.js';
import { gmtLabel } from './tz.js';
import {
  today, addDays, addMonths, parseYmd, ymd, weekday, startOfWeek, diffDays, formatTime,
  dayShort, dayMin, monthYear, monthShort, monthName, MONTHS_SHORT, dayLong,
} from './dates.js';
import * as calsync from './calsync.js';

const MIN = 60000;
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const snap = (m, step = 15) => Math.round(m / step) * step;
const floorTo = (m, step) => Math.floor(m / step) * step;

// ---------------------------------------------------------------------------
// periods
// ---------------------------------------------------------------------------

const VIEW_NAMES = { day: 'Day', days: '{n} days', week: 'Week', month: 'Month', year: 'Year', schedule: 'Schedule' };
const VIEW_KEYS = { day: 'D', days: 'X', week: 'W', month: 'M', year: 'Y', schedule: 'A' };
export const viewLabel = (v, narrow) => tr(VIEW_NAMES[v], { n: narrow ? 3 : 4 });

function period(view, date, narrow, prefs, scheduleDays = 60) {
  const ws = prefs.weekStart ?? 1;
  const keepWeekends = prefs.calWeekends !== false;
  let days = [];
  let weeks = null;
  switch (view) {
    case 'day':
      days = [date];
      break;
    case 'days':
      days = Array.from({ length: narrow ? 3 : 4 }, (_, i) => addDays(date, i));
      break;
    case 'week': {
      const s = startOfWeek(date, ws);
      days = Array.from({ length: 7 }, (_, i) => addDays(s, i));
      if (!keepWeekends) days = days.filter((d) => weekday(d) !== 0 && weekday(d) !== 6);
      break;
    }
    case 'month': {
      const d = parseYmd(date);
      const first = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
      const last = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      let s = startOfWeek(first, ws);
      weeks = [];
      while (s <= last) {
        let w = Array.from({ length: 7 }, (_, i) => addDays(s, i));
        if (!keepWeekends) w = w.filter((x) => weekday(x) !== 0 && weekday(x) !== 6);
        weeks.push(w);
        s = addDays(s, 7);
      }
      days = weeks.flat();
      break;
    }
    case 'year': {
      const y = parseYmd(date).getFullYear();
      days = [`${y}-01-01`, `${y}-12-31`];
      break;
    }
    default:
      days = Array.from({ length: scheduleDays }, (_, i) => addDays(date, i));
  }
  const first = view === 'month' ? weeks[0][0] : days[0];
  const lastDay = view === 'month' ? addDays(startOfWeek(weeks[weeks.length - 1][0], ws), 6) : days[days.length - 1];
  return { days, weeks, from: E.midnight(first), to: E.midnight(addDays(lastDay, 1)) };
}

function step(view, date, dir, narrow) {
  switch (view) {
    case 'day': return addDays(date, dir);
    case 'days': return addDays(date, dir * (narrow ? 3 : 4));
    case 'week': return addDays(date, dir * 7);
    case 'month': return addMonths(date, dir);
    case 'year': return addMonths(date, dir * 12);
    default: return addDays(date, dir * 14);
  }
}

function titleOf(view, date, days, narrow) {
  const d = parseYmd(date);
  if (narrow && !isZh() && view !== 'year') {
    const a = parseYmd(view === 'day' || view === 'month' || view === 'schedule' ? date : days[0]);
    const b = parseYmd(view === 'day' || view === 'month' || view === 'schedule' ? date : days[days.length - 1]);
    if (view === 'day') return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
    return a.getMonth() === b.getMonth() ? `${MONTHS_SHORT[a.getMonth()]} ${a.getFullYear()}` : `${MONTHS_SHORT[a.getMonth()]} – ${MONTHS_SHORT[b.getMonth()]}`;
  }
  if (view === 'day') return isZh() ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` : `${d.getDate()} ${monthName(d.getMonth())} ${d.getFullYear()}`;
  if (view === 'year') return isZh() ? `${d.getFullYear()}年` : String(d.getFullYear());
  if (view === 'month' || view === 'schedule') return monthYear(d);
  const a = parseYmd(days[0]);
  const b = parseYmd(days[days.length - 1]);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return monthYear(a);
  if (isZh()) return a.getFullYear() === b.getFullYear() ? `${a.getFullYear()}年${a.getMonth() + 1}月 – ${b.getMonth() + 1}月` : `${a.getFullYear()}年${a.getMonth() + 1}月 – ${b.getFullYear()}年${b.getMonth() + 1}月`;
  return a.getFullYear() === b.getFullYear() ? `${MONTHS_SHORT[a.getMonth()]} – ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}` : `${MONTHS_SHORT[a.getMonth()]} ${a.getFullYear()} – ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
}

const isTop = (o) => o.allDay || (o.kind === 'event' && o.endMs - o.startMs >= DAY);

// ---------------------------------------------------------------------------
// pointer gestures: drag with a mouse straight away, on touch after a long press
// ---------------------------------------------------------------------------

function gesture(e, h) {
  if (e.button !== undefined && e.button !== 0) return;
  const touch = e.pointerType === 'touch';
  const sx = e.clientX;
  const sy = e.clientY;
  let active = false;
  let ended = false;
  let timer = null;
  const block = (ev) => active && ev.cancelable && ev.preventDefault();
  const cleanup = () => {
    ended = true;
    clearTimeout(timer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('touchmove', block);
    document.body.classList.remove('cal-dragging');
  };
  const begin = () => {
    active = true;
    document.body.classList.add('cal-dragging');
    h.onStart && h.onStart(sx, sy);
  };
  const move = (ev) => {
    if (!active) {
      const dist = Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy);
      if (touch) {
        if (dist > 10) cleanup();
        return;
      }
      if (dist < 5) return;
      begin();
    }
    ev.preventDefault();
    h.onMove(ev.clientX, ev.clientY);
  };
  const up = (ev) => {
    const was = active;
    cleanup();
    if (was) h.onEnd(ev.clientX, ev.clientY);
    else h.onTap && h.onTap(ev);
  };
  const cancel = () => {
    const was = active;
    cleanup();
    if (was && h.onCancel) h.onCancel();
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('touchmove', block, { passive: false });
  if (touch && h.onStart) {
    timer = setTimeout(() => {
      if (ended) return;
      if (navigator.vibrate) navigator.vibrate(12);
      begin();
      h.onMove(sx, sy);
    }, 380);
  }
}

// Scroll a container while the pointer is near its top or bottom edge.
function edgeScroll(el, y) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (y < r.top + 70) el.scrollTop -= Math.ceil((r.top + 70 - y) / 5);
  else if (y > r.bottom - 50) el.scrollTop += Math.ceil((y - (r.bottom - 50)) / 5);
}

const proxy = (rect) => ({ nodeType: 1, getBoundingClientRect: () => rect, contains: () => false });

// Press on a day (month cell or all-day row) and drag across days for a multi-day event.
function startDayRange(e, date, cellSelector) {
  const cell = e.currentTarget;
  const rect0 = cell.getBoundingClientRect();
  const dayAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const c = el && el.closest(cellSelector);
    return c ? c.dataset.date : null;
  };
  const draft = (a, b) => {
    const [s, t] = a <= b ? [a, b] : [b, a];
    return { kind: 'event', allDay: true, startMs: E.midnight(s), endMs: E.midnight(addDays(t, 1)), calendarId: (E.defaultCalendar() || {}).id };
  };
  let last = date;
  gesture(e, {
    onStart: () => {},
    onMove: (x, y) => {
      const d = dayAt(x, y);
      if (d && d !== last) last = d;
      setNav({ pending: draft(date, last) });
    },
    onEnd: () => {
      const el = document.querySelector(`${cellSelector}[data-date="${last}"]`);
      ui.newEvent(draft(date, last), proxy(el ? el.getBoundingClientRect() : rect0));
    },
    onCancel: () => setNav({ pending: null }),
    onTap: () => {
      const d = draft(date, date);
      setNav({ pending: d });
      ui.newEvent(d, proxy(rect0));
    },
  });
}

// ---------------------------------------------------------------------------
// event blocks
// ---------------------------------------------------------------------------

function occStyle(o) {
  return { '--ev': o.color, '--ev-ink': E.inkOn(o.color) };
}

function openOcc(o, el) {
  ui.showEvent(o, el);
}

// ---------------------------------------------------------------------------
// all-day lanes (week rows)
// ---------------------------------------------------------------------------

function lanesFor(items, days) {
  const index = new Map(days.map((d, i) => [d, i]));
  const placed = [];
  for (const o of items) {
    let c0 = -1;
    let c1 = -1;
    for (let i = 0; i < days.length; i++) {
      if (days[i] >= o.startDate && days[i] < o.endDate) {
        if (c0 < 0) c0 = i;
        c1 = i + 1;
      }
    }
    if (c0 < 0) continue;
    placed.push({ o, c0, c1, cutL: o.startDate < days[0] || !index.has(o.startDate), cutR: o.endDate > addDays(days[days.length - 1], 1) });
  }
  placed.sort((a, b) => a.c0 - b.c0 || (b.c1 - b.c0) - (a.c1 - a.c0) || (b.o.allDay ? 1 : 0) - (a.o.allDay ? 1 : 0) || a.o.startMs - b.o.startMs);
  const lanes = [];
  for (const p of placed) {
    let l = 0;
    while (lanes[l] && lanes[l].some((q) => q.c0 < p.c1 && q.c1 > p.c0)) l++;
    (lanes[l] = lanes[l] || []).push(p);
    p.lane = l;
  }
  return { placed, count: lanes.length };
}

// ---------------------------------------------------------------------------
// time grid (day / 3–4 days / week)
// ---------------------------------------------------------------------------

function layoutDay(segs) {
  segs.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const sg of cluster) {
      let c = cols.findIndex((end) => end <= sg.s);
      if (c < 0) {
        c = cols.length;
        cols.push(sg.v);
      } else cols[c] = sg.v;
      sg.col = c;
    }
    for (const sg of cluster) {
      let span = 1;
      for (let c = sg.col + 1; c < cols.length; c++) {
        if (cluster.some((x) => x !== sg && x.col === c && x.s < sg.v && x.v > sg.s)) break;
        span++;
      }
      sg.n = cols.length;
      sg.span = span;
      out.push(sg);
    }
    cluster = [];
    clusterEnd = -1;
  };
  for (const sg of segs) {
    sg.v = Math.max(sg.e, sg.s + 22);
    if (cluster.length && sg.s >= clusterEnd) flush();
    cluster.push(sg);
    clusterEnd = Math.max(clusterEnd, sg.v);
  }
  if (cluster.length) flush();
  return out;
}

function TimeGrid({ days, occs, view, narrow }) {
  const prefs = store.getPrefs();
  const n = useNav();
  const H = 48;
  const scrollRef = useRef(null);
  const colsRef = useRef(null);
  const allRef = useRef(null);
  const [now, setNow] = useState(Date.now());
  const [drag, setDrag] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const ref = today();
  const N = days.length;

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(iv);
  }, []);
  // open near the current time (or the morning)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const d = new Date();
    const h = days.includes(ref) ? d.getHours() + d.getMinutes() / 60 - 1.5 : 7.5;
    el.scrollTop = Math.max(0, h * H);
  }, [view, n.focus]);

  const dragging = drag && drag.occ ? drag.occ.key : null;
  let list = occs;
  if (drag && drag.occ) list = [...occs.filter((o) => o.key !== drag.occ.key), { ...drag.occ, startMs: drag.startMs, endMs: drag.endMs, allDay: drag.allDay, startDate: E.localYmd(drag.startMs), endDate: drag.allDay ? E.localYmd(drag.endMs) : addDays(E.localYmd(Math.max(drag.startMs, drag.endMs - 1)), 1), preview: true }];
  const pend = n.pending;
  if (pend && pend.startMs) {
    const o = {
      key: 'pending', kind: pend.kind === 'task' ? 'task' : 'event', pending: true, allDay: !!pend.allDay, startMs: pend.startMs,
      endMs: pend.kind === 'task' && !pend.allDay ? pend.startMs + 30 * MIN : pend.endMs, title: pend.title || tr('(No title)'),
      color: A.colorOf(pend.kind === 'task' ? 'slate' : (store.get(pend.calendarId) || E.defaultCalendar() || {}).color),
      startDate: E.localYmd(pend.startMs), endDate: pend.allDay ? E.localYmd(pend.endMs) : addDays(E.localYmd(Math.max(pend.startMs, pend.endMs - 1)), 1),
    };
    list = [...list, o];
  }
  const top = list.filter(isTop);
  const timed = list.filter((o) => !isTop(o));
  const { placed, count } = lanesFor(top, days);
  const cap = expanded ? count : count > 3 ? 2 : count;
  const hiddenPerDay = days.map((_, i) => placed.filter((p) => p.lane >= cap && p.c0 <= i && p.c1 > i).length);

  const cols = days.map((d) => {
    const s0 = E.midnight(d);
    const s1 = E.midnight(addDays(d, 1));
    const segs = timed
      .filter((o) => o.startMs < s1 && (o.endMs > s0 || (o.endMs === o.startMs && o.startMs >= s0)))
      .map((o) => ({ o, s: Math.max(0, (o.startMs - s0) / MIN), e: Math.min(1440, (Math.max(o.endMs, o.startMs + 15 * MIN) - s0) / MIN), cutTop: o.startMs < s0, cutBottom: o.endMs > s1 }));
    return layoutDay(segs);
  });

  // where the pointer is: a column and minute, or the all-day row
  const hit = (x, y) => {
    const colEls = colsRef.current ? [...colsRef.current.children] : [];
    let i = colEls.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return x >= r.left && x < r.right;
    });
    if (i < 0) {
      const first = colEls[0] && colEls[0].getBoundingClientRect();
      i = first && x < first.left ? 0 : N - 1;
    }
    const allR = allRef.current && allRef.current.getBoundingClientRect();
    if (allR && y < allR.bottom) return { i, date: days[i], allDay: true };
    const r = colEls[i].getBoundingClientRect();
    const m = Math.max(0, Math.min(1440, ((y - r.top) / H) * 60));
    return { i, date: days[i], min: m };
  };

  const startCreate = (e) => {
    if (e.target.closest('.ev-block')) return;
    const col = e.currentTarget;
    const i = +col.dataset.i;
    const r0 = col.getBoundingClientRect();
    const m0 = Math.min(1425, floorTo(((e.clientY - r0.top) / H) * 60, 15));
    const date = days[i];
    let cur = null;
    const draftFor = (a, b) => ({ kind: 'event', allDay: false, startMs: E.midnight(date) + a * MIN, endMs: E.midnight(date) + b * MIN, calendarId: (E.defaultCalendar() || {}).id });
    const rectFor = (a, b) => {
      const r = col.getBoundingClientRect();
      return { left: r.left + 2, right: r.right - 2, top: r.top + (a / 60) * H, bottom: r.top + (b / 60) * H, width: r.width - 4 };
    };
    gesture(e, {
      onStart: () => {},
      onMove: (x, y) => {
        edgeScroll(scrollRef.current, y);
        const r = col.getBoundingClientRect();
        const m = Math.max(0, Math.min(1440, ((y - r.top) / H) * 60));
        const a = Math.min(m0, floorTo(m, 15));
        const b = Math.max(m0 + 15, Math.min(1440, floorTo(m, 15) + 15));
        cur = [a, b];
        setNav({ pending: draftFor(a, b) });
      },
      onEnd: () => {
        if (!cur) return;
        const d = draftFor(cur[0], cur[1]);
        ui.newEvent(d, proxy(rectFor(cur[0], cur[1])));
      },
      onCancel: () => setNav({ pending: null }),
      onTap: () => {
        const len = prefs.calDuration || 60;
        const a = Math.min(1440 - len, floorTo(((e.clientY - r0.top) / H) * 60, 30));
        const d = draftFor(a, a + len);
        setNav({ pending: d });
        ui.newEvent(d, proxy(rectFor(a, a + len)));
      },
    });
  };

  const startMove = (o, el) => (e) => {
    if (o.pending) return;
    e.stopPropagation();
    const canMove = !o.readOnly && !o.virtual && !(o.kind === 'task' && o.done);
    const len = o.endMs - o.startMs;
    const h0 = hit(e.clientX, e.clientY);
    const grab = o.allDay || h0.allDay ? 0 : (E.midnight(h0.date) + h0.min * MIN) - o.startMs;
    let last = null;
    gesture(e, {
      onStart: canMove ? () => {} : null,
      onMove: (x, y) => {
        if (!canMove) return;
        edgeScroll(scrollRef.current, y);
        const t = hit(x, y);
        if (t.allDay) {
          const days0 = o.allDay ? Math.max(1, diffDays(o.endDate, o.startDate)) : 1;
          const s = E.midnight(t.date);
          last = { startMs: s, endMs: E.midnight(addDays(t.date, days0)), allDay: true };
        } else {
          const startMin = Math.max(0, Math.min(1425, snap(t.min - grab / MIN, 15)));
          const s = E.midnight(t.date) + startMin * MIN;
          const l = o.allDay ? (prefs.calDuration || 60) * MIN : o.kind === 'task' ? 30 * MIN : len;
          last = { startMs: s, endMs: s + l, allDay: false };
        }
        setDrag({ occ: o, ...last });
      },
      onEnd: () => {
        setDrag(null);
        if (!last) return;
        if (last.startMs === o.startMs && last.allDay === o.allDay && last.endMs === o.endMs) return;
        retime(o, last.startMs, last.endMs, last.allDay);
      },
      onCancel: () => setDrag(null),
      onTap: () => openOcc(o, el()),
    });
  };

  const startResize = (o) => (e) => {
    e.stopPropagation();
    let last = null;
    gesture(e, {
      onStart: () => {},
      onMove: (x, y) => {
        edgeScroll(scrollRef.current, y);
        const t = hit(x, y);
        if (t.allDay) return;
        let end = E.midnight(t.date) + snap(t.min, 15) * MIN;
        if (end < o.startMs + 15 * MIN) end = o.startMs + 15 * MIN;
        last = end;
        setDrag({ occ: o, startMs: o.startMs, endMs: end, allDay: false });
      },
      onEnd: () => {
        setDrag(null);
        if (last && last !== o.endMs) retime(o, o.startMs, last, false);
      },
      onCancel: () => setDrag(null),
    });
  };

  const createAllDay = (i) => (e) => {
    if (e.target.closest('.ad-bar, .ad-more')) return;
    startDayRange(e, days[i], '.ad-cell');
  };

  const nowMin = (now - E.midnight(ref)) / MIN;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const fmt = prefs.timeFormat;
  const hourLabel = (h) => (h === 0 ? '' : isZh() && fmt !== '24' ? `${h < 12 ? '上午' : '下午'}${h % 12 || 12}時` : formatTime(`${h}:00`, fmt));

  return (
    <div class={`tg ${N === 1 ? 'one' : ''}`} style={{ '--cols': N, '--hour': `${H}px` }}>
      <div class="tg-scroll" ref={scrollRef}>
        <div class="tg-top">
          <div class="tg-head">
            <div class="tg-gutter tg-tz">{gmtLabel(now)}</div>
            {days.map((d) => {
              const dd = parseYmd(d);
              return (
                <button type="button" key={d} class={`tg-dayhead ${d === ref ? 'today' : ''} ${d < ref ? 'past' : ''}`} onClick={() => (setNav({ date: d }), setView('day'))} aria-label={dayLong(d)}>
                  <span class="dow">{dayShort(dd.getDay())}</span>
                  <span class="dnum">{dd.getDate()}</span>
                </button>
              );
            })}
          </div>
          <div class="tg-allday" ref={allRef}>
            <div class="tg-gutter ad-gutter">
              {count > 3 && (
                <button type="button" class="icon-btn xs" aria-label={expanded ? tr('Show fewer') : tr('Show all')} title={expanded ? tr('Show fewer') : tr('Show all')} onClick={() => setExpanded(!expanded)}>
                  <Icon name={expanded ? 'down' : 'right'} size={14} />
                </button>
              )}
            </div>
            <div class="ad-cells" style={{ '--lanes': Math.max(1, Math.min(cap + (count > cap ? 1 : 0), 99)) }}>
              {days.map((d, i) => (
                <div key={d} class={`ad-cell ${d === ref ? 'today' : ''}`} data-date={d} onPointerDown={createAllDay(i)}>
                  {hiddenPerDay[i] > 0 && (
                    <button type="button" class="ad-more" style={{ top: `${cap * 24 + 2}px` }} onClick={(e) => (e.stopPropagation(), setExpanded(true))}>
                      {tr('+{n} more', { n: hiddenPerDay[i] })}
                    </button>
                  )}
                </div>
              ))}
              {placed.filter((p) => p.lane < cap).map((p) => {
                const o = p.o;
                let elRef = null;
                return (
                  <div
                    key={o.key}
                    ref={(x) => (elRef = x)}
                    role="button"
                    tabIndex={0}
                    class={`ad-bar ev-chip ${o.kind} ${o.pending ? 'ev-ghost' : ''} ${o.preview ? 'preview' : ''} ${dragging === o.key && !o.preview ? 'ghosted' : ''} ${o.done ? 'done' : ''} ${p.cutL ? 'cut-l' : ''} ${p.cutR ? 'cut-r' : ''} ${o.endMs <= now ? 'past' : ''}`}
                    style={{ ...occStyle(o), left: `calc(${(p.c0 / N) * 100}% + 2px)`, width: `calc(${((p.c1 - p.c0) / N) * 100}% - 5px)`, top: `${p.lane * 24 + 2}px` }}
                    onPointerDown={startMove(o, () => elRef)}
                    onKeyDown={(e) => e.key === 'Enter' && openOcc(o, elRef)}
                  >
                    {o.kind === 'task' && <span class={`ev-tick ${o.done ? 'on' : ''}`} />}
                    <span class="ev-title">{o.title}</span>
                    {!o.allDay && <span class="ev-time">{formatTime(`${new Date(o.startMs).getHours()}:${new Date(o.startMs).getMinutes()}`, fmt)}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div class="tg-body" style={{ height: `${24 * H}px` }}>
          <div class="tg-gutter tg-hours">
            {hours.map((h) => <span key={h} class="tg-hour" style={{ top: `${h * H}px` }}>{hourLabel(h)}</span>)}
          </div>
          <div class="tg-cols" ref={colsRef}>
            {days.map((d, i) => (
              <div key={d} class={`tg-col ${d === ref ? 'today' : ''} ${weekday(d) === 0 || weekday(d) === 6 ? 'weekend' : ''}`} data-i={i} data-date={d} onPointerDown={startCreate}>
                {cols[i].map((sg) => {
                  const o = sg.o;
                  const h = Math.max(18, ((sg.v - sg.s) / 60) * H - 2);
                  const short = h < 38;
                  let elRef = null;
                  return (
                    <div
                      key={`${o.key}@${d}`}
                      ref={(x) => (elRef = x)}
                      role="button"
                      tabIndex={0}
                      aria-label={`${o.title}, ${E.timeRangeText(o)}`}
                      class={`ev-block ${o.kind} ${short ? 'short' : ''} ${o.pending ? 'ev-ghost' : ''} ${o.preview ? 'preview' : ''} ${dragging === o.key && !o.preview ? 'ghosted' : ''} ${o.done ? 'done' : ''} ${o.endMs <= now && !o.pending ? 'past' : ''} ${sg.cutTop ? 'cut-t' : ''} ${sg.cutBottom ? 'cut-b' : ''} ${sg.n > 1 ? 'packed' : ''}`}
                      style={{
                        ...occStyle(o),
                        top: `${(sg.s / 60) * H}px`,
                        height: `${h}px`,
                        left: `calc(${(sg.col / sg.n) * 100}% + 1px)`,
                        width: `calc(${(sg.span / sg.n) * 100}% - ${sg.col + sg.span < sg.n ? 2 : 6}px)`,
                        zIndex: o.preview || o.pending ? 30 : 2 + sg.col,
                      }}
                      onPointerDown={startMove(o, () => elRef)}
                      onKeyDown={(e) => e.key === 'Enter' && openOcc(o, elRef)}
                    >
                      {o.kind === 'task' && <span class={`ev-tick ${o.done ? 'on' : ''}`} />}
                      <span class="ev-title">{o.title}</span>
                      <span class="ev-time">{E.timeRangeText(o)}</span>
                      {!short && h > 56 && o.location && <span class="ev-loc">{o.location}</span>}
                      {o.kind === 'event' && !o.readOnly && !o.pending && !sg.cutBottom && <span class="ev-resize" onPointerDown={startResize(o)} aria-hidden="true" />}
                    </div>
                  );
                })}
                {d === ref && <div class="now-line" style={{ top: `${(nowMin / 60) * H}px` }} aria-hidden="true" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// month
// ---------------------------------------------------------------------------

function MonthGrid({ weeks, month, occs }) {
  const prefs = store.getPrefs();
  const n = useNav();
  const ref = today();
  const wrapRef = useRef(null);
  const [rowH, setRowH] = useState(110);
  const [drag, setDrag] = useState(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.querySelector('.mg-week');
      if (r) setRowH(r.getBoundingClientRect().height);
    };
    measure();
    const ro = window.ResizeObserver ? new ResizeObserver(measure) : null;
    ro && ro.observe(el);
    return () => ro && ro.disconnect();
  }, [weeks.length]);
  const LANE = 21;
  const cap = Math.max(1, Math.floor((rowH - 28) / LANE));
  const cols = weeks[0].length;
  const fmt = prefs.timeFormat;
  let list = occs;
  const pend = n.pending;
  if (pend && pend.startMs) {
    list = [...list, {
      key: 'pending', kind: 'event', pending: true, allDay: !!pend.allDay, startMs: pend.startMs, endMs: pend.endMs, title: pend.title || tr('(No title)'),
      color: A.colorOf((store.get(pend.calendarId) || E.defaultCalendar() || {}).color), startDate: E.localYmd(pend.startMs),
      endDate: pend.allDay ? E.localYmd(pend.endMs) : addDays(E.localYmd(pend.startMs), 1),
    }];
  }

  const startMove = (o, getEl) => (e) => {
    if (o.pending) return;
    e.stopPropagation();
    const canMove = !o.readOnly && !o.virtual && !(o.kind === 'task' && o.done);
    let target = null;
    gesture(e, {
      onStart: canMove ? () => {} : null,
      onMove: (x, y) => {
        const el = document.elementFromPoint(x, y);
        const cell = el && el.closest('.mg-cell');
        if (cell) {
          target = cell.dataset.date;
          setDrag({ key: o.key, date: target });
        }
      },
      onEnd: () => {
        setDrag(null);
        if (!target || target === o.startDate) return;
        const shift = diffDays(target, o.startDate);
        if (o.allDay) retime(o, E.midnight(addDays(o.startDate, shift)), E.midnight(addDays(o.endDate, shift)), true);
        else {
          const s = new Date(o.startMs);
          const ns = parseYmd(target);
          ns.setHours(s.getHours(), s.getMinutes(), 0, 0);
          retime(o, ns.getTime(), ns.getTime() + (o.endMs - o.startMs), false);
        }
      },
      onCancel: () => setDrag(null),
      onTap: () => ui.showEvent(o, getEl()),
    });
  };

  const create = (date) => (e) => {
    if (e.target.closest('.ev-chip, .mg-num, .mg-more')) return;
    startDayRange(e, date, '.mg-cell');
  };

  return (
    <div class="mg" ref={wrapRef} style={{ '--cols': cols }}>
      <div class="mg-dows">
        {weeks[0].map((d) => <span key={d}>{dayShort(weekday(d))}</span>)}
      </div>
      <div class="mg-weeks">
        {weeks.map((w) => {
          const items = list.filter((o) => o.startDate <= w[w.length - 1] && o.endDate > w[0]);
          const bars = items.filter((o) => isTop(o) || diffDays(o.endDate, o.startDate) > 1);
          const dots = items.filter((o) => !bars.includes(o));
          const { placed } = lanesFor([...bars, ...dots], w);
          const shown = placed.filter((p) => p.lane < cap);
          const hiddenPerDay = w.map((_, i) => placed.filter((p) => p.c0 <= i && p.c1 > i && p.lane >= cap - 1).length);
          const overflow = w.map((_, i) => placed.filter((p) => p.c0 <= i && p.c1 > i).length > cap);
          return (
            <div class="mg-week" key={w[0]}>
              {w.map((d, i) => {
                const out = parseYmd(d).getMonth() !== month;
                return (
                  <div key={d} class={`mg-cell ${out ? 'out' : ''} ${d === ref ? 'today' : ''} ${drag && drag.date === d ? 'over' : ''}`} data-date={d} onPointerDown={create(d)}>
                    <button type="button" class="mg-num" onClick={() => (setNav({ date: d }), setView('day'))} aria-label={dayLong(d)}>
                      {parseYmd(d).getDate() === 1 ? (isZh() ? `${parseYmd(d).getMonth() + 1}月1日` : `1 ${monthShort(parseYmd(d).getMonth())}`) : parseYmd(d).getDate()}
                    </button>
                    {overflow[i] && (
                      <button type="button" class="mg-more" style={{ top: `${26 + (cap - 1) * LANE}px` }} onClick={(e) => (e.stopPropagation(), ui.showDay(d, e.currentTarget))}>
                        {tr('+{n} more', { n: hiddenPerDay[i] })}
                      </button>
                    )}
                  </div>
                );
              })}
              {shown.filter((p) => !(overflow.slice(p.c0, p.c1).some(Boolean) && p.lane >= cap - 1)).map((p) => {
                const o = p.o;
                const bar = bars.includes(o);
                let elRef = null;
                const t = new Date(o.startMs);
                return (
                  <div
                    key={o.key}
                    ref={(x) => (elRef = x)}
                    role="button"
                    tabIndex={0}
                    class={`ev-chip mg-item ${bar ? 'mg-bar' : 'mg-dot'} ${o.kind} ${o.pending ? 'ev-ghost' : ''} ${drag && drag.key === o.key ? 'ghosted' : ''} ${o.done ? 'done' : ''} ${p.cutL ? 'cut-l' : ''} ${p.cutR ? 'cut-r' : ''} ${o.endMs <= Date.now() && !o.pending ? 'past' : ''}`}
                    style={{ ...occStyle(o), left: `calc(${(p.c0 / cols) * 100}% + 3px)`, width: `calc(${((p.c1 - p.c0) / cols) * 100}% - 6px)`, top: `${26 + p.lane * LANE}px` }}
                    onPointerDown={startMove(o, () => elRef)}
                    onKeyDown={(e) => e.key === 'Enter' && ui.showEvent(o, elRef)}
                  >
                    {o.kind === 'task' ? <span class={`ev-tick ${o.done ? 'on' : ''}`} /> : !bar && <span class="ev-dot" />}
                    {!o.allDay && !bar && <span class="ev-time">{formatTime(`${t.getHours()}:${t.getMinutes()}`, fmt)}</span>}
                    <span class="ev-title">{o.title}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// year
// ---------------------------------------------------------------------------

function YearGrid({ year, occs }) {
  const marks = useMemo(() => {
    const s = new Set();
    for (const o of occs) {
      for (let d = o.startDate; d < o.endDate && d <= `${year}-12-31`; d = addDays(d, 1)) s.add(d);
    }
    return s;
  }, [occs, year]);
  return (
    <div class="yg">
      {Array.from({ length: 12 }, (_, m) => (
        <MiniMonth
          key={m}
          month={new Date(year, m, 1)}
          showNav={false}
          label={monthName(m)}
          marks={marks}
          onMonth={() => {}}
          onPick={(d, el) => ui.showDay(d, el)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// schedule
// ---------------------------------------------------------------------------

function ScheduleList({ occs, from, days, onMore, empty }) {
  const ref = today();
  const sentinel = useRef(null);
  useEffect(() => {
    if (!onMore || !sentinel.current || !window.IntersectionObserver) return;
    const io = new IntersectionObserver((en) => en.some((x) => x.isIntersecting) && onMore(), { rootMargin: '300px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [onMore, occs.length]);
  const byDay = new Map();
  for (const o of occs) {
    let d = o.startDate < from ? from : o.startDate;
    const last = o.allDay ? addDays(o.endDate, -1) : o.startDate;
    for (let i = 0; d <= last && i < 60; i++, d = addDays(d, 1)) {
      if (days && !days.includes(d)) continue;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(o);
    }
  }
  const keys = [...byDay.keys()].sort();
  let lastMonth = '';
  return (
    <div class="sched">
      {keys.map((d) => {
        const dd = parseYmd(d);
        const month = d.slice(0, 7);
        const head = month !== lastMonth;
        lastMonth = month;
        return (
          <Fragment key={d}>
            {head && <h3 class="sched-month">{monthYear(dd)}</h3>}
            <section class={`sched-day ${d === ref ? 'today' : ''} ${d < ref ? 'past' : ''}`}>
              <button type="button" class="sched-date" onClick={() => (setNav({ date: d }), setView('day'))} aria-label={dayLong(d)}>
                <span class="dnum">{dd.getDate()}</span>
                <span class="dow">{isZh() ? `${dd.getMonth() + 1}月 ${dayShort(dd.getDay())}` : `${MONTHS_SHORT[dd.getMonth()]}, ${dayShort(dd.getDay())}`}</span>
              </button>
              <div class="sched-items">
                {byDay.get(d).map((o) => {
                  let elRef = null;
                  return (
                    <button type="button" key={o.key} ref={(x) => (elRef = x)} class={`sched-item ${o.kind} ${o.done ? 'done' : ''} ${o.endMs <= Date.now() ? 'past' : ''}`} style={occStyle(o)} onClick={() => ui.showEvent(o, elRef)}>
                      {o.kind === 'task' ? <span class={`ev-tick ${o.done ? 'on' : ''}`} /> : <span class="ev-dot" />}
                      <span class="sched-time">{o.allDay ? tr('All day') : E.timeRangeText(o)}</span>
                      <span class="sched-title">{o.title}</span>
                      {o.location && <span class="sched-loc"><Icon name="pin" size={13} /> {o.location}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          </Fragment>
        );
      })}
      {!keys.length && empty}
      {onMore && <div ref={sentinel} class="sched-more"><button type="button" class="btn ghost sm" onClick={onMore}>{tr('Show more')}</button></div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

export function CalendarView({ arg }) {
  useStoreVersion();
  const narrow = useNarrow();
  const n = useNav();
  const prefs = store.getPrefs();
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [schedDays, setSchedDays] = useState(60);
  const bodyRef = useRef(null);
  useEffect(() => {
    if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) setNav({ date: arg });
  }, [arg]);
  const view = viewOf(narrow);
  const date = n.date;
  const p = period(view, date, narrow, prefs, schedDays);
  const occs = E.occurrences(p.from, p.to);
  const title = titleOf(view, date, p.days, narrow);

  const go = (dir) => {
    play('select');
    setNav({ date: step(view, date, dir, narrow), pending: null });
  };
  const goToday = () => setNav({ date: today(), pending: null, focus: Date.now() });
  const pick = (v) => {
    setView(v);
    if (v === 'schedule') setSchedDays(60);
  };

  // Google's shortcuts: T today, J/N next, K/P previous, D X W M Y A views, C create, / search
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('.modal-wrap, .popover, .sheet-wrap')) return;
      const k = e.key.toLowerCase();
      const views = { d: 'day', x: 'days', w: 'week', m: 'month', y: 'year', a: 'schedule' };
      let done = true;
      if (views[k]) pick(views[k]);
      else if (k === 't') goToday();
      else if (k === 'j' || k === 'n' || e.key === 'ArrowRight') go(1);
      else if (k === 'k' || k === 'p' || e.key === 'ArrowLeft') go(-1);
      else if (k === 'c') ui.newEvent(null, CENTER);
      else if (k === '/') setSearching(true);
      else done = false;
      if (done) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  // swipe left or right on a phone to change the period
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    let start = null;
    const down = (e) => {
      if (e.pointerType !== 'touch') return;
      start = { x: e.clientX, y: e.clientY, t: Date.now() };
    };
    const up = (e) => {
      if (!start || e.pointerType !== 'touch' || document.body.classList.contains('cal-dragging')) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 45 && Date.now() - start.t < 700) go(dx < 0 ? 1 : -1);
      start = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
    };
  });

  const results = searching && q.trim() ? E.searchEvents(q) : null;
  const viewItems = ['day', 'days', 'week', 'month', 'year', 'schedule'].map((v) => ({ label: viewLabel(v, narrow), hint: narrow ? null : VIEW_KEYS[v], checked: view === v, onSelect: () => pick(v) }));
  const moreItems = [
    { label: tr('Calendar settings'), icon: 'settings', onSelect: () => ui.openSettings('calendar') },
    E.subscribed().length > 0 && { label: tr('Refresh subscribed calendars'), icon: 'refresh', onSelect: () => calsync.refreshAll(true) },
    { label: tr('Subscribe to a calendar…'), icon: 'rss', onSelect: () => ui.openSettings('calendar:subscribe') },
    { label: tr('Import an .ics file…'), icon: 'upload', onSelect: () => ui.openSettings('calendar:import') },
    { divider: true },
    { label: prefs.calShowTasks !== false ? tr('Hide tasks') : tr('Show tasks'), icon: 'done', onSelect: () => store.setPrefs({ calShowTasks: prefs.calShowTasks === false }) },
    { label: prefs.calWeekends !== false ? tr('Hide weekends') : tr('Show weekends'), icon: 'sofa', onSelect: () => store.setPrefs({ calWeekends: prefs.calWeekends === false }) },
  ].filter(Boolean);

  let body;
  if (results) {
    body = <ScheduleList occs={results} from="0000-01-01" empty={<p class="cal-empty">{tr('No events match “{q}”', { q: q.trim() })}</p>} />;
  } else if (view === 'month') {
    body = <MonthGrid weeks={p.weeks} month={parseYmd(date).getMonth()} occs={occs} />;
  } else if (view === 'year') {
    body = <YearGrid year={parseYmd(date).getFullYear()} occs={occs} />;
  } else if (view === 'schedule') {
    body = (
      <ScheduleList
        occs={occs}
        from={date}
        onMore={() => setSchedDays((x) => Math.min(x + 60, 730))}
        empty={
          <div class="cal-empty">
            <p>{tr('Nothing scheduled in the next {n} days.', { n: schedDays })}</p>
            <button type="button" class="btn ghost sm" onClick={() => ui.newEvent(null, CENTER)}>{tr('Create an event')}</button>
          </div>
        }
      />
    );
  } else {
    body = <TimeGrid days={p.days} occs={occs} view={view} narrow={narrow} />;
  }

  return (
    <div class={`view cal-view v-${view} ${searching ? 'searching' : ''}`}>
      <header class="cal-bar">
        {(narrow || prefs.collapsed['sb:hidden']) && (
          <button type="button" class="icon-btn cal-menu" aria-label={narrow ? tr('Open menu') : tr('Show sidebar')} title={tr('Menu (M)')} onClick={() => ui.toggleSidebar()}>
            <Icon name="menu" />
          </button>
        )}
        {!narrow && (
          <button type="button" class="btn primary cal-create" onClick={(e) => ui.newEvent(null, CENTER)} title={tr('Create (C)')}>
            <Icon name="plus" size={18} /> {tr('Create')}
          </button>
        )}
        {narrow ? (
          <button type="button" class="icon-btn cal-today-ic" onClick={goToday} aria-label={tr('Today')}>
            <svg class="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
              <rect x="4" y="5" width="16" height="15" rx="3" />
              <path d="M8 3v4M16 3v4" stroke-linecap="round" />
              <text x="12" y="17.6" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none" font-family="inherit">{parseYmd(today()).getDate()}</text>
            </svg>
          </button>
        ) : (
          <button type="button" class="btn ghost sm cal-today" onClick={goToday} title={tr('Today (T)')}>{tr('Today')}</button>
        )}
        <div class="cal-arrows">
          <button type="button" class="icon-btn sm" aria-label={tr('Previous')} title={narrow ? undefined : tr('Previous (K)')} onClick={() => go(-1)}>
            <Icon name="left" size={20} />
          </button>
          <button type="button" class="icon-btn sm" aria-label={tr('Next')} title={narrow ? undefined : tr('Next (J)')} onClick={() => go(1)}>
            <Icon name="right" size={20} />
          </button>
        </div>
        <h1 class="view-title cal-title"><StyledTitle>{title}</StyledTitle></h1>
        <span class="spacer" />
        <button type="button" class={`icon-btn ${searching ? 'on' : ''}`} aria-label={tr('Search events')} title={tr('Search events (/)')} aria-pressed={searching} onClick={() => (setSearching(!searching), setQ(''))}>
          <Icon name="search" size={20} />
        </button>
        <MenuButton items={viewItems} label={tr('Choose a view')} title={tr('View')} class="cal-viewbtn" align="end">
          <span>{viewLabel(view, narrow)}</span>
          <Icon name="down" size={14} />
        </MenuButton>
        <MenuButton items={moreItems} label={tr('Calendar actions')} title={tr('Calendar')} align="end" />
      </header>
      {searching && (
        <div class="search-box cal-search">
          <Icon name="search" size={18} />
          <input type="search" value={q} autoFocus placeholder={tr('Search events')} aria-label={tr('Search events')} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), setSearching(false))} />
        </div>
      )}
      <div class="cal-body" ref={bodyRef}>{body}</div>
      {narrow && !searching && (
        <button type="button" class="fab cal-fab" aria-label={tr('Create')} onClick={() => ui.newEvent(null, CENTER)}>
          <Icon name="plus" size={26} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// sidebar: mini month and calendars
// ---------------------------------------------------------------------------

export function CalendarSidebar({ onNav }) {
  useStoreVersion();
  const n = useNav();
  const prefs = store.getPrefs();
  const narrow = isNarrow();
  const [month, setMonth] = useState(() => {
    const d = parseYmd(n.date);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  useEffect(() => {
    const d = parseYmd(n.date);
    if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [n.date]);
  const view = viewOf(narrow);
  const p = period(view, n.date, narrow, prefs);
  const range = view === 'month' || view === 'year' || view === 'schedule' ? null : [p.days[0], addDays(p.days[p.days.length - 1], 1)];
  const marks = useMemo(() => {
    const first = ymd(month);
    const from = E.midnight(addDays(first, -7));
    const to = E.midnight(addDays(first, 45));
    const s = new Set();
    for (const o of E.occurrences(from, to)) for (let d = o.startDate; d < o.endDate; d = addDays(d, 1)) s.add(d);
    return s;
  }, [month, store.getVersion()]);
  const hidden = E.hiddenSet();
  const status = (c) => calsync.statusOf(c.id);

  const row = (c, { tasks = false, birthdays = false } = {}) => {
    const id = tasks ? E.TASKS_CAL : birthdays ? E.BIRTHDAYS_CAL : c.id;
    const on = !hidden[id] && (!tasks || prefs.calShowTasks !== false);
    const color = tasks ? A.colorOf('slate') : birthdays ? '#e8618c' : A.colorOf(c.color);
    const name = tasks ? tr('Tasks') : birthdays ? tr('Birthdays') : E.calName(c);
    const st = !tasks && !birthdays && c.sub ? status(c) : null;
    const items = birthdays
      ? [
        { label: tr('Display this only'), icon: 'eye', onSelect: () => E.showOnly(E.BIRTHDAYS_CAL) },
        { label: tr('Open Birthdays'), icon: 'cake', onSelect: () => (location.hash = '#/birthdays') },
        { label: tr('Settings'), icon: 'settings', onSelect: () => ui.openSettings('calendar:birthdays') },
      ]
      : tasks
      ? [
        { label: tr('Display this only'), icon: 'eye', onSelect: () => (store.setPrefs({ calShowTasks: true }), E.showOnly(E.TASKS_CAL)) },
        { label: prefs.calShowDone !== false ? tr('Hide completed tasks') : tr('Show completed tasks'), icon: 'done', onSelect: () => store.setPrefs({ calShowDone: prefs.calShowDone === false }) },
      ]
      : [
        { label: tr('Display this only'), icon: 'eye', onSelect: () => E.showOnly(c.id) },
        { label: tr('Settings'), icon: 'settings', onSelect: () => ui.editCalendar(c.id) },
        c.sub && { label: tr('Refresh now'), icon: 'refresh', onSelect: () => calsync.refresh(c.id, { manual: true }) },
        !c.isDefault && { divider: true },
        !c.isDefault && {
          label: c.sub ? tr('Unsubscribe') : tr('Delete calendar'), icon: 'trash', danger: true, onSelect: async () => {
            const nEv = store.all('event').filter((x) => x.calendarId === c.id).length;
            const ok = await confirmDialog({
              title: c.sub ? tr('Unsubscribe from “{name}”?', { name: name }) : tr('Delete “{name}”?', { name }),
              body: nEv ? tr('Its {n} event{s} will be removed from Checkmate on all your devices.', { n: nEv }) : null,
              confirm: c.sub ? tr('Unsubscribe') : tr('Delete'),
              danger: true,
            });
            if (ok) E.deleteCalendar(c.id);
          },
        },
      ].filter(Boolean);
    return (
      <div class="nav-row cal-row" key={id}>
        <label class="nav-item cal-item" title={st && !st.ok ? st.msg : name}>
          <input
            type="checkbox"
            class="cal-check"
            style={{ '--c': color }}
            checked={on}
            onChange={(e) => {
              if (tasks) store.setPrefs({ calShowTasks: true });
              E.setHidden(id, !e.currentTarget.checked);
            }}
          />
          <span class="nav-label">{name}</span>
          {calsync.isRefreshing(id) && <Icon name="refresh" size={14} class="ds-spin muted" />}
          {st && !st.ok && !st.browser && <Icon name="cloudOff" size={14} class="cal-warn" title={st.msg} />}
        </label>
        <MenuButton class="xs nav-more" label={tr('Options for {name}', { name })} title={name} items={items} />
      </div>
    );
  };

  return (
    <div class="sb-cal">
      <MiniMonth
        month={month}
        onMonth={setMonth}
        selected={n.date}
        range={range}
        marks={marks}
        onPick={(d) => {
          setNav({ date: d, pending: null });
          onNav && onNav();
        }}
      />
      <div class="sb-group">
        <div class="sb-group-head">
          <span>{tr('My calendars')}</span>
          <button type="button" class="icon-btn xs" aria-label={tr('Add calendar')} title={tr('Add calendar')} onClick={() => ui.editCalendar(null)}>
            <Icon name="plus" size={18} />
          </button>
        </div>
        {E.myCalendars().map((c) => row(c))}
        {row(null, { tasks: true })}
        {row(null, { birthdays: true })}
      </div>
      <div class="sb-group">
        <div class="sb-group-head">
          <span>{tr('Other calendars')}</span>
          <MenuButton
            icon="plus"
            class="xs"
            label={tr('Add other calendars')}
            title={tr('Add other calendars')}
            items={[
              { label: tr('Subscribe to a calendar…'), icon: 'rss', onSelect: () => ui.openSettings('calendar:subscribe') },
              { label: tr('Holidays…'), icon: 'sun', onSelect: () => ui.openSettings('calendar:holidays') },
              { label: tr('Import an .ics file…'), icon: 'upload', onSelect: () => ui.openSettings('calendar:import') },
            ]}
          />
        </div>
        {E.subscribed().map((c) => row(c))}
        {!E.subscribed().length && (
          <button type="button" class="sb-empty" onClick={() => ui.openSettings('calendar:subscribe')}>{tr('Add your Google Calendar')}</button>
        )}
      </div>
    </div>
  );
}

export const calTitle = () => tr('Calendar');
export { MONTHS_SHORT, pad, toast, dayMin };
