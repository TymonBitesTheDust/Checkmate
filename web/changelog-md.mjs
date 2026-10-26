// Writes CHANGELOG.md (the update history on GitHub) from src/changelog.js, the same notes the
// app shows in Settings → What's new. Run it after adding a version: node web/changelog-md.mjs
// (test/changelog.mjs fails when CHANGELOG.md is out of date).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CHANGELOG } from './src/changelog.js';

const REPO = 'https://github.com/TymonBitesTheDust/Checkmate';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Releases with downloads on GitHub started at 2.2.0.
const FIRST_RELEASE = [2, 2, 0];

const parts = (v) => v.split('.').map(Number);
const released = (v) => {
  const a = parts(v);
  for (let i = 0; i < 3; i++) if (a[i] !== FIRST_RELEASE[i]) return a[i] > FIRST_RELEASE[i];
  return true;
};
const month = (d) => (d ? `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '');

export function changelogMarkdown() {
  const out = [
    '# Update history',
    '',
    `Every version of Checkmate, newest first. The same notes are in the app under **Settings → What’s new**. Download the latest version from the [Releases page](${REPO}/releases/latest).`,
    '',
    '<!-- Made from web/src/changelog.js by `node web/changelog-md.mjs`. Edit that file, then run the script. -->',
  ];
  for (const c of CHANGELOG) {
    const earlier = c.v === 'earlier';
    const name = earlier ? 'Before 2.1.0' : released(c.v) ? `[${c.v}](${REPO}/releases/tag/v${c.v})` : c.v;
    out.push('', `## ${name}${c.date ? ` — ${month(c.date)}` : ''}`, '');
    for (const [en] of c.notes) out.push(`- ${en}`);
    out.push('', '<details><summary>繁體中文</summary>', '');
    for (const [, zh] of c.notes) out.push(`- ${zh}`);
    out.push('', '</details>');
  }
  return out.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md');
  writeFileSync(file, changelogMarkdown());
  console.log('wrote CHANGELOG.md');
}
