/* KLCharts — shared client renderer for the ChartSpec contract
   (scripts-screener/lib/kerberos_lab/__init__.py). Used by Signal Lab
   (kerberos-lab.js) and the Volatility page (volatility.js). One generic
   multi-pane Lightweight Charts v5 renderer covers osc_over_price, pair_zscore,
   corr_panel, cot_panel, equity_curve and the history panes of the others;
   tables, heatmaps and the term-structure curve are plain HTML/SVG.
   Palette = the app's own tokens read from #kl-probe spans, so dark mode follows. */
(function () {
  'use strict';
  'use strict';
  /* palette = the app's own tokens, read from probe spans so dark mode follows */
  function alpha(c, a) { var m = String(c).match(/\d+/g); return m && m.length >= 3 ? 'rgba(' + m[0] + ',' + m[1] + ',' + m[2] + ',' + a + ')' : c; }
  var INK, MUTE, ACCENT, GOOD, BAD, WARN, S2, S3, TONE, LEVEL, GRID, AXIS;
  function refreshTone() {  /* re-read the app tokens: a theme toggle repaints the next chart */
    var t = PI_CHART.theme();   /* the house inks (pi-chart.js): same recipe as every chart of the app */
    INK = t.text; MUTE = t.mute; ACCENT = t.accent; GOOD = t.good; BAD = t.bad; WARN = t.warn; S2 = t.s2; S3 = t.s3;
    TONE = { ink: INK, mute: alpha(MUTE, 0.45), accent: INK, on: BAD, good: GOOD, bad: BAD, warn: WARN, blue: S2, purple: alpha(S3, 0.9) };
    LEVEL = BAD; GRID = t.grid; AXIS = t.border;
  }
  refreshTone();
  var charts = [];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(v) { if (v == null || isNaN(v)) return '·'; var a = Math.abs(v); return a >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a >= 10 ? v.toFixed(1) : v.toFixed(2); }
  function disposeAll() { charts.forEach(function (c) { try { c.remove(); } catch (e) {} }); charts = []; }
  function waitLW(cb) { var n = 80; (function t() { if (window.LightweightCharts) return cb(); if (--n > 0) setTimeout(t, 80); })(); }

  function pts(t, v) { var out = []; for (var i = 0; i < t.length; i++) { if (v[i] == null) out.push({ time: t[i] }); else out.push({ time: t[i], value: v[i] }); } return out; }
  function cpts(s) { var out = []; for (var i = 0; i < s.t.length; i++) { if (s.c[i] == null) continue; out.push({ time: s.t[i], open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i] }); } return out; }

  /* ---- generic multi-pane LW renderer ---- */
  function renderPanes(el, spec) {
    var LW = window.LightweightCharts;
    var panes = (spec.panes || []).filter(function (p) { return p.series && p.series.length; });
    if (!panes.length) return;
    var total = 0; panes.forEach(function (p, i) { total += p.height || (i === 0 && panes.length > 1 ? 220 : 180); });
    var ch = LW.createChart(el, PI_CHART.opts({
      height: Math.min(total, 620), autoSize: true,
      layout: { panes: { enableResize: false } },
      handleScroll: false, handleScale: false, crosshair: { mode: 0 }
    }));
    PI_CHART.track(ch);
    charts.push(ch);
    var legend = document.createElement('div');
    legend.className = 'text-[11px] text-ink-mute mt-1 flex flex-wrap gap-x-3 gap-y-0.5';
    panes.forEach(function (p, pi) {
      var first = null;
      p.series.forEach(function (s) {
        var color = TONE[s.tone] || TONE.ink, opts, ser;
        var scaleId = s.scale === 'hidden' ? ('h_' + s.key) : (s.scale === 'left' ? 'left' : 'right');
        if (s.type === 'candle') {
          ser = ch.addSeries(LW.CandlestickSeries, Object.assign(PI_CHART.candles(), { priceLineVisible: false, lastValueVisible: false, priceScaleId: scaleId }), pi);
          ser.setData(cpts(s));
        } else if (s.type === 'hist') {
          ser = ch.addSeries(LW.HistogramSeries, { color: color, priceLineVisible: false, lastValueVisible: false, priceScaleId: scaleId }, pi);
          ser.setData(pts(s.t, s.v).map(function (q) { if (q.value != null) q.color = q.value < 0 ? TONE.bad : TONE.good; return q; }));
        } else if (s.type === 'area') {
          ser = ch.addSeries(LW.AreaSeries, { lineColor: color, topColor: alpha(color, 0.2), bottomColor: 'transparent', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, priceScaleId: scaleId }, pi);
          ser.setData(pts(s.t, s.v));
        } else {
          opts = { color: color, lineWidth: s.tone === 'on' ? 2.5 : (s.tone === 'mute' ? 1 : 1.8), priceLineVisible: false, lastValueVisible: s.tone !== 'mute' && s.tone !== 'on', crosshairMarkerVisible: false, priceScaleId: scaleId };
          if (s.type === 'step') opts.lineType = 1;
          ser = ch.addSeries(LW.LineSeries, opts, pi);
          ser.setData(pts(s.t, s.v));
        }
        if (s.scale === 'hidden') ch.priceScale(scaleId, pi).applyOptions({ visible: false });
        if (!first) first = ser;
        var sw = document.createElement('span');
        sw.innerHTML = '<span style="display:inline-block;width:10px;height:3px;background:' + (TONE[s.tone] || TONE.ink) + ';vertical-align:middle;margin-right:4px"></span>' + esc(s.label);
        legend.appendChild(sw);
      });
      (p.levels || []).forEach(function (l) {
        if (first && l.v != null) first.createPriceLine({ price: l.v, color: LEVEL, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        var sw = document.createElement('span'); sw.style.color = LEVEL;
        sw.textContent = '- - ' + fmt(l.v) + (l.label ? ' ' + l.label : '');
        legend.appendChild(sw);
      });
      (p.zones || []).forEach(function (z) {
        var sw = document.createElement('span'); sw.style.color = TONE[z.tone] || MUTE;
        sw.textContent = '[' + (z.lo == null ? '' : fmt(z.lo)) + ' → ' + (z.hi == null ? '' : fmt(z.hi)) + '] ' + z.label;
        legend.appendChild(sw);
      });
      var pm = (spec.markers || []).filter(function (m) { return (m.pane || 0) === pi; });
      if (pm.length && first && LW.createSeriesMarkers) {
        /* many markers = arrows only; their meaning goes once into the legend */
        var terse = pm.length > 8, seen = {};
        LW.createSeriesMarkers(first, pm.map(function (m) {
          return { time: m.t, position: m.tone === 'good' ? 'belowBar' : 'aboveBar', color: TONE[m.tone] || TONE.accent, shape: m.tone === 'good' ? 'arrowUp' : 'arrowDown', text: terse ? '' : (m.text || '') };
        }));
        if (terse) pm.forEach(function (m) { var k = (m.tone || '') + '|' + (m.text || ''); if (seen[k] || !m.text) return; seen[k] = 1; var sw = document.createElement('span'); sw.style.color = TONE[m.tone] || TONE.accent; sw.textContent = (m.tone === 'good' ? '▲ ' : '▼ ') + m.text; legend.appendChild(sw); });
      }
    });
    try {
      var hs = panes.map(function (p, i) { return p.height || (i === 0 && panes.length > 1 ? 220 : 180); });
      ch.panes().forEach(function (pn, i) { if (hs[i]) pn.setHeight(hs[i]); });
    } catch (e) {}
    ch.timeScale().fitContent();
    el.parentNode.insertBefore(legend, el.nextSibling);
    return ch;
  }

  /* ---- tables, heatmap, curve ---- */
  function renderTable(t, heat) {
    if (!t || !t.cols) return '';
    var h = '<div class="overflow-x-auto"><table class="table w-full text-sm"><thead><tr class="text-[0.7rem] uppercase tracking-wide text-ink-mute border-b border-sepia-border">';
    t.cols.forEach(function (c, i) { h += '<th class="py-1.5 px-2 ' + (i ? 'text-right' : 'text-left') + '">' + esc(c) + '</th>'; });
    h += '</tr></thead><tbody class="divide-y divide-sepia-border">';
    (t.rows || []).forEach(function (r, ri) {
      h += '<tr>';
      r.forEach(function (v, ci) {
        var tone = t.tones && t.tones[ri] ? t.tones[ri][ci] : null, style = '';
        if (heat && ci && typeof v === 'number') { var a = Math.max(-1, Math.min(1, v)); style = 'background:' + (a >= 0 ? alpha(GOOD, a * 0.55) : alpha(BAD, -a * 0.55)); }
        var cls = ci ? 'text-right nums' : 'text-left font-semibold';
        if (tone === 'bad') cls += ' text-bad font-semibold'; else if (tone === 'good') cls += ' text-good font-semibold'; else if (tone === 'warn') cls += ' text-accent font-semibold';
        h += '<td class="py-1.5 px-2 ' + cls + '" style="' + style + '">' + (typeof v === 'number' ? fmt(v) : esc(v)) + '</td>';
      });
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }
  function renderCurve(curve) {
    if (!curve || !curve.labels || curve.labels.length < 2) return '';
    var multi = curve.series && curve.series.length > 1;
    var sers = multi ? curve.series : [{ values: curve.values, tone: 'accent' }];
    var all = [];
    sers.forEach(function (sr) { sr.values.forEach(function (v) { if (v !== null && v !== undefined) all.push(v); }); });
    if (!all.length) return '';
    var W = multi ? 520 : 420, H = multi ? 200 : 150, pad = 28, xs = curve.labels.length, mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
    if (mx === mn) mx = mn + 1;
    function X(i) { return pad + i * (W - 2 * pad) / (xs - 1); }
    function Y(v) { return H - pad - (v - mn) * (H - 2 * pad) / (mx - mn); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="w-full ' + (multi ? 'max-w-lg' : 'max-w-md') + '">';
    sers.forEach(function (sr, si) {
      var col = TONE[sr.tone] || TONE.accent, d = '', pen = false;
      sr.values.forEach(function (v, i) { if (v === null || v === undefined) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i) + ',' + Y(v) + ' '; pen = true; });
      s += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + (si ? 1.5 : 2.2) + '"' + (si ? ' opacity="0.8"' : '') + '/>';
      sr.values.forEach(function (v, i) {
        if (v === null || v === undefined) return;
        s += '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="' + (multi ? 2.2 : 3.5) + '" fill="' + col + '"/>';
        if (!multi) s += '<text x="' + X(i) + '" y="' + (Y(v) - 8) + '" font-size="10" text-anchor="middle" fill="' + INK + '">' + fmt(v) + '</text>';
      });
      if (multi) s += '<rect x="' + (pad + si * 90) + '" y="6" width="10" height="3" fill="' + col + '"/><text x="' + (pad + si * 90 + 14) + '" y="11" font-size="10" fill="' + MUTE + '">' + esc(sr.label || '') + '</text>';
    });
    var step = multi ? Math.max(1, Math.ceil(xs / 12)) : 1;
    curve.labels.forEach(function (l, i) { if (i % step === 0 || (i === xs - 1 && i % step >= step / 2)) s += '<text x="' + X(i) + '" y="' + (H - 8) + '" font-size="10" text-anchor="middle" fill="' + MUTE + '">' + esc(l) + '</text>'; });
    return s + '</svg>';
  }

  window.KLCharts = { refreshTone: refreshTone, esc: esc, fmt: fmt, disposeAll: disposeAll, waitLW: waitLW,
                      renderPanes: renderPanes, renderTable: renderTable, renderCurve: renderCurve };
})();
