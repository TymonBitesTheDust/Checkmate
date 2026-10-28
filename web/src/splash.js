// Takes the start screen (splash-boot.js) away once the app has drawn its first frame. It
// stays up long enough to be seen (a short moment when animations are reduced), then fades.
export function hideSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  const reduced = document.documentElement.dataset.motion === 'reduced';
  const wait = Math.max(0, (reduced ? 350 : 1150) - performance.now());
  requestAnimationFrame(() =>
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), reduced ? 200 : 480);
    }, wait),
  );
}
