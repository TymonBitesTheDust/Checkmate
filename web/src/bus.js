// App-wide actions that open UI (assigned by the App component on mount).
export const ui = {
  openTask: () => {},
  quickAdd: () => {},
  editProject: () => {},
  editSection: () => {},
  editLabel: () => {},
  editFilter: () => {},
  openSettings: () => {},
  editCalendar: () => {},
  showEvent: () => {},
  editEvent: () => {},
  newEvent: () => {},
  fullEvent: () => {},
  openEvent: () => {},
  showDay: () => {},
  toggleSidebar: () => {},
  navigate: (hash) => {
    location.hash = hash;
  },
};
