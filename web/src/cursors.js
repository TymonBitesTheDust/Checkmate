// Mouse cursors for the game-style looks, built into CSS at bundle time.
// Each style gets an arrow and a pointer (for things you can click).
// The default Checkmate style keeps the system cursors.

const ARROW = 'M4 3L4 25L10 19.4L14.2 28.2L18.2 26.4L14 17.8L22 17.8Z';

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`;

const CURSORS = {
  archive: {
    arrow: svg(`<path d="${ARROW}" fill="#48443a" stroke="#e1ddd0" stroke-width="1.6" stroke-linejoin="miter"/>`),
    pointer: svg(
      `<path d="${ARROW}" fill="#48443a" stroke="#e1ddd0" stroke-width="1.6" stroke-linejoin="miter"/>` +
        '<rect x="19.5" y="20.5" width="8" height="8" fill="#48443a" stroke="#e1ddd0" stroke-width="1.6"/>',
    ),
  },
  riot: {
    arrow: svg(
      `<path d="${ARROW}" fill="#e5191c" transform="translate(2.5 2.5)"/>` +
        `<path d="${ARROW}" fill="#0d0d0d" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="miter"/>`,
    ),
    pointer: svg(
      `<path d="${ARROW}" fill="#0d0d0d" transform="translate(2.5 2.5)"/>` +
        `<path d="${ARROW}" fill="#e5191c" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="miter"/>` +
        '<path d="M24 17l1.8 5.2L31 24l-5.2 1.8L24 31l-1.8-5.2L17 24l5.2-1.8z" fill="#ffffff" stroke="#0d0d0d" stroke-width="1.2"/>',
    ),
  },
  tide: {
    arrow: svg(
      `<g transform="translate(4 3) skewX(-8) translate(-4 -3)">` +
        `<path d="${ARROW}" fill="none" stroke="#3fdcff" stroke-width="4" stroke-linejoin="round" opacity=".45"/>` +
        `<path d="${ARROW}" fill="#ffffff" stroke="#0b1c82" stroke-width="1.6" stroke-linejoin="round"/></g>`,
    ),
    pointer: svg(
      `<g transform="translate(4 3) skewX(-8) translate(-4 -3)">` +
        `<path d="${ARROW}" fill="none" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" opacity=".5"/>` +
        `<path d="${ARROW}" fill="#3fdcff" stroke="#0b1c82" stroke-width="1.6" stroke-linejoin="round"/></g>` +
        '<circle cx="24" cy="24" r="5" fill="#0b1c82" stroke="#ffffff" stroke-width="1.8"/><circle cx="24" cy="24" r="1.8" fill="#3fdcff"/>',
    ),
  },
  frontier: {
    arrow: svg(`<path d="${ARROW}" fill="#2a1c10" stroke="#f0e3c4" stroke-width="1.6" stroke-linejoin="round"/>`),
    pointer: svg(
      `<path d="${ARROW}" fill="#2a1c10" stroke="#f0e3c4" stroke-width="1.6" stroke-linejoin="round"/>` +
        // a small red star
        '<path d="M24 16.5l2.1 4.6 5 .5-3.8 3.3 1.1 4.9L24 27.3l-4.4 2.5 1.1-4.9-3.8-3.3 5-.5z" fill="#b3241b" stroke="#f0e3c4" stroke-width="1.2" stroke-linejoin="round"/>',
    ),
  },
  neon: {
    arrow: svg(
      `<path d="${ARROW}" fill="#5ef6ff" transform="translate(-1.6 0)" opacity=".85"/>` +
        `<path d="${ARROW}" fill="#ff2a4d" transform="translate(1.6 0)" opacity=".85"/>` +
        `<path d="${ARROW}" fill="#07080e" stroke="#fcee0a" stroke-width="1.5" stroke-linejoin="miter"/>`,
    ),
    pointer: svg(
      `<path d="${ARROW}" fill="#fcee0a" stroke="#07080e" stroke-width="1.5" stroke-linejoin="miter"/>` +
        '<path d="M19 19h7l3 3v7h-7l-3-3z" fill="#07080e" stroke="#5ef6ff" stroke-width="1.5"/><path d="M22 24.5h4" stroke="#ff2a4d" stroke-width="1.6"/>',
    ),
  },
};

const url = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}") 4 3`;

const CLICKABLE = [
  'a[href]', 'button:not(:disabled)', '[role="button"]', '[role="menuitem"]', '[role="radio"]', '[role="tab"]',
  '[role="checkbox"]', 'label', 'select', 'summary', '.task-row', '.cal-day',
  'input[type="checkbox"]', 'input[type="color"]', 'input[type="file"]',
].join(', ');
const TYPING = 'input:not([type="checkbox"]):not([type="color"]):not([type="file"]):not([type="range"]), textarea, [contenteditable="true"]';

export function cursorCss() {
  return Object.entries(CURSORS)
    .map(([skin, c]) => {
      const s = `[data-skin="${skin}"]`;
      return [
        `${s}, ${s} body { cursor: ${url(c.arrow)}, auto; }`,
        `${s} :is(${CLICKABLE}) { cursor: ${url(c.pointer)}, pointer; }`,
        `${s} :is(${TYPING}) { cursor: text; }`,
        `${s} button:disabled { cursor: ${url(c.arrow)}, default; }`,
        `${s} .grip { cursor: grab; }`,
      ].join('\n');
    })
    .join('\n');
}
