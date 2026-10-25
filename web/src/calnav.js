// Where the Calendar page is looking (date and view), shared by the page, the sidebar's
// mini month and the event pop-ups. Kept for the session, so leaving the Calendar and
// coming back returns to the same week.
import { useEffect, useReducer } from 'preact/hooks';
import * as store from './store.js';
import { today } from './dates.js';

const listeners = new Set();
export const nav = { date: today(), view: null, pending: null, focus: null };

export function setNav(patch) {
  Object.assign(nav, patch);
  listeners.forEach((f) => f());
}

export function useNav() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => listeners.delete(force);
  }, []);
  return nav;
}

export const VIEWS = ['day', 'days', 'week', 'month', 'year', 'schedule'];

export function viewOf(narrow) {
  const v = nav.view || store.getPrefs().calView;
  if (VIEWS.includes(v)) return v;
  return narrow ? 'days' : 'week';
}

export function setView(view) {
  store.setPrefs({ calView: view });
  setNav({ view });
}
