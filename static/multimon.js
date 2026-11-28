/* multimon.js: pop-out windows for several monitors (flag multi_monitor).
   - [data-popout] opens the current view in its own bare window (?bare=1).
   - BroadcastChannel 'pi-link': a click on a ticker link anywhere tells every open
     /chart/<T> window to switch to <T>. The chart has no in-page switch (a ticker
     is a page), so the receiver goes to /chart/<T> with location.replace.
   - A bare window keeps its url + screen rect in localStorage 'pi_popouts';
     [data-popout-restore] reopens the ones that are no longer open.
   Every storage and channel call is wrapped: a private window must not break a page. */
(function () {
  'use strict';
  var tag = document.querySelector('script[data-mm]');
  if (!tag || window.piLink) return;
  var qs = new URLSearchParams(location.search);
  if (qs.get('embed') === '1') return;             // a cell inside a layout stays out of it
  var BARE = tag.getAttribute('data-bare') === '1';
  var KEY = 'pi_popouts', MAX = 8, BEAT = 10000, ALIVE = 30000;
  var TK = /^[A-Za-z0-9.\-:]{1,24}$/;
  var CH = null;
  try { CH = new BroadcastChannel('pi-link'); } catch (e) { CH = null; }
  if (BARE && !/^pi-pop-/.test(window.name)) window.name = 'pi-pop-' + rnd();
  var ME = /^pi-pop-/.test(window.name) ? window.name : 'pi-win-' + rnd();
  var CM = /^\/chart\/([^\/]+)\/?$/.exec(location.pathname);
  var CHART = CM ? safeDecode(CM[1]) : null;       // the ticker this window charts, or null

  function rnd() { return Math.random().toString(36).slice(2, 8); }
  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function send(m) { try { if (CH) CH.postMessage(m); } catch (e) {} }
  function say(msg) { try { if (window.toast) window.toast(msg); } catch (e) {} }

  function tickerOf(href) {
    try {
      var u = new URL(href, location.href);
      if (u.origin !== location.origin) return null;
      var m = /^\/(?:name|chart)\/([^\/]+)\/?$/.exec(u.pathname);
      var t = m ? safeDecode(m[1]) : null;
      return t && TK.test(t) ? t : null;
    } catch (e) { return null; }
  }
  function bareUrl(href) {
    try {
      var u = new URL(href, location.href);
      if (u.origin !== location.origin) return href;
      u.searchParams.set('bare', '1');
      return u.pathname + u.search + u.hash;
    } catch (e) { return href; }
  }
  function announce(t) { if (t) send({ type: 'ticker', t: t, from: ME }); }

  // ---- receive: a chart window follows the ticker somebody clicked ----
  var pending = {};
  if (CH) CH.onmessage = function (ev) {
    var m = ev && ev.data;
    if (!m || m.from === ME) return;
    if (m.type === 'ack' && m.nonce && pending[m.nonce]) { pending[m.nonce].acked = true; return; }
    if (m.type !== 'ticker' || !CHART || typeof m.t !== 'string' || !TK.test(m.t)) return;
    if (m.nonce) send({ type: 'ack', nonce: m.nonce, from: ME });
    if (m.t.toLowerCase() !== CHART.toLowerCase())
      location.replace('/chart/' + encodeURIComponent(m.t) + (BARE ? '?bare=1' : ''));
  };

  // ---- the registry of pop-outs ----
  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v.filter(function (e) { return e && typeof e.id === 'string' && typeof e.url === 'string'; }) : [];
    } catch (e) { return []; }
  }
  function alive(e) { return !!e.open && Date.now() - (e.ts || 0) < ALIVE; }
  function save(list) {
    try {
      var live = list.filter(alive), dead = list.filter(function (e) { return !alive(e); });
      localStorage.setItem(KEY, JSON.stringify(live.concat(dead.slice(-Math.max(0, MAX - live.length)))));
    } catch (e) {}
  }
  function rect(e) {
    e.x = window.screenX; e.y = window.screenY; e.w = window.outerWidth; e.h = window.outerHeight;
  }
  function beat(open) {
    if (!BARE) return;
    try {
      var url = location.pathname + location.search, list = load(), me = null;
      list.forEach(function (e) { if (e.id === ME) me = e; });
      if (!me) {
        list = list.filter(function (e) { return alive(e) || e.url !== url; });   // one closed twin at most
        me = { id: ME }; list.push(me);
      }
      me.url = url; me.open = open; me.ts = Date.now();
      rect(me);
      save(list);
    } catch (e) {}
  }

  // ---- open / restore ----
  function feat(r) {
    var w = (r && r.w > 300) ? r.w : 1200, h = (r && r.h > 250) ? r.h : 800, s = 'popup=yes,width=' + w + ',height=' + h;
    if (r && isFinite(r.x) && isFinite(r.y)) s += ',left=' + r.x + ',top=' + r.y;
    return s;
  }
  function popOut(url, name, r) {
    var w = null;
    try { w = window.open(bareUrl(url), name || 'pi-pop-' + rnd(), feat(r)); } catch (e) { w = null; }
    if (!w) say('Allow pop-ups for this site to open a window.');
    return w;
  }
  function restore() {
    var n = 0, blocked = false;
    load().forEach(function (e) {
      if (alive(e) || e.id === ME) return;
      if (popOut(e.url, e.id, e)) n++; else blocked = true;
    });
    if (!n && !blocked) say('No saved layout yet. Pop out a view first.');
    setTimeout(syncRestore, 800);
  }
  function syncRestore() {
    var any = load().some(function (e) { return !alive(e); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-popout-restore]'), function (b) { b.style.display = any ? '' : 'none'; });
  }

  // a ticker clicked in a pop-out board: if no chart window answers, open one
  function followOrOpen(t) {
    var nonce = rnd() + Date.now(), p = pending[nonce] = { acked: false };
    send({ type: 'ticker', t: t, from: ME, nonce: nonce });
    setTimeout(function () {
      delete pending[nonce];
      if (!p.acked) popOut('/chart/' + encodeURIComponent(t), 'pi-pop-chart', { x: window.screenX + 60, y: window.screenY + 60 });
    }, 350);
  }

  document.addEventListener('click', function (ev) {
    try {
      var el = ev.target && ev.target.closest ? ev.target : null;
      if (!el) return;
      var po = el.closest('[data-popout]');
      if (po) { ev.preventDefault(); popOut(location.pathname + location.search, null, { x: window.screenX + 60, y: window.screenY + 60, w: 1200, h: 800 }); return; }
      if (el.closest('[data-popout-restore]')) { ev.preventDefault(); restore(); return; }
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      var a = el.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      var t = tickerOf(a.getAttribute('href'));
      if (t && BARE && !CHART) { ev.preventDefault(); followOrOpen(t); return; }   // a pop-out board stays put
      if (t) announce(t);
      var h = a.getAttribute('href') || '';
      if (BARE && h.charAt(0) !== '#') a.setAttribute('href', bareUrl(h));         // stay bare when navigating
    } catch (e) {}
  }, true);

  // the keyboard walk in chart-pro.js calls this before it navigates
  window.piLink = {
    announce: announce,
    nav: function (url) {
      var t = tickerOf(url);
      announce(t);
      if (t && CHART) url = '/chart/' + encodeURIComponent(t);
      return BARE ? bareUrl(url) : url;
    }
  };

  if (BARE) {
    beat(true);
    setInterval(function () { beat(true); }, BEAT);
    window.addEventListener('resize', function () { beat(true); });
    window.addEventListener('pagehide', function () { beat(false); });
  }
  window.addEventListener('storage', function (ev) { if (ev.key === KEY) syncRestore(); });
  syncRestore();
})();
