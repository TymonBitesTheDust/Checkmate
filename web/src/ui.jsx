import { useEffect, useLayoutEffect, useRef, useState, useReducer } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import * as store from './store.js';
import { Icon } from './icons.jsx';
import { COLORS } from './actions.js';
import { play } from './sound.js';
import { tr } from './i18n.js';
import { openExternal } from './native.js';

// ---------- store subscription ----------

export function useStoreVersion() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => store.subscribe(force), []);
  return store.getVersion();
}

// ---------- layers (Escape / Android back close the topmost) ----------

const layers = [];
export function useLayer(onClose, active = true) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!active) return;
    const l = { close: () => ref.current && ref.current() };
    layers.push(l);
    return () => {
      const i = layers.indexOf(l);
      if (i >= 0) layers.splice(i, 1);
    };
  }, [active]);
}
export function closeTopLayer() {
  // Take it off the stack now, so a second quick Escape (or Back) reaches the
  // layer underneath instead of waiting for this one to unmount.
  const l = layers.pop();
  if (!l) return false;
  l.close();
  return true;
}
export const hasLayers = () => layers.length > 0;

if (typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && layers.length) {
        e.preventDefault();
        e.stopPropagation();
        closeTopLayer();
      }
    },
    true,
  );
}

export const isNarrow = () => window.matchMedia('(max-width: 640px)').matches;

export function useNarrow() {
  const [n, setN] = useState(isNarrow());
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const fn = () => setN(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', fn) : mq.removeListener(fn));
  }, []);
  return n;
}

// ---------- popover ----------

let popSeq = 0;
export function Popover({ anchor, onClose, children, class: cls = '', align = 'start', width, sheetTitle, side }) {
  const ref = useRef(null);
  const seq = useRef(0);
  if (!seq.current) seq.current = ++popSeq;
  const [pos, setPos] = useState(null);
  const narrow = isNarrow();
  useLayer(onClose);
  useEffect(() => play('pop'), []);

  useLayoutEffect(() => {
    if (narrow || !ref.current) return;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const a = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 3, bottom: innerHeight / 3 };
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (side) {
        // beside the anchor (calendar events), on whichever side has room
        let left = a.right + 10;
        if (left + w > innerWidth - 8) left = a.left - w - 10;
        if (left < 8) left = Math.max(8, Math.min(innerWidth - w - 8, (innerWidth - w) / 2));
        const top = Math.max(8, Math.min(a.top, innerHeight - h - 8));
        setPos({ left, top });
        return;
      }
      if (anchor && anchor.center) {
        setPos({ left: Math.max(8, (innerWidth - w) / 2), top: Math.max(8, Math.min(innerHeight * 0.14, innerHeight - h - 8)) });
        return;
      }
      let left = align === 'end' ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, innerWidth - w - 8));
      let top = a.bottom + 6;
      if (top + h > innerHeight - 8) top = Math.max(8, a.top - h - 6);
      setPos({ left, top });
    };
    place();
    const ro = window.ResizeObserver ? new ResizeObserver(place) : null;
    ro && ro.observe(ref.current);
    return () => ro && ro.disconnect();
  }, [anchor, narrow]);

  useEffect(() => {
    const down = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (anchor && anchor.contains && anchor.contains(e.target)) return;
      // A pop-up opened from inside this one (a date picker, a time list) is part of it.
      const other = e.target.closest && e.target.closest('[data-pop-seq]');
      if (other && +other.dataset.popSeq > seq.current) return;
      onClose && onClose();
    };
    const t = setTimeout(() => document.addEventListener('pointerdown', down), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', down);
    };
  }, [anchor, onClose]);

  if (narrow) {
    return createPortal(
      <div class="sheet-wrap" data-pop-seq={seq.current}>
        <div class="sheet-backdrop" />
        <div class={`sheet ${cls}`} ref={ref} role="dialog" aria-label={sheetTitle}>
          <div class="sheet-grab" />
          {sheetTitle && <div class="sheet-title">{sheetTitle}</div>}
          {children}
        </div>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div
      ref={ref}
      data-pop-seq={seq.current}
      class={`popover ${cls}`}
      style={{ left: pos ? pos.left : -9999, top: pos ? pos.top : -9999, width }}
      role="dialog"
      aria-label={sheetTitle}
    >
      {children}
    </div>,
    document.body,
  );
}

// ---------- menu ----------

export function Menu({ anchor, items, onClose, align = 'start', title }) {
  const listRef = useRef(null);
  useEffect(() => {
    const first = listRef.current && listRef.current.querySelector('button:not([disabled])');
    if (first && !isNarrow()) first.focus({ preventScroll: true });
  }, []);
  const onKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = [...listRef.current.querySelectorAll('button:not([disabled])')];
    const i = btns.indexOf(document.activeElement);
    const n = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
    btns[n] && btns[n].focus();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} align={align} class="menu" sheetTitle={title}>
      <div class="menu-list" ref={listRef} role="menu" onKeyDown={onKey}>
        {items.filter(Boolean).map((it, i) =>
          it.divider ? (
            <div class="menu-sep" key={`d${i}`} />
          ) : it.heading ? (
            <div class="menu-heading" key={`h${i}`}>{it.heading}</div>
          ) : it.custom ? (
            <div key={`c${i}`}>{it.custom}</div>
          ) : (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              class={`menu-item ${it.danger ? 'danger' : ''} ${it.checked ? 'checked' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                onClose && onClose();
                it.onSelect && it.onSelect();
              }}
            >
              {it.icon && <Icon name={it.icon} size={18} class={it.iconClass || ''} />}
              {it.swatch && <span class="swatch" style={{ background: it.swatch }} />}
              <span class="menu-label">{it.label}</span>
              {it.hint && <span class="menu-hint">{it.hint}</span>}
              {it.checked && <span class="menu-check">✓</span>}
            </button>
          ),
        )}
      </div>
    </Popover>
  );
}

// Button that opens a menu.
export function MenuButton({ items, icon = 'more', label, class: cls = '', align = 'end', children, title }) {
  label = label || tr('More actions');
  const [anchor, setAnchor] = useState(null);
  return (
    <>
      <button
        type="button"
        class={`icon-btn ${cls}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(anchor ? null : e.currentTarget);
        }}
      >
        {children || <Icon name={icon} />}
      </button>
      {anchor && <Menu anchor={anchor} align={align} title={title} items={typeof items === 'function' ? items() : items} onClose={() => setAnchor(null)} />}
    </>
  );
}

