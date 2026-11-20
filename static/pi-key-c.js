// C on a row of any table (or card) opens its ticker in /chart/{ticker}. Flag chart_fixes2.
// The row is the one under the mouse, else the one holding the focus: the ticker is its
// data-ticker or its /name/XXX link. Typing in a field never triggers it, and /chart keeps its own keys.
(function () {
  if (/^\/chart(\/|$)/.test(location.pathname)) return;
  var last = null, RX = /^\/name\/([A-Za-z0-9.\-]{1,10})(?:[/?#]|$)/;
  document.addEventListener('mouseover', function (e) { last = e.target; }, { passive: true });
  function tickersIn(node) {
    var seen = {}, n = 0, first = null;
    if (node.dataset && node.dataset.ticker) { seen[node.dataset.ticker.toUpperCase()] = 1; n = 1; first = node.dataset.ticker.toUpperCase(); }
    Array.prototype.forEach.call(node.querySelectorAll('[data-ticker],a[href^="/name/"]'), function (a) {
      var t = a.dataset && a.dataset.ticker ? a.dataset.ticker : (RX.exec(a.getAttribute('href') || '') || [])[1];
      if (!t) return; t = t.toUpperCase();
      if (!seen[t]) { seen[t] = 1; n++; if (!first) first = t; }
    });
    return { n: n, first: first };
  }
  function rowTicker(el) {
    for (var node = el; node && node !== document.body && node.nodeType === 1; node = node.parentElement) {
      var own = node.dataset && node.dataset.ticker;
      if (own) return own.toUpperCase();
      if (node.tagName === 'A') { var m = RX.exec(node.getAttribute('href') || ''); if (m) return m[1].toUpperCase(); }
      var r = tickersIn(node);
      if (r.n === 1) return r.first;
      if (r.n > 1) return null;   // grew past one row: the mouse is on blank space between rows
    }
    return null;
  }
  document.addEventListener('keydown', function (e) {
    if ((e.key !== 'c' && e.key !== 'C') || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
    var a = document.activeElement, tag = (a && a.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (a && a.isContentEditable)) return;
    var hov = last && document.body.contains(last) && last.matches && last.matches(':hover') ? last : null;
    var t = (hov && rowTicker(hov)) || (a && a !== document.body && rowTicker(a));
    if (!t) { var m = /^\/name\/([A-Za-z0-9.\-]{1,10})/.exec(location.pathname); t = m && m[1].toUpperCase(); }
    if (!t) return;
    e.preventDefault();
    location.href = '/chart/' + encodeURIComponent(t);
  });
})();
