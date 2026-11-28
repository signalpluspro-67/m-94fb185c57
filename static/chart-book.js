/* Chart book — renderer for /charts. Payload contract: scripts-screener/
   chart_book_daily.py. Series go on Lightweight Charts v5 panes; the drawings
   (segments, labels, arrows, levels, rings, ellipses, vertical lines) are one
   series primitive per (pane, series), in that series' price coordinates.
   Every drawing time is snapped to a bar date by the producer. */
(function () {
  'use strict';
  function alpha(c, a) { var m = String(c).match(/[\d.]+/g); return m && m.length >= 3 ? 'rgba(' + m[0] + ',' + m[1] + ',' + m[2] + ',' + a + ')' : c; }
  // the house inks (pi-chart.js, --pi-* variables): the same colours as every other chart of the app
  var TH = PI_CHART.theme();
  var C = {
    ink: TH.text, mute: TH.mute, good: TH.good, bad: TH.bad, card: TH.card,
    warn: TH.warn, accent: TH.accent, cmp: TH.s2
  };
  C.grid = alpha(C.mute, 0.12); C.axis = alpha(C.mute, 0.25);
  function fmtFor(vals) {
    var m = 0;
    vals.forEach(function (v) { if (v != null && Math.abs(v) > m) m = Math.abs(v); });
    var p = m < 0.1 ? 6 : m < 2 ? 4 : 2;
    return { type: 'price', precision: p, minMove: Math.pow(10, -p) };
  }
  function tone(t) { return t === 'mute' ? alpha(C.mute, 0.75) : (C[t] || C.ink); }

  var data;
  try { data = JSON.parse(document.getElementById('cb-data').textContent); } catch (e) { return; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function waitLW(cb) { var n = 100; (function t() { if (window.LightweightCharts) return cb(); if (--n > 0) setTimeout(t, 80); })(); }
  function pts(t, v) { var out = []; for (var i = 0; i < t.length; i++) if (v[i] != null) out.push({ time: t[i], value: v[i] }); return out; }
  function cpts(s) { var out = []; for (var i = 0; i < s.t.length; i++) if (s.c[i] != null) out.push({ time: s.t[i], open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i] }); return out; }

  /* ---- drawings ---- */
  /* labels never sit on a curve: the box is moved above or below every line of the
     pane over its own width, then away from the labels already drawn */
  function label(ctx, x, y, txt, color, W, taken, dir, span, H) {
    ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
    var w = ctx.measureText(txt).width;
    var lx = Math.max(w / 2 + 3, Math.min(W - w / 2 - 3, x));
    var sp = span ? span(lx - w / 2 - 4, lx + w / 2 + 4) : null;
    var lim = H || 1e9;
    function fit(yy) { return Math.max(13, Math.min(lim - 4, yy)); }
    function onCurve(yy) { return sp && yy - 12 < sp.bot + 3 && yy + 4 > sp.top - 3; }
    function onLabel(yy) { return (taken || []).some(function (r) { return Math.abs(r[0] - lx) < (r[2] + w) / 2 + 4 && Math.abs(r[1] - yy) < 15; }); }
    var tries = sp ? (dir === 'down' ? [y, sp.bot + 17, sp.top - 7] : [y, sp.top - 7, sp.bot + 17]) : [y];
    var best = null;
    for (var i = 0; i < tries.length && best == null; i++) {
      var c = fit(tries[i]);
      if (onCurve(c)) continue;
      var step = sp && c < sp.top ? -15 : 15, n = 0;
      if (!sp) step = dir === 'down' ? 15 : -15;
      while (n++ < 6 && onLabel(c)) c = fit(c + step);
      if (!onCurve(c) && !onLabel(c)) best = c;
    }
    if (best == null) {  /* nowhere clear: keep the first spot, the plate keeps it readable */
      best = fit(y); var k = 0, st = dir === 'down' ? 15 : -15;
      while (k++ < 6 && onLabel(best)) best = fit(best + st);
    }
    y = best;
    if (taken) taken.push([lx, y, w]);
    ctx.fillStyle = alpha(C.card, 0.92);
    ctx.fillRect(lx - w / 2 - 3, y - 11, w + 6, 15);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(txt, lx, y);
  }
  function Drawings(chart, series, anns, curves) {
    var self = this;
    this.chart = chart; this.series = series; this.anns = anns; this.curves = curves || []; this._geo = null;
    this._view = { renderer: function () { return { draw: function (target) {
      target.useMediaCoordinateSpace(function (scope) { self.draw(scope.context, scope.mediaSize); });
    } }; } };
  }
  Drawings.prototype.attached = function (p) { this._req = p && p.requestUpdate; };
  Drawings.prototype.updateAllViews = function () {};
  Drawings.prototype.paneViews = function () { return [this._view]; };
  /* pixel outline of every curve in the pane, cached until the view or the size changes */
  Drawings.prototype.geo = function (W, H) {
    var ts = this.chart.timeScale(), r = ts.getVisibleLogicalRange();
    var key = W + '|' + H + '|' + (r ? r.from.toFixed(1) + ',' + r.to.toFixed(1) : '');
    if (this._geo && this._geo.key === key) return this._geo.list;
    var list = this.curves.map(function (cv) {
      var xs = [], top = [], bot = [];
      for (var i = 0; i < cv.t.length; i++) {
        var x = ts.timeToCoordinate(cv.t[i]);
        if (x == null) continue;
        var a = cv.ser.priceToCoordinate(cv.hi[i]), b = cv.ser.priceToCoordinate(cv.lo[i]);
        if (a == null || b == null) continue;
        xs.push(x); top.push(Math.min(a, b)); bot.push(Math.max(a, b));
      }
      return { x: xs, top: top, bot: bot };
    });
    this._geo = { key: key, list: list };
    return list;
  };
  Drawings.prototype.draw = function (ctx, size) {
    var ts = this.chart.timeScale(), s = this.series, W = size.width, H = size.height, taken = [];
    var geo = this.geo(W, H);
    function span(x0, x1) {  /* highest and lowest pixel of any curve between x0 and x1 */
      var top = Infinity, bot = -Infinity;
      geo.forEach(function (g) {
        var lo = 0, hi = g.x.length;
        while (lo < hi) { var m = (lo + hi) >> 1; if (g.x[m] < x0) lo = m + 1; else hi = m; }
        for (var i = lo; i < g.x.length && g.x[i] <= x1; i++) { if (g.top[i] < top) top = g.top[i]; if (g.bot[i] > bot) bot = g.bot[i]; }
      });
      return top === Infinity ? null : { top: top, bot: bot };
    }
    function X(t) { return ts.timeToCoordinate(t); }
    function Y(v) { return v == null ? null : s.priceToCoordinate(v); }
    if (this.hidden) return;  /* clean chart: the lines and labels switched off */
    ctx.save();
    this.anns.forEach(function (a) {
      var col = tone(a.tone), x, y, x2, y2;
      ctx.setLineDash([]); ctx.strokeStyle = col; ctx.lineWidth = a.w || 1.5;
      if (a.k === 'seg') {
        x = X(a.t1); y = Y(a.v1); x2 = X(a.t2); y2 = Y(a.v2);
        if (x == null || y == null || x2 == null || y2 == null) return;
        if (a.dash) ctx.setLineDash([5, 4]);
        ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      } else if (a.k === 'text') {
        x = X(a.t); y = Y(a.v);
        if (x == null || y == null || x < -4 || x > W + 4) return;  /* an episode left of the view is not pinned to the edge */
        label(ctx, x, a.pos === 'below' ? y + 17 : y - 9, a.text, col, W, taken, a.pos === 'below' ? 'down' : 'up', span, H);
      } else if (a.k === 'arrow') {
        x = X(a.t); y = Y(a.v);
        if (x == null || y == null || x < -4 || x > W + 4) return;
        var up = a.dir === 'up', tip = up ? y + 6 : y - 6, len = 30;
        var tail = up ? Math.min(H - 18, tip + len) : Math.max(18, tip - len);
        ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, tail); ctx.lineTo(x, tip); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 5, tip + (up ? 7 : -7)); ctx.lineTo(x, tip); ctx.lineTo(x + 5, tip + (up ? 7 : -7)); ctx.stroke();
        if (a.text) label(ctx, x, up ? tail + 14 : tail - 4, a.text, col, W, taken, up ? 'down' : 'up', span, H);
      } else if (a.k === 'hline') {
        y = Y(a.v);
        if (y == null) return;
        ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        if (a.text) {
          ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
          var tw = ctx.measureText(a.text).width, ly = y - 5;
          var sp0 = span(0, tw + 14);  /* above the line unless a curve sits there, then below */
          if (sp0 && ly - 11 < sp0.bot + 3 && ly + 3 > sp0.top - 3) ly = y + 13;
          ctx.fillStyle = alpha(C.card, 0.92); ctx.fillRect(4, ly - 11, tw + 6, 14);
          ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.fillText(a.text, 7, ly);
        }
      } else if (a.k === 'ring') {
        x = X(a.t); y = Y(a.v);
        if (x == null || y == null) return;
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 11, 0, 2 * Math.PI); ctx.stroke();
      } else if (a.k === 'ellipse') {
        x = X(a.t1); x2 = X(a.t2); y = Y(a.v1); y2 = Y(a.v2);
        if (x == null || y == null || x2 == null || y2 == null) return;
        ctx.lineWidth = 2; ctx.beginPath();
        ctx.ellipse((x + x2) / 2, (y + y2) / 2, Math.max(8, Math.abs(x2 - x) / 2), Math.max(8, Math.abs(y2 - y) / 2), 0, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (a.k === 'box') {
        x = X(a.t1); x2 = X(a.t2); y = Y(a.v1); y2 = Y(a.v2);
        if (x == null || y == null || x2 == null || y2 == null) return;
        ctx.lineWidth = 2; ctx.strokeRect(Math.min(x, x2) - 4, Math.min(y, y2) - 6, Math.abs(x2 - x) + 8, Math.abs(y2 - y) + 12);
      } else if (a.k === 'vline') {
        x = X(a.t);
        if (x == null) return;
        ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
    });
    ctx.restore();
  };

  /* ---- one chart ---- */
  function render(el, spec, spec0) {
    var LW = window.LightweightCharts;
    var left = spec.panes.some(function (p) { return p.series.some(function (s) { return s.scale === 'left'; }); });
    var num = spec.x === 'num';  /* strikes, maturities, levels: a number axis instead of dates */
    var ch = (num && LW.createOptionsChart ? LW.createOptionsChart : LW.createChart)(el, PI_CHART.opts({
      autoSize: true,
      layout: { panes: { enableResize: false } },
      leftPriceScale: { visible: left },
      timeScale: { rightOffset: 4, minBarSpacing: 0.05 },  /* long daily windows fit whole */
      handleScroll: num ? false : { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: num ? false : { mouseWheel: false, pinch: true, axisPressedMouseMove: { time: true, price: false }, axisDoubleClickReset: { time: true, price: true } },
      crosshair: { mode: 0 }
    }));
    PI_CHART.track(ch, function (t) { C.ink = t.text; C.mute = t.mute; C.good = t.good; C.bad = t.bad; C.card = t.card; C.warn = t.warn; C.accent = t.accent; C.cmp = t.s2; C.grid = alpha(C.mute, 0.12); C.axis = alpha(C.mute, 0.25); });
    el.style.position = 'relative';
    if (!num) el.addEventListener('wheel', function (e) {  /* ctrl or cmd + wheel (and a trackpad pinch) zooms around the pointer */
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      var ts = ch.timeScale(), lr = ts.getVisibleLogicalRange();
      if (!lr) return;
      var at = ts.coordinateToLogical(e.clientX - el.getBoundingClientRect().left);
      if (at == null) at = (lr.from + lr.to) / 2;
      var f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      ts.setVisibleLogicalRange({ from: at - (at - lr.from) * f, to: at + (lr.to - at) * f });
    }, { passive: false });
    var sers = [], logScales = {}, logOK = !num;
    var anchors = [], legend = [], curves = [];
    spec.panes.forEach(function (p, pi) {
      anchors[pi] = []; curves[pi] = [];
      p.series.forEach(function (s) {
        var ov = s.scale === 'overlay';  /* its own hidden scale: a small line under big bars keeps its shape */
        var ser, scale = ov ? 'ov' + pi : s.scale === 'left' ? 'left' : 'right';
        if (s.type === 'candle') {
          ser = ch.addSeries(LW.CandlestickSeries, Object.assign(PI_CHART.candles(), { priceLineVisible: false, priceScaleId: scale, priceFormat: fmtFor(s.c) }), pi);
          ser.setData(cpts(s));
          curves[pi].push({ ser: ser, t: s.t, hi: s.h, lo: s.l });
          legend.push([C.ink, s.label]);
        } else if (s.type === 'hist') {
          ser = ch.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceScaleId: scale, priceFormat: { type: 'volume' } }, pi);
          ser.setData(pts(s.t, s.v).map(function (q, i) {
            var upDay = s.col ? s.col[s.t.indexOf(q.time)] > 0 : q.value >= 0;
            q.color = s.col ? PI_CHART.volume(upDay) : alpha(upDay ? C.good : C.bad, 0.8); return q;
          }));
          legend.push([alpha(C.mute, 0.8), s.label]);
        } else {
          ser = ch.addSeries(LW.LineSeries, { color: tone(s.tone), lineWidth: s.width || 2, priceLineVisible: false, lastValueVisible: s.tone !== 'mute' && !ov, crosshairMarkerVisible: false, priceScaleId: scale, priceFormat: fmtFor(s.v) }, pi);
          ser.setData(pts(s.t, s.v));
          if (ov) { try { ch.priceScale(scale, pi).applyOptions({ scaleMargins: { top: 0.12, bottom: 0.12 } }); } catch (e) {} }
          curves[pi].push({ ser: ser, t: s.t, hi: s.v, lo: s.v });
          if (s.log) { try { ch.priceScale(scale, pi).applyOptions({ mode: 1 }); } catch (e) {} }
          legend.push([tone(s.tone), s.label + (scale === 'left' ? ' (left scale)' : '') + (s.log ? ' (log scale)' : '')]);
        }
        anchors[pi].push(ser);
        sers.push({ ser: ser, label: s.label, candle: s.type === 'candle' });
        if (pi === 0 && !ov) {
          var vv = s.type === 'candle' ? s.l : s.v;
          if (s.log || (vv || []).some(function (x) { return x != null && x <= 0; })) logOK = false;
          logScales[scale] = 1;
        }
      });
    });
    try {
      var H = el.clientHeight, pn = ch.panes();
      spec.panes.forEach(function (p, i) {  /* stretch factors keep each pane's share, whatever the chart height */
        if (pn[i] && spec.panes.length > 1) { if (pn[i].setStretchFactor) pn[i].setStretchFactor(p.h); else pn[i].setHeight(Math.round(H * p.h)); }
      });
    } catch (e) {}
    var groups = {};
    (spec.ann || []).forEach(function (a) {
      var keys = a.k === 'vline' ? spec.panes.map(function (p, i) { return i + '|0'; }) : [(a.p || 0) + '|' + (a.s || 0)];
      keys.forEach(function (k) { (groups[k] = groups[k] || []).push(a); });
    });
    Object.keys(groups).forEach(function (k) {
      var ix = k.split('|'), ser = anchors[+ix[0]] && anchors[+ix[0]][+ix[1]];
      if (ser) {
        var dr = new Drawings(ch, ser, groups[k], curves[+ix[0]]);
        dr.hidden = cleanFor(+el.dataset.b);
        ser.attachPrimitive(dr);
        (prims[+el.dataset.b] = prims[+el.dataset.b] || []).push(dr);
      }
    });
    var tset = {};
    spec.panes.forEach(function (p) { p.series.forEach(function (s) { (s.t || []).forEach(function (x) { tset[x] = 1; }); }); });
    var uniq = Object.keys(tset).sort();  /* every bar on the chart, in the order the time scale indexes them */
    if (num) ch.timeScale().fitContent(); else fitPad(ch, uniq.length);
    if (!num && window.piRecessions && anchors[0] && anchors[0][0]) window.piRecessions(anchors[0][0], uniq);  /* grey recessions, flag recession_bands */
    if (!num && uniq.length) { live.push({ b: +el.dataset.b, ch: ch, times: uniq }); viewLabels(+el.dataset.b, uniq); }
    var lg = document.createElement('div');
    lg.className = 'text-[11px] text-ink-mute mt-1 flex flex-wrap gap-x-3 gap-y-0.5';
    lg.innerHTML = legend.map(function (l) {
      return '<span><span style="display:inline-block;width:10px;height:3px;background:' + l[0] + ';vertical-align:middle;margin-right:4px"></span>' + esc(l[1]) + '</span>';
    }).join('');
    el.parentNode.insertBefore(lg, el.nextSibling);
    var b = +el.dataset.b, extras = [lg];
    var s0 = (spec.panes[0] || { series: [] }).series[0], vmap = {};
    if (s0) (s0.t || []).forEach(function (t, i) { var v = s0.type === 'candle' ? s0.c[i] : s0.v[i]; if (v != null) vmap[t] = v; });
    var item = { ch: ch, el: el, legend: legend, title: spec.title, logOK: logOK, logScales: Object.keys(logScales),
                 spec0: spec0 || spec, extras: extras, num: num, times: uniq, sers: sers, vmap: vmap, s0ser: anchors[0] && anchors[0][0] };
    (reg[b] = reg[b] || []).push(item);
    el.addEventListener('mouseenter', function () { hovered = ch; });
    el.addEventListener('mouseleave', function () { if (hovered === ch) hovered = null; syncCross(b, ch, null); });
    if (!num && uniq.length) {  /* weekly bars are offered on long daily histories */
      var gaps = [], k0 = Math.max(1, uniq.length - 120);
      for (var q = k0; q < uniq.length; q++) gaps.push((new Date(uniq[q].slice(0, 10)) - new Date(uniq[q - 1].slice(0, 10))) / 864e5);
      gaps.sort(function (x, y) { return x - y; });
      var daily = gaps.length && gaps[gaps.length >> 1] <= 4;
      if (weekly[b] || (daily && uniq.length >= 300)) document.querySelectorAll('.cb-tf-wrap[data-b="' + b + '"]').forEach(function (x) { x.style.display = ''; });
    }
    if (logOK) document.querySelectorAll('.cb-log[data-b="' + b + '"]').forEach(function (x) { x.style.display = ''; });
    if (logOn[b] && logOK) setLog(ch, Object.keys(logScales), true);

    /* the date and every value under the pointer */
    var tip = document.createElement('div');
    tip.style.cssText = 'position:absolute;left:6px;top:4px;z-index:4;pointer-events:none;display:none;font:11px system-ui,-apple-system,sans-serif;' +
      'background:' + alpha(C.card, 0.94) + ';border:1px solid ' + C.axis + ';border-radius:6px;padding:3px 7px;color:' + C.ink + ';max-width:70%';
    el.appendChild(tip);
    ch.subscribeCrosshairMove(function (prm) {
      if (!prm || prm.time == null || !prm.point || prm.point.x < 0) { tip.style.display = 'none'; if (hovered === ch) syncCross(b, ch, null); return; }
      var t = prm.time, d = typeof t === 'object' && t.year ? t.year + '-' + ('0' + t.month).slice(-2) + '-' + ('0' + t.day).slice(-2) : String(t);
      if (hovered === ch) syncCross(b, ch, prm.time, d);
      var head = num ? esc(d) : esc(MON[+d.slice(5, 7) - 1] + ' ' + (+d.slice(8, 10)) + ', ' + d.slice(0, 4));
      var parts = sers.map(function (x) {
        var v = prm.seriesData.get(x.ser);
        if (!v) return '';
        var n = x.candle ? v.close : v.value;
        if (n == null) return '';
        var a = Math.abs(n), txt = a >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a >= 10 ? n.toFixed(2) : a >= 1 ? n.toFixed(3) : n.toPrecision(3);
        return '<span style="color:' + C.mute + '">' + esc(x.label) + '</span> <b>' + txt + '</b>';
      }).filter(Boolean);
      tip.innerHTML = '<b>' + head + '</b>' + (parts.length ? ' · ' + parts.join(' · ') : '');
      tip.style.display = '';
    });

    /* every numbered episode on the chart, with what price did next; a click zooms on it */
    if (!num) {
      var eps = episodes(spec);
      if (eps.length >= 2) {
        var row = document.createElement('div');
        row.className = 'text-[11px] mt-1.5 flex flex-wrap items-center gap-1';
        row.innerHTML = '<span class="text-ink-mute mr-1">Episodes</span>' + eps.map(function (e, k) {
          var col = e.mv === 'open' ? C.bad : /^[-−]/.test(e.mv || '') ? C.bad : e.mv ? C.good : C.mute;
          return '<button type="button" data-k="' + k + '" class="cb-ep px-2 py-0.5 rounded-full border border-sepia-border bg-sepia-card hover:border-accent/40">' +
            esc(e.label) + (e.mv ? ' <b style="color:' + col + '">' + (e.mv === 'open' ? 'open' : esc(e.mv)) + '</b>' : '') + '</button>';
        }).join('');
        lg.parentNode.insertBefore(row, lg.nextSibling);
        extras.push(row);
        row.addEventListener('click', function (ev) {
          var bt = ev.target.closest && ev.target.closest('.cb-ep');
          if (!bt) return;
          var e = eps[+bt.dataset.k], lo = 0, hi = uniq.length;
          while (lo < hi) { var m = (lo + hi) >> 1; if (uniq[m] < e.t) lo = m + 1; else hi = m; }
          ch.timeScale().setVisibleLogicalRange({ from: Math.max(0, lo - 90) - 0.5, to: Math.min(uniq.length - 1, lo + 70) + 4 });
          row.querySelectorAll('.cb-ep').forEach(function (x) { x.style.borderColor = ''; });
          bt.style.borderColor = C.accent;
          document.querySelectorAll('.cb-zoom[data-b="' + b + '"]').forEach(function (x) { x.className = 'cb-zoom px-2.5 py-1 rounded-lg border border-sepia-border bg-sepia-card text-ink-mute'; });
        });
      }
    }
  }

  var weekly = {}, cmpSym = {}, cmpData = {}, hovered = null;

  /* one pointer, every chart of the card: the others follow the date under the mouse */
  function syncCross(b, from, time, key) {
    (reg[b] || []).forEach(function (x) {
      if (x.ch === from || x.num) return;
      try {
        var v = time == null ? null : x.vmap[key];
        if (v == null) x.ch.clearCrosshairPosition(); else x.ch.setCrosshairPosition(v, time, x.s0ser);
      } catch (e) {}
    });
  }

  /* weekly bars from the daily ones: a candle's week is open, high, low, close; a line keeps
     the week's last value; bars add up. Drawings move to their week's bar. */
  function wkey(d) { var dt = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); return new Date(dt - ((dt.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); }
  function toWeekly(spec) {
    var lab = {};
    spec.panes.forEach(function (p) { p.series.forEach(function (sr) { (sr.t || []).forEach(function (t) { var k = wkey(t); if (!lab[k] || t > lab[k]) lab[k] = t; }); }); });
    function L(t) { return t == null ? t : (lab[wkey(t)] || t); }
    function last(a, i0, i1) { for (var i = i1; i >= i0; i--) if (a[i] != null) return a[i]; return null; }
    function first(a, i0, i1) { for (var i = i0; i <= i1; i++) if (a[i] != null) return a[i]; return null; }
    function ext(a, i0, i1, hi) { var m = null; for (var i = i0; i <= i1; i++) if (a[i] != null && (m == null || (hi ? a[i] > m : a[i] < m))) m = a[i]; return m; }
    var out = JSON.parse(JSON.stringify(spec));
    out.panes.forEach(function (p) {
      p.series.forEach(function (sr) {
        var groups = [];
        (sr.t || []).forEach(function (t, i) { var k = L(t); var g = groups[groups.length - 1]; if (g && g.t === k) g.i1 = i; else groups.push({ t: k, i0: i, i1: i }); });
        var nt = groups.map(function (g) { return g.t; });
        if (sr.type === 'candle') {
          var o = [], h = [], l = [], c = [];
          groups.forEach(function (g) { o.push(first(sr.o, g.i0, g.i1)); h.push(ext(sr.h, g.i0, g.i1, true)); l.push(ext(sr.l, g.i0, g.i1, false)); c.push(last(sr.c, g.i0, g.i1)); });
          sr.o = o; sr.h = h; sr.l = l; sr.c = c;
        } else if (sr.type === 'hist') {
          sr.v = groups.map(function (g) { var t = 0, any = false; for (var i = g.i0; i <= g.i1; i++) if (sr.v[i] != null) { t += sr.v[i]; any = true; } return any ? t : null; });
          if (sr.col) sr.col = groups.map(function (g) { return last(sr.col, g.i0, g.i1); });
        } else {
          sr.v = groups.map(function (g) { return last(sr.v, g.i0, g.i1); });
        }
        sr.t = nt;
      });
    });
    out.ann = (out.ann || []).map(function (a) {
      var z = Object.assign({}, a);
      ['t', 't1', 't2'].forEach(function (f) { if (z[f] != null) z[f] = L(z[f]); });
      return z;
    });
    return out;
  }
  function rerender(b) {
    var items = reg[b] || [];
    var todo = items.map(function (x) { return { el: x.el, spec: x.spec0 }; });
    items.forEach(function (x) { try { x.ch.remove(); } catch (e) {} (x.extras || []).forEach(function (e) { e.remove(); }); x.el.innerHTML = ''; });
    reg[b] = []; delete prims[b]; delete labelled[b];
    live = live.filter(function (x) { return x.b !== b; });
    todo.forEach(function (o) { try { render(o.el, weekly[b] ? toWeekly(o.spec) : o.spec, o.spec); } catch (e) { o.el.textContent = 'Chart unavailable.'; } });
    document.querySelectorAll('.cb-tf[data-b="' + b + '"]').forEach(function (x) { x.className = 'cb-tf ' + btnCls((x.dataset.tf === 'w') === !!weekly[b]); });
    document.querySelectorAll('.cb-zoom[data-b="' + b + '"]').forEach(function (x) { x.className = 'cb-zoom ' + btnCls(x.dataset.z === 'full'); });
    paintAnn(b);
    if (cmpSym[b]) applyCmp(b);
  }

  /* compare with another market: its closes on their own hidden scale, dashed, over the chart */
  function applyCmp(b) {
    var sym = cmpSym[b];
    (reg[b] || []).forEach(function (x) {
      if (x.cmp) { try { x.ch.removeSeries(x.cmp); } catch (e) {} x.sers = x.sers.filter(function (q) { return q.ser !== x.cmp; }); x.cmp = null; }
      if (x.cmpLg) { x.cmpLg.remove(); x.cmpLg = null; }
    });
    if (!sym) return;
    if (!cmpData[sym]) cmpData[sym] = fetch('/charts/overlay/' + encodeURIComponent(sym), { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
    cmpData[sym].then(function (d) {
      if (cmpSym[b] !== sym) return;
      var byT = {};
      d.t.forEach(function (t, i) { byT[t] = d.v[i]; });
      (reg[b] || []).forEach(function (x) {
        if (x.num || x.cmp) return;
        var pts = [];
        x.times.forEach(function (t) { var v = byT[String(t).slice(0, 10)]; if (v != null) pts.push({ time: t, value: v }); });
        if (pts.length < 10) return;
        var ser = x.ch.addSeries(window.LightweightCharts.LineSeries, { color: C.cmp, lineWidth: 1.5, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceScaleId: 'cmp' }, 0);
        ser.setData(pts);
        try { x.ch.priceScale('cmp', 0).applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } }); } catch (e) {}
        x.cmp = ser;
        x.sers.push({ ser: ser, label: d.label });
        var sp = document.createElement('span');
        sp.innerHTML = '<span style="display:inline-block;width:10px;border-top:2px dashed ' + C.cmp + ';vertical-align:middle;margin-right:4px"></span>' + esc(d.label) + ' (compared, own scale)';
        x.extras[0].appendChild(sp); x.cmpLg = sp;
      });
    }).catch(function () {});
  }
  document.addEventListener('click', function (e) {
    var bt = e.target.closest && e.target.closest('.cb-tf');
    if (!bt) return;
    var b = +bt.dataset.b, w = bt.dataset.tf === 'w';
    if (!!weekly[b] === w) return;
    weekly[b] = w;
    rerender(b);
  });
  document.addEventListener('change', function (e) {
    var sel = e.target.closest && e.target.closest('.cb-cmp');
    if (!sel) return;
    cmpSym[+sel.dataset.b] = sel.value || '';
    applyCmp(+sel.dataset.b);
  });

  function episodes(spec) {
    var ann = spec.ann || [], out = [], seen = {};
    var PCT = /[-+−]?\d+(?:\.\d+)?%/;
    var tx = ann.filter(function (a) { return a.k === 'text' && !(a.p || 0); });
    var hashed = tx.filter(function (a) { return /^#\d+/.test(a.text); });
    if (hashed.length) {
      hashed.forEach(function (h) {
        var i = ann.indexOf(h), mv = null;
        for (var j = i + 1; j < ann.length; j++) {
          var a = ann[j];
          if (a.k !== 'text' || (a.p || 0)) continue;
          if (/^#\d+/.test(a.text)) break;
          if (/now/.test(a.text)) { mv = 'open'; break; }
          var m = a.text.match(PCT);
          if (m) { mv = m[0]; break; }
        }
        var lab = /\d{4}/.test(h.text) ? h.text : h.text + ' ' + String(h.t).slice(0, 4);
        out.push({ t: String(h.t), label: lab, mv: mv });
      });
      tx.forEach(function (a) {  /* a divergence still open, drawn apart from the numbered ones */
        if (/divergence, now/.test(a.text) && !out.some(function (e) { return e.mv === 'open'; })) out.push({ t: String(a.t), label: 'Now, from ' + mon(String(a.t)), mv: 'open' });
      });
    } else {
      tx.forEach(function (a) {
        var t = String(a.t), m = a.text.match(/^(?:then )?([-+−]?\d+(?:\.\d+)?%)$/);
        if (m) out.push({ t: t, label: mon(t), mv: m[1] });
        else if (/divergence, now|now \?/.test(a.text)) out.push({ t: t, label: mon(t), mv: 'open' });
      });
    }
    out.sort(function (x, y) { return x.t < y.t ? -1 : x.t > y.t ? 1 : 0; });
    return out.filter(function (e) { var k = e.t + e.label; if (seen[k]) return false; seen[k] = 1; return true; }).slice(-24);
  }

  /* log scale for the top pane, card by card */
  var logOn = {};
  function setLog(ch, scales, on) {
    scales.forEach(function (sc) { try { ch.priceScale(sc, 0).applyOptions({ mode: on ? 1 : 0 }); } catch (e) {} });
  }
  document.addEventListener('click', function (e) {
    var bt = e.target.closest && e.target.closest('.cb-log');
    if (!bt) return;
    var b = +bt.dataset.b;
    logOn[b] = !logOn[b];
    (reg[b] || []).forEach(function (x) { if (x.logOK) setLog(x.ch, x.logScales, logOn[b]); });
    document.querySelectorAll('.cb-log[data-b="' + b + '"]').forEach(function (x) {
      x.className = 'cb-log px-2.5 py-1 rounded-lg border ' + (logOn[b] ? 'border-accent/30 bg-accent/10 text-accent font-semibold' : 'border-sepia-border bg-sepia-card text-ink-mute');
    });
  });

  var live = [], prims = {}, reg = {};
  var CLEAN_KEY = 'cb-clean', cleanAll = false, cleanOne = {};
  try { cleanAll = localStorage.getItem(CLEAN_KEY) === '1'; } catch (e) {}
  function cleanFor(b) { return b in cleanOne ? cleanOne[b] : cleanAll; }
  function paintAnn(b) {
    var off = cleanFor(b);
    (prims[b] || []).forEach(function (d) { d.hidden = off; if (d._req) d._req(); });
    document.querySelectorAll('.cb-ann[data-b="' + b + '"]').forEach(function (btn) {
      var on = (btn.dataset.a === 'off') === off;
      btn.className = 'cb-ann px-2.5 py-1 rounded-lg border ' + (on ? 'border-accent/30 bg-accent/10 text-accent font-semibold' : 'border-sepia-border bg-sepia-card text-ink-mute');
    });
  }
  function setClean(v) {
    cleanAll = v; cleanOne = {};
    try { localStorage.setItem(CLEAN_KEY, v ? '1' : '0'); } catch (e) {}
    document.querySelectorAll('.cb-ann[data-a="on"]').forEach(function (btn) { paintAnn(+btn.dataset.b); });
  }
  function day(d) { return d.toISOString().slice(0, 10); }
  /* show bars [i0, n-1] and leave ~7% of the width empty after the last one, so the latest
     move never sits glued to the price scale */
  function showFrom(ch, i0, n) {
    ch.timeScale().setVisibleLogicalRange({ from: i0 - 0.5, to: n - 1 + Math.max(2, (n - i0) * 0.075) });
  }
  function fitPad(ch, n) { if (n) showFrom(ch, 0, n); else ch.timeScale().fitContent(); }
  function recentFrom(x) {  /* the last quarter of the history, never less than 18 months */
    var ts = x.times, n = ts.length, last = new Date(ts[n - 1].slice(0, 10) + 'T00:00:00Z');
    var span = (last - new Date(ts[0].slice(0, 10) + 'T00:00:00Z')) / 864e5;
    var cut = day(new Date(last - Math.max(540, span * 0.25) * 864e5));
    var lo = 0, hi = n;
    while (lo < hi) { var m = (lo + hi) >> 1; if (ts[m] < cut) lo = m + 1; else hi = m; }
    return lo;
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function mon(d) { return MON[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4); }
  /* each view button says what it shows; Recent hides when it would show the same as the full view */
  var labelled = {};
  function viewLabels(b, ts) {
    if ((labelled[b] || 0) >= ts.length) return;
    labelled[b] = ts.length;
    var r = recentFrom({ times: ts });
    document.querySelectorAll('.cb-zoom[data-b="' + b + '"]').forEach(function (btn) {
      if (btn.dataset.z === 'full') btn.textContent = 'Full history · since ' + mon(ts[0]);
      else { btn.textContent = 'Recent · since ' + mon(ts[r]); btn.style.display = r < ts.length * 0.15 ? 'none' : ''; }
    });
  }
  function zoom(b, z) {
    live.forEach(function (x) {
      if (x.b !== b) return;
      showFrom(x.ch, z === 'full' ? 0 : recentFrom(x), x.times.length);
    });
    document.querySelectorAll('.cb-zoom[data-b="' + b + '"]').forEach(function (btn) {
      var on = btn.dataset.z === z;
      btn.className = 'cb-zoom px-2.5 py-1 rounded-lg border ' + (on ? 'border-accent/30 bg-accent/10 text-accent font-semibold' : 'border-sepia-border bg-sepia-card text-ink-mute');
    });
  }
  var box = document.getElementById('cb-clean');
  if (box) { box.checked = cleanAll; box.addEventListener('change', function () { setClean(box.checked); }); }
  else cleanAll = false;  /* the page-wide toggle is gone (26/10): a stored « clean » no longer hides drawings */
  document.querySelectorAll('.cb-ann[data-a="on"]').forEach(function (btn) { paintAnn(+btn.dataset.b); });
  document.addEventListener('click', function (e) {
    var ab = e.target.closest && e.target.closest('.cb-ann');
    if (ab) { cleanOne[+ab.dataset.b] = ab.dataset.a === 'off'; paintAnn(+ab.dataset.b); return; }
    var btn = e.target.closest && e.target.closest('.cb-zoom');
    if (btn) zoom(+btn.dataset.b, btn.dataset.z);
  });
  /* the page carries only the chart ids; each card's series arrive when it nears the screen */
  var got = {};
  function load(b) {
    if (!got[b]) got[b] = fetch('/charts/data/' + encodeURIComponent(data[b]), { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
    return got[b];
  }

  /* ---- image: the card's charts, drawings included, with its title and read, as one PNG ---- */
  function wrap(ctx, txt, maxW) {
    var words = String(txt || '').split(' '), lines = [], cur = '';
    words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur);
    return lines.slice(0, 2);
  }
  function snap(b, meta) {
    var items = reg[b] || [];
    if (!items.length) return;
    var shots = items.map(function (x) { return { c: x.ch.takeScreenshot(), x: x }; });
    var r = shots[0].c.width / Math.max(1, shots[0].x.el.clientWidth) || 1;
    var cols = shots.length > 1 ? 2 : 1, pad = 24 * r, gap = 18 * r;
    var cw = Math.max.apply(null, shots.map(function (s) { return s.c.width; }));
    var sub = shots.length > 1 ? 20 * r : 0, legH = 24 * r;
    var rowsH = [];
    for (var i = 0; i < shots.length; i += cols) {
      var h = 0;
      for (var j = i; j < Math.min(shots.length, i + cols); j++) h = Math.max(h, shots[j].c.height);
      rowsH.push(sub + h + legH);
    }
    var W = pad * 2 + cols * cw + (cols - 1) * gap;
    var tmp = document.createElement('canvas').getContext('2d');
    tmp.font = '600 ' + (16 * r) + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    var stLines = wrap(tmp, meta.status, W - pad * 2);
    var head = pad + 30 * r + stLines.length * 22 * r + 10 * r, foot = 34 * r;
    var H = head + rowsH.reduce(function (a, v) { return a + v + gap; }, 0) - gap + foot;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = C.card; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillStyle = C.ink; ctx.font = '700 ' + (24 * r) + 'px "Source Serif 4", Georgia, serif';
    ctx.fillText(meta.title || '', pad, pad + 22 * r);
    ctx.font = '600 ' + (16 * r) + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = meta.tone === 'bad' ? C.bad : meta.tone === 'good' ? C.good : C.ink;
    stLines.forEach(function (l, k) { ctx.fillText(l, pad, pad + 30 * r + (k + 1) * 22 * r - 4 * r); });
    var y = head;
    for (var ri = 0; ri < rowsH.length; ri++) {
      for (var ci = 0; ci < cols; ci++) {
        var s = shots[ri * cols + ci];
        if (!s) continue;
        var x = pad + ci * (cw + gap), yy = y;
        if (sub) { ctx.fillStyle = C.mute; ctx.font = '600 ' + (12 * r) + 'px system-ui, sans-serif'; ctx.fillText(String(s.x.title || '').toUpperCase(), x, yy + 13 * r); yy += sub; }
        ctx.drawImage(s.c, x, yy);
        var lx = x, ly = yy + s.c.height + 16 * r;
        ctx.font = (12 * r) + 'px system-ui, sans-serif';
        s.x.legend.forEach(function (l) {
          ctx.fillStyle = l[0]; ctx.fillRect(lx, ly - 6 * r, 10 * r, 3 * r);
          ctx.fillStyle = C.mute; ctx.fillText(l[1], lx + 14 * r, ly);
          lx += 14 * r + ctx.measureText(l[1]).width + 14 * r;
        });
      }
      y += rowsH[ri] + gap;
    }
    ctx.fillStyle = C.mute; ctx.font = '600 ' + (12 * r) + 'px system-ui, sans-serif';
    var e = meta.eod || '', eodTxt = e ? MON[+e.slice(5, 7) - 1] + ' ' + (+e.slice(8, 10)) + ', ' + e.slice(0, 4) + ' close' : '';
    ctx.fillText('The Philosopher Investor' + (eodTxt ? ' · ' + eodTxt : ''), pad, H - 13 * r);
    var a = document.createElement('a');
    a.download = (data[b] || 'chart') + (meta.eod ? '-' + meta.eod : '') + '.png';
    a.href = cv.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
  }
  function cardMeta(el) {
    return { title: el.dataset.title, status: el.dataset.status, tone: el.dataset.tone, eod: document.getElementById('cb-data').dataset.eod };
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.cb-img');
    if (!btn) return;
    var b = +btn.dataset.b, host = btn.closest('[data-title]');
    if (host) snap(b, cardMeta(host));
  });

  /* ---- pop-up: the overview table opens one chart over the page, full size ---- */
  function ensureLW(cb) {
    if (window.LightweightCharts) return cb();
    var src = document.getElementById('cb-data').dataset.lw;
    if (src && !document.getElementById('cb-lw')) {
      var sc = document.createElement('script'); sc.id = 'cb-lw'; sc.src = src; sc.async = true; document.head.appendChild(sc);
    }
    waitLW(cb);
  }
  function closeModal() {
    var ov = document.getElementById('cb-modal');
    if (!ov) return;
    var b = +ov.dataset.b;
    (reg[b] || []).forEach(function (x) { try { x.ch.remove(); } catch (e) {} });
    delete reg[b]; delete prims[b]; delete labelled[b]; delete cleanOne[b]; delete logOn[b]; delete weekly[b]; delete cmpSym[b];
    live = live.filter(function (x) { return x.b !== b; });
    ov.remove();
    document.body.style.overflow = '';
  }
  function cmpSelect(b) {
    var opts = document.getElementById('cb-cmp-opts');
    return opts ? '<select class="cb-cmp rounded-lg border border-sepia-border bg-sepia-card text-ink-mute px-2 py-1" data-b="' + b + '" title="Lay another market over the chart, on its own scale">' + opts.innerHTML + '</select>' : '';
  }
  function btnCls(on) { return 'px-2.5 py-1 rounded-lg border ' + (on ? 'border-accent/30 bg-accent/10 text-accent font-semibold' : 'border-sepia-border bg-sepia-card text-ink-mute'); }
  function openModal(row) {
    var b = +row.dataset.b;
    ensureLW(function () {
      closeModal();
      var tc = row.dataset.tone === 'bad' ? 'text-bad' : row.dataset.tone === 'good' ? 'text-good' : 'text-ink';
      var ov = document.createElement('div');
      ov.id = 'cb-modal'; ov.dataset.b = b; ov.setAttribute('data-title', row.dataset.title);
      ov.dataset.status = row.dataset.status; ov.dataset.tone = row.dataset.tone;
      ov.style.cssText = 'position:fixed;inset:0;z-index:60;background:rgba(20,18,14,0.55);display:flex;align-items:flex-start;justify-content:center;padding:3vh 12px;overflow:auto';
      ov.innerHTML = '<div class="bg-sepia-card border border-sepia-border rounded-xl p-4 sm:p-5 w-full" style="max-width:72rem">' +
        '<div class="flex items-start justify-between gap-3"><div><div class="font-serif text-xl font-bold text-ink leading-tight">' + esc(row.dataset.title) + '</div>' +
        '<div class="text-[0.7rem] text-ink-mute">' + esc(row.dataset.family) + '</div></div>' +
        '<button type="button" class="cb-close text-2xl leading-none text-ink-mute hover:text-ink px-2" aria-label="Close">×</button></div>' +
        (row.dataset.status ? '<p class="mt-2 text-base font-semibold ' + tc + '">' + esc(row.dataset.status) + '</p>' : '') +
        '<div class="mt-3 flex flex-wrap items-center gap-1.5 text-xs">' +
        '<span class="text-ink-mute mr-1">View</span><button type="button" class="cb-zoom ' + btnCls(true) + '" data-b="' + b + '" data-z="full">Full history</button>' +
        '<button type="button" class="cb-zoom ' + btnCls(false) + '" data-b="' + b + '" data-z="recent">Recent</button><span class="mx-2 text-ink-mute/40">|</span>' +
        '<span class="text-ink-mute mr-1">Drawings</span><button type="button" class="cb-ann ' + btnCls(true) + '" data-b="' + b + '" data-a="on">On</button>' +
        '<button type="button" class="cb-ann ' + btnCls(false) + '" data-b="' + b + '" data-a="off">Off</button><span class="mx-2 text-ink-mute/40">|</span>' +
        '<span class="cb-tf-wrap inline-flex items-center gap-1.5" data-b="' + b + '" style="display:none"><button type="button" class="cb-tf ' + btnCls(true) + '" data-b="' + b + '" data-tf="d">Daily</button>' +
        '<button type="button" class="cb-tf ' + btnCls(false) + '" data-b="' + b + '" data-tf="w">Weekly</button><span class="mx-2 text-ink-mute/40">|</span></span>' +
        cmpSelect(b) +
        '<button type="button" class="cb-log ' + btnCls(false) + '" data-b="' + b + '" style="display:none">Log scale</button>' +
        '<button type="button" class="cb-img ' + btnCls(false) + '" data-b="' + b + '">⬇ Image</button>' +
        '<a href="?fam=' + encodeURIComponent(row.dataset.family) + '#' + encodeURIComponent(data[b]) + '" class="ml-auto text-accent font-semibold">Open with the full read →</a></div>' +
        '<div class="cb-mbody mt-2">Loading…</div></div>';
      document.body.appendChild(ov);
      document.body.style.overflow = 'hidden';
      ov.addEventListener('click', function (e) { if (e.target === ov || (e.target.closest && e.target.closest('.cb-close'))) closeModal(); });
      load(b).then(function (charts) {
        var body = ov.querySelector('.cb-mbody');
        body.textContent = '';
        if (charts && charts.length > 1) body.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px';
        if (charts && charts.every(function (c) { return c.x === 'num'; })) ov.querySelectorAll('.cb-zoom').forEach(function (x) { x.style.display = 'none'; });
        (charts || []).forEach(function (spec, c) {
          var cell = document.createElement('div'); cell.className = 'min-w-0';
          if (charts.length > 1) cell.innerHTML = '<div class="text-[0.7rem] uppercase tracking-wide text-ink-mute font-semibold mb-1">' + esc(spec.title) + '</div>';
          var el = document.createElement('div'); el.className = 'w-full'; el.dataset.b = b; el.dataset.c = c;
          el.style.height = Math.max(spec.height || 300, charts.length > 1 ? 280 : 480) + 'px';
          cell.appendChild(el); body.appendChild(cell);
          try { render(el, spec); } catch (e) { el.textContent = 'Chart unavailable.'; }
        });
        paintAnn(b);
      }).catch(function () { ov.querySelector('.cb-mbody').textContent = 'Chart unavailable.'; });
    });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  document.querySelectorAll('.cb-mini').forEach(function (td) {
    td.addEventListener('click', function (e) { e.stopPropagation(); openModal(td.closest('tr')); });
  });

  waitLW(function () {
    function draw(el) {
      if (el.dataset.drawn) return;
      el.dataset.drawn = '1';
      var b = +el.dataset.b, c = +el.dataset.c;
      load(b).then(function (charts) {
        var spec = charts && charts[c];
        if (spec) { try { render(el, spec, spec); } catch (e) { el.textContent = 'Chart unavailable.'; } }
      }).catch(function () { el.textContent = 'Chart unavailable.'; });
    }
    var els = document.querySelectorAll('.cb-chart');
    if (!('IntersectionObserver' in window)) { els.forEach(draw); return; }
    /* dozens of charts on one page: draw each one as it nears the screen */
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); draw(en.target); } });
    }, { rootMargin: '800px 0px' });
    els.forEach(function (el) { io.observe(el); });
  });
})();

