// The start screen (起始畫面): the current style's app icon and the Checkmate name, shown
// while the app loads. It runs straight after the #splash markup, before the app's script;
// main.jsx takes it away (splash.js). build.mjs fills in the icons and the theme colours.
(function () {
  var el = document.getElementById('splash');
  if (!el) return;
  var d = /*__SPLASH_DATA__*/ { icons: {}, accents: {}, accent: '' };
  try {
    var p = JSON.parse(localStorage.getItem('tickwise.prefs.v1') || '{}');
    // Off in Settings → Theme. Browser tests (navigator.webdriver) skip it unless they ask for it.
    if (p.splash === false || (navigator.webdriver && !window.__cmSplash)) {
      el.remove();
      return;
    }
    var skin = d.icons[p.skin] ? p.skin : 'tickwise';
    var svg = d.icons[skin];
    if (skin === 'tickwise' && p.accent) {
      var hex = d.accents[p.accent] || (/^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : '');
      if (hex) svg = svg.split(d.accent).join(hex);
    }
    el.querySelector('.sp-icon').innerHTML = svg;
    el.className = 'on';
  } catch (e) {
    el.remove();
    return;
  }
  // Never stay up if the app fails to start.
  setTimeout(function () {
    if (el.parentNode) el.remove();
  }, 10000);
})();
