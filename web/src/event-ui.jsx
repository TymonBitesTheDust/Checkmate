// Event pop-ups: the details card, quick create, the full editor, the "this event /
// following / all" question, and the small date, time, repeat and reminder fields.
import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'preact/hooks';
import { BirthdayCard } from './birthdays-ui.jsx';
import { createPortal } from 'preact/compat';
import * as store from './store.js';
import * as A from './actions.js';
import * as E from './events.js';
import { ui } from './bus.js';
import { Icon } from './icons.jsx';
import { Popover, Modal, MenuButton, Linkify, autoGrow, isNarrow, useLayer, toast, useStoreVersion } from './ui.jsx';
import { play } from './sound.js';
import { tr, isZh } from './i18n.js';
import { parseEventText, parseQuickAdd, parseDateText } from './parse.js';
import { presets, describeRule, sameRule, ruleFromTaskRecur, reanchor } from './recur.js';
import { wallToMs, msToWall, localTz, allZones, gmtLabel } from './tz.js';
import {
  today, addDays, parseYmd, ymd, weekday, formatTime, dayLong, dayShortDate, dayMin, monthYear, diffDays, startOfWeek,
} from './dates.js';
import { setNav, nav } from './calnav.js';
import { saveFile } from './native.js';
import { toIcs } from './ics.js';

