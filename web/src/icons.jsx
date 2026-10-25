import * as store from './store.js';
import { iconSvg } from './brand-icons.js';
// Small stroke icon set drawn for Checkmate (24px grid).
const P = {
  plus: <path d="M12 5v14M5 12h14" />,
  inbox: <><path d="M4 13.5 6.2 6.6A2 2 0 0 1 8.1 5.2h7.8a2 2 0 0 1 1.9 1.4L20 13.5" /><path d="M4 13.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5h-4.5a3.5 3.5 0 0 1-7 0z" /></>,
  today: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /><path d="M9.5 14.6l1.8 1.8 3.3-3.6" /></>,
  upcoming: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /><circle cx="8.5" cy="14" r=".6" fill="currentColor" /><circle cx="12" cy="14" r=".6" fill="currentColor" /><circle cx="15.5" cy="14" r=".6" fill="currentColor" /><circle cx="8.5" cy="17" r=".6" fill="currentColor" /><circle cx="12" cy="17" r=".6" fill="currentColor" /></>,
  filter: <><path d="M5 6h14M8 12h8M10.5 18h3" /></>,
  tag: <><path d="M4 12.2V5.5A1.5 1.5 0 0 1 5.5 4h6.7a2 2 0 0 1 1.4.6l6.1 6.1a2 2 0 0 1 0 2.8l-6.4 6.4a2 2 0 0 1-2.8 0l-6.1-6.1a2 2 0 0 1-.4-1.6z" /><circle cx="8.5" cy="8.5" r="1.3" /></>,
  done: <><circle cx="12" cy="12" r="8" /><path d="m8.6 12.2 2.3 2.3 4.6-4.9" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.6-4.6" /></>,
  settings: <><circle cx="12" cy="12" r="2.8" /><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  more: <><circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  left: <path d="m15 6-6 6 6 6" />,
  right: <path d="m9 6 6 6-6 6" />,
  flag: <><path d="M6 21V4.5" /><path d="M6 4.5h10.5l-2 4 2 4H6" /></>,
  repeat: <><path d="M17 3.5 20 6.5l-3 3" /><path d="M4 12V10a3.5 3.5 0 0 1 3.5-3.5H20" /><path d="M7 20.5 4 17.5l3-3" /><path d="M20 12v2a3.5 3.5 0 0 1-3.5 3.5H4" /></>,
  comment: <path d="M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8.5z" />,
  trash: <><path d="M4.5 7h15M10 4h4M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7" /><path d="M10.2 11v5M13.8 11v5" /></>,
  edit: <><path d="M5 19h3.5L18.8 8.7a2 2 0 0 0 0-2.8l-.7-.7a2 2 0 0 0-2.8 0L5 15.5z" /><path d="m13.5 7 3.5 3.5" /></>,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  board: <><rect x="4" y="4.5" width="4.5" height="15" rx="1.5" /><rect x="10" y="4.5" width="4.5" height="10" rx="1.5" /><rect x="16" y="4.5" width="4" height="12.5" rx="1.5" /></>,
  list: <path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" />,
  sun: <><circle cx="12" cy="12" r="3.6" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  moon: <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />,
  cloud: <path d="M7.5 18.5h9.8a3.7 3.7 0 0 0 .6-7.4 5.5 5.5 0 0 0-10.6-.9A4.2 4.2 0 0 0 7.5 18.5z" />,
  cloudOff: <><path d="M7.5 18.5h9.8a3.7 3.7 0 0 0 1.9-.5M18.6 11.6a5.5 5.5 0 0 0-8.8-4.3M6.6 10.4A4.2 4.2 0 0 0 7.5 18.5" /><path d="m4 4 16 16" /></>,
  grip: <><circle cx="9.5" cy="7" r="1.1" fill="currentColor" stroke="none" /><circle cx="14.5" cy="7" r="1.1" fill="currentColor" stroke="none" /><circle cx="9.5" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="14.5" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="9.5" cy="17" r="1.1" fill="currentColor" stroke="none" /><circle cx="14.5" cy="17" r="1.1" fill="currentColor" stroke="none" /></>,
  star: <path d="m12 4.5 2.3 4.7 5.2.8-3.8 3.6.9 5.1L12 16.3l-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z" />,
  archive: <><rect x="4" y="5" width="16" height="4" rx="1" /><path d="M5.5 9v8.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>,
  sort: <><path d="M7 5v14M4 16l3 3 3-3" /><path d="M13 7h7M13 12h5M13 17h3" /></>,
  chart: <><path d="M5 19V11M10 19V6M15 19v-5M20 19V9" /></>,
  folder: <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4l2 2h7A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />,
  hash: <path d="M9.5 4 8 20M16 4l-1.5 16M5 9h15M4 15h15" />,
  section: <><path d="M4 7h16M4 12h10M4 17h7" /></>,
  sub: <><path d="M6 4v9a3 3 0 0 0 3 3h9" /><path d="m15 13 3 3-3 3" /></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-8A1.5 1.5 0 0 0 5 6.5v8A1.5 1.5 0 0 0 6.5 16H8" /></>,
  bell: <><path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" /><path d="M10 20.5h4" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  sofa: <><path d="M5.5 11V8.5A2.5 2.5 0 0 1 8 6h8a2.5 2.5 0 0 1 2.5 2.5V11" /><path d="M4 18v-5.5a1.5 1.5 0 0 1 3 0V14h10v-1.5a1.5 1.5 0 0 1 3 0V18z" /></>,
  arrowRight: <path d="M5 12h13M13 7l5 5-5 5" />,
  ban: <><circle cx="12" cy="12" r="8" /><path d="m6.5 6.5 11 11" /></>,
  undo: <><path d="M9 14 4.5 9.5 9 5" /><path d="M5 9.5h9.5a5 5 0 0 1 0 10H10" /></>,
  key: <><circle cx="8" cy="15" r="3.5" /><path d="m10.5 12.5 8-8M16 7l2.5 2.5M14 9l1.5 1.5" /></>,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></>,
  upload: <><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14" /></>,
  keyboard: <><rect x="3.5" y="6.5" width="17" height="11" rx="2" /><path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8" /></>,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 20v-4h-4" /></>,
  sheet: <><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="M4 10h16M4 15h16M10 4v16" /></>,
  doc: <><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  month: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16M9.3 10v10M14.7 10v10M4 15h16" /></>,
  pin: <><path d="M12 20.5s-6-5.4-6-10.2A6 6 0 0 1 18 10.3c0 4.8-6 10.2-6 10.2z" /><circle cx="12" cy="10.2" r="2.2" /></>,
  notes: <path d="M5 7h14M5 12h14M5 17h9" />,
  globe: <><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2.3 2.2 3.4 4.9 3.4 8s-1.1 5.8-3.4 8c-2.3-2.2-3.4-4.9-3.4-8S9.7 6.2 12 4z" /></>,
  palette: <><path d="M12 4a8 8 0 0 0 0 16c1.3 0 1.8-.9 1.5-1.9-.4-1.2.3-2.1 1.5-2.1H17a3 3 0 0 0 3-3c0-5-3.6-9-8-9z" /><circle cx="8" cy="11" r="1" fill="currentColor" /><circle cx="11" cy="7.8" r="1" fill="currentColor" /><circle cx="15" cy="8.6" r="1" fill="currentColor" /></>,
  sidebar: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="M9.5 5v14" /></>,
  info: <><circle cx="12" cy="12" r="8" /><path d="M12 11v5M12 8.2h.01" /></>,
  heart: <path d="M12 19.3s-7-4.3-7-9.4A3.8 3.8 0 0 1 12 7.7a3.8 3.8 0 0 1 7 2.2c0 5.1-7 9.4-7 9.4z" />,
  spark: <path d="M12 4.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z" />,
  plug: <><path d="M9 3.5V7M15 3.5V7" /><path d="M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0z" /><path d="M12 16v4.5" /></>,
  open: <><path d="M14 5h5v5M19 5l-8 8" /><path d="M17 14v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 17.5v-9A1.5 1.5 0 0 1 6.5 7H10" /></>,
  eye: <><path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="2.6" /></>,
  cake: <><path d="M5 20v-6.5A1.5 1.5 0 0 1 6.5 12h11a1.5 1.5 0 0 1 1.5 1.5V20" /><path d="M4 20h16" /><path d="M5 15.5c1.2 0 1.8-1 2.8-1s1.6 1 2.8 1 1.7-1 2.8-1 1.6 1 2.8 1 1.6-1 2.8-1" /><path d="M8 12V9.5M12 12V9.5M16 12V9.5" /><path d="M8 6.8c-.6-.6-.6-1.4 0-2.3.6.9.6 1.7 0 2.3zM12 6.8c-.6-.6-.6-1.4 0-2.3.6.9.6 1.7 0 2.3zM16 6.8c-.6-.6-.6-1.4 0-2.3.6.9.6 1.7 0 2.3z" /></>,
  clip: <path d="M19.5 11.5 12 19a5 5 0 0 1-7-7l7.6-7.6a3.3 3.3 0 0 1 4.7 4.7l-7.5 7.5a1.7 1.7 0 0 1-2.4-2.4l6.9-6.9" />,
  file: <><path d="M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5z" /><path d="M14 3.5v4h4" /></>,
  image: <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4.5 17 4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5" /></>,
  history: <><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6" /><path d="M4 4.5v4.1h4.1" /><path d="M12 8v4.3l3 1.8" /></>,
  rss: <><path d="M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8" /><circle cx="6" cy="18" r="1.2" fill="currentColor" /></>,
};

export function Icon({ name, size = 20, class: cls = '', title, style }) {
  return (
    <svg
      class={`ic ${cls}`}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {P[name] || P.more}
    </svg>
  );
}

// The app mark for the current style (Checkmate follows the chosen theme colour).
export function Logo({ size = 28 }) {
  const skin = store.getPrefs().skin || 'tickwise';
  const svg = iconSvg(skin, { accent: 'var(--accent)', size });
  return <span class="logo" style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}
