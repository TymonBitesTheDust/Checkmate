// The update history: CHANGELOG.md matches Settings → What's new, the newest version is on top,
// and the app, the Windows exe and the Android app all carry that version.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CHANGELOG } from '../web/src/changelog.js';
import { VERSION } from '../web/src/version.js';
import { changelogMarkdown } from '../web/changelog-md.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

assert.strictEqual(read('CHANGELOG.md'), changelogMarkdown(), 'CHANGELOG.md is out of date: run node web/changelog-md.mjs');
console.log('  ✓ CHANGELOG.md matches Settings → What’s new');

assert.strictEqual(CHANGELOG[0].v, VERSION, 'the newest What’s new entry is the current version');
const nums = CHANGELOG.filter((c) => c.v !== 'earlier').map((c) => c.v.split('.').map(Number));
for (let i = 1; i < nums.length; i++) {
  const [a, b] = [nums[i - 1], nums[i]];
  assert(a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2]))), `newest first: ${a.join('.')} before ${b.join('.')}`);
}
assert.strictEqual(read('CHANGELOG.md').match(/^## \[?([\d.]+)/m)[1], VERSION, 'CHANGELOG.md starts with the current version');
console.log(`  ✓ newest first, starting with ${VERSION}`);

const apk = read('android/apk/apktool.yml');
assert.strictEqual(apk.match(/versionName: (\S+)/)[1], VERSION, 'Android versionName');
const win = JSON.parse(read('desktop/winres/winres.json'));
const info = JSON.stringify(win);
assert(info.includes(`"ProductVersion":"${VERSION}"`) && info.includes(`"FileVersion":"${VERSION}"`), 'Windows exe version');
console.log(`  ✓ the Windows exe and the Android app are ${VERSION} too`);
