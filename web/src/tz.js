// Time zones for calendar events. A timed event is stored as a wall-clock time
// ("2026-10-19T10:00") in the zone it was made in ("Australia/Sydney"), the same way
// Google Calendar keeps it, so a weekly 10am meeting stays at 10am across daylight
// saving. These helpers turn wall times into instants and back.

const fmtCache = new Map();
const pad = (n) => String(n).padStart(2, '0');

let local = null;
export function localTz() {
  if (local) return local;
  try {
    local = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    local = 'UTC';
  }
  return local;
}

function fmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function validTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

// Calendar fields of an instant as seen in a zone.
export function partsIn(ms, tz) {
  const p = {};
  for (const x of fmt(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  let h = +p.hour;
  if (h === 24) h = 0;
  return { y: +p.year, m: +p.month, d: +p.day, h, mi: +p.minute, s: +p.second };
}

// Minutes the zone is ahead of UTC at that instant (Sydney in summer: 660).
export function offsetMin(ms, tz) {
  if (!validTz(tz)) return -new Date(ms).getTimezoneOffset();
  const p = partsIn(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

const isLocal = (tz) => !tz || tz === localTz() || !validTz(tz);

// "2026-10-19", "10:00", "Asia/Hong_Kong" -> milliseconds since 1970.
export function wallToMs(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  if (isLocal(tz)) return new Date(y, m - 1, d, h || 0, mi || 0).getTime();
  const guess = Date.UTC(y, m - 1, d, h || 0, mi || 0);
  const off = offsetMin(guess, tz);
  let ms = guess - off * 60000;
  const off2 = offsetMin(ms, tz);
  if (off2 !== off) ms = guess - off2 * 60000;
  return ms;
}

// Milliseconds -> { date: "2026-10-19", time: "10:00" } in a zone (or this device's).
export function msToWall(ms, tz) {
  if (isLocal(tz)) {
    const d = new Date(ms);
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }
  const p = partsIn(ms, tz);
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

// "GMT+11" / "GMT+5:30" for this device at the given instant, like Google's grid label.
export function gmtLabel(ms = Date.now(), tz) {
  const off = tz ? offsetMin(ms, tz) : -new Date(ms).getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `GMT${off === 0 ? '+00' : sign + h}${m ? `:${pad(m)}` : ''}`;
}

// Every zone the browser knows, for the event editor's time zone list.
export function allZones() {
  try {
    if (Intl.supportedValuesOf) {
      const list = Intl.supportedValuesOf('timeZone');
      if (list && list.length) {
        const out = [...list];
        if (!out.includes(localTz())) out.unshift(localTz());
        if (!out.includes('UTC')) out.push('UTC');
        return out;
      }
    }
  } catch {}
  return [...new Set([localTz(), 'UTC', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth', 'Pacific/Auckland', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Shanghai', 'Asia/Macau', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Vancouver', 'America/Toronto'])];
}

// Outlook and Exchange name zones the Windows way; these are the common ones.
const WINDOWS_ZONES = {
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'W. Australia Standard Time': 'Australia/Perth',
  'Tasmania Standard Time': 'Australia/Hobart',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'China Standard Time': 'Asia/Shanghai',
  'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Singapore Standard Time': 'Asia/Singapore',
  'India Standard Time': 'Asia/Kolkata',
  'Arabian Standard Time': 'Asia/Dubai',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};

// A zone name from an .ics file, as one this device understands (or null = floating).
export function normalizeZone(name) {
  if (!name) return null;
  const n = String(name).replace(/^"|"$/g, '').replace(/^\/[^/]*\/[^/]*\//, '').trim();
  if (validTz(n)) return n;
  if (WINDOWS_ZONES[n]) return WINDOWS_ZONES[n];
  const m = /([A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)/.exec(n);
  if (m && validTz(m[1])) return m[1];
  return null;
}
