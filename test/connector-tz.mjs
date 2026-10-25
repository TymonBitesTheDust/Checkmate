// The connector's quick time zone conversion must give exactly what the app's tz.js gives,
// including on daylight-saving days and in half- and quarter-hour zones.
import { writeFileSync } from 'node:fs';
import assert from 'node:assert';
import { bundleModule } from '../connector/build.mjs';

const SCRATCH = process.env.SCRATCH || '/tmp/claude-0/-home-claude/ea44315e-fc01-53a8-96ed-f547afb31a4f/scratchpad';
const file = `${SCRATCH}/connector-tools-${process.pid}.mjs`;
writeFileSync(file, await bundleModule(new URL('../connector/src/tools.js', import.meta.url).pathname));
const { _tzForTests: T } = await import(file);
const zones = ['Australia/Sydney', 'Australia/Adelaide', 'Australia/Lord_Howe', 'America/St_Johns', 'America/New_York', 'Europe/London', 'Asia/Kathmandu', 'Pacific/Chatham', 'Asia/Hong_Kong', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC'];
let n = 0;
const start = Date.UTC(2025, 0, 1);
for (const tz of zones) {
  // every 37 minutes for two years covers every clock change in that time
  for (let ms = start; ms < start + 2 * 366 * 86400000; ms += 37 * 60000) {
    const a = T.msToWall(ms, tz);
    const b = T.slowMsToWall(ms, tz);
    assert.deepStrictEqual(a, b, `msToWall ${tz} ${new Date(ms).toISOString()}`);
    const back = T.wallToMs(a.date, a.time, tz);
    assert.strictEqual(back, T.slowWallToMs(a.date, a.time, tz), `wallToMs ${tz} ${a.date} ${a.time}`);
    n++;
  }
}
console.log(`  ✓ quick time zone conversion matches the app's on ${n} instants in ${zones.length} zones`);
