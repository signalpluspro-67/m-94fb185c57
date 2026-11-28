/* chart-floatbar.js: a floating, draggable drawing bar on /chart (dark chart_float_draw).
   It shows the tools pinned on the left rail plus the last three tools used. A click calls the
   rail's own setTool (window.__cp.drawBar); the rail stays as it is. Drag it by the handle;
   the place is kept in localStorage (pi_floatbar_pos). The x hides it, and the chart settings
   (Canvas tab) bring it back (pi_floatbar_on). Hidden under 640px: the rail is enough there. */
(function () {
  var KEY_ON = 'pi_floatbar_on', KEY_POS = 'pi_floatbar_pos', KEY_RECENT = 'pi_floatbar_recent';
  var DEFAULT = ['trend-line', 'horizontal-line', 'horizontal-ray', 'fib-retracement', 'rectangle', 'text', 'long-position'];
  var bar = null, wrap = null, recent = [], active = null;

  function store(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function isOn() { return store(KEY_ON) !== '0'; }
  function readRecent() { try { var r = JSON.parse(store(KEY_RECENT) || '[]'); return Array.isArray(r) ? r.slice(0, 3) : []; } catch (e) { return []; } }
  function readPos() { try { var p = JSON.parse(store(KEY_POS) || 'null'); return p && isFinite(p.x) && isFinite(p.y) ? p : null; } catch (e) { return null; } }

  var CSS = '#cp-floatbar{position:absolute;z-index:7;display:flex;align-items:center;gap:2px;padding:3px;max-width:calc(100% - 16px);'
    + 'background:rgb(var(--pi-card));border:1px solid rgb(var(--pi-border));border-radius:0.75rem;box-shadow:0 2px 10px rgb(var(--pi-ink) / .16);user-select:none;-webkit-user-select:none}'
    + '#cp-floatbar .fb-h{cursor:grab;touch-action:none;padding:0.3rem 0.15rem;color:rgb(var(--pi-ink-mute));font-size:0.8125rem;line-height:1;letter-spacing:-2px}'
    + '#cp-floatbar .fb-h:active{cursor:grabbing}'
    + '#cp-floatbar button{border:0;background:transparent;color:rgb(var(--pi-ink-mute));cursor:pointer;min-width:1.7rem;height:1.7rem;padding:0 0.3rem;border-radius:0.5rem;font-size:0.9rem;line-height:1}'
    + '#cp-floatbar button:hover{background:rgb(var(--pi-hover));color:rgb(var(--pi-ink))}'
    + '#cp-floatbar button.on{background:rgb(var(--pi-accent));color:rgb(var(--pi-card))}'
    + '#cp-floatbar .fb-x{font-size:0.75rem;min-width:1.3rem}'
    + '#cp-floatbar .fb-sep{width:1px;align-self:stretch;margin:3px 2px;background:rgb(var(--pi-border))}'
    + '@media (max-width:640px){#cp-floatbar{display:none!important}}';

  function api() { try { return window.__cp && window.__cp.drawBar ? window.__cp.drawBar() : null; } catch (e) { return null; } }

  function toolIds(a) {
    var pins = (a.favs || []).filter(function (t) { return a.name[t]; });
    if (!pins.length) pins = DEFAULT.filter(function (t) { return a.name[t]; });
    recent.forEach(function (t) { if (a.name[t] && pins.indexOf(t) < 0) pins.push(t); });
    return pins;
  }

  function render() {
    if (!bar) return;
    var a = api(); if (!a) return;
    var html = '<span class="fb-h" title="Drag to move the bar">⋮⋮</span>'
      + '<button type="button" data-ft="" title="Cursor. Click a drawing to pick it up.">↖</button><span class="fb-sep"></span>';
    toolIds(a).forEach(function (t) {
      html += '<button type="button" data-ft="' + t + '" title="' + a.name[t] + '">' + (a.icon[t] || '▫') + '</button>';
    });
    html += '<span class="fb-sep"></span><button type="button" class="fb-x" title="Hide this bar. Bring it back in the chart settings." data-fx="1">×</button>';
    bar.innerHTML = html;
    mark();
    place();
  }

  function mark() {
    if (!bar) return;
    Array.prototype.forEach.call(bar.querySelectorAll('[data-ft]'), function (b) {
      var on = (b.getAttribute('data-ft') || null) === active;
      if (on) b.classList.add('on'); else b.classList.remove('on');
    });
  }

  // keep the bar inside the chart area; the first time it sits bottom right, off the candles
  function place() {
    if (!bar || !wrap) return;
    var W = wrap.clientWidth, Hh = wrap.clientHeight, bw = bar.offsetWidth, bh = bar.offsetHeight, p = readPos();
    var x = p ? p.x : W - bw - 80, y = p ? p.y : Hh - bh - 40;
    bar.style.left = Math.max(4, Math.min(x, W - bw - 4)) + 'px';
    bar.style.top = Math.max(4, Math.min(y, Hh - bh - 4)) + 'px';
  }

  function drag(ev) {
    var h = ev.target.closest && ev.target.closest('.fb-h'); if (!h) return;
    ev.preventDefault();
    var x0 = ev.clientX, y0 = ev.clientY, l0 = bar.offsetLeft, t0 = bar.offsetTop, id = ev.pointerId;
    try { h.setPointerCapture(id); } catch (e) {}
    function move(e) {
      if (e.pointerId !== id) return;
      var W = wrap.clientWidth, Hh = wrap.clientHeight;
      bar.style.left = Math.max(4, Math.min(l0 + e.clientX - x0, W - bar.offsetWidth - 4)) + 'px';
      bar.style.top = Math.max(4, Math.min(t0 + e.clientY - y0, Hh - bar.offsetHeight - 4)) + 'px';
    }
    function up(e) {
      if (e.pointerId !== id) return;
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      try { h.releasePointerCapture(id); } catch (e2) {}
      save(KEY_POS, JSON.stringify({ x: bar.offsetLeft, y: bar.offsetTop }));
    }
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  }

  function build() {
    if (bar || !wrap) return;
    if (!document.getElementById('cp-floatbar-css')) {
      var st = document.createElement('style'); st.id = 'cp-floatbar-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    bar = document.createElement('div'); bar.id = 'cp-floatbar';
    bar.addEventListener('pointerdown', drag);
    bar.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('button'); if (!b) return;
      if (b.getAttribute('data-fx')) { setOn(false); return; }
      var a = api(); if (!a) return;
      a.setTool(b.getAttribute('data-ft') || null);   // the rail's own click: same function
    });
    wrap.appendChild(bar);
    render();
    show();
  }

  // the bar shows only while a drawing tool is in hand: the rest of the time the chart stays clear
  function show() { if (bar) bar.style.display = isOn() && active ? '' : 'none'; if (bar && active) place(); }

  function setOn(on) {
    save(KEY_ON, on ? '1' : '0');
    if (on) { build(); if (bar) { render(); show(); } }
    else if (bar) bar.style.display = 'none';
  }

  window.__cpFloatBar = { on: isOn, set: setOn };

  document.addEventListener('cp-tool', function (e) {
    active = e.detail || null;
    var t = active;
    if (t && recent[0] !== t) {
      recent = [t].concat(recent.filter(function (x) { return x !== t; })).slice(0, 3);
      save(KEY_RECENT, JSON.stringify(recent));
      render();
    } else mark();
    show();
  });
  document.addEventListener('cp-rail', function () { if (bar) render(); });   // pins changed on the rail
  window.addEventListener('resize', place);

  function init(n) {
    wrap = document.getElementById('chart-wrap');
    if (!wrap) return;
    if (!api()) { if (n < 40) setTimeout(function () { init(n + 1); }, 250); return; }
    recent = readRecent();
    if (isOn()) build();
    if (window.ResizeObserver) { try { new ResizeObserver(place).observe(wrap); } catch (e) {} }
  }
  init(0);
})();
