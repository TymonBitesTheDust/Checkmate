// Screens of the Cyberpunk 2077 style (id "neon") in light and dark, on a phone and in Chinese.
const tour = require('./tour.cjs');
tour('neon', 'Cyberpunk 2077', process.argv[2] || '/tmp/shots')
  .then((errs) => console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no page errors'))
  .catch((e) => { console.error('FAILED', e.message); process.exit(1); });
