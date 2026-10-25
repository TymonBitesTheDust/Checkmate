// The Birthdays page, the add/edit dialog and the card shown from the calendar.
import { useState } from 'preact/hooks';
import * as store from './store.js';
import * as B from './birthdays.js';
import * as R from './reminders.js';
import { ui } from './bus.js';
import { Icon } from './icons.jsx';
import { Modal, Popover, Field, Switch, confirmDialog, toast, useStoreVersion } from './ui.jsx';
import { ReminderField } from './event-ui.jsx';
import { reminderText } from './events.js';
import { ViewHeader } from './views.jsx';
import { StyledTitle } from './riot.jsx';
import { play } from './sound.js';
import { dayShortDate, today } from './dates.js';
import { tr, isZh } from './i18n.js';

const TINTS = ['#e8618c', '#f46b25', '#d9a21b', '#3fa66b', '#1f9ab0', '#4f74d9', '#8a5bd6', '#c94fae'];
function tintOf(b) {
  let h = 0;
  for (const ch of b.id || b.name || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}
function initials(name) {
  const s = (name || '?').trim();
  if (/[㐀-鿿]/.test(s)) return s.slice(-2);
  return s.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

export function Avatar({ b, size = 40 }) {
  return (
    <span class="bd-avatar" style={{ '--tint': tintOf(b), width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` }} aria-hidden="true">
      {b.me ? <Icon name="cake" size={Math.round(size * 0.55)} /> : initials(b.name)}
    </span>
  );
}

function when(next) {
  if (!next) return '';
  return dayShortDate(next.date);
}

// ---------------------------------------------------------------- page

export function BirthdaysView() {
  useStoreVersion();
  const list = B.upcoming();
  const todays = list.filter((x) => x.days === 0);
  const soon = list.filter((x) => x.days > 0 && x.days <= 30);
  const later = list.filter((x) => x.days > 30);
  const hasMe = list.some((x) => x.b.me);
  const group = (title, items) => items.length > 0 && (
    <section class="bd-group" key={title}>
      <h2 class="day-head"><span class="day-date">{title}</span><span class="group-count">{items.length}</span></h2>
      <div class="bd-list">{items.map((x) => <BirthdayRow key={x.b.id} x={x} />)}</div>
    </section>
  );
  return (
    <div class="view birthdays-view">
      <ViewHeader
        title={tr('Birthdays')}
        subtitle={list.length ? tr('{n} birthday{s}', { n: list.length }) : null}
        actions={
          <button type="button" class="btn primary sm" onClick={() => ui.openBirthday(null)}>
            <Icon name="plus" size={16} /> {tr('Add birthday')}
          </button>
        }
      />
      {!list.length && (
        <div class="empty">
          <div class="empty-mark bd-empty-mark" aria-hidden="true"><Icon name="cake" size={46} /></div>
          <h2><StyledTitle>{tr('Never miss a birthday')}</StyledTitle></h2>
          <p>{tr('Add your own birthday and your friends’. Checkmate reminds you on the day, shows them on the calendar, and tells you how old everyone is turning.')}</p>
          <div class="bd-empty-actions">
            <button type="button" class="btn primary" onClick={() => ui.openBirthday(null, { me: true })}>{tr('Add my birthday')}</button>
            <button type="button" class="btn ghost" onClick={() => ui.openBirthday(null)}>{tr('Add a friend’s birthday')}</button>
          </div>
        </div>
      )}
      {group(tr('Today'), todays)}
      {group(tr('Next 30 days'), soon)}
      {group(tr('Later'), later)}
      {list.length > 0 && !hasMe && (
        <button type="button" class="link-btn accent bd-add-me" onClick={() => ui.openBirthday(null, { me: true })}>
          <Icon name="cake" size={16} /> {tr('Add my birthday')}
        </button>
      )}
    </div>
  );
}

function BirthdayRow({ x }) {
  const { b, next, days } = x;
  const age = next && next.age != null ? B.ageText(next.age, b.me) : '';
  return (
    <button type="button" class={`bd-row ${days === 0 ? 'is-today' : ''}`} onClick={() => ui.openBirthday(b.id)}>
      <Avatar b={b} />
      <span class="bd-main">
        <span class="bd-name">
          {b.me ? tr('You') : b.name}
          {b.me && b.name && <span class="muted"> · {b.name}</span>}
        </span>
        <span class="bd-date muted">
          {B.dateText(b)}
          {b.lunar && next && <> · {when(next)}</>}
          {b.note && <> · {b.note}</>}
        </span>
      </span>
      <span class="bd-when">
        <strong>{days === 0 ? `🎂 ${tr('Today')}` : B.untilText(days)}</strong>
        {age && <span class="muted">{age}</span>}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- add / edit

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function BirthdayDialog({ id, preset = {}, onClose }) {
  const b = id ? store.get(id) : null;
  const [name, setName] = useState(b ? b.name : preset.name || '');
  const [me, setMe] = useState(b ? !!b.me : !!preset.me);
  const [lunar, setLunar] = useState(b ? !!b.lunar : false);
  const [month, setMonth] = useState(b ? b.month : +today().slice(5, 7));
  const [day, setDay] = useState(b ? b.day : +today().slice(8, 10));
  const [year, setYear] = useState(b && b.year ? String(b.year) : '');
  const [note, setNote] = useState(b ? b.note || '' : '');
  const [own, setOwn] = useState(b ? Array.isArray(b.reminders) : false);
  const [rems, setRems] = useState(b && Array.isArray(b.reminders) ? b.reminders : R.defaults().birthday);
  const offerLunar = B.lunarOffered() || lunar;
  const maxDay = lunar ? 30 : MONTH_DAYS[month - 1];
  const y = parseInt(year, 10);
  const yearOk = !year.trim() || (y >= 1900 && y <= +today().slice(0, 4));
  const ok = (name.trim() || me) && yearOk;

  const save = () => {
    if (!ok) return;
    const fields = {
      name: name.trim(), me, lunar, month, day: Math.min(day, maxDay), year: year.trim() ? y : null, note: note.trim(),
      reminders: own ? R.clean(rems) : null,
    };
    // only one birthday can be yours
    if (me) for (const o of B.all()) if (o.me && o.id !== id) store.patch(o.id, { me: false });
    B.save(id, fields);
    play('add');
    toast(id ? tr('Birthday saved') : tr('Birthday added'));
    onClose();
  };
  const del = async () => {
    const ok2 = await confirmDialog({ title: tr('Delete this birthday?'), body: b.me ? tr('Your birthday') : b.name, confirm: tr('Delete'), danger: true });
    if (!ok2) return;
    const snap = { ...b };
    store.remove(b.id);
    play('delete');
    onClose();
    toast(tr('Birthday deleted'), () => store.restore(snap));
  };

  const monthName = (m) => (lunar ? (isZh() ? B.lunarText(m, 1).replace(/初一$/, '') : tr('Month {n}', { n: m })) : new Date(2000, m - 1, 1).toLocaleDateString(isZh() ? 'zh-Hant' : [], { month: 'long' }));
  const dayName = (d) => (lunar && isZh() ? B.lunarText(1, d).replace(/^農曆正月/, '') : String(d));
  const preview = { month, day: Math.min(day, maxDay), lunar, year: year.trim() && yearOk ? y : null, me, name };
  const next = B.next(preview);

  return (
    <Modal onClose={onClose} class="dialog bd-dialog" label={id ? tr('Edit birthday') : tr('Add birthday')}>
      <form onSubmit={(e) => (e.preventDefault(), save())}>
        <h2 class="dialog-title">{id ? tr('Edit birthday') : tr('Add birthday')}</h2>
        <div class="dialog-fields">
          <Field label={me ? tr('Your name (optional)') : tr('Name')}>
            <input type="text" value={name} maxLength={80} autofocus={!me} placeholder={me ? '' : tr('e.g. Sam')} onInput={(e) => setName(e.currentTarget.value)} />
          </Field>
          <Switch label={tr('This is my birthday')} checked={me} onChange={setMe} />
          {offerLunar && (
            <div class="seg wide" role="group" aria-label={tr('Calendar')}>
              <button type="button" class={!lunar ? 'on' : ''} aria-pressed={!lunar} onClick={() => setLunar(false)}>{tr('Date')}</button>
              <button type="button" class={lunar ? 'on' : ''} aria-pressed={lunar} onClick={() => setLunar(true)}>{tr('Lunar date (農曆)')}</button>
            </div>
          )}
          <div class="bd-date-row">
            <Field label={lunar ? tr('Lunar month') : tr('Month')}>
              <select value={String(month)} onChange={(e) => setMonth(+e.currentTarget.value)}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={String(m)}>{monthName(m)}</option>)}
              </select>
            </Field>
            <Field label={lunar ? tr('Lunar day') : tr('Day')}>
              <select value={String(Math.min(day, maxDay))} onChange={(e) => setDay(+e.currentTarget.value)}>
                {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => <option key={d} value={String(d)}>{dayName(d)}</option>)}
              </select>
            </Field>
            <Field label={tr('Year (optional)')}>
              <input type="number" inputMode="numeric" min="1900" max={today().slice(0, 4)} value={year} placeholder={tr('e.g. 1995')} onInput={(e) => setYear(e.currentTarget.value)} />
            </Field>
          </div>
          {!yearOk && <p class="form-error">{tr('Enter a year between 1900 and this year, or leave it empty.')}</p>}
          {next && (
            <p class="field-hint bd-preview">
              <Icon name="cake" size={14} /> {tr('Next: {date}', { date: dayShortDate(next.date) })} · {B.untilText(B.daysUntil(preview))}
              {next.age != null && next.age >= 0 && <> · {B.ageText(next.age, me)}</>}
            </p>
          )}
          <Field group label={tr('Reminders')}>
            <Switch label={tr('Use my default reminders')} checked={!own} onChange={(v) => setOwn(!v)} />
            {own ? (
              <ReminderField value={rems} allDay onChange={setRems} />
            ) : (
              <span class="field-hint">{R.defaults().birthday.length ? R.defaults().birthday.map((m) => reminderLine(m)).join(' · ') : tr('No reminder')}</span>
            )}
          </Field>
          <Field label={tr('Note (optional)')}>
            <input type="text" value={note} maxLength={200} placeholder={tr('e.g. Likes chocolate cake')} onInput={(e) => setNote(e.currentTarget.value)} />
          </Field>
        </div>
        <div class="dialog-actions">
          {b && (
            <button type="button" class="btn ghost bd-del" onClick={del}>
              <Icon name="trash" size={16} /> {tr('Delete')}
            </button>
          )}
          <button type="button" class="btn ghost" onClick={onClose}>{tr('Cancel')}</button>
          <button type="submit" class="btn primary" disabled={!ok}>{id ? tr('Save') : tr('Add birthday')}</button>
        </div>
      </form>
    </Modal>
  );
}

const reminderLine = (m) => reminderText(m, true);

// ---------------------------------------------------------------- card (from the calendar)

export function BirthdayCard({ occ, anchor, onClose }) {
  useStoreVersion();
  const b = store.get(occ.id);
  if (!b) return null;
  const days = Math.round((occ.startMs - new Date(today() + 'T00:00').getTime()) / 86400000);
  return (
    <Popover anchor={anchor} side={!!(anchor && anchor.nodeType === 1)} onClose={onClose} class="bd-card" width={320} sheetTitle={occ.title}>
      <div class="bd-card-head">
        <Avatar b={b} size={44} />
        <div>
          <strong class="bd-card-title">{occ.title}</strong>
          <div class="muted">{dayShortDate(occ.startDate)}{b.lunar ? ` · ${B.lunarText(b.month, b.day)}` : ''}</div>
        </div>
      </div>
      <div class="bd-card-lines">
        {occ.age != null && occ.age >= 0 && <div><Icon name="cake" size={15} /> {B.ageText(occ.age, b.me)}</div>}
        {days >= 0 && <div><Icon name="clock" size={15} /> {B.untilText(days)}</div>}
        {b.note && <div><Icon name="notes" size={15} /> {b.note}</div>}
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn ghost sm" onClick={() => (onClose(), (location.hash = '#/birthdays'))}>{tr('All birthdays')}</button>
        <button type="button" class="btn primary sm" onClick={() => (onClose(), ui.openBirthday(b.id))}>{tr('Edit')}</button>
      </div>
    </Popover>
  );
}
