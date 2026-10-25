// Settings → Calendar, and the dialog for one calendar's name, colour and reminders.
import { useState, useEffect, useRef } from 'preact/hooks';
import * as store from './store.js';
import * as A from './actions.js';
import * as E from './events.js';
import * as calsync from './calsync.js';
import { Icon } from './icons.jsx';
import { ui } from './bus.js';
import { Modal, Field, Switch, ColorPicker, confirmDialog, toast, useStoreVersion } from './ui.jsx';
import { ReminderField } from './event-ui.jsx';
import { saveFile, copyText, openExternal, hasNativeFetch, platform } from './native.js';
import { toIcs } from './ics.js';
import { play } from './sound.js';
import { tr, isZh } from './i18n.js';
import { ymd } from './dates.js';

function Seg({ value, options, onChange, label }) {
  return (
    <div class="seg wide" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button type="button" key={v} class={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function CalendarPanel({ focus }) {
  useStoreVersion();
  const p = store.getPrefs();
  const subRef = useRef(null);
  const holRef = useRef(null);
  const impRef = useRef(null);
  const bdRef = useRef(null);
  useEffect(() => {
    const el = focus === 'subscribe' ? subRef.current : focus === 'holidays' ? holRef.current : focus === 'import' ? impRef.current : focus === 'birthdays' ? bdRef.current : null;
    if (el) {
      el.scrollIntoView({ block: 'start' });
      const input = focus === 'subscribe' && el.querySelector('input[type="url"]');
      if (input) setTimeout(() => input.focus(), 50);
    }
  }, [focus]);
  return (
    <div class="panel-stack cal-panel">
      <p class="lead">{tr('Events live in your calendars and sync to your other devices like tasks. Tasks with a date show on the calendar too.')}</p>

      <Field group label={tr('My calendars')}>
        <div class="ds-list">
          {E.myCalendars().map((c) => <CalRow key={c.id} cal={c} />)}
        </div>
        <div class="row-actions">
          <button type="button" class="btn ghost sm" onClick={() => ui.editCalendar(null)}>
            <Icon name="plus" size={16} /> {tr('Add calendar')}
          </button>
        </div>
      </Field>

      <div ref={subRef}><SubscribeForm /></div>

      {E.subscribed().length > 0 && (
        <Field group label={tr('Subscribed calendars')}>
          <div class="ds-list">
            {E.subscribed().map((c) => <CalRow key={c.id} cal={c} />)}
          </div>
        </Field>
      )}

      <div ref={holRef}><Holidays /></div>

      <div ref={impRef}><ImportExport /></div>

      <hr class="sep" />
      <Field group label={tr('Show on the calendar')}>
        <div class="panel-stack tight">
          <Switch label={tr('Tasks with a date')} checked={p.calShowTasks !== false} onChange={(v) => store.setPrefs({ calShowTasks: v })} />
          <Switch label={tr('Completed tasks')} checked={p.calShowDone !== false} onChange={(v) => store.setPrefs({ calShowDone: v })} />
          <Switch label={tr('Weekends')} checked={p.calWeekends !== false} onChange={(v) => store.setPrefs({ calWeekends: v })} />
          <Switch label={tr('Today’s events in Today and Upcoming')} checked={p.calInLists !== false} onChange={(v) => store.setPrefs({ calInLists: v })} />
        </div>
      </Field>
      <div ref={bdRef}>
        <Field group label={tr('Birthdays')}>
          <div class="panel-stack tight">
            <Switch label={tr('Birthdays on the calendar')} checked={!E.isHidden(E.BIRTHDAYS_CAL)} onChange={(v) => E.setHidden(E.BIRTHDAYS_CAL, !v)} />
            <Switch label={tr('Lunar birthdays (農曆)')} checked={!!p.lunarBirthdays} onChange={(v) => store.setPrefs({ lunarBirthdays: v })} />
          </div>
          <span class="field-hint">{tr('Lets you add a birthday by its lunar date. It moves to the right day each year.')}</span>
          <button type="button" class="link-btn accent sm" onClick={() => (ui.closeSettings && ui.closeSettings(), (location.hash = '#/birthdays'))}>
            <Icon name="cake" size={14} /> {tr('Open Birthdays')}
          </button>
        </Field>
      </div>
      <Field label={tr('Default event length')}>
        <select value={String(p.calDuration || 60)} onChange={(e) => store.setPrefs({ calDuration: +e.currentTarget.value })}>
          {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={String(m)}>{m < 60 ? tr('{n} minutes', { n: m }) : tr('{n} hour{s}', { n: m / 60 })}</option>)}
        </select>
      </Field>
      <Field group label={tr('Check subscribed calendars')}>
        <Seg
          label={tr('Check subscribed calendars')}
          value={String(p.calSyncEvery ?? 30)}
          onChange={(v) => store.setPrefs({ calSyncEvery: +v })}
          options={[['15', tr('{n} min', { n: 15 })], ['30', tr('{n} min', { n: 30 })], ['60', tr('{n} hr', { n: 1 })], ['0', tr('When I ask')]]}
        />
      </Field>
    </div>
  );
}

function CalRow({ cal }) {
  const st = cal.sub ? calsync.statusOf(cal.id) : null;
  const n = store.all('event').filter((e) => e.calendarId === cal.id).length;
  return (
    <div class={`ds-card ${st && !st.ok && !st.browser ? 'bad' : ''}`}>
      <div class="ds-head">
        <span class="cdot lg" style={{ background: A.colorOf(cal.color) }} />
        <div class="ds-meta">
          <strong>{E.calName(cal)}</strong>
          <span class="muted">
            {tr('{n} event{s}', { n })}
            {cal.sub && st && st.ok && ` · ${tr('checked {when}', { when: calsync.when(st.at) })}`}
            {cal.sub && calsync.isRefreshing(cal.id) && ` · ${tr('Checking…')}`}
          </span>
        </div>
        <span class="spacer" />
        {cal.sub && (
          <button type="button" class="icon-btn sm" aria-label={tr('Refresh now')} title={tr('Refresh now')} onClick={() => calsync.refresh(cal.id, { manual: true })}>
            <Icon name="refresh" size={18} class={calsync.isRefreshing(cal.id) ? 'ds-spin' : ''} />
          </button>
        )}
        <button type="button" class="icon-btn sm" aria-label={tr('Calendar settings')} title={tr('Settings')} onClick={() => ui.editCalendar(cal.id)}>
          <Icon name="edit" size={18} />
        </button>
      </div>
      {st && !st.ok && <p class={st.browser ? 'field-hint' : 'form-error'}>{st.msg}</p>}
    </div>
  );
}

function SubscribeForm() {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [guide, setGuide] = useState(false);
  const web = !hasNativeFetch();
  const go = async (e) => {
    e && e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const cal = await calsync.subscribe(url, { name: name.trim(), color: nextColor() });
      const st = calsync.statusOf(cal.id);
      if (st && st.ok) toast(tr('Subscribed to “{name}”', { name: E.calName(store.get(cal.id)) }));
      else if (st && st.browser) toast(tr('Subscribed. The Windows and Android apps will read it and sync the events here.'));
      setUrl('');
      setName('');
    } catch (x) {
      play('error');
      setErr(x.message);
    }
    setBusy(false);
  };
  return (
    <form class="field" onSubmit={go}>
      <span class="field-label">{tr('Subscribe to a calendar')}</span>
      <p class="field-hint">{tr('Show your Google Calendar here by pasting its secret address in iCal format. Any .ics link works too. Subscribed calendars are read-only: change them where they come from.')}</p>
      <input type="url" value={url} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" aria-label={tr('Calendar link')} onInput={(e) => setUrl(e.currentTarget.value)} spellcheck={false} />
      <input type="text" value={name} placeholder={tr('Name (optional)')} aria-label={tr('Name')} onInput={(e) => setName(e.currentTarget.value)} />
      {web && <p class="field-hint">{tr('In a browser, Google’s links can only be read by the Windows and Android apps. Subscribe on any device: once an app has read the link, the events sync here too.')}</p>}
      {err && <p class="form-error" role="alert">{err}</p>}
      <div class="row-actions">
        <button type="submit" class="btn primary sm" disabled={!url.trim() || busy}>{busy ? tr('Reading…') : tr('Subscribe')}</button>
        <button type="button" class="btn ghost sm" aria-expanded={guide} onClick={() => setGuide(!guide)}>{guide ? tr('Hide the steps') : tr('Where do I find the link?')}</button>
      </div>
      {guide && <GoogleSteps />}
    </form>
  );
}

function GoogleSteps() {
  const link = <button type="button" class="link-btn accent" onClick={() => openExternal('https://calendar.google.com/calendar/r/settings')}>calendar.google.com</button>;
  if (isZh()) {
    return (
      <ol class="steps">
        <li>在電腦上打開 {link}，按右上角的齒輪 →<b>設定（Settings）</b>。</li>
        <li>在左邊<b>我的日曆的設定（Settings for my calendars）</b>下選擇要加入的日曆。</li>
        <li>向下捲到<b>整合日曆（Integrate calendar）</b>，複製<b>iCal 格式的私密網址（Secret address in iCal format）</b>。</li>
        <li>貼到上面並按<b>訂閱</b>。每個日曆要各自訂閱一次。私密網址等同密碼，請勿分享。</li>
      </ol>
    );
  }
  return (
    <ol class="steps">
      <li>On a computer, open {link} and choose the gear at the top right → <b>Settings</b>.</li>
      <li>On the left, under <b>Settings for my calendars</b>, pick the calendar you want.</li>
      <li>Scroll to <b>Integrate calendar</b> and copy the <b>Secret address in iCal format</b>.</li>
      <li>Paste it above and choose <b>Subscribe</b>. Do this once for each calendar. Treat the secret address like a password.</li>
    </ol>
  );
}

function nextColor() {
  const used = new Set(E.calendars().map((c) => c.color));
  return ['teal', 'tangerine', 'iris', 'moss', 'rose', 'gold', 'plum', 'sky', 'coral'].find((c) => !used.has(c)) || 'teal';
}

function Holidays() {
  const [busy, setBusy] = useState('');
  const have = new Set(E.subscribed().map((c) => c.sub.url));
  const add = async (key, name) => {
    setBusy(key);
    try {
      await calsync.subscribe(calsync.holidayUrl(key), { name: tr('Holidays in {place}', { place: name }), color: 'moss' });
      toast(tr('Added “{name}”', { name: tr('Holidays in {place}', { place: name }) }));
    } catch (x) {
      play('error');
      toast(x.message);
    }
    setBusy('');
  };
  return (
    <Field group label={tr('Holidays')} hint={tr('Public holiday calendars from Google, kept up to date.')}>
      <div class="hol-list">
        {calsync.HOLIDAYS.map(([key, en, zh]) => {
          const on = have.has(calsync.holidayUrl(key));
          return (
            <button type="button" key={key} class={`btn ghost sm ${on ? 'on' : ''}`} disabled={on || !!busy} onClick={() => add(key, isZh() ? zh : en)}>
              {on ? <Icon name="done" size={16} /> : busy === key ? <Icon name="refresh" size={16} class="ds-spin" /> : <Icon name="plus" size={16} />}
              {isZh() ? zh : en}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

function ImportExport() {
  const mine = E.myCalendars();
  const [target, setTarget] = useState((mine[0] || {}).id || '');
  const [exp, setExp] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const onFile = async (file) => {
    setErr('');
    setMsg('');
    const text = await file.text();
    try {
      let calId = target;
      if (target === '__new') {
        const base = file.name.replace(/\.ics$/i, '');
        calId = E.saveCalendar(null, { name: base || tr('Imported'), color: nextColor() }).id;
      }
      const r = calsync.importFile(text, calId);
      if (target === '__new' && r.name) E.saveCalendar(calId, { name: r.name });
      play('add');
      setMsg(tr('Imported {n} event{s} into “{name}”.', { n: r.total, name: E.calName(store.get(calId)) }));
    } catch (x) {
      play('error');
      setErr(x.message);
    }
  };
  const doExport = () => {
    const cal = exp ? store.get(exp) : null;
    const name = cal ? E.calName(cal) : 'Checkmate';
    const text = toIcs(E.eventsForExport(exp || null), { name });
    saveFile(`${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'calendar'}-${ymd(new Date())}.ics`, 'text/calendar', text);
  };
  return (
    <Field group label={tr('Import and export')}>
      <p class="field-hint">{tr('Bring in an .ics file exported from Google Calendar, Outlook or Apple Calendar. Importing the same file again updates the events instead of copying them.')}</p>
      <div class="imp-row">
        <select value={target} aria-label={tr('Import into')} onChange={(e) => setTarget(e.currentTarget.value)}>
          {mine.map((c) => <option key={c.id} value={c.id}>{E.calName(c)}</option>)}
          <option value="__new">{tr('A new calendar')}</option>
        </select>
        <label class="btn ghost sm file-btn">
          <Icon name="upload" size={16} /> {tr('Choose .ics file')}
          <input type="file" accept=".ics,text/calendar" onChange={(e) => {
            const f = e.currentTarget.files && e.currentTarget.files[0];
            if (f) onFile(f);
            e.currentTarget.value = '';
          }} />
        </label>
      </div>
      {msg && <p class="form-ok" role="status">{msg}</p>}
      {err && <p class="form-error" role="alert">{err}</p>}
      <div class="imp-row">
        <select value={exp} aria-label={tr('Export')} onChange={(e) => setExp(e.currentTarget.value)}>
          <option value="">{tr('All calendars')}</option>
          {E.calendars().map((c) => <option key={c.id} value={c.id}>{E.calName(c)}</option>)}
        </select>
        <button type="button" class="btn ghost sm" onClick={doExport}><Icon name="download" size={16} /> {tr('Export .ics')}</button>
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------

export function CalendarDialog({ id, onClose }) {
  const cal = id ? store.get(id) : null;
  const [name, setName] = useState(cal ? (cal.isDefault && cal.name === 'My calendar' ? E.calName(cal) : cal.name) : '');
  const [color, setColor] = useState(cal ? cal.color : nextColor());
  const [rem, setRem] = useState(cal ? cal.defaultReminders || [] : [10]);
  const [remAll, setRemAll] = useState(cal ? cal.allDayReminders || [] : []);
  const save = (e) => {
    e && e.preventDefault();
    const fields = { color, defaultReminders: rem, allDayReminders: remAll };
    const nm = name.trim();
    if (cal && cal.isDefault && nm === E.calName({ isDefault: true, name: 'My calendar' })) fields.name = 'My calendar';
    else fields.name = nm || (cal ? cal.name : tr('Calendar'));
    if (!cal && !nm) return;
    E.saveCalendar(id, fields);
    if (!cal) {
      play('add');
      toast(tr('Added “{name}”', { name: fields.name }));
    }
    onClose();
  };
  const st = cal && cal.sub ? calsync.statusOf(cal.id) : null;
  return (
    <Modal onClose={onClose} class="dialog" label={cal ? tr('Calendar settings') : tr('New calendar')}>
      <form onSubmit={save}>
        <h2 class="dialog-title">{cal ? tr('Calendar settings') : tr('New calendar')}</h2>
        <div class="dialog-fields">
          <Field label={tr('Name')}>
            <input type="text" value={name} autoFocus onInput={(e) => setName(e.currentTarget.value)} placeholder={tr('e.g. Work, Family, Church')} />
          </Field>
          <Field group label={tr('Colour')}>
            <ColorPicker value={color} onChange={setColor} />
          </Field>
          <Field group label={tr('Notifications for events')}>
            <ReminderField value={rem} allDay={false} onChange={setRem} />
          </Field>
          <Field group label={tr('Notifications for all-day events')}>
            <ReminderField value={remAll} allDay onChange={setRemAll} />
          </Field>
          {cal && cal.sub && (
            <Field group label={tr('Calendar link')} hint={st ? (st.ok ? tr('Last checked {when}', { when: calsync.when(st.at) }) : st.msg) : null}>
              <div class="copy-row">
                <input type="text" class="mono" readOnly value={cal.sub.url} onFocus={(e) => e.currentTarget.select()} aria-label={tr('Calendar link')} />
                <button type="button" class="btn ghost sm" onClick={async () => (await copyText(cal.sub.url)) && toast(tr('Link copied'))}>{tr('Copy')}</button>
              </div>
            </Field>
          )}
        </div>
        <div class="dialog-actions">
          {cal && !cal.isDefault && (
            <button type="button" class="btn danger-ghost" onClick={async () => {
              const n = store.all('event').filter((x) => x.calendarId === cal.id).length;
              const ok = await confirmDialog({
                title: cal.sub ? tr('Unsubscribe from “{name}”?', { name: E.calName(cal) }) : tr('Delete “{name}”?', { name: E.calName(cal) }),
                body: n ? tr('Its {n} event{s} will be removed from Checkmate on all your devices.', { n }) : null,
                confirm: cal.sub ? tr('Unsubscribe') : tr('Delete'),
                danger: true,
              });
              if (ok) {
                E.deleteCalendar(cal.id);
                onClose();
              }
            }}>{cal.sub ? tr('Unsubscribe') : tr('Delete')}</button>
          )}
          <span class="spacer" />
          <button type="button" class="btn ghost" onClick={onClose}>{tr('Cancel')}</button>
          <button type="submit" class="btn primary" disabled={!cal && !name.trim()}>{cal ? tr('Save') : tr('Add')}</button>
        </div>
      </form>
    </Modal>
  );
}

export const calendarHelpPlatform = platform;