/* the ask box answers as you type: the rows or cards on the page filter live, and a short list
   jumps to matching charts in other families; Enter still asks the page for its full answer */
(function () {
  var box = document.getElementById('cb-ask'), idxEl = document.getElementById('cb-index');
  if (!box || !idxEl) return;
  var idx = []; try { idx = JSON.parse(idxEl.textContent || '[]'); } catch (e) {}
  var sug = document.getElementById('cb-suggest'), cnt = document.getElementById('cb-count');
  var here = new URLSearchParams(location.search).get('fam') || '';
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function run() {
    var words = box.value.trim().toLowerCase().split(/\s+/).filter(function (w) { return w.length >= 2; });
    var hit = {}, list = [];
    if (words.length) idx.forEach(function (c) {
      if (words.every(function (w) { return c.w.indexOf(w) >= 0; })) { hit[c.id] = 1; list.push(c); }
    });
    document.querySelectorAll('.cb-card').forEach(function (el) {
      var id = el.dataset.id || el.id;
      el.style.display = !words.length || hit[id] ? '' : 'none';
    });
    if (cnt) {
      cnt.classList.toggle('hidden', !words.length);
      cnt.textContent = !words.length ? '' : list.length ? list.length + ' chart' + (list.length > 1 ? 's' : '') + ' match. Press Enter for the full page.' : 'Nothing matches yet. Try breadth, sentiment, rates, the dollar, gold or divergence.';
    }
    var away = here ? list.filter(function (c) { return c.f !== here; }) : [];
    if (!sug) return;
    if (!words.length || !away.length) { sug.classList.add('hidden'); sug.innerHTML = ''; return; }
    sug.innerHTML = '<div class="px-3 py-1.5 text-[0.7rem] uppercase tracking-wide text-ink-mute border-b border-sepia-border">In other families</div>' +
      away.slice(0, 8).map(function (c) {
        return '<a href="/charts?fam=' + encodeURIComponent(c.f) + '#' + encodeURIComponent(c.id) + '" class="flex items-baseline justify-between gap-3 px-3 py-1.5 hover:bg-sepia-hover">' +
          '<span class="text-ink font-semibold">' + (c.k ? '<span class="text-bad">●</span> ' : '') + esc(c.t) + '</span>' +
          '<span class="text-[0.7rem] text-ink-mute whitespace-nowrap">' + esc(c.f) + '</span></a>';
      }).join('');
    sug.classList.remove('hidden');
  }
  box.addEventListener('input', run);
  box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { box.value = ''; run(); } });
  document.addEventListener('click', function (e) { if (sug && !sug.contains(e.target) && e.target !== box) sug.classList.add('hidden'); });
  box.addEventListener('focus', function () { if (box.value.trim()) run(); });
})();


