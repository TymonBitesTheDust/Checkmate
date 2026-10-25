// Thin layer over the host app (Android WebView bridge, Windows WebView2 host, or a plain browser).
const android = () => (typeof window !== 'undefined' ? window.TickwiseNative : null);

export function platform() {
  if (android()) return 'android';
  if (window.chrome && window.chrome.webview) return 'windows';
  return 'web';
}

export function saveFile(name, mime, text) {
  const a = android();
  if (a && a.saveFile) {
    a.saveFile(name, mime, text);
    return true;
  }
  const blob = new Blob([text], { type: mime });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 2000);
  return true;
}

// Saves a Blob (a task's file) where the user chooses. Android gets it in pieces, so even a
// 100 MB file never has to sit in one string; elsewhere the browser downloads it.
export async function saveBlob(name, blob) {
  const a = android();
  if (a && a.saveBinary && a.saveChunk) {
    const token = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const ready = new Promise((resolve) => {
      window.__cmSaves = window.__cmSaves || {};
      window.__cmSaves[token] = resolve;
      window.__cmSaveReady = (t, ok) => {
        const fn = window.__cmSaves && window.__cmSaves[t];
        if (fn) {
          delete window.__cmSaves[t];
          fn(ok);
        }
      };
    });
    a.saveBinary(token, name, blob.type || 'application/octet-stream');
    if (!(await ready)) return false;
    const STEP = 384 * 1024; // a multiple of 3, so each piece is whole base64
    let ok = true;
    for (let i = 0; i < blob.size && ok; i += STEP) {
      const bytes = new Uint8Array(await blob.slice(i, i + STEP).arrayBuffer());
      let bin = '';
      for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
      ok = a.saveChunk(token, btoa(bin));
    }
    a.saveDone(token, !!ok);
    return !!ok;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 60000);
  return true;
}

export async function copyText(text) {
  const a = android();
  if (a && a.copyText) {
    a.copyText(text);
    return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
    return ok;
  }
}

export function setSystemBars(color, lightIcons) {
  const a = android();
  if (a && a.setSystemBars) {
    try {
      a.setSystemBars(color, !!lightIcons);
    } catch {}
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
}

// Hand upcoming reminders to the host so they fire even when the app is closed.
export function scheduleReminders(list) {
  const a = android();
  if (a && a.scheduleReminders) {
    try {
      a.scheduleReminders(JSON.stringify(list));
      return true;
    } catch {}
  }
  if (window.twScheduleReminders) {
    try {
      window.twScheduleReminders(JSON.stringify(list));
      return true;
    } catch {}
  }
  return false;
}

export function nativeNotify(title, body) {
  if (window.twNotify) {
    try {
      window.twNotify(title, body);
      return true;
    } catch {}
  }
  return false;
}

export function openExternal(url) {
  if (window.twOpenExternal) {
    window.twOpenExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

// Matches the app icon to the style: the browser tab icon and the Windows window icon
// always; with `follow` (on unless turned off in Settings) also Checkmate.exe and its
// desktop, Start and taskbar shortcuts, and the Android home-screen icon.
export function setAppIcon(skin, { tabIconSvg, follow }) {
  const link = document.querySelector('link[rel="icon"]');
  if (link && tabIconSvg) link.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(tabIconSvg)}`);
  if (window.twSetIcon) {
    try {
      window.twSetIcon(skin, !!follow);
    } catch {}
  }
  const a = android();
  if (a && a.setLauncherIcon) {
    try {
      a.setLauncherIcon(follow ? skin : 'tickwise');
    } catch {}
  }
}

// Lets the Android app word its own toasts and notification channel the same way.
export function setNativeLanguage(l) {
  const a = android();
  if (a && a.setLanguage) {
    try {
      a.setLanguage(l);
    } catch {}
  }
}

// Reads a Google Docs/Sheets URL through the host app, which isn't held back by the
// browser's cross-site rules. Returns null in a plain browser. The Windows and Android
// hosts answer later through window.__twFetchDone, so the window never freezes.
let fetchSeq = 0;
const fetchWaiting = new Map();
if (typeof window !== 'undefined') {
  window.__twFetchDone = (id, status, text) => {
    const done = fetchWaiting.get(id);
    if (!done) return;
    fetchWaiting.delete(id);
    done(status ? { status, text: text || '' } : null);
  };
}
export const hasNativeFetch = () => !!(window.twFetch || (android() && android().fetchText));

export function nativeFetchText(url) {
  const a = android();
  const start = window.twFetch ? (id) => window.twFetch(id, url) : a && a.fetchText ? (id) => a.fetchText(id, url) : null;
  if (!start) return null;
  return new Promise((resolve, reject) => {
    const id = `f${++fetchSeq}`;
    const timer = setTimeout(() => fetchWaiting.delete(id) && reject(new Error('timeout')), 30000);
    fetchWaiting.set(id, (r) => {
      clearTimeout(timer);
      if (r) resolve(r);
      else reject(new Error('network'));
    });
    try {
      const r = start(id);
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (e) {
      fetchWaiting.delete(id);
      clearTimeout(timer);
      reject(e);
    }
  });
}

export const canSwitchAppIcon = () => !!((android() && android().setLauncherIcon) || window.twSetIcon);

export function hasNativeReminders() {
  const a = android();
  return !!(a && a.scheduleReminders);
}
