// The Files section of a task: add files (up to 100 MB each), see, save and remove them.
import { useState, useEffect, useRef } from 'preact/hooks';
import * as store from './store.js';
import * as F from './files.js';
import * as sync from './sync.js';
import { Icon } from './icons.jsx';
import { Modal, toast, confirmDialog } from './ui.jsx';
import { saveBlob } from './native.js';
import { play } from './sound.js';
import { tr } from './i18n.js';

function useFileProgress() {
  const [, setN] = useState(0);
  useEffect(() => F.onProgress(() => setN((n) => n + 1)), []);
}

const kindOf = (f) => {
  const t = (f.type || '').toLowerCase();
  const n = (f.name || '').toLowerCase();
  if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/.test(n)) return 'image';
  if (t.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/.test(n)) return 'video';
  if (t.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|flac|aac)$/.test(n)) return 'audio';
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (t.startsWith('text/') || /\.(txt|md|csv|json|log)$/.test(n)) return 'text';
  return 'file';
};

function errText(e) {
  if (e && e.code === 'not-uploaded') return tr('This file is still uploading from the device it was added on. Try again once that device is online.');
  if (e && e.code === 'not-here') return tr('This file was added on another device. Turn on sync (Settings → Sync) to get it here.');
  return tr('Couldn’t get the file. Check your connection and try again.');
}

export function TaskFiles({ task }) {
  useFileProgress();
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const files = task.files || [];

  const add = async (list) => {
    const arr = [...(list || [])];
    if (!arr.length) return;
    const { added, tooBig } = await F.addFiles(task.id, arr);
    if (added.length) {
      play('add');
      toast(added.length === 1 ? tr('Added “{name}”', { name: added[0].name }) : tr('Added {n} files', { n: added.length }));
    }
    if (tooBig.length) toast(tr('“{name}” is larger than 100 MB, so it wasn’t added.', { name: tooBig[0] }), null, { icon: 'ban', duration: 7000 });
  };

  return (
    <section
      class={`detail-section files-section ${over ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        setOver(false);
        add(e.dataTransfer.files);
      }}
    >
      <h3>
        {tr('Files')}
        {files.length > 0 && <span class="muted"> {files.length}</span>}
      </h3>
      {files.length > 0 && (
        <div class="file-list">
          {files.map((f) => <FileRow key={f.id} task={task} f={f} onOpen={() => setPreview(f)} />)}
        </div>
      )}
      <input ref={input} type="file" multiple hidden onChange={(e) => {
        add(e.currentTarget.files);
        e.currentTarget.value = '';
      }} />
      <button type="button" class="file-add" onClick={() => input.current && input.current.click()}>
        <span class="add-plus"><Icon name="clip" size={16} /></span>
        <span>{tr('Add file')}</span>
        <span class="muted file-limit">{tr('Up to 100 MB')}</span>
      </button>
      {preview && <FilePreview f={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

function FileRow({ task, f, onOpen }) {
  const p = F.progressOf(f.id);
  const here = F.isLocal(f.id);
  const kind = kindOf(f);
  const pct = p ? Math.round((p.done / Math.max(1, p.total)) * 100) : 0;
  let status = F.sizeText(f.size);
  if (p && p.kind === 'up') status = p.error ? tr('Upload paused, will try again') : tr('Uploading {n}%', { n: pct });
  else if (p && p.kind === 'down') status = tr('Downloading {n}%', { n: pct });
  else if (!here && F.ready()) status = `${F.sizeText(f.size)} · ${tr('On another device, opens when you tap it')}`;

  const save = async () => {
    try {
      const blob = await F.getBlob(f);
      await saveBlob(f.name, blob);
    } catch (e) {
      toast(errText(e), null, { icon: 'cloudOff', duration: 8000 });
    }
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: tr('Remove this file?'), body: f.name, confirm: tr('Remove'), danger: true });
    if (!ok) return;
    await F.removeFile(task.id, f.id);
    play('delete');
  };
  return (
    <div class={`file-row ${p ? 'busy' : ''}`}>
      <button type="button" class="file-open" onClick={onOpen} title={tr('Open')}>
        <span class={`file-ico k-${kind}`}><Icon name={kind === 'image' ? 'image' : 'file'} size={18} /></span>
        <span class="file-text">
          <span class="file-name">{f.name}</span>
          <span class="file-status muted">{status}</span>
        </span>
      </button>
      {p && <span class="file-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>}
      <button type="button" class="icon-btn sm" aria-label={tr('Save {name}', { name: f.name })} title={tr('Save')} onClick={save}>
        <Icon name="download" size={16} />
      </button>
      <button type="button" class="icon-btn sm" aria-label={tr('Remove {name}', { name: f.name })} title={tr('Remove')} onClick={remove}>
        <Icon name="trash" size={16} />
      </button>
    </div>
  );
}

export function FilePreview({ f, onClose }) {
  useFileProgress();
  const [url, setUrl] = useState(null);
  const [text, setText] = useState(null);
  const [err, setErr] = useState(null);
  const [blob, setBlob] = useState(null);
  const kind = kindOf(f);
  useEffect(() => {
    let live = true;
    let made = null;
    F.getBlob(f)
      .then(async (b) => {
        if (!live) return;
        setBlob(b);
        if (kind === 'text') setText((await b.slice(0, 200 * 1024).text()) + (b.size > 200 * 1024 ? '\n…' : ''));
        else if (kind !== 'file') setUrl((made = URL.createObjectURL(b)));
      })
      .catch((e) => live && setErr(e));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [f.id]);
  const p = F.progressOf(f.id);
  const android = /CheckmateAndroid/.test(navigator.userAgent);
  const canShow = kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'text' || (kind === 'pdf' && !android);
  return (
    <Modal onClose={onClose} class="dialog file-preview" label={f.name}>
      <div class="fp-head">
        <h2 class="dialog-title fp-title">{f.name}</h2>
        <span class="muted">{F.sizeText(f.size)}</span>
      </div>
      <div class="fp-body">
        {err && <p class="form-error">{errText(err)}</p>}
        {!err && !blob && <p class="muted">{p && p.kind === 'down' ? tr('Downloading {n}%', { n: Math.round((p.done / Math.max(1, p.total)) * 100) }) : tr('Opening…')}</p>}
        {blob && canShow && kind === 'image' && url && <img src={url} alt={f.name} />}
        {blob && canShow && kind === 'video' && url && <video src={url} controls playsInline />}
        {blob && canShow && kind === 'audio' && url && <audio src={url} controls />}
        {blob && canShow && kind === 'pdf' && url && <iframe src={url} title={f.name} />}
        {blob && kind === 'text' && text != null && <pre>{text}</pre>}
        {blob && !canShow && <p class="muted fp-none"><Icon name="file" size={28} /><br />{tr('Checkmate can’t show this kind of file. Save it to open it in another app.')}</p>}
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" onClick={onClose}>{tr('Close')}</button>
        <button type="button" class="btn primary" disabled={!blob} onClick={() => blob && saveBlob(f.name, blob)}>
          <Icon name="download" size={16} /> {tr('Save')}
        </button>
      </div>
    </Modal>
  );
}

export const syncOn = () => !!sync.remote();