/* the overview table sorts on a click of a column title; blank cells stay at the bottom both ways */
(function () {
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function key(tr, k) {
    var v = tr.dataset[k] || '';
    if (k === 't') return (tr.dataset.title || '').toLowerCase();
    if (k === 'since') {
      var m = v.toLowerCase().match(/([a-z]{3})?\s*(\d{4})/);
      return m ? +m[2] * 100 + (m[1] ? MON[m[1]] || 0 : 0) : null;
    }
    return v === '' ? null : +v;
  }
  document.querySelectorAll('th.cb-sort').forEach(function (th) {
    th.addEventListener('click', function () {
      var tbody = th.closest('table').querySelector('tbody'), k = th.dataset.key;
      var dir = th.dataset.cur === 'desc' ? 'asc' : th.dataset.cur === 'asc' ? 'desc' : (th.dataset.dir || 'desc');
      document.querySelectorAll('th.cb-sort').forEach(function (o) { o.dataset.cur = ''; o.classList.remove('text-accent'); o.querySelector('.cb-caret').textContent = ''; });
      th.dataset.cur = dir; th.classList.add('text-accent'); th.querySelector('.cb-caret').textContent = dir === 'asc' ? '▲' : '▼';
      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      rows.sort(function (a, b) {
        var x = key(a, k), y = key(b, k);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        var c = x < y ? -1 : x > y ? 1 : 0;
        return dir === 'asc' ? c : -c;
      });
      rows.forEach(function (r) { tbody.appendChild(r); });
    });
  });
})();


