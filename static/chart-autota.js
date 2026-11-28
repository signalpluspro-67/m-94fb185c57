/* chart-autota.js: the Auto layer of the chart (dark auto_ta, item 1199).
   One button draws, from about a year of daily bars computed on the server
   (/api/auto-ta, app/autota.py): the trend lines through the swing points
   (three touches or more), the horizontal support and resistance levels, and
   the Fibonacci retracement of the last major leg. They are drawn with the same
   drawing objects as the member's own lines, in a separate "auto" layer that is
   never saved; a line the member keeps (button, drag or restyle) becomes theirs.
   Loads after chart-pro.js and waits for its handle. */
(function () {
  var API = null, H = null, on = false, folded = false, data = null, mine = [], panel = null, btn = null, loadedFor = null;
  var COL = { get res() { return PI_CHART.theme().bad; }, get sup() { return PI_CHART.theme().good; }, get fib() { return PI_CHART.theme().s2; } };   // the house inks, read live

  function tk() { return ((document.getElementById('chart-snap') || {}).dataset || {}).ticker || ''; }
  function fmt(v) { v = +v; return v >= 1000 ? v.toFixed(0) : v >= 10 ? v.toFixed(2) : v.toFixed(3); }
  function remember(v) { try { localStorage.setItem('pi_auto_ta', v ? '1' : '0'); } catch (e) {} }
  function wanted() {
    try { if (/[?&]auto=1\b/.test(location.search)) return true; } catch (e) {}
    try { return localStorage.getItem('pi_auto_ta') === '1'; } catch (e) { return false; }
  }

  function clear() {
    var dm = API.dm(); if (!dm) return;
    mine.forEach(function (x) { var d = x.d; if (!d || !d._auto) return; API.detach(d); try { dm.removeDrawing(d.id); } catch (e) {} });
    mine = [];
  }
  function add(type, anchors, style, extra, note, info) {
    var dm = API.dm(), L = window.LightweightChartsDrawing; if (!dm || !L) return null;
    var reg = L.getToolRegistry(); if (!reg.has(type)) return null;
    var snapped = anchors.map(function (a) { return { time: API.snap(a.time), price: a.price }; });
    var d = reg.createDrawing(type, 'auto_' + type + '_' + mine.length + '_' + Date.now(), snapped, style, extra || {});
    if (!d) return null;
    d._auto = true; d._autoNote = note; d._style = style;
    d._orig = JSON.parse(JSON.stringify(anchors));
    dm.addDrawing(d); API.attach(d);
    var x = { d: d, info: info };
    mine.push(x);
    return x;
  }

  function verb(e) {
    if (!e.status) return '';
    var up = e.side === 'res';
    return e.status === 'break' ? (up ? 'broke above today' : 'broke below today') : (up ? 'tested from below today' : 'tested from above today');
  }

  function draw() {
    clear();
    if (!data) return;
    var last = null; try { var lb = window.__cp.lastBar(); last = lb && lb.time; } catch (e) {}
    (data.lines || []).forEach(function (l) {
      var role = l.side === 'res' ? 'resistance' : 'support';
      add('trend-line', [l.a, l.b], { lineColor: COL[l.side], lineWidth: l.touches >= 4 ? 2 : 1, lineDash: [], showLabels: false, extendRight: true },
          { extendRight: true }, role + ' trend line, ' + l.touches + ' touches',
          { kind: 'Trend line', side: l.side, role: role, touches: l.touches, value: l.value, status: l.status, verb: verb(l), slope: l.slope_pct_month });
    });
    (data.levels || []).forEach(function (l) {
      var role = l.side === 'res' ? 'resistance' : 'support';
      add('horizontal-ray', [l.a], { lineColor: COL[l.side], lineWidth: 1, lineDash: [5, 4], showLabels: false },
          {}, role + ' level, ' + l.touches + ' touches',
          { kind: 'Level', side: l.side, role: role, touches: l.touches, value: l.value, status: l.status, verb: verb(l) });
    });
    var f = data.fib;
    if (f && last) {
      // anchor 0 = where the leg ended (0%), anchor 1 = where it started (100%);
      // the first anchor sits on the last bar so the levels run to today
      add('fib-retracement', [{ time: last, price: f.b.price }, f.a],
          { lineColor: COL.fib, lineWidth: 1, lineDash: [], showLabels: true, labelColor: COL.fib },
          { showPrices: true, showPercentages: true }, 'Fibonacci of the last major leg',
          { kind: 'Fibonacci', fib: f });
    }
    paint();
    render();
  }
  // the library paints a new primitive on the next chart frame; ask for one now
  function paint() {
    mine.forEach(function (x) { try { if (x.d._requestUpdateFn) x.d._requestUpdateFn(); } catch (e) {} });
    try { H.cs.applyOptions({}); } catch (e) {}
    try { var ts = H.chart.timeScale(), r = ts.getVisibleLogicalRange(); if (r) ts.setVisibleLogicalRange({ from: r.from, to: r.to }); } catch (e) {}
  }

  function render() {
    if (!panel) return;
    if (!on) { panel.style.display = 'none'; return; }
    panel.style.display = folded ? 'none' : '';
    if (!data) { panel.innerHTML = '<div class="text-ink-mute">Reading the chart…</div>'; return; }
    var rows = mine.filter(function (x) { return x.d && x.d._auto; });
    var head = '<div class="flex items-center gap-2 mb-1"><span class="font-semibold text-ink">Auto lines</span>'
      + (data.as_of ? '<span class="text-ink-mute" style="font-size:10px">daily bars to ' + data.as_of + '</span>' : '')
      + '<button type="button" data-ax="hide" class="ml-auto text-ink-mute hover:text-ink" title="Fold this list, keep the lines">–</button>'
      + '<button type="button" data-ax="off" class="text-ink-mute hover:text-ink" title="Remove the Auto layer">✕</button></div>';
    if (!rows.length) {
      panel.innerHTML = head + '<div class="text-ink-mute py-1">No line with three touches, no level and no clear leg on this name right now. A name in a fresh trend or with a short history often has none.</div>';
      wire(); return;
    }
    var html = head + rows.map(function (x, i) {
      var t = x.info, idx = mine.indexOf(x);
      if (t.kind === 'Fibonacci') {
        var f = t.fib, dir = f.dir === 'up' ? 'rise' : 'drop';
        var where = f.retraced_pct == null ? '' : f.retraced_pct < 0 ? ', the price now trades past its end'
          : f.retraced_pct > 100 ? ', the price has given all of it back' : ', the price has given back ' + Math.round(f.retraced_pct) + '% of it';
        return '<div class="flex items-start gap-2 py-1 border-t border-sepia-border">'
          + '<span style="width:8px;height:8px;border-radius:2px;margin-top:4px;background:' + COL.fib + ';flex:none"></span>'
          + '<span class="flex-1">Last major ' + dir + ', ' + fmt(f.a.price) + ' to ' + fmt(f.b.price) + ' (' + (f.move_pct > 0 ? '+' : '') + f.move_pct + '%)' + where + '.</span>'
          + '<button type="button" data-keep="' + idx + '" class="text-accent whitespace-nowrap" title="Make it one of your drawings">keep</button></div>';
      }
      var chip = t.status ? '<span class="ml-1 px-1 rounded ' + (t.status === 'break' ? 'bg-accent text-white' : 'border border-sepia-border') + '" style="font-size:10px">' + t.verb + '</span>' : '';
      var sl = t.kind === 'Trend line' && t.slope != null ? ', ' + (t.slope > 0 ? 'rising ' : 'falling ') + Math.abs(t.slope).toFixed(1) + '% a month' : '';
      return '<div class="flex items-start gap-2 py-1 border-t border-sepia-border">'
        + '<span style="width:8px;height:8px;border-radius:2px;margin-top:4px;background:' + COL[t.side] + ';flex:none"></span>'
        + '<span class="flex-1">' + (t.kind === 'Trend line' ? 'Trend line' : 'Level') + ', ' + t.role
        + ' at <span class="nums font-medium">' + fmt(t.value) + '</span>, ' + t.touches + ' touches' + sl + chip + '</span>'
        + '<button type="button" data-keep="' + idx + '" class="text-accent whitespace-nowrap" title="Make it one of your drawings: saved with this name, yours to move">keep</button></div>';
    }).join('')
      + '<div class="flex items-center gap-2 pt-1 border-t border-sepia-border"><button type="button" data-ax="keepall" class="text-accent">Keep them all</button>'
      + '<span class="text-ink-mute" style="font-size:10px">Click a line to restyle or move it; it becomes yours.</span></div>';
    panel.innerHTML = html;
    wire();
  }
  function wire() {
    Array.prototype.forEach.call(panel.querySelectorAll('[data-keep]'), function (b) {
      b.addEventListener('click', function () { var x = mine[+this.getAttribute('data-keep')]; if (x && x.d) API.keep(x.d); render(); });
    });
    var h = panel.querySelector('[data-ax="hide"]'); if (h) h.addEventListener('click', function () { folded = true; render(); });
    var o = panel.querySelector('[data-ax="off"]'); if (o) o.addEventListener('click', function () { toggle(false); });
    var k = panel.querySelector('[data-ax="keepall"]'); if (k) k.addEventListener('click', function () {
      mine.slice().forEach(function (x) { if (x.d && x.d._auto) API.keep(x.d); }); render(); });
  }

  function load() {
    var t = tk(); if (!t) return;
    if (loadedFor === t && data) { draw(); return; }
    data = null; render();
    fetch('/api/auto-ta?t=' + encodeURIComponent(t)).then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { if (!on) return; loadedFor = t; data = j || {}; draw(); })
      .catch(function () { data = {}; render(); });
  }
  function toggle(v) {
    on = v == null ? !on : !!v; remember(on);
    if (!on) folded = false;
    if (btn) API.pill(btn, on);
    if (on) load(); else { clear(); paint(); render(); }
  }

  function boot() {
    if (API) return;
    if (!window.__cp || !window.__cp.auto) return;
    API = window.__cp.auto; H = window.__piChart;
    var host = document.getElementById('cp-replay') || document.getElementById('cp-pal-btn');
    if (!host || !H || !H.el) return;
    btn = document.createElement('button'); btn.type = 'button'; btn.id = 'cp-auto';
    btn.className = 'px-2 py-1 rounded-lg border border-sepia-border text-xs font-medium text-ink-mute hover:text-ink';
    btn.title = 'Auto: trend lines through the swing points, support and resistance levels, and the Fibonacci of the last major leg, drawn for you. Keep any line to make it yours.';
    btn.textContent = 'Auto';
    host.parentNode.insertBefore(btn, host);
    btn.addEventListener('click', function () { if (on && folded) { folded = false; render(); return; } toggle(); });
    panel = document.createElement('div'); panel.id = 'cp-auto-panel';
    panel.className = 'bg-white border border-sepia-border rounded-lg shadow-lg p-2 text-xs';
    panel.style.cssText = 'position:absolute;left:44px;top:3rem;z-index:7;width:min(20rem,calc(100% - 60px));max-height:13rem;overflow:auto;display:none';
    if ((H.el.clientWidth || 999) < 520) { panel.style.left = '8px'; panel.style.width = 'calc(100% - 16px)'; }
    H.el.appendChild(panel);
    document.addEventListener('pi-auto-kept', function () { render(); });
    // a new name or a new timeframe: the anchors are daily dates, redraw them
    try { if (H.onChange) H.onChange(function () { if (on) setTimeout(load, 0); }); } catch (e) {}
    if (wanted()) {
      // on a phone the list would cover the chart: start folded, the button opens it
      folded = (H.el.clientWidth || 999) < 520;
      toggle(true);
    }
  }
  if (window.__cpReady) boot(); else document.addEventListener('pi-cp-ready', boot);
})();
