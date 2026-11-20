/* FX stat sheet — the currencies-and-SPX overlay (window switch, legend
   toggles), the SPX correlation plot, and the row detail (one year with the
   levels and SPX, correlation bars). Charts via KLCharts (kl-charts.js) and
   Lightweight Charts v5; data via /signal-lab/chart/{id} and /fx/detail/{sym}. */
(function () {
  'use strict';
  var K = window.KLCharts;
  if (!K) return;
  var esc = K.esc;

  function fetchSpec(id) {
    return fetch('/fx/chart/' + encodeURIComponent(id), { credentials: 'same-origin' }).then(function (r) { return r.json(); });
  }
  /* ---- all eight currencies on one chart, with a window switch ---- */
  var OV_COLORS = { USD: '#2e7d32', JPY: '#c9a800', CHF: '#6b6b6b', EUR: '#0097a7', GBP: '#c62828', AUD: '#ef8f00', NZD: '#1565c0', CAD: '#8e24aa', SPX: PI_CHART.theme().text, HYG: '#7a6a4f', VIX: '#a0522d' };
  var ovEl = document.getElementById('fx-overlay'), ovLegend = document.getElementById('fx-overlay-legend');
  var OV_HIDDEN = { HYG: true, VIX: true };
  if (ovEl) {
    var ovSpec = null, ovChart = null, ovTF = '1W';
    function ovWindow(tf) {
      var hourly = ovSpec.panes[0], daily = ovSpec.panes[1];
      if (tf === '1D' || tf === '1W' || tf === '1M') return { pane: hourly, days: tf === '1D' ? 1.2 : (tf === '1W' ? 7 : 31), intraday: true };
      return { pane: daily, days: tf === '3M' ? 95 : 400, intraday: false };
    }
    function ovSlice(s, w) {
      /* slice by time, not by count: SPX only trades a third of the hours the currencies do */
      var tmax = -Infinity; ovSpec.panes[w.intraday ? 0 : 1].series.forEach(function (x) { var t = x.t[x.t.length - 1]; var u = w.intraday ? Date.parse(t + ':00Z') : Date.parse(t); if (u > tmax) tmax = u; });
      var cut = tmax - w.days * 86400000, t = [], v = [];
      for (var i = 0; i < s.t.length; i++) { var u = w.intraday ? Date.parse(s.t[i] + ':00Z') : Date.parse(s.t[i]); if (u >= cut) { t.push(s.t[i]); v.push(s.v[i]); } }
      return { t: t, v: v };
    }
    function ovRender() {
      if (!ovSpec || !window.LightweightCharts) return;
      var LW = window.LightweightCharts, w = ovWindow(ovTF), pane = w.pane;
      if (ovChart) { try { ovChart.remove(); } catch (e) {} ovChart = null; }
      ovEl.innerHTML = '';
      K.refreshTone();
      ovChart = LW.createChart(ovEl, PI_CHART.opts({
        height: 420, autoSize: true,
        layout: { attributionLogo: false },
        timeScale: { timeVisible: w.intraday, secondsVisible: false, rightOffsetPixels: 52 }, /* keep the line ends clear of the ticker tags */
        handleScroll: false, handleScale: false, crosshair: { mode: 0 }
      }));
      PI_CHART.track(ovChart);
      var rows = [];
      pane.series.forEach(function (s) {
        if (OV_HIDDEN[s.label]) { rows.push({ label: s.label, last: null, color: OV_COLORS[s.label] || PI_CHART.theme().mute }); return; }
        var sl = ovSlice(s, w), t = sl.t, v = sl.v;
        var base = null; for (var i = 0; i < v.length; i++) { if (v[i] != null) { base = v[i]; break; } }
        if (base == null) return;
        var pts = [];
        for (var j = 0; j < t.length; j++) {
          if (v[j] == null) continue;
          var time = w.intraday ? Math.floor(Date.parse(t[j] + ':00Z') / 1000) : t[j];
          pts.push({ time: time, value: v[j] / base * 100 });
        }
        var color = OV_COLORS[s.label] || PI_CHART.theme().text;
        var ls = ovChart.addSeries(LW.LineSeries, { color: color, lineWidth: s.label === 'SPX' ? 3 : 2, priceLineVisible: false, lastValueVisible: true, title: s.label, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
        ls.setData(pts);
        rows.push({ label: s.label, last: pts[pts.length - 1].value, color: color });
      });
      ovChart.addSeries(LW.LineSeries, Object.assign(PI_CHART.bench(), { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }))
        .setData((function () { var f = ovSlice(pane.series[0], w); if (!f.t.length) return []; var a = f.t[0], z = f.t[f.t.length - 1]; return [{ time: (w.intraday ? Math.floor(Date.parse(a + ':00Z') / 1000) : a), value: 100 }, { time: (w.intraday ? Math.floor(Date.parse(z + ':00Z') / 1000) : z), value: 100 }]; })());
      ovChart.timeScale().fitContent();
      rows.sort(function (a, b) { return (b.last == null ? -1e9 : b.last) - (a.last == null ? -1e9 : a.last); });
      var haven = { USD: 1, JPY: 1, CHF: 1 };
      ovLegend.innerHTML = '<div class="text-[0.7rem] uppercase tracking-wide text-ink-mute font-semibold mb-1">Strongest to weakest</div>' + rows.map(function (r) {
        if (r.last == null) return '<button type="button" class="ov-toggle flex items-center justify-between gap-2 text-sm py-0.5 w-full text-left opacity-50 hover:opacity-100" data-l="' + r.label + '"><span class="flex items-center gap-1.5"><span style="display:inline-block;width:12px;height:3px;background:' + r.color + '"></span><span class="font-semibold text-ink">' + r.label + '</span><span class="text-[10px] text-ink-mute">off</span></span></button>';
        var d = r.last - 100;
        return '<button type="button" class="ov-toggle flex items-center justify-between gap-2 text-sm py-0.5 w-full text-left" data-l="' + r.label + '"><span class="flex items-center gap-1.5"><span style="display:inline-block;width:12px;height:3px;background:' + r.color + '"></span><span class="font-semibold text-ink">' + r.label + '</span><span class="text-[10px] text-ink-mute">' + (r.label === 'SPX' ? 'index' : (r.label === 'HYG' ? 'credit' : (r.label === 'VIX' ? 'fear' : (haven[r.label] ? 'haven' : (r.label === 'EUR' || r.label === 'GBP' ? '' : 'commodity'))))) + '</span></span><span class="nums ' + (d >= 0 ? 'text-good' : 'text-bad') + '">' + (d >= 0 ? '+' : '') + d.toFixed(2) + '%</span></button>';
      }).join('');
    }
    fetchSpec(ovEl.dataset.id).then(function (d) {
      ovSpec = (d && d.spec) || null;
      if (!ovSpec || !ovSpec.panes || ovSpec.panes.length < 2) { ovEl.innerHTML = '<div class="text-xs text-ink-mute">Could not load the chart.</div>'; return; }
      K.waitLW(ovRender);
    }).catch(function () { ovEl.innerHTML = '<div class="text-xs text-ink-mute">Could not load the chart.</div>'; });
    document.addEventListener('click', function (e) {
      var tg = e.target.closest('.ov-toggle'); if (tg) { OV_HIDDEN[tg.dataset.l] = !OV_HIDDEN[tg.dataset.l]; ovRender(); return; }
      var b = e.target.closest('.fx-tf'); if (!b) return;
      ovTF = b.dataset.tf;
      document.querySelectorAll('.fx-tf').forEach(function (x) { var on = x === b; x.className = 'fx-tf px-2.5 py-1 rounded-full border ' + (on ? 'border-accent/40 bg-accent/10 text-accent font-semibold' : 'border-sepia-border text-ink-mute hover:text-ink'); });
      ovRender();
    });
  }


  /* ---- SPX correlation plot: grouped bars, one group per leg, one bar per window ---- */
  var corrEl = document.getElementById('fx-corr'), corrData = null;
  try { corrData = JSON.parse(document.getElementById('fx-corr-data').textContent); } catch (e) {}
  if (corrEl && corrData && corrData.rows.length) {
    var cols = corrData.cols.slice(1), rows = corrData.rows;
    var CW = (function () { var t = PI_CHART.theme(); return [t.text, t.s2, t.s3, t.mute, t.rgba('text', 0.5), t.rgba('s2', 0.55)]; })();   // six windows: neutral series, never good / bad / accent
    var W = 1000, H = 360, padL = 44, padR = 10, padT = 16, padB = 46, gw = (W - padL - padR) / rows.length, bw = Math.min(14, (gw - 10) / cols.length);
    function Y(v) { return padT + (1 - v) * (H - padT - padB) / 2; }
    var h = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="w-full" style="max-height:420px" font-family="inherit">';
    [1, 0.5, 0, -0.5, -1].forEach(function (g) { h += '<line x1="' + padL + '" y1="' + Y(g) + '" x2="' + (W - padR) + '" y2="' + Y(g) + '" stroke="' + PI_CHART.theme().rgba('mute', g === 0 ? 0.6 : 0.15) + '"/><text x="' + (padL - 6) + '" y="' + (Y(g) + 4) + '" font-size="11" text-anchor="end" fill="' + PI_CHART.theme().mute + '">' + g.toFixed(2) + '</text>'; });
    rows.forEach(function (r, gi) {
      var x0 = padL + gi * gw + (gw - bw * cols.length) / 2;
      cols.forEach(function (c, ci) {
        var v = r[ci + 1]; if (v == null) return;
        var y = Y(Math.max(v, 0)), hh = Math.abs(Y(0) - Y(v));
        h += '<rect x="' + (x0 + ci * bw) + '" y="' + y + '" width="' + (bw - 1.5) + '" height="' + hh + '" fill="' + CW[ci] + '"><title>' + esc(r[0]) + ' ' + esc(c) + ': ' + v.toFixed(2) + '</title></rect>';
      });
      h += '<text x="' + (padL + gi * gw + gw / 2) + '" y="' + (H - padB + 16) + '" font-size="12" font-weight="600" text-anchor="middle" fill="' + PI_CHART.theme().text + '">' + esc(r[0]) + '</text>';
    });
    h += '</svg>';
    h += '<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-mute mt-1">' + cols.map(function (c, ci) { return '<span class="inline-flex items-center gap-1"><span style="display:inline-block;width:12px;height:8px;background:' + CW[ci] + '"></span>' + esc(c) + '</span>'; }).join('') + '</div>';
    corrEl.innerHTML = h;
  }


  function mkChart(host, h, showTime) {
    var LW = window.LightweightCharts;
    return PI_CHART.track(LW.createChart(host, PI_CHART.opts({ height: h, autoSize: true,
      layout: { fontSize: 10, attributionLogo: false },
      timeScale: { timeVisible: true, secondsVisible: false, visible: showTime },
      handleScroll: false, handleScale: false, crosshair: { mode: 0 } })));
  }
  function unix(t) { return Math.floor(Date.parse(t + ':00Z') / 1000); }

  /* ---- the FX sheet: a row opens its charts in place ---- */
  function corrBars(cols, vals) {
    var CW = (function () { var t = PI_CHART.theme(); return [t.text, t.s2, t.s3, t.mute, t.rgba('text', 0.5), t.rgba('s2', 0.55)]; })();   // six windows: neutral series, never good / bad / accent
    var W = 320, H = 120, padL = 30, padT = 8, padB = 22, bw = (W - padL - 8) / cols.length;
    function Y(v) { return padT + (1 - v) * (H - padT - padB) / 2; }
    var h = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="w-full" style="max-width:360px">';
    [1, 0, -1].forEach(function (g) { h += '<line x1="' + padL + '" y1="' + Y(g) + '" x2="' + (W - 8) + '" y2="' + Y(g) + '" stroke="' + PI_CHART.theme().rgba('mute', g === 0 ? 0.6 : 0.15) + '"/><text x="' + (padL - 4) + '" y="' + (Y(g) + 4) + '" font-size="10" text-anchor="end" fill="' + PI_CHART.theme().mute + '">' + g + '</text>'; });
    cols.forEach(function (c, i) { var v = vals[i]; if (v == null) return; h += '<rect x="' + (padL + i * bw + 3) + '" y="' + Y(Math.max(v, 0)) + '" width="' + (bw - 6) + '" height="' + Math.abs(Y(0) - Y(v)) + '" fill="' + CW[i] + '"><title>' + esc(c) + ': ' + v.toFixed(2) + '</title></rect><text x="' + (padL + i * bw + bw / 2) + '" y="' + (H - 6) + '" font-size="9" text-anchor="middle" fill="' + PI_CHART.theme().mute + '">' + esc(c.replace('SPX_', '')) + '</text>'; });
    return h + '</svg>';
  }
  function fillDetail(body, d) {
    if (!d || !d.ticker) { body.innerHTML = '<div class="text-xs text-ink-mute">Nothing stored for this instrument.</div>'; return; }
    var h = '<div style="display:grid;grid-template-columns:minmax(0,8fr) minmax(0,3fr);gap:14px">';
    h += '<div style="min-width:0"><div class="text-xs font-semibold text-ink mb-1">One year, with the levels and SPX rebased</div><div id="fxd-daily" class="w-full"></div>' + (d.daily ? '' : '<div class="text-xs text-ink-mute">No daily bars for an index row.</div>') + '</div>';
    h += '<div style="min-width:0"><div class="text-xs font-semibold text-ink mb-1">Correlation to SPX</div>' + (d.corr ? corrBars(d.corr.cols, d.corr.vals) : '<div class="text-xs text-ink-mute">Not one of the correlation legs.</div>') + '</div>';
    h += '</div>';
    body.innerHTML = h;
    K.waitLW(function () {
      K.refreshTone();
      if (d.daily) { var el = document.getElementById('fxd-daily'); if (el) K.renderPanes(el, d.daily); }
      if (d.intraday) {
        var LW = window.LightweightCharts, host = document.getElementById('fxd-intra'); if (!host) return;
        d.intraday.panes.forEach(function (p, i) {
          var box = document.createElement('div'); box.className = i ? 'mt-1 border-t border-sepia-border pt-1' : ''; host.appendChild(box);
          var ch = mkChart(box, p.height || 150, i === d.intraday.panes.length - 1);
          var s = p.series[0], pts = []; for (var j = 0; j < s.t.length; j++) if (s.v[j] != null) pts.push({ time: unix(s.t[j]), value: s.v[j] });
          var last = pts.length ? pts[pts.length - 1].value : 1;
          ch.addSeries(LW.LineSeries, { color: i ? PI_CHART.theme().warn : PI_CHART.theme().text, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'price', precision: Math.abs(last) < 20 ? 4 : 2, minMove: 0.0001 } }).setData(pts);
          ch.timeScale().fitContent();
        });
      }
    });
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('#fx-detail-close')) { var hst = document.getElementById('fx-detail-host'); if (hst) hst.classList.add('hidden'); return; }
    if (e.target.closest('a')) return;
    var row = e.target.closest('.fx-row'); if (!row) return;
    var host = document.getElementById('fx-detail-host'); if (!host) return;
    document.querySelectorAll('.fx-row').forEach(function (r) { r.classList.toggle('bg-accent/5', r === row); });
    host.classList.remove('hidden');
    document.getElementById('fx-detail-title').textContent = row.querySelector('td').textContent.trim();
    var body = host.querySelector('.fx-body');
    body.innerHTML = '<div class="text-xs text-ink-mute">Loading…</div>';
    host.scrollIntoView({ block: 'start', behavior: 'smooth' });
    fetch('/fx/detail/' + encodeURIComponent(row.dataset.sym), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) { fillDetail(body, d); }).catch(function () { body.innerHTML = '<div class="text-xs text-ink-mute">Could not load.</div>'; });
  });

})();