/* pinned charts: a star keeps a chart at the top of the table, saved in this browser */
(function () {
  var KEY = 'cb-pins', pins = [];
  try { pins = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(pins)); } catch (e) {} }
  function paint() {
    document.querySelectorAll('.cb-pin').forEach(function (bt) {
      var on = pins.indexOf(bt.dataset.id) >= 0, word = bt.textContent.indexOf('Pin') >= 0;
      bt.textContent = (on ? '★' : '☆') + (word ? (on ? ' Pinned' : ' Pin') : '');
      bt.style.color = on ? C.warn : '';
    });
    var tbody = document.querySelector('tr.cb-card') && document.querySelector('tr.cb-card').parentNode;
    if (!tbody) return;
    pins.slice().reverse().forEach(function (id) {
      var tr = tbody.querySelector('tr[data-id="' + id + '"]');
      if (tr) tbody.insertBefore(tr, tbody.firstChild);
    });
  }
  document.addEventListener('click', function (e) {
    var bt = e.target.closest && e.target.closest('.cb-pin');
    if (!bt) return;
    e.stopPropagation(); e.preventDefault();
    var id = bt.dataset.id, i = pins.indexOf(id);
    if (i >= 0) pins.splice(i, 1); else pins.push(id);
    save(); paint();
  }, true);
  paint();
})();
