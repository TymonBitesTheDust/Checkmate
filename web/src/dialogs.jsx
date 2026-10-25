import { useState } from 'preact/hooks';
import * as store from './store.js';
import * as A from './actions.js';
import { ui } from './bus.js';
import { Modal, ColorPicker, Field, Switch } from './ui.jsx';
import { compileFilter, filterHelp } from './filters.js';
import { tr, isZh } from './i18n.js';

function DialogShell({ title, onClose, onSubmit, submitLabel, disabled, children }) {
  return (
    <Modal onClose={onClose} class="dialog" label={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled) onSubmit();
        }}
      >
        <h2 class="dialog-title">{title}</h2>
        <div class="dialog-fields">{children}</div>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" onClick={onClose}>{tr('Cancel')}</button>
          <button type="submit" class="btn primary" disabled={disabled}>{submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectDialog({ id, onClose }) {
  const p = id ? store.get(id) : null;
  const [name, setName] = useState(p ? p.name : '');
  const [color, setColor] = useState(p ? p.color : 'pine');
  const [view, setView] = useState(p ? p.view || 'list' : 'list');
  const [fav, setFav] = useState(p ? !!p.favorite : false);
  return (
    <DialogShell
      title={p ? tr('Edit project') : tr('Add project')}
      submitLabel={p ? tr('Save') : tr('Add project')}
      disabled={!name.trim()}
      onClose={onClose}
      onSubmit={() => {
        const saved = A.saveProject(id, { name: name.trim(), color, view, favorite: fav });
        onClose();
        if (!id) ui.navigate(`#/project/${saved.id}`);
      }}
    >
      <Field label={tr('Name')}>
        <input type="text" value={name} maxLength={120} autofocus onInput={(e) => setName(e.currentTarget.value)} />
      </Field>
      <Field group label={tr('Colour')}>
        <ColorPicker value={color} onChange={setColor} />
      </Field>
      <Field group label={tr('Layout')}>
        <div class="seg wide" role="group">
          <button type="button" class={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>{tr('List')}</button>
          <button type="button" class={view === 'board' ? 'on' : ''} aria-pressed={view === 'board'} onClick={() => setView('board')}>{tr('Board')}</button>
        </div>
      </Field>
      <Switch label={tr('Show in favourites')} checked={fav} onChange={setFav} />
    </DialogShell>
  );
}

export function SectionDialog({ id, projectId, onClose }) {
  const s = id ? store.get(id) : null;
  const [name, setName] = useState(s ? s.name : '');
  return (
    <DialogShell
      title={s ? tr('Rename section') : tr('Add section')}
      submitLabel={s ? tr('Save') : tr('Add section')}
      disabled={!name.trim()}
      onClose={onClose}
      onSubmit={() => {
        A.saveSection(id, { name: name.trim(), projectId: s ? s.projectId : projectId });
        onClose();
      }}
    >
      <Field label={tr('Section name')}>
        <input type="text" value={name} maxLength={120} autofocus onInput={(e) => setName(e.currentTarget.value)} />
      </Field>
    </DialogShell>
  );
}

export function LabelDialog({ id, onClose }) {
  const l = id ? store.get(id) : null;
  const [name, setName] = useState(l ? l.name : '');
  const [color, setColor] = useState(l ? l.color : 'slate');
  const [fav, setFav] = useState(l ? !!l.favorite : false);
  const clean = name.trim().replace(/^@/, '').replace(/\s+/g, '_');
  const dup = A.labels().some((x) => x.id !== id && x.name.toLowerCase() === clean.toLowerCase());
  return (
    <DialogShell
      title={l ? tr('Edit label') : tr('Add label')}
      submitLabel={l ? tr('Save') : tr('Add label')}
      disabled={!clean || dup}
      onClose={onClose}
      onSubmit={() => {
        A.saveLabel(id, { name: clean, color, favorite: fav });
        onClose();
      }}
    >
      <Field label={tr('Label name')} hint={dup ? tr('A label with this name already exists.') : tr('Spaces become underscores so you can type it after @.')}>
        <input type="text" value={name} maxLength={60} autofocus onInput={(e) => setName(e.currentTarget.value)} />
      </Field>
      <Field group label={tr('Colour')}>
        <ColorPicker value={color} onChange={setColor} />
      </Field>
      <Switch label={tr('Show in favourites')} checked={fav} onChange={setFav} />
    </DialogShell>
  );
}

export function FilterDialog({ id, onClose }) {
  const f = id ? store.get(id) : null;
  const [name, setName] = useState(f ? f.name : '');
  const [query, setQuery] = useState(f ? f.query : '');
  const [color, setColor] = useState(f ? f.color : 'iris');
  const [fav, setFav] = useState(f ? !!f.favorite : true);
  const ctx = { projects: A.projects(), labels: A.labels(), sections: store.all('section') };
  let count = null;
  if (query.trim()) {
    const { fn } = compileFilter(query, ctx);
    count = A.openTasks().filter((t) => { try { return fn(t); } catch { return false; } }).length;
  }
  return (
    <DialogShell
      title={f ? tr('Edit filter') : tr('Add filter')}
      submitLabel={f ? tr('Save') : tr('Add filter')}
      disabled={!name.trim() || !query.trim()}
      onClose={onClose}
      onSubmit={() => {
        const saved = A.saveFilter(id, { name: name.trim(), query: query.trim(), color, favorite: fav });
        onClose();
        if (!id) ui.navigate(`#/filter/${saved.id}`);
      }}
    >
      <Field label={tr('Name')}>
        <input type="text" value={name} maxLength={80} autofocus placeholder={tr('e.g. Urgent this week')} onInput={(e) => setName(e.currentTarget.value)} />
      </Field>
      <Field label={tr('Query')} hint={count != null ? tr('{n} open task{s} match right now', { n: count }) : null}>
        <input type="text" value={query} placeholder={isZh() ? '(今天 | 逾期) & p1' : '(today | overdue) & p1'} spellcheck={false} onInput={(e) => setQuery(e.currentTarget.value)} />
      </Field>
      <div class="query-help">
        {filterHelp().map(([q, d]) => (
          <button type="button" key={q} class="qh" onClick={() => !q.includes('|') ? setQuery((query.trim() ? `${query.trim()} & ` : '') + q) : null}>
            <code>{q}</code>
            <span>{d}</span>
          </button>
        ))}
      </div>
      <Field group label={tr('Colour')}>
        <ColorPicker value={color} onChange={setColor} />
      </Field>
      <Switch label={tr('Show in favourites')} checked={fav} onChange={setFav} />
    </DialogShell>
  );
}
