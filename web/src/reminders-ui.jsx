// Reminder pieces for tasks (the task panel) and Settings → Reminders.
import { useState } from 'preact/hooks';
import * as store from './store.js';
import * as A from './actions.js';
import * as R from './reminders.js';
import * as E from './events.js';
import { Icon } from './icons.jsx';
import { Popover, Field, Switch, useStoreVersion } from './ui.jsx';
import { ReminderField } from './event-ui.jsx';
import { platform } from './native.js';
import { tr } from './i18n.js';

export const taskReminderText = (m, allDay) => (m === 0 && !allDay ? tr('At the due time') : E.reminderText(m, allDay));

export function reminderSummary(t) {
  if (!t.due || !t.due.date) return tr('Add a date first');
  const list = R.taskReminders(t);
  if (!list.length) return tr('None');
  if (list.length === 1) return taskReminderText(list[0], !t.due.time);
  return tr('{n} reminders', { n: list.length });
}

export function TaskReminders({ task, anchor, onClose }) {
  useStoreVersion();
  const t = store.get(task.id) || task;
  const allDay = !(t.due && t.due.time);
  const own = !R.usesDefaults(t);
  const list = R.taskReminders(t);
  return (
    <Popover anchor={anchor} onClose={onClose} class="rem-pop" width={340} sheetTitle={tr('Reminders')}>
      <div class="rem-pop-body">
        <h3 class="rem-pop-title"><Icon name="bell" size={16} /> {tr('Reminders')}</h3>
        {!t.due || !t.due.date ? (
          <p class="muted">{tr('Give the task a date first, then choose when to be reminded.')}</p>
        ) : (
          <>
            <Switch
              label={tr('Use my default reminders')}
              checked={!own}
              onChange={(v) => A.updateTask(t.id, { reminders: v ? null : [...list] })}
            />
            {own ? (
              <ReminderField value={list} allDay={allDay} text={taskReminderText} onChange={(r) => A.updateTask(t.id, { reminders: R.clean(r) })} />
            ) : (
              <div class="rem-defaults">
                {list.length ? list.map((m) => <div key={m}>{taskReminderText(m, allDay)}</div>) : <div class="muted">{tr('No reminder')}</div>}
                <span class="field-hint">{allDay ? tr('The default for tasks with only a date.') : tr('The default for tasks with a time.')}</span>
              </div>
            )}
          </>
        )}
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------- Settings → Reminders

export function RemindersPanel({ goTo }) {
  useStoreVersion();
  const d = R.defaults();
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  return (
    <div class="panel-stack reminders-panel">
      <p class="lead">{tr('Choose when Checkmate reminds you. A task can also have its own reminders: open it and choose Reminders.')}</p>
      <Field group label={tr('Tasks with a time')} hint={tr('For example “Call Sam tomorrow 5pm”.')}>
        <ReminderField value={d.timed} allDay={false} text={taskReminderText} onChange={(r) => R.setDefaults({ timed: R.clean(r) })} />
      </Field>
      <Field group label={tr('Tasks with only a date')} hint={tr('For example “Pay rent on Friday”.')}>
        <ReminderField value={d.dateOnly} allDay onChange={(r) => R.setDefaults({ dateOnly: R.clean(r) })} />
      </Field>
      <Field group label={tr('Birthdays')} hint={tr('A birthday can also have its own reminders.')}>
        <ReminderField value={d.birthday} allDay onChange={(r) => R.setDefaults({ birthday: R.clean(r) })} />
      </Field>
      <Field group label={tr('Calendar events')}>
        <p class="field-hint">{tr('Each calendar has its own default notifications, and each event can have its own.')}</p>
        <button type="button" class="btn ghost sm" onClick={() => goTo && goTo('calendar')}>
          <Icon name="month" size={16} /> {tr('Calendar settings')}
        </button>
      </Field>
      <p class="field-hint">{tr('These defaults are the same on all your devices.')}</p>
      {platform() === 'web' && perm === 'default' && (
        <Field group label={tr('Notifications in this browser')}>
          <button type="button" class="btn primary sm" onClick={async () => setPerm(await Notification.requestPermission())}>
            <Icon name="bell" size={16} /> {tr('Allow notifications')}
          </button>
          <span class="field-hint">{tr('Reminders show inside Checkmate either way. Allowing notifications also shows them when the tab is in the background.')}</span>
        </Field>
      )}
      {platform() === 'web' && perm === 'denied' && (
        <p class="field-hint">{tr('This browser blocks notifications from Checkmate. Reminders still show inside the app while it’s open.')}</p>
      )}
    </div>
  );
}
