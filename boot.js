// Setzt Theme & Akzent vor dem ersten Rendern (verhindert Aufblitzen).
(function () {
  var s = {};
  try { s = JSON.parse(localStorage.getItem('hub.settings') || '{}') || {}; } catch (e) {}
  var t = s.theme || 'system';
  if (t === 'system') t = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  var r = document.documentElement;
  r.setAttribute('data-theme', t);
  if (s.accent) r.style.setProperty('--accent', s.accent);
})();