// ---------- modal ----------

export function Modal({ onClose, children, class: cls = '', label, initialFocus = true }) {
  const ref = useRef(null);
  useLayer(onClose);
  useEffect(() => {
    play('open');
    return () => play('close');
  }, []);
  useLayoutEffect(() => {
    const prev = document.activeElement;
    if (initialFocus && ref.current && !isNarrow() && !ref.current.contains(document.activeElement)) {
      const el = ref.current.querySelector('[autofocus], input, textarea, button');
      el && el.focus({ preventScroll: true });
    }
    // give focus back without scrolling anything to it
    return () => prev && prev.focus && prev.focus({ preventScroll: true });
  }, []);
  return createPortal(
    <div class="modal-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div class={`modal ${cls}`} ref={ref} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---------- toasts ----------

let pushToast = () => {};
// toast(message) or toast(message, undoFn) or toast(message, fn, { label: 'Open', duration })
export function toast(message, action, opts = {}) {
  pushToast(message, action, opts);
}

export function Toasts() {
  const [list, setList] = useState([]);
  useEffect(() => {
    pushToast = (message, action, opts) => {
      const id = Math.random().toString(36).slice(2);
      setList((l) => [...l.filter((t) => t.message !== message).slice(-1), { id, message, action, label: opts.label || tr('Undo'), undo: !opts.label, icon: opts.icon }]);
      setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), opts.duration || (action ? 6500 : 3500));
    };
  }, []);
  const drop = (id) => setList((l) => l.filter((x) => x.id !== id));
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div class="toast" key={t.id}>
          {t.icon && <Icon name={t.icon} size={18} />}
          <span class="toast-msg">{t.message}</span>
          {t.action && (
            <button
              type="button"
              class="toast-undo"
              onClick={() => {
                if (t.undo) play('undo');
                t.action();
                drop(t.id);
              }}
            >
              {t.label}
            </button>
          )}
          <button type="button" class="toast-x" aria-label={tr('Dismiss')} onClick={() => drop(t.id)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- small form pieces ----------

export function ColorPicker({ value, onChange }) {
  return (
    <div class="colors" role="radiogroup" aria-label={tr('Colour')}>
      {Object.entries(COLORS).map(([name, hex]) => (
        <button
          type="button"
          key={name}
          role="radio"
          aria-checked={value === name}
          aria-label={tr(name[0].toUpperCase() + name.slice(1))}
          title={tr(name[0].toUpperCase() + name.slice(1))}
          class={`color-dot ${value === name ? 'on' : ''}`}
          style={{ '--c': hex }}
          onClick={() => onChange(name)}
        />
      ))}
    </div>
  );
}

let fieldSeq = 0;
// A labelled form row. Use `group` when the content is a set of buttons
// (a <label> would forward clicks on its text to the first button).
export function Field({ label, children, hint, group }) {
  const id = useRef(null);
  if (!id.current) id.current = `field-${++fieldSeq}`;
  if (group) {
    return (
      <div class="field" role="group" aria-labelledby={id.current}>
        <span class="field-label" id={id.current}>{label}</span>
        {children}
        {hint && <span class="field-hint">{hint}</span>}
      </div>
    );
  }
  return (
    <label class="field">
      <span class="field-label">{label}</span>
      {children}
      {hint && <span class="field-hint">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label }) {
  return (
    <label class="switch-row">
      <span>{label}</span>
      <input type="checkbox" class="switch" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}

// Confirm dialog
let openConfirm = () => {};
export function confirmDialog(opts) {
  return new Promise((resolve) => openConfirm({ ...opts, resolve }));
}
export function ConfirmHost() {
  const [c, setC] = useState(null);
  useEffect(() => {
    openConfirm = setC;
  }, []);
  if (!c) return null;
  const done = (v) => {
    c.resolve(v);
    setC(null);
  };
  return (
    <Modal onClose={() => done(false)} class="confirm" label={c.title}>
      <h2 class="dialog-title">{c.title}</h2>
      {c.body && <p class="dialog-body">{c.body}</p>}
      <div class="dialog-actions">
        <button type="button" class="btn ghost" onClick={() => done(false)}>{tr('Cancel')}</button>
        <button type="button" class={`btn ${c.danger ? 'danger' : 'primary'}`} autofocus onClick={() => done(true)}>
          {c.confirm || tr('OK')}
        </button>
      </div>
    </Modal>
  );
}

export function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function Linkify({ text }) {
  if (!text) return null;
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              // opens in the browser chosen in Settings → General, without also opening the task
              e.stopPropagation();
              e.preventDefault();
              openExternal(p);
            }}
          >
            {p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}