const MIN = 60000;
const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const fromMin = (x) => {
  const v = ((x % 1440) + 1440) % 1440;
  return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`;
};
export const CENTER = { center: true, getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }), contains: () => false };

// ---------------------------------------------------------------------------
// mini month (sidebar, date fields, year view)
// ---------------------------------------------------------------------------

export function MiniMonth({ month, onMonth, onPick, selected, range, marks, showNav = true, label, compact }) {
  const prefs = store.getPrefs();
  const ws = prefs.weekStart ?? 1;
  const first = ymd(month);
  const ref = today();
  const gridStart = addDays(first, -((weekday(first) - ws + 7) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const rows = cells[35] && parseYmd(cells[35]).getMonth() !== month.getMonth() ? cells.slice(0, 35) : cells;
  return (
    <div class={`mini ${compact ? 'compact' : ''}`}>
      <div class="mini-head">
        <strong>{label || monthYear(month)}</strong>
        {showNav && (
          <div>
            <button type="button" class="icon-btn xs" aria-label={tr('Previous month')} onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
              <Icon name="left" size={16} />
            </button>
            <button type="button" class="icon-btn xs" aria-label={tr('Next month')} onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              <Icon name="right" size={16} />
            </button>
          </div>
        )}
      </div>
      <div class="mini-grid" role="grid">
        {Array.from({ length: 7 }, (_, i) => <span class="mini-dn" key={`d${i}`}>{dayMin((ws + i) % 7)}</span>)}
        {rows.map((c) => {
          const out = parseYmd(c).getMonth() !== month.getMonth();
          const inRange = range && c >= range[0] && c < range[1];
          return (
            <button
              type="button"
              key={c}
              class={`mini-day ${out ? 'out' : ''} ${c === ref ? 'today' : ''} ${c === selected ? 'sel' : ''} ${inRange ? 'in' : ''} ${marks && marks.has(c) ? 'marked' : ''}`}
              aria-label={dayLong(c)}
              aria-pressed={c === selected}
              onClick={(e) => onPick(c, e.currentTarget)}
            >
              {parseYmd(c).getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// fields
// ---------------------------------------------------------------------------

export function DateField({ value, onChange, label, min }) {
  const [anchor, setAnchor] = useState(null);
  const [month, setMonth] = useState(() => {
    const d = parseYmd(value || today());
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  return (
    <>
      <button type="button" class="field-btn date-btn" aria-label={label} onClick={(e) => {
        const d = parseYmd(value || today());
        setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
        setAnchor(anchor ? null : e.currentTarget);
      }}>
        {value ? dayShortDate(value) : tr('Pick a date')}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} class="date-pop" sheetTitle={label} width={272}>
          <MiniMonth month={month} onMonth={setMonth} selected={value} onPick={(d) => {
            if (min && d < min) return;
            onChange(d);
            setAnchor(null);
          }} />
        </Popover>
      )}
    </>
  );
}

// "3pm", "15:30", "1530", "下午3點" -> "HH:MM" (or null)
export function parseClock(text, near) {
  const s = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  let m = /^(\d{1,2})(?:[:.：](\d{2}))?(a|am|p|pm|a\.m\.|p\.m\.)?$/.exec(s) || /^(\d{1,2})(\d{2})(a|am|p|pm)?$/.exec(s);
  if (m) {
    let h = +m[1];
    const mi = m[2] ? +m[2] : 0;
    if (mi > 59) return null;
    if (m[3]) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (m[3].startsWith('p') ? 12 : 0);
    } else if (h > 23) return null;
    else if (near != null && h < 12 && !m[2] && h * 60 + mi < near) h += 12;
    return `${pad(h)}:${pad(mi)}`;
  }
  const due = parseDateText(text);
  return due && due.time ? due.time : null;
}

function durationText(mins) {
  if (mins < 60) return tr('{n} min', { n: mins });
  const h = mins / 60;
  if (Number.isInteger(h)) return tr('{n} hr', { n: h });
  return tr('{n} hr', { n: Math.round(h * 10) / 10 });
}

export function TimeField({ value, onChange, from, label }) {
  const prefs = store.getPrefs();
  const fmt = (v) => (v ? formatTime(v, prefs.timeFormat) : '');
  const [text, setText] = useState(fmt(value));
  const [open, setOpen] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => setText(fmt(value)), [value, prefs.timeFormat, prefs.language]);
  useLayer(() => setOpen(null), !!open);

  const startMin = from ? toMin(from) : 0;
  const opts = useMemo(() => {
    const out = [];
    if (from) {
      for (let x = startMin; x < startMin + 1440; x += 15) {
        if (x >= 1440 && x > startMin + 24 * 60 - 15) break;
        out.push({ v: fromMin(x), dur: x - startMin });
        if (x - startMin >= 23 * 60 + 45) break;
      }
    } else for (let x = 0; x < 1440; x += 15) out.push({ v: fromMin(x) });
    return out;
  }, [from]);

  const commit = () => {
    const t = parseClock(text, from ? startMin : null);
    if (t) {
      if (t !== value) onChange(t);
      setText(fmt(t));
    } else setText(fmt(value));
  };
  const show = () => {
    const r = inputRef.current.getBoundingClientRect();
    const h = Math.min(260, innerHeight - r.bottom - 12);
    setOpen(h > 120 ? { left: r.left, top: r.bottom + 4, width: Math.max(r.width, from ? 170 : 120), maxHeight: h } : { left: r.left, bottom: innerHeight - r.top + 4, width: Math.max(r.width, from ? 170 : 120), maxHeight: Math.min(260, r.top - 12) });
  };
  useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    const cur = listRef.current.querySelector('.on');
    if (cur) listRef.current.scrollTop = cur.offsetTop - 60;
  }, [open]);

  return (
    <span class="time-field">
      <input
        ref={inputRef}
        type="text"
        class="field-btn"
        value={text}
        aria-label={label}
        autocomplete="off"
        onFocus={(e) => {
          e.currentTarget.select();
          show();
        }}
        onClick={() => !open && show()}
        onInput={(e) => setText(e.currentTarget.value)}
        onBlur={() => {
          commit();
          setTimeout(() => setOpen(null), 120);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            setOpen(null);
          }
        }}
      />
      {open && createPortal(
        <div class="time-list" data-pop-seq="999999" ref={listRef} role="listbox" aria-label={label} style={open}>
          {opts.map((o) => (
            <button
              type="button"
              role="option"
              key={o.v + (o.dur || '')}
              class={o.v === value ? 'on' : ''}
              aria-selected={o.v === value}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(o.v);
                setText(fmt(o.v));
                setOpen(null);
                inputRef.current && inputRef.current.blur();
              }}
            >
              <span>{fmt(o.v)}</span>
              {o.dur != null && <span class="muted">{durationText(o.dur)}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}

export function RepeatField({ rule, start, onChange }) {
  const [custom, setCustom] = useState(false);
  const list = presets(start);
  const hit = rule ? list.find((p) => p.rule && sameRule(p.rule, rule) && !rule.count && !rule.until) : list[0];
  const key = hit ? hit.key : 'custom-now';
  return (
    <>
      <select
        class="repeat-select"
        aria-label={tr('Repeat')}
        value={key}
        onChange={(e) => {
          const v = e.currentTarget.value;
          if (v === 'custom') {
            setCustom(true);
            return;
          }
          if (v === 'custom-now') return;
          const p = list.find((x) => x.key === v);
          onChange(p ? p.rule : null);
        }}
      >
        {list.map((p) => <option key={p.key} value={p.key}>{describeRule(p.rule, start)}</option>)}
        {key === 'custom-now' && <option value="custom-now">{describeRule(rule, start)}</option>}
        <option value="custom">{tr('Custom…')}</option>
      </select>
      {custom && <CustomRepeat rule={rule} start={start} onClose={() => setCustom(false)} onDone={(r) => (onChange(r), setCustom(false))} />}
    </>
  );
}

const ZH_WD = ['日', '一', '二', '三', '四', '五', '六'];

export function CustomRepeat({ rule, start, onDone, onClose }) {
  const ws = store.getPrefs().weekStart ?? 1;
  const wd0 = weekday(start);
  const d0 = parseYmd(start).getDate();
  const nth = Math.ceil(d0 / 7);
  const [freq, setFreq] = useState((rule && rule.freq) || 'weekly');
  const [interval, setInterval_] = useState((rule && rule.interval) || 1);
  const [days, setDays] = useState(() => (rule && rule.freq === 'weekly' && rule.byDay ? rule.byDay.map((b) => b.wd) : [wd0]));
  const [monthMode, setMonthMode] = useState(() => (rule && rule.freq === 'monthly' && rule.byDay && rule.byDay.some((b) => b.n) ? (rule.byDay[0].n < 0 ? 'last' : 'nth') : 'day'));
  const [ends, setEnds] = useState(rule && rule.count ? 'count' : rule && rule.until ? 'until' : 'never');
  const [until, setUntil] = useState((rule && rule.until) || addDays(start, 90));
  const [count, setCount] = useState((rule && rule.count) || 10);
  const lastWeek = d0 + 7 > new Date(parseYmd(start).getFullYear(), parseYmd(start).getMonth() + 1, 0).getDate();
  const build = () => {
    const r = { freq, interval: Math.max(1, Math.min(999, +interval || 1)) };
    if (freq === 'weekly') r.byDay = (days.length ? days : [wd0]).map((wd) => ({ wd, n: 0 }));
    if (freq === 'monthly') {
      if (monthMode === 'day') r.byMonthDay = [d0];
      else r.byDay = [{ wd: wd0, n: monthMode === 'last' ? -1 : nth }];
    }
    if (freq === 'yearly') {
      r.byMonth = [parseYmd(start).getMonth() + 1];
      r.byMonthDay = [d0];
    }
    if (ends === 'until') r.until = until < start ? start : until;
    if (ends === 'count') r.count = Math.max(1, Math.min(999, +count || 1));
    return r;
  };
  const unitName = { daily: tr('day'), weekly: tr('week'), monthly: tr('month'), yearly: tr('year') };
  const order = Array.from({ length: 7 }, (_, i) => (ws + i) % 7);
  return (
    <Modal onClose={onClose} class="dialog repeat-dialog" label={tr('Custom repeat')}>
      <h2 class="dialog-title">{tr('Custom repeat')}</h2>
      <div class="dialog-fields">
        <div class="rp-row">
          <span>{tr('Repeat every')}</span>
          <input type="number" min="1" max="999" class="rp-num" value={interval} aria-label={tr('Repeat every')} onInput={(e) => setInterval_(e.currentTarget.value)} />
          <select value={freq} aria-label={tr('Unit')} onChange={(e) => setFreq(e.currentTarget.value)}>
            {['daily', 'weekly', 'monthly', 'yearly'].map((f) => <option value={f} key={f}>{unitName[f]}</option>)}
          </select>
        </div>
        {freq === 'weekly' && (
          <div class="field" role="group" aria-label={tr('Repeat on')}>
            <span class="field-label">{tr('Repeat on')}</span>
            <div class="rp-days">
              {order.map((wd) => (
                <button
                  type="button"
                  key={wd}
                  class={`rp-day ${days.includes(wd) ? 'on' : ''}`}
                  aria-pressed={days.includes(wd)}
                  aria-label={isZh() ? `星期${ZH_WD[wd]}` : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd]}
                  onClick={() => setDays(days.includes(wd) ? days.filter((x) => x !== wd) : [...days, wd])}
                >
                  {dayMin(wd)}
                </button>
              ))}
            </div>
          </div>
        )}
        {freq === 'monthly' && (
          <select value={monthMode} aria-label={tr('Repeat on')} onChange={(e) => setMonthMode(e.currentTarget.value)}>
            <option value="day">{describeRule({ freq: 'monthly', interval: 1, byMonthDay: [d0] }, start, { withEnd: false })}</option>
            {nth <= 4 && <option value="nth">{describeRule({ freq: 'monthly', interval: 1, byDay: [{ wd: wd0, n: nth }] }, start, { withEnd: false })}</option>}
            {lastWeek && <option value="last">{describeRule({ freq: 'monthly', interval: 1, byDay: [{ wd: wd0, n: -1 }] }, start, { withEnd: false })}</option>}
          </select>
        )}
        <div class="field" role="radiogroup" aria-label={tr('Ends')}>
          <span class="field-label">{tr('Ends')}</span>
          <label class="rp-end"><input type="radio" name="rp-end" checked={ends === 'never'} onChange={() => setEnds('never')} /> {tr('Never')}</label>
          <label class="rp-end">
            <input type="radio" name="rp-end" checked={ends === 'until'} onChange={() => setEnds('until')} /> {tr('On')}
            <span class={ends === 'until' ? '' : 'dim'}><DateField value={until} min={start} label={tr('End date')} onChange={(d) => (setUntil(d), setEnds('until'))} /></span>
          </label>
          <label class="rp-end">
            <input type="radio" name="rp-end" checked={ends === 'count'} onChange={() => setEnds('count')} /> {tr('After')}
            <input type="number" min="1" max="999" class="rp-num" value={count} aria-label={tr('Number of times')} onFocus={() => setEnds('count')} onInput={(e) => setCount(e.currentTarget.value)} />
            {tr('times')}
          </label>
        </div>
        <p class="field-hint">{describeRule(build(), start)}</p>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" onClick={onClose}>{tr('Cancel')}</button>
        <button type="button" class="btn primary" onClick={() => onDone(build())}>{tr('Done')}</button>
      </div>
    </Modal>
  );
}

// A list of notification times with presets and "Custom…" (any number of minutes, hours,
// days or weeks before; for all-day items, any number of days before at any time).
export function ReminderField({ value, allDay, onChange, max = 5, text = E.reminderText }) {
  const opts = allDay ? E.ALLDAY_REMINDERS : E.TIMED_REMINDERS;
  const [custom, setCustom] = useState(null); // index being customised (value.length = a new one)
  const put = (i, m) => {
    const next = [...value];
    next[i] = m;
    onChange([...new Set(next)]);
  };
  return (
    <div class="rem-list">
      {value.map((m, i) => (custom === i ? (
        <CustomReminder key={`c${i}`} allDay={allDay} value={m} text={text} onDone={(v) => (v != null && put(i, v), setCustom(null))} />
      ) : (
        <div class="rem-row" key={`${i}-${m}`}>
          <select aria-label={tr('Notification')} value={String(m)} onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === 'custom') return setCustom(i);
            put(i, +v);
          }}>
            {[...new Set([...opts, m])].sort((a, b) => a - b).map((x) => <option key={x} value={String(x)}>{text(x, allDay)}</option>)}
            <option value="custom">{tr('Custom…')}</option>
          </select>
          <button type="button" class="icon-btn sm" aria-label={tr('Remove notification')} title={tr('Remove')} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )))}
      {custom === value.length && (
        <CustomReminder allDay={allDay} value={allDay ? 900 : 10} text={text} onDone={(v) => (v != null && onChange([...new Set([...value, v])]), setCustom(null))} />
      )}
      {value.length < max && custom == null && (
        <div class="rem-add">
          <button type="button" class="link-btn accent sm" onClick={() => onChange([...value, allDay ? (value.includes(900) ? -540 : 900) : value.includes(10) ? 30 : 10])}>
            <Icon name="plus" size={14} /> {tr('Add notification')}
          </button>
          <button type="button" class="link-btn sm" onClick={() => setCustom(value.length)}>{tr('Custom…')}</button>
        </div>
      )}
    </div>
  );
}

const UNITS = [[1, 'minutes'], [60, 'hours'], [1440, 'days'], [10080, 'weeks']];

function CustomReminder({ allDay, value, onDone, text = E.reminderText }) {
  // timed: n units before; all-day: n days before at hh:mm (0 days = on the day)
  const start = (() => {
    if (allDay) {
      const days = Math.max(0, Math.ceil(value / 1440));
      const at = days * 1440 - value;
      return { n: days, time: `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}` };
    }
    const u = [...UNITS].reverse().find(([k]) => value % k === 0 && value >= k) || UNITS[0];
    return { n: value / u[0], unit: u[0] };
  })();
  const [n, setN] = useState(String(start.n));
  const [unit, setUnit] = useState(start.unit || 1);
  const [time, setTime] = useState(start.time || '09:00');
  const num = Math.max(0, Math.min(allDay ? 60 : 9999, Math.floor(+n || 0)));
  const result = () => {
    if (allDay) {
      const [h, m] = (time || '09:00').split(':').map(Number);
      return num * 1440 - (h * 60 + (m || 0));
    }
    return Math.min(num * unit, 40320 * 2);
  };
  const preview = text(result(), allDay);
  return (
    <div class="rem-custom" role="group" aria-label={tr('Custom notification')}>
      <div class="rem-custom-row">
        <input type="number" inputMode="numeric" min="0" max={allDay ? 60 : 999} value={n} aria-label={allDay ? tr('Days before') : tr('How long before')} onInput={(e) => setN(e.currentTarget.value)} />
        {allDay ? (
          <>
            <span>{tr('days before, at')}</span>
            <input type="time" value={time} aria-label={tr('Time')} onInput={(e) => setTime(e.currentTarget.value)} />
          </>
        ) : (
          <>
            <select value={String(unit)} aria-label={tr('Unit')} onChange={(e) => setUnit(+e.currentTarget.value)}>
              {UNITS.map(([k, name]) => <option key={k} value={String(k)}>{tr(name)}</option>)}
            </select>
            <span>{tr('before')}</span>
          </>
        )}
      </div>
      <div class="rem-custom-row">
        <span class="muted rem-preview">{preview}</span>
        <span class="rem-custom-actions">
          <button type="button" class="btn ghost xs" onClick={() => onDone(null)}>{tr('Cancel')}</button>
          <button type="button" class="btn primary xs" onClick={() => onDone(result())}>{tr('Done')}</button>
        </span>
      </div>
    </div>
  );
}

export function CalendarSelect({ value, onChange }) {
  const list = E.myCalendars();
  return (
    <span class="cal-select">
      <span class="cdot" style={{ background: A.colorOf((store.get(value) || {}).color) }} />
      <select value={value} aria-label={tr('Calendar')} onChange={(e) => onChange(e.currentTarget.value)}>
        {list.map((c) => <option key={c.id} value={c.id}>{E.calName(c)}</option>)}
      </select>
    </span>
  );
}

function ColorSelect({ value, calColor, onChange }) {
  const items = [
    { label: tr('Calendar colour'), swatch: A.colorOf(calColor), checked: !value, onSelect: () => onChange(null) },
    { divider: true },
    ...Object.keys(A.COLORS).map((c) => ({ label: tr(c[0].toUpperCase() + c.slice(1)), swatch: A.COLORS[c], checked: value === c, onSelect: () => onChange(c) })),
  ];
  return (
    <MenuButton items={items} label={tr('Event colour')} title={tr('Event colour')} align="start" class="color-btn">
      <span class="cdot lg" style={{ background: A.colorOf(value || calColor) }} />
      <Icon name="down" size={14} />
    </MenuButton>
  );
}

// ---------------------------------------------------------------------------
// "This event / following / all"
// ---------------------------------------------------------------------------

let openScope = () => {};
export function askScope(opts) {
  return new Promise((resolve) => openScope({ ...opts, resolve }));
}

export function ScopeHost() {
  const [s, setS] = useState(null);
  const [v, setV] = useState('this');
  useEffect(() => {
    openScope = (o) => {
      setV(o.allowThis === false ? 'following' : 'this');
      setS(o);
    };
  }, []);
  if (!s) return null;
  const done = (val) => {
    s.resolve(val);
    setS(null);
  };
  const opts = [
    s.allowThis !== false && ['this', tr('This event')],
    ['following', tr('This and following events')],
    ['all', tr('All events')],
  ].filter(Boolean);
  return (
    <Modal onClose={() => done(null)} class="confirm scope" label={s.title}>
      <h2 class="dialog-title">{s.title}</h2>
      <div class="scope-opts" role="radiogroup">
        {opts.map(([k, label]) => (
          <label class="rp-end" key={k}>
            <input type="radio" name="scope" checked={v === k} onChange={() => setV(k)} /> {label}
          </label>
        ))}
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" onClick={() => done(null)}>{tr('Cancel')}</button>
        <button type="button" class={`btn ${s.danger ? 'danger' : 'primary'}`} autofocus onClick={() => done(v)}>{s.confirm || tr('OK')}</button>
      </div>
    </Modal>
  );
}

// Moves or resizes an occurrence, asking first if it repeats. Used by drag and drop.
export async function retime(occ, startMs, endMs, allDay) {
  if (occ.kind === 'task') {
    const t = store.get(occ.id);
    if (!t) return;
    const date = E.localYmd(startMs);
    const due = { ...(t.due || { recur: null }), date, time: allDay ? null : hm(new Date(startMs)) };
    play('drop');
    A.updateTask(t.id, { due });
    return;
  }
  const ev = store.get(occ.id);
  if (!ev || occ.readOnly) return;
  const tz = ev.tz || localTz();
  const changes = allDay
    ? { allDay: true, start: E.localYmd(startMs), end: E.localYmd(Math.max(endMs, startMs + 86400000)) }
    : { allDay: false, start: E.wallOf(startMs, tz), end: E.wallOf(endMs, tz), tz };
  let scope = 'this';
  if (occ.recurring) {
    scope = await askScope({ title: tr('Change recurring event'), confirm: tr('OK') });
    if (!scope) return;
  }
  play('drop');
  const ids = relatedIds(ev);
  E.withUndo(tr('Event saved'), ids, () => E.changeOccurrence(occ, changes, scope));
}

function relatedIds(ev) {
  const sid = ev.recurringId || ev.id;
  return [sid, ...E.overridesOf(sid).map((o) => o.id)];
}

// ---------------------------------------------------------------------------
// details card
// ---------------------------------------------------------------------------

function dateLine(occ) {
  if (occ.allDay) {
    const last = addDays(occ.endDate, -1);
    return last === occ.startDate ? dayLong(occ.startDate) : `${dayLong(occ.startDate)} – ${dayLong(last)}`;
  }
  const sd = E.localYmd(occ.startMs);
  const ed = E.localYmd(Math.max(occ.startMs, occ.endMs - 1));
  if (sd === ed) return `${dayLong(sd)} · ${E.timeRangeText(occ)}`;
  return E.timeRangeText(occ);
}

export function EventCard({ occ, anchor, onClose }) {
  useStoreVersion();
  const isTask = occ.kind === 'task';
  const item = store.get(occ.id);
  if (!item) return null;
  const ro = occ.readOnly;
  const cal = isTask ? null : E.calendarOf(item);
  const series = !isTask && item.recurringId ? store.get(item.recurringId) : !isTask && item.rrule ? item : null;
  const reminders = isTask ? [] : E.remindersFor(item);
  const side = anchor && !anchor.center && anchor.nodeType === 1;

  const del = async () => {
    onClose();
    if (occ.recurring) {
      const scope = await askScope({ title: tr('Delete recurring event'), confirm: tr('Delete'), danger: true });
      if (scope) E.deleteOccurrence(occ, scope);
    } else E.deleteOccurrence(occ);
  };
  const exportOne = () => {
    const evs = series ? [series, ...E.overridesOf(series.id)] : [item];
    saveFile(`${(item.title || 'event').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'event'}.ics`, 'text/calendar', toIcs(evs, { name: item.title || 'Checkmate' }));
  };
  const more = [
    !isTask && { label: ro ? tr('Copy to my calendar') : tr('Duplicate'), icon: 'copy', onSelect: () => {
      onClose();
      const made = E.duplicateEvent(occ);
      if (made) ui.editEvent(E.findOccurrence(made.id));
    } },
    !isTask && { label: tr('Export as .ics'), icon: 'download', onSelect: exportOne },
    isTask && { label: tr('Open task'), icon: 'open', onSelect: () => (onClose(), ui.openTask(occ.id)) },
  ].filter(Boolean);

  return (
    <Popover anchor={anchor} side={side} onClose={onClose} class="evcard" width={400} sheetTitle={occ.title}>
      <div class="evc-tools">
        {!isTask && !ro && (
          <button type="button" class="icon-btn sm" aria-label={tr('Edit event')} title={tr('Edit')} onClick={() => (onClose(), ui.editEvent(occ))}>
            <Icon name="edit" size={18} />
          </button>
        )}
        {isTask && (
          <button type="button" class="icon-btn sm" aria-label={tr('Edit task')} title={tr('Edit')} onClick={() => (onClose(), ui.openTask(occ.id))}>
            <Icon name="edit" size={18} />
          </button>
        )}
        {!isTask && !ro && (
          <button type="button" class="icon-btn sm" aria-label={tr('Delete event')} title={tr('Delete')} onClick={del}>
            <Icon name="trash" size={18} />
          </button>
        )}
        {more.length > 0 && <MenuButton items={more} label={tr('More actions')} class="sm" title={occ.title} />}
        <button type="button" class="icon-btn sm" aria-label={tr('Close')} title={tr('Close')} onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div class="evc-body">
        <div class="evc-row evc-main">
          {isTask ? (
            <button
              type="button"
              class={`check prio-${item.priority || 4} ${item.done ? 'on' : ''}`}
              role="checkbox"
              aria-checked={!!item.done}
              disabled={occ.virtual}
              aria-label={item.done ? tr('Mark “{title}” as not done', { title: item.title }) : tr('Complete “{title}”', { title: item.title })}
              onClick={() => {
                if (item.done) {
                  play('uncomplete');
                  A.uncompleteTask(item.id);
                } else {
                  play('complete');
                  A.completeTask(item.id);
                }
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m7.8 12.3 2.9 2.9 5.5-6" /></svg>
            </button>
          ) : (
            <span class="evc-sq" style={{ '--ev': occ.color }} />
          )}
          <div class="evc-text">
            <h3 class={`evc-title ${isTask && item.done ? 'is-done' : ''}`}><Linkify text={occ.title} /></h3>
            <p>{dateLine(occ)}</p>
            {series && <p class="muted">{describeRule(series.rrule, series.start.slice(0, 10))}</p>}
            {isTask && item.due && item.due.recur && <p class="muted"><Icon name="repeat" size={14} /> {tr('Repeating task')}</p>}
          </div>
        </div>
        {!isTask && item.location && (
          <div class="evc-row">
            <Icon name="pin" size={18} />
            <div class="evc-text">
              <span>{item.location}</span>
              {!/^https?:\/\//.test(item.location) && (
                <a class="evc-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.location)}`} target="_blank" rel="noopener noreferrer">{tr('Open in Maps')}</a>
              )}
            </div>
          </div>
        )}
        {!isTask && item.desc && (
          <div class="evc-row">
            <Icon name="notes" size={18} />
            <div class="evc-text evc-desc"><Linkify text={item.desc} /></div>
          </div>
        )}
        {isTask && item.desc && (
          <div class="evc-row">
            <Icon name="notes" size={18} />
            <div class="evc-text evc-desc"><Linkify text={item.desc} /></div>
          </div>
        )}
        {reminders.length > 0 && (
          <div class="evc-row">
            <Icon name="bell" size={18} />
            <div class="evc-text">{reminders.map((m) => <div key={m}>{E.reminderText(m, occ.allDay)}</div>)}</div>
          </div>
        )}
        <div class="evc-row">
          <Icon name={isTask ? 'today' : 'calendar'} size={18} />
          <div class="evc-text">
            {isTask ? <span>{tr('Task')} · {occ.project}</span> : <span>{E.calName(cal)}</span>}
            {ro && <span class="muted evc-note">{tr('From a subscribed calendar. Change it where it comes from, such as Google Calendar.')}</span>}
          </div>
        </div>
      </div>
    </Popover>
  );
}

