// Screens of the Red Dead Redemption 2 style (id "frontier") in light and dark, on a phone and in Chinese.
const tour = require('./tour.cjs');
tour('frontier', 'Red Dead Redemption 2', process.argv[2] || '/tmp/shots')
  .then((errs) => console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no page errors'))
  .catch((e) => { console.error('FAILED', e.message); process.exit(1); });
