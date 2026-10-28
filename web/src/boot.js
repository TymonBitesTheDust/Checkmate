// Runs in <head> before the first paint: applies the saved theme, style, language and
// motion so the page doesn't flash. It is inlined into Checkmate.html, and is its own file
// in the browser extension (extension pages can't run inline scripts).
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('tickwise.prefs.v1') || '{}');
    var t = p.theme || 'system';
    var dark = p.skin === 'riot' || t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    var m = p.motion || 'system';
    document.documentElement.dataset.motion = m === 'reduced' || (m === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'reduced' : 'full';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if (p.skin && p.skin !== 'tickwise') document.documentElement.dataset.skin = p.skin;
    var l = p.language || 'system';
    if (l === 'system') l = /^zh-(tw|hk|mo|hant)/i.test(navigator.language || '') ? 'zh-Hant' : 'en';
    document.documentElement.lang = l === 'zh-Hant' ? 'zh-Hant' : 'en';
    var v = p.accentVars && p.accentVars[dark ? 'dark' : 'light'];
    if (v && p.accent && p.accent !== 'orange' && (!p.skin || p.skin === 'tickwise')) for (var k in v) document.documentElement.style.setProperty(k, v[k]);
  } catch (e) {}
})();