// "+3 more" in the month view, and a day clicked in the year view.
export function DayList({ date, anchor, onClose }) {
  useStoreVersion();
  const list = E.occurrences(E.midnight(date), E.midnight(addDays(date, 1)));
  return (
    <Popover anchor={anchor} onClose={onClose} class="daylist" width={300} sheetTitle={dayLong(date)}>
      <div class="dl-head">
        <span class="dl-dow">{dayLong(date)}</span>
        <button type="button" class="link-btn accent sm" onClick={() => {
          onClose();
          setNav({ date, view: 'day' });
          store.setPrefs({ calView: 'day' });
          if (!location.hash.startsWith('#/calendar')) location.hash = '#/calendar';
        }}>{tr('Open day')}</button>
      </div>
      <div class="dl-list">
        {list.map((o) => (
          <button type="button" key={o.key} class={`dl-item ${o.kind === 'task' && o.done ? 'done' : ''}`} onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onClose();
            ui.showEvent(o, { getBoundingClientRect: () => r, contains: () => false, nodeType: 1 });
          }}>
            <span class="cdot" style={{ background: o.color }} />
            <span class="dl-time">{o.allDay ? tr('All day') : E.timeRangeText(o, { short: true })}</span>
            <span class="dl-title">{o.title}</span>
          </button>
        ))}
        {!list.length && <p class="muted dl-empty">{tr('Nothing scheduled')}</p>}
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// quick create
// ---------------------------------------------------------------------------

