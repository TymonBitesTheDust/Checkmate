// The pages listed at the top of the sidebar. Settings → Sidebar chooses which are shown.
import { Icon } from './icons.jsx';
import { today, parseYmd } from './dates.js';

export function TodayIcon() {
  const d = parseYmd(today()).getDate();
  return (
    <svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M8 3v4M16 3v4" />
      <text x="12" y="17.6" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none" font-family="inherit">{d}</text>
    </svg>
  );
}

// key, link, label (English; translated where shown), icon
export const NAV_ITEMS = [
  { key: 'search', href: '#/search', label: 'Search', icon: () => <Icon name="search" /> },
  { key: 'inbox', href: '#/inbox', label: 'Inbox', icon: () => <Icon name="inbox" /> },
  { key: 'today', href: '#/today', label: 'Today', icon: () => <TodayIcon /> },
  { key: 'upcoming', href: '#/upcoming', label: 'Upcoming', icon: () => <Icon name="upcoming" /> },
  { key: 'calendar', href: '#/calendar', label: 'Calendar', icon: () => <Icon name="month" /> },
  { key: 'birthdays', href: '#/birthdays', label: 'Birthdays', icon: () => <Icon name="cake" /> },
  { key: 'filters', href: '#/filters', label: 'Filters & labels', icon: () => <Icon name="tag" /> },
  { key: 'completed', href: '#/completed', label: 'Completed', icon: () => <Icon name="done" /> },
  { key: 'productivity', href: '#/productivity', label: 'Productivity', icon: () => <Icon name="chart" /> },
];