function draftWall(d) {
  const s = new Date(d.startMs);
  const e = new Date(d.endMs);
  return { date: E.localYmd(d.startMs), start: hm(s), endDate: E.localYmd(d.allDay ? d.endMs - 1 : d.endMs), end: hm(e) };
}

// Draft (ms) from fields.
function draftFrom(date, start, end, allDay, endDate) {
  if (allDay) {
    const last = endDate && endDate >= date ? endDate : date;
    return { startMs: E.midnight(date), endMs: E.midnight(addDays(last, 1)) };
  }
  const s = wallToMs(date, start, null);
  let e = wallToMs(endDate && endDate >= date ? endDate : date, end, null);
  if (e <= s) e = wallToMs(date, end, null) <= s ? wallToMs(addDays(date, 1), end, null) : wallToMs(date, end, null);
  return { startMs: s, endMs: e };
}

export function QuickEvent({ draft, anchor, onClose }) {
  const prefs = store.getPrefs();
  const [kind, setKind] = useState(draft.kind || 'event');
  const [text, setText] = useState(draft.title || '');
  const [parseOff, setParseOff] = useState(false);
  const [base, setBase] = useState(draft);
  const [location, setLocation] = useState('');
  const [desc, setDesc] = useState('');
  const [calId, setCalId] = useState(draft.calendarId || (E.defaultCalendar() || {}).id);
  const [rrule, setRrule] = useState(null);
  const inputRef = useRef(null);
  // focus before the first keystroke arrives, so fast typing isn't lost
  useLayoutEffect(() => {
    if (inputRef.current) inputRef.current.focus({ preventScroll: true });
  }, []);

  const parsed = useMemo(() => (kind === 'event' ? parseEventText(text, { dateOrder: prefs.dateOrder, off: parseOff }) : null), [text, kind, parseOff]);
  const taskParsed = useMemo(() => {
    if (kind !== 'task') return null;
    return parseQuickAdd(text, {
      projects: A.projects().map((p) => ({ id: p.id, name: A.projectName(p) })),
      labels: A.labels().map((l) => ({ id: l.id, name: l.name })),
      dateOrder: prefs.dateOrder,
      timeFormat: prefs.timeFormat,
      keepTime: prefs.keepTimeInName !== false,
      disabled: parseOff ? new Set(['date', 'priority', 'project', 'section']) : new Set(),
    });
  }, [text, kind, parseOff]);

  // what the event will be, with anything typed in the title applied
  const eff = useMemo(() => {
    let d = { ...base };
    let rule = rrule;
    if (parsed && parsed.found) {
      const w = draftWall(base);
      let date = parsed.date || w.date;
      const typedRule = parsed.recur ? ruleFromTaskRecur(parsed.recur) : null;
      // "every weekday" typed on a Saturday starts on Monday
      if (typedRule && typedRule.freq === 'weekly' && typedRule.byDay && !parsed.date) {
        for (let i = 0; i < 7 && !typedRule.byDay.some((b) => b.wd === weekday(date)); i++) date = addDays(date, 1);
      }
      if (parsed.allDay) d = { ...d, allDay: true, ...draftFrom(date, null, null, true) };
      else if (parsed.start) {
        const dur = Math.max(15, Math.round((base.endMs - base.startMs) / MIN)) || prefs.calDuration || 60;
        const end = parsed.end || fromMin(toMin(parsed.start) + (base.allDay ? prefs.calDuration || 60 : dur));
        d = { ...d, allDay: false, ...draftFrom(date, parsed.start, end, false) };
      } else if (parsed.date) {
        d = base.allDay ? { ...d, ...draftFrom(date, null, null, true) } : { ...d, ...draftFrom(date, w.start, w.end, false) };
      }
      if (typedRule) rule = typedRule;
      if (typedRule && !parsed.start && !parsed.allDay && date !== w.date) d = { ...d, ...(base.allDay ? draftFrom(date, null, null, true) : draftFrom(date, w.start, w.end, false)) };
    }
    return { ...d, rrule: rule };
  }, [base, parsed, rrule]);

  useEffect(() => {
    setNav({ pending: kind === 'event' ? { ...eff, calendarId: calId, title: (parsed && parsed.title) || text } : { ...eff, kind: 'task', title: text } });
  }, [eff, calId, kind, text]);
  useEffect(() => () => setNav({ pending: null }), []);

  const w = draftWall(eff);
  const setField = (patch) => {
    const cur = { date: w.date, start: w.start, end: w.end, endDate: w.endDate, allDay: eff.allDay, ...patch };
    if (patch.start && !patch.end && !cur.allDay) {
      const len = Math.max(15, Math.round((eff.endMs - eff.startMs) / MIN));
      cur.end = fromMin(toMin(patch.start) + len);
      cur.endDate = toMin(patch.start) + len >= 1440 ? addDays(cur.date, 1) : cur.date;
    }
    if (patch.date && !patch.endDate) cur.endDate = addDays(patch.date, diffDays(w.endDate, w.date));
    if ('allDay' in patch && !patch.allDay && eff.allDay) {
      const now = new Date();
      const startMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30;
      cur.start = base.startTime || fromMin(Math.min(startMin, 23 * 60));
      cur.end = fromMin(toMin(cur.start) + (prefs.calDuration || 60));
      cur.endDate = cur.date;
    }
    setParseOff(true);
    setBase({ ...eff, allDay: cur.allDay, ...draftFrom(cur.date, cur.start, cur.end, cur.allDay, cur.endDate) });
    setRrule(eff.rrule);
  };

  const title = kind === 'event' ? (parsed ? parsed.title : text.trim()) : taskParsed ? taskParsed.title : text.trim();
  const save = () => {
    if (kind === 'task') {
      if (!title) return inputRef.current && inputRef.current.focus();
      const tp = taskParsed;
      const due = tp && tp.due ? tp.due : { date: w.date, time: eff.allDay ? null : w.start, recur: null };
      let projectId = 'inbox';
      if (tp && tp.project) projectId = tp.project.id || A.saveProject(null, { name: tp.project.name }).id;
      play('add');
      const t = A.addTask({ title, due: { date: due.date, time: due.time || null, recur: due.recur || null }, priority: (tp && tp.priority) || 4, labels: A.ensureLabels((tp && tp.labels) || []), projectId });
      toast(tr('Added to {name}', { name: A.projectName(store.get(t.projectId)) }), () => ui.openTask(t.id), { label: tr('Open') });
      onClose();
      return;
    }
    const fields = E.newEventFields(eff.startMs, eff.endMs, eff.allDay, { calendarId: calId });
    const ev = E.createEvent({ ...fields, title, location: location.trim(), desc: desc.trim(), rrule: eff.rrule || null });
    toast(tr('Event saved'), () => E.findOccurrence(ev.id) && ui.showEvent(E.findOccurrence(ev.id), CENTER), { label: tr('View') });
    onClose();
  };
  const more = () => {
    const d = { ...eff, kind, title, location, desc, calendarId: calId };
    onClose();
    ui.fullEvent(d);
  };
  const recognised = kind === 'event' && parsed && parsed.found && !parseOff;

  return (
    <Popover anchor={anchor || CENTER} side={!!(anchor && anchor.nodeType === 1)} onClose={onClose} class="quickev" width={420} sheetTitle={kind === 'task' ? tr('New task') : tr('New event')}>
      <form class="qe" onSubmit={(e) => (e.preventDefault(), save())}>
        <div class="qe-top">
          <button type="button" class="icon-btn sm" aria-label={tr('Close')} onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <input
          ref={inputRef}
          type="text"
          class="qe-title"
          value={text}
          placeholder={kind === 'task' ? tr('Add a task, e.g. Pay rent fri p1') : tr('Add title, e.g. Lunch with Sam fri 12:30-1:30pm')}
          aria-label={tr('Title')}
          enterkeyhint="done"
          onInput={(e) => setText(e.currentTarget.value)}
        />
        {recognised && (
          <div class="chips">
            <span class="chip chip-date">
              <Icon name="calendar" size={14} />
              {eff.allDay ? `${dayShortDate(w.date)} · ${tr('All day')}` : `${dayShortDate(w.date)} · ${formatTime(w.start, prefs.timeFormat)} – ${formatTime(w.end, prefs.timeFormat)}`}
              {eff.rrule ? ` · ${describeRule(eff.rrule, w.date, { withEnd: false })}` : ''}
              <button type="button" class="chip-x" aria-label={tr('Keep the date words as plain text')} title={tr('Keep as plain text')} onClick={() => setParseOff(true)}>
                <Icon name="close" size={12} />
              </button>
            </span>
          </div>
        )}
        <div class="seg qe-kind" role="tablist">
          <button type="button" role="tab" aria-selected={kind === 'event'} class={kind === 'event' ? 'on' : ''} onClick={() => setKind('event')}>{tr('Event')}</button>
          <button type="button" role="tab" aria-selected={kind === 'task'} class={kind === 'task' ? 'on' : ''} onClick={() => setKind('task')}>{tr('Task')}</button>
        </div>
        <div class="qe-row">
          <Icon name="clock" size={18} />
          <div class="qe-when">
            <DateField value={w.date} label={tr('Date')} onChange={(d) => setField({ date: d })} />
            {!eff.allDay && (
              <>
                <TimeField value={w.start} label={tr('Start time')} onChange={(t) => setField({ start: t })} />
                {kind === 'event' && (
                  <>
                    <span class="muted">–</span>
                    <TimeField value={w.end} from={w.start} label={tr('End time')} onChange={(t) => setField({ end: t, endDate: toMin(t) <= toMin(w.start) ? addDays(w.date, 1) : w.date })} />
                  </>
                )}
              </>
            )}
            <label class="check-line inline">
              <input type="checkbox" checked={eff.allDay} onChange={(e) => setField({ allDay: e.currentTarget.checked })} />
              {kind === 'task' ? tr('No time') : tr('All day')}
            </label>
          </div>
        </div>
        {kind === 'event' && (
          <>
            <div class="qe-row">
              <Icon name="repeat" size={18} />
              <RepeatField rule={eff.rrule} start={w.date} onChange={(r) => (setRrule(r), setParseOff(true), setBase(eff))} />
            </div>
            <div class="qe-row">
              <Icon name="pin" size={18} />
              <input type="text" value={location} placeholder={tr('Add location')} aria-label={tr('Location')} onInput={(e) => setLocation(e.currentTarget.value)} />
            </div>
            <div class="qe-row">
              <Icon name="notes" size={18} />
              <textarea rows={1} value={desc} placeholder={tr('Add description')} aria-label={tr('Description')} onInput={(e) => (setDesc(e.currentTarget.value), autoGrow(e.currentTarget))} />
            </div>
            <div class="qe-row">
              <Icon name="calendar" size={18} />
              <CalendarSelect value={calId} onChange={setCalId} />
            </div>
          </>
        )}
        <div class="qe-foot">
          {kind === 'event' ? <button type="button" class="link-btn" onClick={more}>{tr('More options')}</button> : <span />}
          <button type="submit" class="btn primary sm">{tr('Save')}</button>
        </div>
      </form>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// full editor
// ---------------------------------------------------------------------------

function initialForm(occ, draft) {
  const prefs = store.getPrefs();
  if (occ) {
    const ev = store.get(occ.id);
    const series = ev.recurringId ? store.get(ev.recurringId) : ev;
    const tz = ev.tz || localTz();
    const s = occ.allDay ? { date: occ.startDate, time: '09:00' } : msToWall(occ.startMs, tz);
    const e = occ.allDay ? { date: addDays(occ.endDate, -1), time: '10:00' } : msToWall(occ.endMs, tz);
    return {
      title: ev.title || '', allDay: !!ev.allDay, sDate: s.date, sTime: s.time, eDate: e.date, eTime: e.time, tz,
      rrule: ev.recurringId ? (series && series.rrule) || null : ev.rrule || null,
      location: ev.location || '', desc: ev.desc || '', calendarId: ev.calendarId, color: ev.color || null,
      reminders: Array.isArray(ev.reminders) ? ev.reminders : null,
    };
  }
  const d = draft || {};
  const startMs = d.startMs || Date.now();
  const endMs = d.endMs || startMs + (prefs.calDuration || 60) * MIN;
  const s = new Date(startMs);
  const e = new Date(endMs);
  return {
    title: d.title || '', allDay: !!d.allDay, sDate: E.localYmd(startMs), sTime: hm(s),
    eDate: d.allDay ? E.localYmd(endMs - 1) : E.localYmd(endMs), eTime: hm(e), tz: localTz(),
    rrule: d.rrule || null, location: d.location || '', desc: d.desc || '',
    calendarId: d.calendarId || (E.defaultCalendar() || {}).id, color: null, reminders: null,
  };
}

export function EventEditor({ occ, draft, onClose }) {
  const prefs = store.getPrefs();
  const [f, setF] = useState(() => initialForm(occ, draft));
  const [showTz, setShowTz] = useState(() => f.tz !== localTz());
  const titleRef = useRef(null);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const cal = store.get(f.calendarId);
  const remDefault = cal ? (f.allDay ? cal.allDayReminders || [] : cal.defaultReminders || []) : [];
  const reminders = f.reminders || remDefault;
  useEffect(() => {
    if (!isNarrow() && titleRef.current) titleRef.current.focus();
  }, []);

  const setStart = (patch) => {
    const next = { ...f, ...patch };
    // keep the length when the start moves
    const oldS = wallToMs(f.sDate, f.allDay ? '00:00' : f.sTime, null);
    const oldE = wallToMs(f.eDate, f.allDay ? '00:00' : f.eTime, null);
    const newS = wallToMs(next.sDate, next.allDay ? '00:00' : next.sTime, null);
    const len = Math.max(0, oldE - oldS);
    const ne = new Date(newS + len);
    next.eDate = E.localYmd(newS + len);
    if (!next.allDay) next.eTime = hm(ne);
    // a weekly or monthly repeat follows the new day, as in Google Calendar
    if (f.rrule && patch.sDate && patch.sDate !== f.sDate) next.rrule = reanchor(f.rrule, f.sDate, patch.sDate);
    setF(next);
  };

  const build = () => {
    const changes = {
      title: f.title.trim(), location: f.location.trim(), desc: f.desc.trim(), calendarId: f.calendarId, color: f.color,
      reminders: f.reminders, allDay: f.allDay, tz: f.tz,
    };
    if (f.allDay) {
      changes.start = f.sDate;
      changes.end = addDays(f.eDate < f.sDate ? f.sDate : f.eDate, 1);
    } else {
      changes.start = `${f.sDate}T${f.sTime}`;
      let end = `${f.eDate}T${f.eTime}`;
      if (wallToMs(f.eDate, f.eTime, f.tz) < wallToMs(f.sDate, f.sTime, f.tz)) end = E.wallOf(wallToMs(f.sDate, f.sTime, f.tz) + 3600000, f.tz);
      changes.end = end;
    }
    return changes;
  };

  const save = async () => {
    const changes = build();
    if (!occ) {
      E.createEvent({ ...E.newEventFields(Date.now(), Date.now(), changes.allDay), ...changes, rrule: f.rrule || null, exdates: [] });
      toast(tr('Event saved'));
      onClose();
      return;
    }
    const ev = store.get(occ.id);
    if (!ev) return onClose();
    const series = ev.recurringId ? store.get(ev.recurringId) : ev.rrule ? ev : null;
    const ruleChanged = series ? JSON.stringify(series.rrule || null) !== JSON.stringify(f.rrule || null) : !!f.rrule;
    if (ruleChanged) changes.rrule = f.rrule || null;
    let scope = 'this';
    if (series) {
      scope = await askScope({ title: tr('Save recurring event'), confirm: tr('Save'), allowThis: !ruleChanged });
      if (!scope) return;
    } else if (f.rrule) {
      // a single event that now repeats
      changes.rrule = f.rrule;
      changes.exdates = [];
    }
    E.withUndo(tr('Event saved'), relatedIds(ev), () => E.changeOccurrence(occ, changes, scope));
    onClose();
  };

  const del = async () => {
    if (!occ) return onClose();
    onClose();
    if (occ.recurring) {
      const scope = await askScope({ title: tr('Delete recurring event'), confirm: tr('Delete'), danger: true });
      if (scope) E.deleteOccurrence(occ, scope);
    } else E.deleteOccurrence(occ);
  };

  const zones = useMemo(() => (showTz ? allZones() : []), [showTz]);
  return (
    <Modal onClose={onClose} class="dialog ev-editor" label={occ ? tr('Edit event') : tr('New event')} initialFocus={false}>
      <form onSubmit={(e) => (e.preventDefault(), save())} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (e.preventDefault(), save())}>
        <div class="ee-head">
          <input ref={titleRef} type="text" class="ee-title" value={f.title} placeholder={tr('Add title')} aria-label={tr('Title')} onInput={(e) => set({ title: e.currentTarget.value })} />
          <button type="button" class="icon-btn" aria-label={tr('Close')} onClick={onClose}><Icon name="close" /></button>
        </div>
        <div class="ee-body">
          <div class="ee-row">
            <Icon name="clock" size={18} />
            <div class="ee-when">
              <div class="ee-line">
                <DateField value={f.sDate} label={tr('Start date')} onChange={(d) => setStart({ sDate: d })} />
                {!f.allDay && <TimeField value={f.sTime} label={tr('Start time')} onChange={(t) => setStart({ sTime: t })} />}
                <span class="muted">–</span>
                {!f.allDay && <TimeField value={f.eTime} from={f.eDate === f.sDate ? f.sTime : null} label={tr('End time')} onChange={(t) => set({ eTime: t, eDate: f.eDate === f.sDate && toMin(t) < toMin(f.sTime) ? addDays(f.sDate, 1) : f.eDate })} />}
                <DateField value={f.eDate} min={f.sDate} label={tr('End date')} onChange={(d) => set({ eDate: d })} />
              </div>
              <div class="ee-line">
                <label class="check-line inline">
                  <input type="checkbox" checked={f.allDay} onChange={(e) => set({ allDay: e.currentTarget.checked, reminders: null })} /> {tr('All day')}
                </label>
                {!f.allDay && (
                  <button type="button" class="link-btn sm" onClick={() => setShowTz(!showTz)} aria-expanded={showTz}>
                    <Icon name="globe" size={14} /> {tr('Time zone')}{!showTz && f.tz !== localTz() ? ` · ${f.tz}` : ''}
                  </button>
                )}
              </div>
              {showTz && !f.allDay && (
                <select value={f.tz} aria-label={tr('Time zone')} onChange={(e) => set({ tz: e.currentTarget.value })}>
                  {zones.map((z) => <option key={z} value={z}>{`(${gmtLabel(wallToMs(f.sDate, f.sTime, z), z)}) ${z.replace(/_/g, ' ')}`}</option>)}
                </select>
              )}
            </div>
          </div>
          <div class="ee-row">
            <Icon name="repeat" size={18} />
            <RepeatField rule={f.rrule} start={f.sDate} onChange={(r) => set({ rrule: r })} />
          </div>
          <div class="ee-row">
            <Icon name="pin" size={18} />
            <input type="text" value={f.location} placeholder={tr('Add location')} aria-label={tr('Location')} onInput={(e) => set({ location: e.currentTarget.value })} />
          </div>
          <div class="ee-row">
            <Icon name="bell" size={18} />
            <ReminderField value={reminders} allDay={f.allDay} onChange={(r) => set({ reminders: r })} />
          </div>
          <div class="ee-row">
            <Icon name="calendar" size={18} />
            <div class="ee-line">
              <CalendarSelect value={f.calendarId} onChange={(id) => set({ calendarId: id })} />
              <ColorSelect value={f.color} calColor={cal ? cal.color : 'ocean'} onChange={(c) => set({ color: c })} />
            </div>
          </div>
          <div class="ee-row">
            <Icon name="notes" size={18} />
            <textarea rows={4} value={f.desc} placeholder={tr('Add description')} aria-label={tr('Description')} onInput={(e) => set({ desc: e.currentTarget.value })} />
          </div>
        </div>
        <div class="dialog-actions ee-foot">
          {occ && <button type="button" class="btn danger-ghost" onClick={del}><Icon name="trash" size={16} /> {tr('Delete')}</button>}
          <span class="spacer" />
          <button type="button" class="btn ghost" onClick={onClose}>{tr('Cancel')}</button>
          <button type="submit" class="btn primary">{tr('Save')}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// host (one place that shows the card, quick create and editor)
// ---------------------------------------------------------------------------

export function EventLayer() {
  const [card, setCard] = useState(null);
  const [quick, setQuick] = useState(null);
  const [editor, setEditor] = useState(null);
  const [day, setDay] = useState(null);
  const seq = useRef(0);
  ui.showEvent = (occ, anchor) => {
    setQuick(null);
    setDay(null);
    setCard({ occ, anchor: anchor || CENTER, k: ++seq.current });
  };
  ui.editEvent = (occ) => {
    setCard(null);
    setEditor({ occ, k: ++seq.current });
  };
  ui.newEvent = (draft, anchor) => {
    setCard(null);
    setDay(null);
    const prefs = store.getPrefs();
    let d = draft;
    if (!d) {
      const now = new Date();
      now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30, 0, 0);
      const base = nav.date && nav.date !== today() ? new Date(`${nav.date}T09:00`) : now;
      d = { kind: 'event', allDay: false, startMs: base.getTime(), endMs: base.getTime() + (prefs.calDuration || 60) * MIN };
    }
    setQuick({ draft: d, anchor, k: ++seq.current });
  };
  ui.fullEvent = (draft) => {
    setQuick(null);
    setEditor({ draft, k: ++seq.current });
  };
  ui.openEvent = (id, orig) => {
    const occ = E.findOccurrence(id, orig);
    if (occ) ui.showEvent(occ, CENTER);
  };
  ui.showDay = (date, anchor) => {
    setCard(null);
    setDay({ date, anchor, k: ++seq.current });
  };
  return (
    <>
      {card && card.occ.kind === 'birthday' && <BirthdayCard key={card.k} occ={card.occ} anchor={card.anchor} onClose={() => setCard(null)} />}
      {card && card.occ.kind !== 'birthday' && <EventCard key={card.k} occ={card.occ} anchor={card.anchor} onClose={() => setCard(null)} />}
      {quick && <QuickEvent key={quick.k} draft={quick.draft} anchor={quick.anchor} onClose={() => setQuick(null)} />}
      {editor && <EventEditor key={editor.k} occ={editor.occ} draft={editor.draft} onClose={() => setEditor(null)} />}
      {day && <DayList key={day.k} date={day.date} anchor={day.anchor} onClose={() => setDay(null)} />}
      <ScopeHost />
    </>
  );
}

export { startOfWeek };
