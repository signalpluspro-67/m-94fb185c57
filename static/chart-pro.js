/* chart-pro.js: the layers that turn the ticker chart into a working desk:
   studies in their own panes, alternative price renderings, and bar replay.
   Loads after name.html has built the base chart and waits for its handle. */
(function () {
  var H = null, LWC = null, chart = null;
  var studyState = {}, studyCfg = {}, studySeries = {}, studyPane = {};
  // A study can be on the chart more than once: 'rsi' is the first copy, 'rsi#2' the next.
  // Only the key carries the copy; the table of studies never changes.
  function baseKey(k) { var i = String(k).indexOf('#'); return i < 0 ? k : k.slice(0, i); }
  // a study's definition, with the member's choice of pane on top (Move to → on the price / its own pane)
  function defOf(k) { var d = STUDIES[baseKey(k)]; if (!d) return d; var sc = studyCfg[k]; if (sc && sc.ownPane != null && !!sc.ownPane !== !!d.pane) { var o = {}; Object.keys(d).forEach(function (q) { o[q] = d[q]; }); o.pane = !!sc.ownPane; if (o.pane && !o.height) o.height = 110; return o; } return d; }
  function liveKeys() { return Object.keys(studyState).filter(function (k) { return studyState[k]; }); }
  function nextCopy(k) { var b = baseKey(k), n = 2; while (studyState[b + '#' + n]) n++; return b + '#' + n; }
  var mode = 'candles', baseSeries = null, replay = null;
  var interval = 'D';   // D = the bars the server sent; 2D 3D 2W Q are built here
  function fullBars() { var all = intraBars || H.candles();
    return (!intraBars && interval !== 'D') ? resampleBars(all, interval) : all; }
  function bars() { var all = fullBars();
    return replay ? all.slice(0, replay.i) : all; }
  // dark chart_tv_lot4: a study read on weekly or monthly bars, its values stepped back onto the days.
  // The week (or month) in progress moves until it closes, the way TradingView draws it.
  function tvMore() { var b = document.getElementById('chart-snap'); return !!(b && b.dataset && b.dataset.tvMore === '1'); }
  function htfKey(t, k) { var p = String(t).split('-');
    if (k === 'M') return p[0] + '-' + p[1];
    return String(Math.floor((Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5 + 3) / 7)); }
  function htfBars(c, k) {
    var vol = {}; try { (H.vol() || []).forEach(function (x) { vol[x.time] = x.value; }); } catch (e) {}
    var out = [], ov = [], cur = null, ck = null, last = {};
    c.forEach(function (b) { var kk = htfKey(b.time, k);
      if (cur && kk === ck) { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.volume += vol[b.time] || 0; cur.time = b.time; }
      else { if (cur) out.push(cur); cur = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: vol[b.time] || 0 }; ck = kk; }
      last[b.time] = kk; });
    if (cur) out.push(cur);
    out.forEach(function (b) { ov.push({ time: b.time, value: b.volume }); });
    return { bars: out, vol: ov, bucketOf: last };
  }
  function htfSpread(parts, c, h, k) {   // each day takes the value of its own week or month
    var keyOfTime = {}; h.bars.forEach(function (b) { keyOfTime[b.time] = htfKey(b.time, k); });
    return parts.map(function (p) {
      var byKey = {}; (p.data || []).forEach(function (x) { if (keyOfTime[x.time] != null) byKey[keyOfTime[x.time]] = x; });
      var d = []; c.forEach(function (b) { var x = byKey[h.bucketOf[b.time]]; if (x && x.value != null) { var y = { time: b.time, value: x.value }; if (x.color) y.color = x.color; d.push(y); } });
      var q = {}; Object.keys(p).forEach(function (kk) { q[kk] = p[kk]; }); q.data = d; if (!p.histogram) q.steps = true; delete q.marks; return q; });
  }
  function resampleBars(c, k) {
    var vol = {}; try { (H.vol() || []).forEach(function (x) { vol[x.time] = x.value; }); } catch (e) {}
    function key(b, i) { var p = b.time.split('-');
      if (k === '2D' || k === '3D') return Math.floor(i / (k === '2D' ? 2 : 3));
      var wk = Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5 / 7);
      if (k === '2W') return Math.floor(wk / 2);
      if (k === 'Q') return p[0] + 'Q' + Math.ceil(+p[1] / 3);
      if (k === '6M') return p[0] + 'H' + Math.ceil(+p[1] / 6);
      if (k === '12M') return p[0];
      return p[0] + 'Q' + Math.ceil(+p[1] / 3); }
    var out = [], cur = null, ck = null;
    c.forEach(function (b, i) { var kk = key(b, i);
      if (cur && kk === ck) { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.volume += vol[b.time] || 0; }
      else { if (cur) out.push(cur); cur = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: vol[b.time] || 0 }; ck = kk; } });
    if (cur) out.push(cur); return out;
  }
  var INTERVALS = [['D', 'off'], ['2D', '2 days'], ['3D', '3 days'], ['2W', '2 weeks'],
                   ['Q', 'quarters'], ['6M', 'half years'], ['12M', 'years']];
  // Intraday lives only for the names the desk polls through the session; everything
  // else is end of day, and the menu says so instead of drawing an empty chart.
  var INTRADAY = [['1min', '1 minute'], ['5min', '5 minutes'], ['15min', '15 minutes'], ['1H', '1 hour'], ['4H', '4 hours']];
  var intraTf = null, intraBars = null, intraPoll = null;
  function intraHave() { try { return ((H.ours && H.ours()) || {}).intratfs || []; } catch (e) { return []; } }
  function tickerNow() { return ((document.getElementById('chart-snap') || {}).dataset || {}).ticker || ''; }
  // The market's follow-through and distribution days (dark chart_surge): one fetch per
  // page, the layer redraws itself when the dates land. Until then it draws nothing.
  var MKT = { d: null, tk: null, busy: false };
  function mktMarks() {
    var tk = tickerNow(); if (!tk) return null;
    if (MKT.d && MKT.tk === tk) return MKT.d;
    if (!MKT.busy) { MKT.busy = true; MKT.tk = tk;
      fetch('/api/market-marks?t=' + encodeURIComponent(tk), { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { MKT.busy = false; MKT.d = j || { ftd: [], dist: [] }; if (studyState.ftd) drawStudy('ftd'); })
        .catch(function () { MKT.busy = false; MKT.d = { ftd: [], dist: [] }; }); }
    return null;
  }
  function loadIntraday(tf, then) {
    var tk = tickerNow(); if (!tk) return then(null);
    fetch('/api/intraday?t=' + encodeURIComponent(tk) + '&tf=' + encodeURIComponent(tf))
      .then(function (r) { return r.json(); })
      .then(function (j) { then(j && j.candles && j.candles.length ? j : null); })
      .catch(function () { then(null); });
  }
  // While an intraday timeframe is on screen, the last bar's close lags behind
  // the tape (the desk's own poll or an on-demand Polygon pull both work in
  // minutes, not seconds). /quote/<ticker> already carries the latest print
  // (cheap, cached 30s server-side) so a light poll keeps the last candle
  // honest without a new endpoint.
  function stopIntraPoll() { if (intraPoll) { clearInterval(intraPoll); intraPoll = null; } }
  function startIntraPoll() {
    stopIntraPoll();
    intraPoll = setInterval(function () {
      var tk = tickerNow();
      if (!tk || !intraTf || !intraBars || !intraBars.length) return;
      fetch('/quote/' + encodeURIComponent(tk)).then(function (r) { return r.json(); })
        .then(function (q) {
          if (!q || q.last == null || !intraTf || !intraBars.length) return;
          var last = intraBars[intraBars.length - 1];
          last.close = q.last;
          if (q.last > last.high) last.high = q.last;
          if (q.last < last.low) last.low = q.last;
          try { H.setBase(intraBars); } catch (e) {}
        }).catch(function () {});
    }, 60000);
  }
  function setIntraday(tf) {
    if (!tf) { intraTf = null; intraBars = null; stopIntraPoll();
      try { H.setBase(H.candles()); if (H.setVol) H.setVol(H.vol()); } catch (e) {}
      applyType(); redrawStudies(); markInterval(); return; }
    hint('Loading ' + tf + '\u2026');
    loadIntraday(tf, function (j) {
      if (!j) { hint('No intraday for this name yet, it stays on the daily bars');
                setTimeout(function () { hint(''); }, 2600); markInterval(); return; }
      hint(''); intraTf = tf; interval = 'D';
      // carry each bar's volume on the bar itself: the profiles read b.volume
      var vby = {}; (j.vol || []).forEach(function (x) { vby[x.time] = x.value; });
      intraBars = j.candles.map(function (b) { return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: vby[b.time] || 0 }; });
      try { H.setBase(j.candles); if (H.setVol) H.setVol(j.vol || []); } catch (e) {}
      applyType(); redrawStudies(); resnapDrawings(); markInterval();
      try { chart.timeScale().fitContent(); } catch (e) {}
      if (tpoOn) { try { var ss0 = sessionsOf(intraBars, false).slice(-3); if (ss0.length) chart.timeScale().setVisibleRange({ from: intraBars[ss0[0].idx[0]].time, to: intraBars[intraBars.length - 1].time }); } catch (e) {} }
      overlaysSoon();
      startIntraPoll();
    });
  }
  // A year candle needs years of bars: the long intervals pull the history in
  // once, instead of drawing two boxes from ten months of daily closes.
  function loadDeep(rounds, then) {
    if (rounds <= 0 || older.done || window.__piNoOlder) { if (then) then(); return; }
    var c = H.candles(), tk = ((document.getElementById('chart-snap') || {}).dataset || {}).ticker;
    if (!c.length || !tk || !H.prepend) { if (then) then(); return; }
    hint('Loading history\u2026');
    fetch('/api/bars?t=' + encodeURIComponent(tk) + '&before=' + c[0].time + '&n=500')
      .then(function (x) { return x.ok ? x.json() : null; })
      .then(function (j) {
        var add = (j && j.candles) || [];
        if (add.length < 500) older.done = true;
        if (add.length) H.prepend(add, (j && j.vol) || []);
        loadDeep(rounds - 1, then);
      }).catch(function () { hint(''); if (then) then(); });
  }
  function setInterval2(k) {
    var wasIntra = !!intraTf; intraTf = null; intraBars = null; if (wasIntra) stopIntraPoll();
    interval = k; try { H.setBase(H.candles()); if (wasIntra && H.setVol) H.setVol(H.vol()); } catch (e) {}
    applyType(); redrawStudies(); resnapDrawings(); drawRvp(); markInterval();
    try { chart.timeScale().fitContent(); } catch (e) {}
    if ((k === 'Q' || k === '6M' || k === '12M') && H.candles().length < 1500) {
      loadDeep(4, function () { hint(''); applyType(); redrawStudies(); markInterval();
        try { chart.timeScale().fitContent(); } catch (e) {} });
    }
  }
  function markInterval() {
    Array.prototype.forEach.call(document.querySelectorAll('#cp-int [data-intra]'), function (b) {
      b.addEventListener('click', function () { setIntraday(this.getAttribute('data-intra')); var dd = document.getElementById('cp-int'); if (dd) dd.removeAttribute('open'); }); });
    Array.prototype.forEach.call(document.querySelectorAll('#cp-int [data-view]'), function (b) {
      b.addEventListener('click', function () { quickView(this.getAttribute('data-view')); var dd = document.getElementById('cp-int'); if (dd) dd.removeAttribute('open'); }); });
    Array.prototype.forEach.call(document.querySelectorAll('#cp-int [data-int]'), function (b) {
      b.className = 'block w-full text-left px-2 py-1 rounded-lg ' + (b.getAttribute('data-int') === interval ? 'bg-accent text-white' : 'hover:bg-sepia-hover'); });
    Array.prototype.forEach.call(document.querySelectorAll('#cp-int [data-intra]'), function (b) {
      b.className = 'block w-full text-left px-2 py-1 rounded-lg ' + (b.getAttribute('data-intra') === intraTf ? 'bg-accent text-white' : 'hover:bg-sepia-hover'); });
    var sm = document.getElementById('cp-int-sum');
    if (sm) { var lbl = intraTf || (interval === 'D' ? 'More' : interval); sm.textContent = lbl; pill(sm, !!intraTf || interval !== 'D'); }
  }

  // ── indicator math (plain arrays in, plain arrays out) ───────────────────
  function sma(v, p) { var o = [], s = 0, n = 0;
    for (var i = 0; i < v.length; i++) { if (v[i] == null) { o.push(null); continue; }
      s += v[i]; n++; if (n > p) { s -= v[i - p]; n = p; }
      o.push(n === p ? s / p : null); } return o; }
  function ema(v, p) { var o = [], k = 2 / (p + 1), e = null, s = 0, c = 0;
    for (var i = 0; i < v.length; i++) { var x = v[i];
      if (x == null) { o.push(e); continue; }
      if (e === null) { s += x; c++; if (c < p) { o.push(null); continue; } e = s / p; }
      else e = x * k + e * (1 - k);
      o.push(e); } return o; }
  function stdev(v, p) { var o = [];
    for (var i = 0; i < v.length; i++) { if (i < p - 1) { o.push(null); continue; }
      var m = 0, j; for (j = 0; j < p; j++) m += v[i - j]; m /= p;
      var q = 0; for (j = 0; j < p; j++) q += (v[i - j] - m) * (v[i - j] - m);
      o.push(Math.sqrt(q / p)); } return o; }
  function rsi(cl, p) { var o = [], g = 0, l = 0, ag = null, al = null;
    for (var i = 0; i < cl.length; i++) { if (i === 0) { o.push(null); continue; }
      var d = cl[i] - cl[i - 1], up = d > 0 ? d : 0, dn = d < 0 ? -d : 0;
      if (i <= p) { g += up; l += dn;
        if (i === p) { ag = g / p; al = l / p; o.push(100 - 100 / (1 + (al ? ag / al : 99))); }
        else o.push(null); continue; }
      ag = (ag * (p - 1) + up) / p; al = (al * (p - 1) + dn) / p;
      o.push(100 - 100 / (1 + (al ? ag / al : 99))); } return o; }
  function trueRange(c) { var o = [];
    for (var i = 0; i < c.length; i++) { if (i === 0) { o.push(c[i].high - c[i].low); continue; }
      var pc = c[i - 1].close;
      o.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - pc), Math.abs(c[i].low - pc))); }
    return o; }
  function atr(c, p) { var t = trueRange(c), o = [], a = null, s = 0;
    for (var i = 0; i < t.length; i++) {
      if (i < p - 1) { s += t[i]; o.push(null); continue; }
      if (i === p - 1) { s += t[i]; a = s / p; } else a = (a * (p - 1) + t[i]) / p;
      o.push(a); } return o; }  // Wilder (alpha 1/p), same as the alert formulas
  function wmaOf(v, p) { var o = []; for (var i = 0; i < v.length; i++) { if (i < p - 1) { o.push(null); continue; }
      var s2 = 0, w = 0, ok = true; for (var j = 0; j < p; j++) { var x = v[i - j]; if (x == null) { ok = false; break; } s2 += x * (p - j); w += p - j; }
      o.push(ok ? s2 / w : null); } return o; }
  // value of the straight line fitted over the last p points, read at the last point
  function linreg(v, p) { var o = [];
    for (var i = 0; i < v.length; i++) { if (i < p - 1) { o.push(null); continue; }
      var sx = 0, sy = 0, sxy = 0, sxx = 0, ok = true;
      for (var j = 0; j < p; j++) { var y = v[i - p + 1 + j]; if (y == null) { ok = false; break; }
        sx += j; sy += y; sxy += j * y; sxx += j * j; }
      if (!ok) { o.push(null); continue; }
      var d = p * sxx - sx * sx, b = d ? (p * sxy - sx * sy) / d : 0, a = (sy - b * sx) / p;
      o.push(a + b * (p - 1)); } return o; }

  // ── more indicator maths ─────────────────────────────────────────────────
  function hhv(c, p, key) { var o = []; for (var i = 0; i < c.length; i++) {
      if (i < p - 1) { o.push(null); continue; }
      var m = -Infinity; for (var j = 0; j < p; j++) m = Math.max(m, c[i - j][key]); o.push(m); } return o; }
  function llv(c, p, key) { var o = []; for (var i = 0; i < c.length; i++) {
      if (i < p - 1) { o.push(null); continue; }
      var m = Infinity; for (var j = 0; j < p; j++) m = Math.min(m, c[i - j][key]); o.push(m); } return o; }
  function line(c, arr, dec) { var o = [], d = dec == null ? 2 : dec;
    for (var i = 0; i < c.length; i++) if (arr[i] != null && isFinite(arr[i]))
      o.push({ time: c[i].time, value: +arr[i].toFixed(d) }); return o; }
  // our own series arrive as plain values ending on the last session
  function tail(c, vals, dec) { if (!vals || !vals.length) return [];
    var n = Math.min(vals.length, c.length), off = c.length - n, o = [], d = dec == null ? 2 : dec;
    for (var i = 0; i < n; i++) if (vals[i] != null && isFinite(vals[i]))
      o.push({ time: c[off + i].time, value: +Number(vals[i]).toFixed(d) }); return o; }
  // each daily session takes the value of the week it sits in: the rows come sorted by first session
  function wkMaParts(c, o, key, color) { var rows = o && o.wkma; if (!rows || !rows.length) return [];
    var out = [], j = -1;
    for (var i = 0; i < c.length; i++) { var t = c[i].time;
      while (j + 1 < rows.length && rows[j + 1].w <= t) j++;
      if (j >= 0 && rows[j][key] != null) out.push({ time: t, value: rows[j][key] }); }
    return out.length ? [{ data: out, color: color, width: 2, steps: true }] : []; }
  function TR(n, a) { return PI_CHART.theme().rgba(n, a); }
  function volsOf(c, vol) { var by = {}; (vol || []).forEach(function (x) { by[x.time] = x.value; });
    return c.map(function (b) { return b.volume != null ? b.volume : (by[b.time] == null ? null : by[b.time]); }); }
  var spyOf = volsOf;   // the S&P line arrives in the same {time, value} shape

  // the house inks, read live from the app's variables (pi-chart.js): good / bad, ink for the main line,
  // series_2 and series_3 for the neutral extras, warn for alerts, ink_mute for axes and guides
  var C = { get up() { return PI_CHART.theme().good; }, get dn() { return PI_CHART.theme().bad; },
            get a() { return PI_CHART.theme().text; }, get b() { return PI_CHART.theme().s2; },
            get c() { return PI_CHART.theme().s3; }, get d() { return PI_CHART.theme().warn; },
            get m() { return PI_CHART.theme().mute; }, get g() { return PI_CHART.theme().rgba('mute', 0.75); } };

  // ── the studies catalogue ────────────────────────────────────────────────
  // pane 0 draws over the price; anything else gets its own strip underneath.
  // `params` are what the reader can change; `build` receives them as cfg.
  // ── auto patterns: classic shapes read off the swing pivots (detected shapes,
  // never a signal: nothing here carries a hit rate) ──────────────────────────
  function swingPivots(c, p) { var pts = [], n = c.length, i, j, last = null;
    for (i = p; i < n - p; i++) { var isH = true, isL = true;
      for (j = 1; j <= p; j++) { if (c[i - j].high >= c[i].high || c[i + j].high >= c[i].high) isH = false; if (c[i - j].low <= c[i].low || c[i + j].low <= c[i].low) isL = false; if (!isH && !isL) break; }
      var k = isH ? 'H' : isL ? 'L' : null; if (!k) continue;
      var v = k === 'H' ? c[i].high : c[i].low;
      if (last && last.k === k) { if ((k === 'H' && v > last.v) || (k === 'L' && v < last.v)) { pts[pts.length - 1] = { i: i, k: k, v: v }; last = pts[pts.length - 1]; } continue; }
      pts.push({ i: i, k: k, v: v }); last = pts[pts.length - 1]; }
    return pts; }
  function findPatterns(c, p, maxN) {
    var P = swingPivots(c, p), n = c.length, out = [], used = {};
    if (P.length < 3) return out;
    function near(a, b, tol) { return Math.abs(a - b) / ((a + b) / 2) <= tol; }
    function lineAt(a, b, i) { return a.v + (b.v - a.v) * (i - a.i) / ((b.i - a.i) || 1); }
    function add(o) { var key = o.piv.map(function (x) { return x.i; }).join('-');
      for (var q = 0; q < o.piv.length; q++) if (used[o.piv[q].i]) return; o.piv.forEach(function (x) { used[x.i] = 1; }); out.push(o); }
    for (var e = P.length - 1; e >= 2 && out.length < maxN; e--) {
      var a = P[e - 2], b = P[e - 1], d = P[e];
      // head and shoulders (and inverse): five pivots
      if (e >= 4) { var s1 = P[e - 4], n1 = P[e - 3], hd = P[e - 2], n2 = P[e - 1], s2 = P[e];
        if (s1.k === 'H' && hd.v > s1.v * 1.02 && hd.v > s2.v * 1.02 && near(s1.v, s2.v, 0.04)) {
          var nk = lineAt(n1, n2, n - 1);
          add({ name: 'Head and shoulders', piv: [s1, n1, hd, n2, s2], neck: [n1, n2], target: nk - (hd.v - lineAt(n1, n2, hd.i)), dir: -1 }); continue; }
        if (s1.k === 'L' && hd.v < s1.v * 0.98 && hd.v < s2.v * 0.98 && near(s1.v, s2.v, 0.04)) {
          var nk2 = lineAt(n1, n2, n - 1);
          add({ name: 'Inverse head and shoulders', piv: [s1, n1, hd, n2, s2], neck: [n1, n2], target: nk2 + (lineAt(n1, n2, hd.i) - hd.v), dir: 1 }); continue; } }
      // triangles, wedges, channels: the last two highs and the last two lows
      if (e >= 3) { var w = P.slice(e - 3, e + 1), hs = w.filter(function (x) { return x.k === 'H'; }), ls = w.filter(function (x) { return x.k === 'L'; });
        if (hs.length === 2 && ls.length === 2) {
          var span = w[3].i - w[0].i, px = (hs[0].v + ls[0].v) / 2;
          var sh = (hs[1].v - hs[0].v) / px, sl = (ls[1].v - ls[0].v) / px, flat = 0.015;
          var w0 = hs[0].v - ls[0].v, w1 = lineAt(hs[0], hs[1], w[3].i) - lineAt(ls[0], ls[1], w[3].i), conv = w1 < w0 * 0.8, para = Math.abs(w1 - w0) <= w0 * 0.2;
          var nm = null;
          if (Math.abs(sh) <= flat && sl > flat && conv) nm = 'Ascending triangle';
          else if (Math.abs(sl) <= flat && sh < -flat && conv) nm = 'Descending triangle';
          else if (sh < -flat && sl > flat) nm = 'Symmetrical triangle';
          else if (sh > flat && sl > flat && conv) nm = 'Rising wedge';
          else if (sh < -flat && sl < -flat && conv) nm = 'Falling wedge';
          else if (para && sh > flat && sl > flat) nm = 'Rising channel';
          else if (para && sh < -flat && sl < -flat) nm = 'Falling channel';
          if (nm && /channel/.test(nm) && span <= 25) {   // a short counter-trend channel after a pole reads as a flag
            var i0 = Math.max(0, w[0].i - 15), pole = (c[w[0].i].close - c[i0].close) / c[i0].close;
            if (pole >= 0.08 && sh < 0) nm = 'Bull flag'; else if (pole <= -0.08 && sh > 0) nm = 'Bear flag'; }
          if (nm) { add({ name: nm, piv: w, up: hs, dn: ls }); continue; } } }
      // double top / bottom: three pivots, equal extremes, a real dip between
      if (a.k === 'H' && near(a.v, d.v, 0.02) && b.v < Math.min(a.v, d.v) * 0.96) {
        add({ name: 'Double top', piv: [a, b, d], neck: [b, { i: n - 1, v: b.v }], target: b.v - ((a.v + d.v) / 2 - b.v), dir: -1 }); continue; }
      if (a.k === 'L' && near(a.v, d.v, 0.02) && b.v > Math.max(a.v, d.v) * 1.04) {
        add({ name: 'Double bottom', piv: [a, b, d], neck: [b, { i: n - 1, v: b.v }], target: b.v + (b.v - (a.v + d.v) / 2), dir: 1 }); continue; }
    }
    return out; }
  function fqxRows(o) { return ((o.extra && o.extra.fqx) || []).slice().sort(function (x, y) { return x.t < y.t ? -1 : x.t > y.t ? 1 : 0; }); }
  function fqxStep(c, o, key, div, signed, color) {
    var q = fqxRows(o); if (!q.length || !c.length || typeof c[0].time !== 'string') return [];
    var out = [], j = -1;
    for (var i = 0; i < c.length; i++) { while (j + 1 < q.length && q[j + 1].t <= c[i].time) j++;
      if (j < 0 || q[j][key] == null) continue;
      var v = +(q[j][key] / div).toFixed(2), pt = { time: c[i].time, value: v };
      if (signed) pt.color = v >= 0 ? TR('good', 0.7) : TR('bad', 0.7);
      out.push(pt); }
    if (!out.length) return [];
    return signed ? [{ data: out, histogram: true }] : [{ data: out, color: color, width: 2, steps: true }];
  }
  // each session holds the quarter last filed before it, coloured by the change on the year-ago quarter
  function fqParts(c, o, key, yk, div) {
    var q = ((o.extra && o.extra.fq) || []).slice().sort(function (x, y) { return x.t < y.t ? -1 : x.t > y.t ? 1 : 0; });
    if (!q.length || !c.length || typeof c[0].time !== 'string') return [];
    var out = [], j = -1;
    for (var i = 0; i < c.length; i++) {
      while (j + 1 < q.length && q[j + 1].t <= c[i].time) j++;
      if (j < 0 || q[j][key] == null) continue;
      var y = q[j][yk];
      out.push({ time: c[i].time, value: +(q[j][key] / div).toFixed(2),
                 color: y == null ? TR('mute', 0.55) : y >= 0 ? TR('good', 0.7) : TR('bad', 0.7) });
    }
    return out.length ? [{ data: out, histogram: true }] : [];
  }
  var STUDIES = {
    bb: { label: 'Bollinger Bands', group: 'On the price', pane: 0,
      params: [{ k: 'p', label: 'Length', def: 20 }, { k: 'm', label: 'Deviations', def: 2, step: 0.5 }],
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; });
        var m = sma(cl, g.p), sd = stdev(cl, g.p);
        function b(mul) { var a = []; for (var i = 0; i < c.length; i++)
          a.push(m[i] != null && sd[i] != null ? m[i] + mul * sd[i] : null); return line(c, a); }
        return [{ data: b(g.m), color: C.g, width: 1 }, { data: b(0), color: C.g, width: 1, dashed: true },
                { data: b(-g.m), color: C.g, width: 1 }]; } },
    keltner: { label: 'Keltner Channel', group: 'On the price', pane: 0,
      params: [{ k: 'p', label: 'Length', def: 20 }, { k: 'm', label: 'ATR multiple', def: 2, step: 0.5 }],
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; });
        var m = ema(cl, g.p), a = atr(c, 10);
        function b(mul) { var o = []; for (var i = 0; i < c.length; i++)
          o.push(m[i] != null && a[i] != null ? m[i] + mul * a[i] : null); return line(c, o); }
        return [{ data: b(g.m), color: C.b, width: 1 }, { data: b(-g.m), color: C.b, width: 1 }]; } },
    donchian: { label: 'Donchian Channel', group: 'On the price', pane: 0,
      params: [{ k: 'p', label: 'Length', def: 20 }],
      build: function (c, vol, g) { return [{ data: line(c, hhv(c, g.p, 'high')), color: C.dn, width: 1 },
                                            { data: line(c, llv(c, g.p, 'low')), color: C.up, width: 1 }]; } },
    vwap: { label: 'VWAP from the window start', group: 'On the price', pane: 0,
      params: [], build: function (c, vol) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var pv = 0, vv = 0, o = [];
        for (var i = 0; i < c.length; i++) { var tp = (c[i].high + c[i].low + c[i].close) / 3, q = v[i] || 0;
          pv += tp * q; vv += q; o.push(vv ? pv / vv : null); }
        return [{ data: line(c, o), color: C.a, width: 2 }]; } },
    // restarts at every session (New York date); daily bars are one session each, so only intraday draws
    vwap_session: { label: 'Session VWAP with 1 and 2 deviation bands', group: 'On the price', pane: 0,
      params: [], build: function (c, vol) { var v = volsOf(c, vol);
        if (!c.length || typeof c[0].time === 'string' || !v.some(function (x) { return x; })) return [];
        var f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }), day = null,
            pv = 0, p2 = 0, vv = 0, mid = [], sd = [];
        for (var i = 0; i < c.length; i++) { var d = f.format(new Date(c[i].time * 1000)), q = v[i] || 0,
            tp = (c[i].high + c[i].low + c[i].close) / 3;
          if (d !== day) { day = d; pv = 0; p2 = 0; vv = 0; }
          pv += tp * q; p2 += tp * tp * q; vv += q;
          if (vv) { var m = pv / vv; mid.push(m); sd.push(Math.sqrt(Math.max(0, p2 / vv - m * m))); }
          else { mid.push(null); sd.push(null); } }
        function band(k) { return line(c, mid.map(function (m, i) { return m == null ? null : m + k * sd[i]; })); }
        return [{ data: line(c, mid), color: C.a, width: 2 },
                { data: band(1), color: C.a, width: 1 }, { data: band(-1), color: C.a, width: 1 },
                { data: band(2), color: C.a, width: 1, dashed: true }, { data: band(-2), color: C.a, width: 1, dashed: true }]; } },
    supertrend: { label: 'Supertrend', group: 'On the price', pane: 0,
      params: [{ k: 'p', label: 'ATR length', def: 10 }, { k: 'm', label: 'Multiple', def: 3, step: 0.5 }],
      build: function (c, vol, g) { var a = atr(c, g.p), up = [], dn = [], dir = 1, prev = null;
        for (var i = 0; i < c.length; i++) { if (a[i] == null) { up.push(null); dn.push(null); continue; }
          var mid = (c[i].high + c[i].low) / 2, u = mid + g.m * a[i], l = mid - g.m * a[i];
          if (prev != null) { if (c[i].close > prev) dir = 1; else if (c[i].close < prev) dir = -1; }
          prev = dir > 0 ? l : u; up.push(dir > 0 ? l : null); dn.push(dir > 0 ? null : u); }
        return [{ data: line(c, up), color: C.up, width: 2 }, { data: line(c, dn), color: C.dn, width: 2 }]; } },
    psar: { label: 'Parabolic SAR', group: 'On the price', pane: 0,
      params: [{ k: 'a', label: 'Step', def: 0.02, step: 0.01 }, { k: 'm', label: 'Maximum', def: 0.2, step: 0.02 }],
      build: function (c, vol, g) { if (c.length < 3) return [];
        var o = [], dir = 1, af = g.a, ep = c[0].high, sar = c[0].low;
        for (var i = 1; i < c.length; i++) { sar = sar + af * (ep - sar);
          if (dir > 0) { if (c[i].low < sar) { dir = -1; sar = ep; ep = c[i].low; af = g.a; }
            else if (c[i].high > ep) { ep = c[i].high; af = Math.min(g.m, af + g.a); } }
          else { if (c[i].high > sar) { dir = 1; sar = ep; ep = c[i].high; af = g.a; }
            else if (c[i].low < ep) { ep = c[i].low; af = Math.min(g.m, af + g.a); } }
          o.push(sar); }
        o.unshift(null); return [{ data: line(c, o), color: C.a, width: 1 }]; } },

    ichimoku: { label: 'Ichimoku', group: 'On the price', pane: 0,
      params: [{ k: 'a', label: 'Conversion', def: 9 }, { k: 'b', label: 'Base', def: 26 }, { k: 'c', label: 'Span B', def: 52 }],
      build: function (c, vol, g) {
        function mid(p) { var h = hhv(c, p, 'high'), l = llv(c, p, 'low'), o = [];
          for (var i = 0; i < c.length; i++) o.push(h[i] == null || l[i] == null ? null : (h[i] + l[i]) / 2);
          return o; }
        var ten = mid(g.a), kij = mid(g.b), spb = mid(g.c), spa = [], i;
        for (i = 0; i < c.length; i++) spa.push(ten[i] != null && kij[i] != null ? (ten[i] + kij[i]) / 2 : null);
        // the cloud is pushed forward by the base period: read it as the value
        // computed that many bars ago. The part that would sit past today is not drawn.
        function shiftFwd(a2) { var o = []; for (i = 0; i < c.length; i++) o.push(i >= g.b ? a2[i - g.b] : null); return o; }
        var lag = []; for (i = 0; i < c.length; i++) lag.push(i + g.b < c.length ? c[i + g.b].close : null);
        return [{ data: line(c, ten), color: C.b, width: 1 },
                { data: line(c, kij), color: C.dn, width: 1 },
                { data: line(c, shiftFwd(spa)), color: TR('good', 0.55), width: 1 },
                { data: line(c, shiftFwd(spb)), color: TR('bad', 0.55), width: 1 },
                { data: line(c, lag), color: C.a, width: 1, dashed: true }]; } },
    rsi: { label: 'RSI', group: 'Momentum', pane: 1, height: 110, bands: [30, 70],
      params: [{ k: 'p', label: 'Length', def: 14 }],
      build: function (c, vol, g) { return [{ data: line(c, rsi(c.map(function (x) { return x.close; }), g.p), 1),
                                              color: C.a, width: 2 }]; } },
    macd: { label: 'MACD', group: 'Momentum', pane: 1, height: 110, bands: [0],
      params: [{ k: 'f', label: 'Fast', def: 12 }, { k: 's', label: 'Slow', def: 26 }, { k: 'g', label: 'Signal', def: 9 }],
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; });
        var f = ema(cl, g.f), sl = ema(cl, g.s), m = [], i;
        for (i = 0; i < cl.length; i++) m.push(f[i] != null && sl[i] != null ? f[i] - sl[i] : null);
        var sig = ema(m, g.g), hs = [];
        for (i = 0; i < cl.length; i++) hs.push(m[i] != null && sig[i] != null ? m[i] - sig[i] : null);
        var bars = line(c, hs).map(function (x) { return { time: x.time, value: x.value,
          color: x.value >= 0 ? TR('good', 0.45) : TR('bad', 0.45) }; });
        return [{ data: bars, histogram: true }, { data: line(c, m), color: C.b, width: 2 },
                { data: line(c, sig), color: C.c, width: 1 }]; } },
    stoch: { label: 'Stochastic', group: 'Momentum', pane: 1, height: 110, bands: [20, 80],
      params: [{ k: 'p', label: 'Length', def: 14 }, { k: 'd', label: 'Smoothing', def: 3 }],
      build: function (c, vol, g) { var hi = hhv(c, g.p, 'high'), lo = llv(c, g.p, 'low'), k = [];
        for (var i = 0; i < c.length; i++) { if (hi[i] == null || hi[i] === lo[i]) { k.push(null); continue; }
          k.push((c[i].close - lo[i]) / (hi[i] - lo[i]) * 100); }
        return [{ data: line(c, k, 1), color: C.b, width: 2 },
                { data: line(c, sma(k.map(function (x) { return x == null ? 0 : x; }), g.d), 1), color: C.c, width: 1 }]; } },
    cci: { label: 'CCI', group: 'Momentum', pane: 1, height: 100, bands: [-100, 100],
      params: [{ k: 'p', label: 'Length', def: 20 }],
      build: function (c, vol, g) { var tp = c.map(function (x) { return (x.high + x.low + x.close) / 3; });
        var m = sma(tp, g.p), o = [];
        for (var i = 0; i < c.length; i++) { if (m[i] == null) { o.push(null); continue; }
          var dev = 0; for (var j = 0; j < g.p; j++) dev += Math.abs(tp[i - j] - m[i]); dev /= g.p;
          o.push(dev ? (tp[i] - m[i]) / (0.015 * dev) : 0); }
        return [{ data: line(c, o, 1), color: C.a, width: 2 }]; } },
    willr: { label: 'Williams %R', group: 'Momentum', pane: 1, height: 100, bands: [-80, -20],
      params: [{ k: 'p', label: 'Length', def: 14 }],
      build: function (c, vol, g) { var hi = hhv(c, g.p, 'high'), lo = llv(c, g.p, 'low'), o = [];
        for (var i = 0; i < c.length; i++) o.push(hi[i] == null || hi[i] === lo[i] ? null
          : (hi[i] - c[i].close) / (hi[i] - lo[i]) * -100);
        return [{ data: line(c, o, 1), color: C.d, width: 2 }]; } },
    roc: { label: 'Rate of change', group: 'Momentum', pane: 1, height: 100, bands: [0],
      params: [{ k: 'p', label: 'Length', def: 12 }],
      build: function (c, vol, g) { var o = [];
        for (var i = 0; i < c.length; i++) o.push(i < g.p || !c[i - g.p].close ? null
          : (c[i].close / c[i - g.p].close - 1) * 100);
        return [{ data: line(c, o, 1), color: C.b, width: 2 }]; } },
    adx: { label: 'ADX and directional movement', group: 'Momentum', pane: 1, height: 110, bands: [25],
      params: [{ k: 'p', label: 'Length', def: 14 }],
      build: function (c, vol, g) { var pdm = [], ndm = [], tr = trueRange(c), i;
        for (i = 0; i < c.length; i++) { if (i === 0) { pdm.push(0); ndm.push(0); continue; }
          var u = c[i].high - c[i - 1].high, d = c[i - 1].low - c[i].low;
          pdm.push(u > d && u > 0 ? u : 0); ndm.push(d > u && d > 0 ? d : 0); }
        var ap = ema(pdm, g.p), an = ema(ndm, g.p), at = ema(tr, g.p), pdi = [], ndi = [], dx = [];
        for (i = 0; i < c.length; i++) { if (!at[i]) { pdi.push(null); ndi.push(null); dx.push(null); continue; }
          var P = ap[i] / at[i] * 100, N = an[i] / at[i] * 100;
          pdi.push(P); ndi.push(N); dx.push(P + N ? Math.abs(P - N) / (P + N) * 100 : 0); }
        return [{ data: line(c, ema(dx.map(function (x) { return x == null ? 0 : x; }), g.p), 1), color: C.a, width: 2 },
                { data: line(c, pdi, 1), color: C.up, width: 1 },
                { data: line(c, ndi, 1), color: C.dn, width: 1 }]; } },

    atr: { label: 'ATR', group: 'Volatility', pane: 1, height: 90,
      params: [{ k: 'p', label: 'Length', def: 14 }],
      build: function (c, vol, g) { return [{ data: line(c, atr(c, g.p)), color: C.d, width: 2 }]; } },
    bbw: { label: 'Bollinger bandwidth', group: 'Volatility', pane: 1, height: 90,
      params: [{ k: 'p', label: 'Length', def: 20 }],
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; });
        var m = sma(cl, g.p), sd = stdev(cl, g.p), o = [];
        for (var i = 0; i < c.length; i++) o.push(m[i] && sd[i] != null ? 4 * sd[i] / m[i] * 100 : null);
        return [{ data: line(c, o, 2), color: C.b, width: 2 }]; } },
    hv: { label: 'Historical volatility', group: 'Volatility', pane: 1, height: 90,
      params: [{ k: 'p', label: 'Length', def: 20 }],
      build: function (c, vol, g) { var r = [c.length ? null : null], i;
        for (i = 1; i < c.length; i++) r.push(c[i - 1].close ? Math.log(c[i].close / c[i - 1].close) : null);
        var o = [];
        for (i = 0; i < c.length; i++) { if (i < g.p) { o.push(null); continue; }
          var m = 0, j; for (j = 0; j < g.p; j++) m += r[i - j] || 0; m /= g.p;
          var q = 0; for (j = 0; j < g.p; j++) q += Math.pow((r[i - j] || 0) - m, 2);
          o.push(Math.sqrt(q / g.p) * Math.sqrt(252) * 100); }
        return [{ data: line(c, o, 1), color: C.d, width: 2 }]; } },

    vola: { label: 'Volume against its own average', group: 'Volume', pane: 1, height: 90,
      params: [{ k: 'p', label: 'Average length', def: 50 }],
      build: function (c, vol, g) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var av = sma(v.map(function (x) { return x || 0; }), g.p), o = [];
        for (var i = 0; i < c.length; i++) o.push(v[i] != null && av[i] ? v[i] / av[i] : null);
        var bars = line(c, o).map(function (x) { return { time: x.time, value: x.value,
          color: x.value >= 1.5 ? TR('warn', 0.55) : TR('mute', 0.35) }; });
        return [{ data: bars, histogram: true }]; } },
    obv: { label: 'On balance volume', group: 'Volume', pane: 1, height: 90, params: [],
      build: function (c, vol) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var t = 0, o = [];
        for (var i = 0; i < c.length; i++) { if (i && c[i].close > c[i - 1].close) t += v[i] || 0;
          else if (i && c[i].close < c[i - 1].close) t -= v[i] || 0; o.push(t / 1e6); }
        return [{ data: line(c, o, 1), color: C.b, width: 2 }]; } },
    mfi: { label: 'Money flow index', group: 'Volume', pane: 1, height: 100, bands: [20, 80],
      params: [{ k: 'p', label: 'Length', def: 14 }],
      build: function (c, vol, g) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var tp = c.map(function (x) { return (x.high + x.low + x.close) / 3; }), o = [];
        for (var i = 0; i < c.length; i++) { if (i < g.p) { o.push(null); continue; }
          var pos = 0, neg = 0;
          for (var j = 0; j < g.p; j++) { var k = i - j; if (!k) continue;
            var f = tp[k] * (v[k] || 0); if (tp[k] > tp[k - 1]) pos += f; else neg += f; }
          o.push(neg ? 100 - 100 / (1 + pos / neg) : 100); }
        return [{ data: line(c, o, 1), color: C.a, width: 2 }]; } },
    cmf: { label: 'Chaikin money flow', group: 'Volume', pane: 1, height: 90, bands: [0],
      params: [{ k: 'p', label: 'Length', def: 20 }],
      build: function (c, vol, g) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var mfv = c.map(function (b, i) { var r = b.high - b.low;
          return r ? ((b.close - b.low) - (b.high - b.close)) / r * (v[i] || 0) : 0; });
        var o = [];
        for (var i = 0; i < c.length; i++) { if (i < g.p - 1) { o.push(null); continue; }
          var a = 0, q = 0; for (var j = 0; j < g.p; j++) { a += mfv[i - j]; q += v[i - j] || 0; }
          o.push(q ? a / q : null); }
        return [{ data: line(c, o, 3), color: C.b, width: 2 }]; } },

    // ── the studies swing traders search for by name ────────────────────────
    adr: { label: 'Average daily range, in percent', group: 'Trader-built', pane: 1, height: 90,
      params: [{ k: 'p', label: 'Length', def: 20 }],
      build: function (c, vol, g) { var r = c.map(function (b) { return b.low ? (b.high / b.low - 1) * 100 : null; });
        return [{ data: line(c, sma(r, g.p), 2), color: C.d, width: 2 }]; } },
    rmv: { label: 'Relative measured volatility', group: 'Trader-built', pane: 1, height: 90, bands: [15],
      params: [{ k: 'p', label: 'Lookback', def: 15 }],
      // how tight the last three bars are, on a 0-100 scale against the tightest
      // and widest reading of the lookback. Low = coiled. Our rendition of the idea.
      build: function (c, vol, g) { var w = [], o = [], i;
        for (i = 0; i < c.length; i++) { if (i < 2) { w.push(null); continue; }
          var hi = Math.max(c[i].high, c[i - 1].high, c[i - 2].high), lo = Math.min(c[i].low, c[i - 1].low, c[i - 2].low);
          w.push(lo ? (hi - lo) / lo * 100 : null); }
        for (i = 0; i < c.length; i++) { if (i < g.p + 1 || w[i] == null) { o.push(null); continue; }
          var mn = Infinity, mx = -Infinity;
          for (var j = 0; j < g.p; j++) { var x = w[i - j]; if (x == null) continue; mn = Math.min(mn, x); mx = Math.max(mx, x); }
          o.push(mx > mn ? (w[i] - mn) / (mx - mn) * 100 : 0); }
        return [{ data: line(c, o, 1), color: C.b, width: 2 }]; } },
    mansfield: { label: 'Mansfield relative strength', group: 'Trader-built', pane: 1, height: 100, bands: [0],
      params: [{ k: 'p', label: 'Length', def: 100 }],
      // price against the S&P, then that ratio against its own average: above zero
      // the name has been beating the index over the length
      build: function (c, vol, g, o, spy) { var s = spyOf(c, spy); if (!s.some(function (x) { return x; })) return [];
        var r = c.map(function (b, i) { return s[i] ? b.close / s[i] : null; });
        var m = sma(r, g.p), out = [];
        for (var i = 0; i < c.length; i++) out.push(r[i] != null && m[i] ? (r[i] / m[i] - 1) * 100 : null);
        return [{ data: line(c, out, 2), color: C.a, width: 2 }]; } },
    udvol: { label: 'Up/down volume ratio', group: 'Trader-built', pane: 1, height: 90, bands: [1],
      params: [{ k: 'p', label: 'Length', def: 50 }],
      build: function (c, vol, g) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var o = [];
        for (var i = 0; i < c.length; i++) { if (i < g.p) { o.push(null); continue; }
          var up = 0, dn = 0;
          for (var j = 0; j < g.p; j++) { var k = i - j; if (!k) continue; var q = v[k] || 0;
            if (c[k].close > c[k - 1].close) up += q; else if (c[k].close < c[k - 1].close) dn += q; }
          o.push(dn ? up / dn : null); }
        return [{ data: line(c, o, 2), color: C.up, width: 2 }]; } },
    dvol: { label: 'Dollar volume, in millions', group: 'Trader-built', pane: 1, height: 90, params: [],
      build: function (c, vol) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var bars2 = [];
        for (var i = 0; i < c.length; i++) if (v[i] != null) bars2.push({ time: c[i].time,
          value: +(c[i].close * v[i] / 1e6).toFixed(1),
          color: c[i].close >= c[i].open ? TR('good', 0.45) : TR('bad', 0.45) });
        return [{ data: bars2, histogram: true }]; } },
    atrx: { label: 'Distance from the moving average, in ATRs', group: 'Trader-built', pane: 1, height: 90, bands: [0],
      params: [{ k: 'p', label: 'Average length', def: 50 }, { k: 'a', label: 'ATR length', def: 14 }],
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; });
        var m = sma(cl, g.p), a = atr(c, g.a), o = [];
        for (var i = 0; i < c.length; i++) o.push(m[i] != null && a[i] ? (cl[i] - m[i]) / a[i] : null);
        return [{ data: line(c, o, 2), color: C.d, width: 2 }]; } },
    squeeze: { label: 'TTM squeeze', group: 'Trader-built', pane: 1, height: 100, bands: [0],
      params: [{ k: 'p', label: 'Length', def: 20 }, { k: 'm', label: 'Bollinger deviations', def: 2, step: 0.5 },
               { k: 'k', label: 'Keltner multiple', def: 1.5, step: 0.5 }],
      // orange bars = the Bollinger bands sit inside the Keltner channel (the squeeze is on);
      // the bar itself is the momentum, a fitted line of the close against the window's midpoint
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; });
        var m = sma(cl, g.p), sd = stdev(cl, g.p), a = atr(c, g.p), hi = hhv(c, g.p, 'high'), lo = llv(c, g.p, 'low');
        var dev = [], i;
        for (i = 0; i < c.length; i++) dev.push(m[i] != null && hi[i] != null ? cl[i] - ((hi[i] + lo[i]) / 2 + m[i]) / 2 : null);
        var mom = linreg(dev, g.p), bars2 = [];
        for (i = 0; i < c.length; i++) { if (mom[i] == null) continue;
          var on = sd[i] != null && a[i] != null && g.m * sd[i] < g.k * a[i];
          bars2.push({ time: c[i].time, value: +mom[i].toFixed(2),
            color: on ? TR('warn', 0.85) : (mom[i] >= 0 ? TR('good', 0.45) : TR('bad', 0.45)) }); }
        return [{ data: bars2, histogram: true }]; } },
    ripster: { label: 'Ripster EMA clouds', group: 'Trader-built', pane: 0,
      params: [{ k: 'a', label: 'Cloud 1 from', def: 5 }, { k: 'b', label: 'Cloud 1 to', def: 12 },
               { k: 'c', label: 'Cloud 2 from', def: 34 }, { k: 'd', label: 'Cloud 2 to', def: 50 }],
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; });
        return [{ data: line(c, ema(cl, g.a)), color: C.b, width: 1 }, { data: line(c, ema(cl, g.b)), color: C.b, width: 1, dashed: true },
                { data: line(c, ema(cl, g.c)), color: C.a, width: 1 }, { data: line(c, ema(cl, g.d)), color: C.a, width: 1, dashed: true }]; } },

    expected: { label: 'Expected move from implied vol, 30 days, one sigma', group: 'Our data', pane: 0, daily: true,
      params: [{ k: 'd', label: 'Days ahead', def: 30 }],
      // what the options market prices as a one-standard-deviation move: the
      // cone is close x iv x sqrt(t/252), drawn on the calendar past today
      build: function (c, vol, g, o) { var iv = o && o.iv ? +o.iv / 100 : 0; if (!iv || !c.length) return [];
        var last = c[c.length - 1], C0 = last.close, up = [{ time: last.time, value: C0 }], dn = [{ time: last.time, value: C0 }];
        var dt = new Date(last.time + 'T00:00:00Z'), k = 0;
        while (k < g.d) { dt.setUTCDate(dt.getUTCDate() + 1); var wd = dt.getUTCDay(); if (wd === 0 || wd === 6) continue; k++;
          var t = dt.toISOString().slice(0, 10), m = iv * Math.sqrt(k / 252);
          up.push({ time: t, value: +(C0 * (1 + m)).toFixed(2) }); dn.push({ time: t, value: +(C0 * (1 - m)).toFixed(2) }); }
        return [{ data: up, color: C.a, width: 1, dashed: true }, { data: dn, color: C.a, width: 1, dashed: true }]; } },
    ours_rs: { label: 'Relative strength against the S&P', group: 'Our data', pane: 1, height: 100, bands: [100],
      params: [], daily: true,
      build: function (c, vol, g, o) { var part = { data: tail(c, o.rs, 1), color: C.a, width: 2 };
        // dark rs_new_high: a circle on every 52-week record of the line (the page sends the days),
        // dark blue when the price is still under its own 52-week high, pale when it agrees
        if (o.rsnh && part.data.length) { var has = {}; part.data.forEach(function (x) { has[x.time] = 1; });
          part.marks = o.rsnh.filter(function (r) { return has[r.d]; }).map(function (r) {
            return { time: r.d, position: 'inBar', shape: 'circle', size: r.strong ? 1.6 : 0.9,
                     color: r.strong ? TR('text', 1) : TR('text', 0.32) }; });
          part.legend = 'Circle: the line is at a 52-week high  \u00b7  dark: the price is still under its own'; }
        return [part]; } },
    ours_score: { label: 'Our conviction score, session by session', group: 'Our data', pane: 1, height: 100, bands: [65],
      params: [], daily: true,
      build: function (c, vol, g, o) { return [{ data: tail(c, o.score, 0), color: C.b, width: 2 }]; } },
    ours_desk: { label: 'What the desk said, day by day', group: 'Our data', pane: 1, height: 100, bands: [65],
      params: [], daily: true,
      build: function (c, vol, g, o) {
        var d = o.desk; if (!d || !d.score) return [];
        var bars2 = [];
        for (var i = 0; i < c.length; i++) {
          var v = d.score[c[i].time];
          if (v == null) continue;
          bars2.push({ time: c[i].time, value: v,
                       color: v >= 80 ? TR('text', 0.75) : TR('text', 0.40) });
        }
        return bars2.length ? [{ data: bars2, histogram: true }] : []; } },
    ours_gex: { label: 'Dealer gamma through time', group: 'Our data', pane: 1, height: 100, bands: [0],
      params: [], daily: true,
      build: function (c, vol, g, o) { return [{ data: tail(c, o.gex, 0), color: C.d, width: 2 }]; } },
    ours_prem: { label: 'Options premium, calls against puts', group: 'Our data', pane: 1, height: 100,
      params: [], daily: true,
      build: function (c, vol, g, o) { if (!o.callp) return [];
        var m = 1e9;
        return [{ data: tail(c, o.callp.map(function (x) { return x / m; }), 2), color: C.up, width: 2 },
                { data: tail(c, (o.putp || []).map(function (x) { return x / m; }), 2), color: C.dn, width: 2 }]; } },
    // ── TradingView's built-in technicals, the ones that make sense on daily bars ──
    wma: { label: 'Weighted moving average', group: 'Trend', pane: 0, params: [{ k: 'p', label: 'Length', def: 20 }], about: 'A moving average that weighs the latest bars more, linearly.',
      build: function (c, vol, g) { return [{ data: line(c, wmaOf(c.map(function (x) { return x.close; }), g.p)), color: C.b, width: 1 }]; } },
    dema: { label: 'DEMA', group: 'Trend', pane: 0, params: [{ k: 'p', label: 'Length', def: 20 }], about: 'Double exponential average: two EMAs combined to cut the lag.',
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; }), e1 = ema(cl, g.p), e2 = ema(e1.map(function (v) { return v == null ? 0 : v; }), g.p);
        return [{ data: line(c, e1.map(function (v, i) { return v == null || e2[i] == null ? null : 2 * v - e2[i]; })), color: C.b, width: 1 }]; } },
    tema: { label: 'TEMA', group: 'Trend', pane: 0, params: [{ k: 'p', label: 'Length', def: 20 }], about: 'Triple exponential average: three EMAs combined, even less lag.',
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; }), z = function (a) { return a.map(function (v) { return v == null ? 0 : v; }); };
        var e1 = ema(cl, g.p), e2 = ema(z(e1), g.p), e3 = ema(z(e2), g.p);
        return [{ data: line(c, e1.map(function (v, i) { return v == null ? null : 3 * v - 3 * e2[i] + e3[i]; })), color: C.b, width: 1 }]; } },
    vwma: { label: 'Volume-weighted moving average', group: 'Trend', pane: 0, params: [{ k: 'p', label: 'Length', def: 20 }], about: 'The average of the closes weighed by the volume of each bar.',
      build: function (c, vol, g) { var v = volsOf(c, vol), o = [];
        for (var i = 0; i < c.length; i++) { if (i < g.p - 1) { o.push(null); continue; } var a = 0, w = 0; for (var j = 0; j < g.p; j++) { a += c[i - j].close * (v[i - j] || 0); w += v[i - j] || 0; } o.push(w ? a / w : null); }
        return [{ data: line(c, o), color: C.b, width: 1 }]; } },
    alma: { label: 'Arnaud Legoux moving average', group: 'Trend', pane: 0, params: [{ k: 'p', label: 'Length', def: 20 }, { k: 'o', label: 'Offset', def: 0.85, step: 0.05 }, { k: 's', label: 'Sigma', def: 6 }], about: 'A Gaussian-weighted average, smooth and quick at once.',
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; }), m = g.o * (g.p - 1), sd = g.p / g.s, o = [];
        for (var i = 0; i < cl.length; i++) { if (i < g.p - 1) { o.push(null); continue; } var a = 0, w = 0; for (var j = 0; j < g.p; j++) { var wt = Math.exp(-((j - m) * (j - m)) / (2 * sd * sd)); a += cl[i - g.p + 1 + j] * wt; w += wt; } o.push(a / w); }
        return [{ data: line(c, o), color: C.b, width: 1 }]; } },
    lsma: { label: 'Least squares moving average', group: 'Trend', pane: 0, params: [{ k: 'p', label: 'Length', def: 25 }], about: 'The end point of a straight line fitted to the last bars.',
      build: function (c, vol, g) { return [{ data: line(c, linreg(c.map(function (x) { return x.close; }), g.p)), color: C.b, width: 1 }]; } },
    mcginley: { label: 'McGinley dynamic', group: 'Trend', pane: 0, params: [{ k: 'p', label: 'Length', def: 14 }], about: 'An average that speeds up in fast markets and slows in quiet ones.',
      build: function (c, vol, g) { var o = [], md = null; c.forEach(function (b) { if (md === null) md = b.close; else md = md + (b.close - md) / (g.p * Math.pow(b.close / md, 4)); o.push(md); });
        return [{ data: line(c, o), color: C.b, width: 1 }]; } },
    envelope: { label: 'Moving average envelope', group: 'Trend', pane: 0, params: [{ k: 'p', label: 'Length', def: 20 }, { k: 'm', label: 'Percent', def: 5, step: 0.5 }], about: 'A simple average with a band a fixed percent above and below.',
      build: function (c, vol, g) { var m = sma(c.map(function (x) { return x.close; }), g.p);
        return [{ data: line(c, m.map(function (v) { return v == null ? null : v * (1 + g.m / 100); })), color: C.g, width: 1 }, { data: line(c, m), color: C.b, width: 1 }, { data: line(c, m.map(function (v) { return v == null ? null : v * (1 - g.m / 100); })), color: C.g, width: 1 }]; } },
    ribbon: { label: 'Moving average ribbon', group: 'Trend', pane: 0, params: [{ k: 'a', label: 'From', def: 10 }, { k: 'b', label: 'Step', def: 10 }], about: 'Six exponential averages, from the shortest to the longest, as one ribbon.',
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; }), out = [];
        for (var k = 0; k < 6; k++) out.push({ data: line(c, ema(cl, g.a + k * g.b)), color: TR('s2', 0.9 - k * 0.12), width: 1 }); return out; } },
    aroon: { label: 'Aroon', group: 'Trend', pane: 1, height: 100, bands: [50], params: [{ k: 'p', label: 'Length', def: 14 }], about: 'How many bars since the last high and the last low, on a 0-100 scale.',
      build: function (c, vol, g) { var up = [], dn = [];
        for (var i = 0; i < c.length; i++) { if (i < g.p) { up.push(null); dn.push(null); continue; } var hi = -Infinity, lo = Infinity, ih = 0, il = 0;
          for (var j = 0; j <= g.p; j++) { var b = c[i - j]; if (b.high >= hi) { hi = b.high; ih = j; } if (b.low <= lo) { lo = b.low; il = j; } }
          up.push((g.p - ih) / g.p * 100); dn.push((g.p - il) / g.p * 100); }
        return [{ data: line(c, up, 1), color: C.up, width: 1 }, { data: line(c, dn, 1), color: C.dn, width: 1 }]; } },
    vortex: { label: 'Vortex', group: 'Trend', pane: 1, height: 100, bands: [1], params: [{ k: 'p', label: 'Length', def: 14 }], about: 'Two lines from the reach of each bar above and below the previous one; a cross marks a turn.',
      build: function (c, vol, g) { var tr = trueRange(c), vp = [], vm = [], i;
        for (i = 0; i < c.length; i++) { vp.push(i ? Math.abs(c[i].high - c[i - 1].low) : 0); vm.push(i ? Math.abs(c[i].low - c[i - 1].high) : 0); }
        function rs(a) { var o = []; for (var k = 0; k < a.length; k++) { if (k < g.p - 1) { o.push(null); continue; } var s2 = 0; for (var j = 0; j < g.p; j++) s2 += a[k - j]; o.push(s2); } return o; }
        var sp = rs(vp), sm = rs(vm), st = rs(tr);
        return [{ data: line(c, sp.map(function (v, k) { return v == null || !st[k] ? null : v / st[k]; }), 2), color: C.up, width: 1 }, { data: line(c, sm.map(function (v, k) { return v == null || !st[k] ? null : v / st[k]; }), 2), color: C.dn, width: 1 }]; } },
    chop: { label: 'Choppiness index', group: 'Trend', pane: 1, height: 90, bands: [38.2, 61.8], params: [{ k: 'p', label: 'Length', def: 14 }], about: 'Above 61.8 the market is churning, below 38.2 it is trending.',
      build: function (c, vol, g) { var tr = trueRange(c), o = [];
        for (var i = 0; i < c.length; i++) { if (i < g.p) { o.push(null); continue; } var s2 = 0, hi = -Infinity, lo = Infinity; for (var j = 0; j < g.p; j++) { s2 += tr[i - j]; hi = Math.max(hi, c[i - j].high); lo = Math.min(lo, c[i - j].low); }
          o.push(hi > lo ? 100 * Math.log10(s2 / (hi - lo)) / Math.log10(g.p) : null); }
        return [{ data: line(c, o, 1), color: C.d, width: 1 }]; } },
    dpo: { label: 'Detrended price oscillator', group: 'Momentum', pane: 1, height: 90, bands: [0], params: [{ k: 'p', label: 'Length', def: 21 }], about: 'The close against an average shifted back, to see the cycle without the trend.',
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; }), m = sma(cl, g.p), sh = Math.floor(g.p / 2) + 1, o = [];
        for (var i = 0; i < cl.length; i++) o.push(i >= sh && m[i - sh] != null ? cl[i] - m[i - sh] : null);
        return [{ data: line(c, o), color: C.b, width: 1 }]; } },
    kst: { label: 'Know sure thing', group: 'Momentum', pane: 1, height: 100, bands: [0], params: [], about: 'Four rates of change, smoothed and summed, with its signal line.',
      build: function (c, vol) { var cl = c.map(function (x) { return x.close; });
        function rocN(p) { return cl.map(function (v, i) { return i >= p && cl[i - p] ? (v / cl[i - p] - 1) * 100 : null; }); }
        function s(a, p) { return sma(a.map(function (v) { return v == null ? 0 : v; }), p); }
        var r1 = s(rocN(10), 10), r2 = s(rocN(15), 10), r3 = s(rocN(20), 10), r4 = s(rocN(30), 15), k = [];
        for (var i = 0; i < cl.length; i++) k.push(r1[i] == null || r4[i] == null ? null : r1[i] + 2 * r2[i] + 3 * r3[i] + 4 * r4[i]);
        return [{ data: line(c, k, 2), color: C.b, width: 1 }, { data: line(c, s(k, 9), 2), color: C.dn, width: 1 }]; } },
    mass: { label: 'Mass index', group: 'Volatility', pane: 1, height: 90, bands: [27], params: [], about: 'Range expansion measured on the high-low spread; a bulge above 27 often precedes a turn.',
      build: function (c) { var r = c.map(function (b) { return b.high - b.low; }), e1 = ema(r, 9), e2 = ema(e1.map(function (v) { return v == null ? 0 : v; }), 9), q = [], o = [];
        for (var i = 0; i < r.length; i++) q.push(e1[i] == null || !e2[i] ? null : e1[i] / e2[i]);
        for (i = 0; i < r.length; i++) { if (i < 24) { o.push(null); continue; } var s2 = 0, ok = true; for (var j = 0; j < 25; j++) { if (q[i - j] == null) { ok = false; break; } s2 += q[i - j]; } o.push(ok ? s2 : null); }
        return [{ data: line(c, o, 2), color: C.d, width: 1 }]; } },
    alligator: { label: 'Williams alligator', group: 'Trend', pane: 0, params: [], about: 'Three smoothed averages of the mid price, shifted forward: jaw 13, teeth 8, lips 5.',
      build: function (c) { var mid = c.map(function (b) { return (b.high + b.low) / 2; });
        function smma(a, p) { var o = [], m = null; for (var i = 0; i < a.length; i++) { if (i < p - 1) { o.push(null); continue; } if (m === null) { m = a.slice(0, p).reduce(function (x, y) { return x + y; }, 0) / p; } else m = (m * (p - 1) + a[i]) / p; o.push(m); } return o; }
        function shift(a, n) { var o = []; for (var i = 0; i < a.length; i++) o.push(i >= n ? a[i - n] : null); return o; }
        return [{ data: line(c, shift(smma(mid, 13), 8)), color: C.b, width: 1 }, { data: line(c, shift(smma(mid, 8), 5)), color: C.dn, width: 1 }, { data: line(c, shift(smma(mid, 5), 3)), color: C.up, width: 1 }]; } },
    fractals: { label: 'Williams fractals', group: 'Trader-built', pane: 0, params: [], about: 'A high with two lower highs on each side, a low with two higher lows on each side.',
      build: function (c) { var m = [];
        for (var i = 2; i < c.length - 2; i++) { if (c[i].high > c[i - 1].high && c[i].high > c[i - 2].high && c[i].high > c[i + 1].high && c[i].high > c[i + 2].high) m.push({ time: c[i].time, position: 'aboveBar', color: C.dn, shape: 'arrowDown', text: '' });
          if (c[i].low < c[i - 1].low && c[i].low < c[i - 2].low && c[i].low < c[i + 1].low && c[i].low < c[i + 2].low) m.push({ time: c[i].time, position: 'belowBar', color: C.up, shape: 'arrowUp', text: '' }); }
        return { markers: m }; } },
    bop: { label: 'Balance of power', group: 'Momentum', pane: 1, height: 80, bands: [0], params: [], about: 'Where the close sits between open and the bar\'s range: buyers or sellers had the bar.',
      build: function (c) { return [{ data: line(c, c.map(function (b) { return b.high > b.low ? (b.close - b.open) / (b.high - b.low) : 0; }), 2), color: C.b, width: 1 }]; } },
    ao: { label: 'Awesome oscillator', group: 'Momentum', pane: 1, height: 90, bands: [0], params: [], about: 'The 5-bar average of the mid price minus the 34-bar one, as bars.',
      build: function (c) { var mid = c.map(function (b) { return (b.high + b.low) / 2; }), a = sma(mid, 5), b2 = sma(mid, 34), o = [];
        for (var i = 0; i < mid.length; i++) o.push(a[i] == null || b2[i] == null ? null : a[i] - b2[i]);
        var d = line(c, o, 2); return [{ data: d.map(function (x, i) { return { time: x.time, value: x.value, color: i && x.value >= d[i - 1].value ? TR('good', 0.6) : TR('bad', 0.6) }; }), histogram: true }]; } },
    mom: { label: 'Momentum', group: 'Momentum', pane: 1, height: 80, bands: [0], params: [{ k: 'p', label: 'Length', def: 10 }], about: 'The close minus the close p bars ago.',
      build: function (c, vol, g) { return [{ data: line(c, c.map(function (b, i) { return i >= g.p ? b.close - c[i - g.p].close : null; })), color: C.b, width: 1 }]; } },
    stochrsi: { label: 'Stochastic RSI', group: 'Momentum', pane: 1, height: 100, bands: [20, 80], params: [{ k: 'p', label: 'RSI length', def: 14 }, { k: 's', label: 'Stochastic length', def: 14 }], about: 'The stochastic of the RSI: where the RSI sits in its own recent range.',
      build: function (c, vol, g) { var r = rsi(c.map(function (x) { return x.close; }), g.p), o = [];
        for (var i = 0; i < r.length; i++) { if (i < g.p + g.s || r[i] == null) { o.push(null); continue; } var hi = -Infinity, lo = Infinity; for (var j = 0; j < g.s; j++) { if (r[i - j] == null) continue; hi = Math.max(hi, r[i - j]); lo = Math.min(lo, r[i - j]); } o.push(hi > lo ? (r[i] - lo) / (hi - lo) * 100 : 50); }
        var k = sma(o.map(function (v) { return v == null ? 0 : v; }), 3);
        return [{ data: line(c, k, 1), color: C.b, width: 1 }, { data: line(c, sma(k, 3), 1), color: C.dn, width: 1 }]; } },
    trix: { label: 'TRIX', group: 'Momentum', pane: 1, height: 90, bands: [0], params: [{ k: 'p', label: 'Length', def: 18 }], about: 'The rate of change of a triple-smoothed exponential average.',
      build: function (c, vol, g) { var z = function (a) { return a.map(function (v) { return v == null ? 0 : v; }); }, e = ema(z(ema(z(ema(c.map(function (x) { return x.close; }), g.p)), g.p)), g.p), o = [];
        for (var i = 0; i < e.length; i++) o.push(i && e[i - 1] ? (e[i] / e[i - 1] - 1) * 10000 : null);
        return [{ data: line(c, o, 2), color: C.b, width: 1 }]; } },
    uo: { label: 'Ultimate oscillator', group: 'Momentum', pane: 1, height: 100, bands: [30, 70], params: [], about: 'Buying pressure over 7, 14 and 28 bars, weighted 4-2-1.',
      build: function (c) { var bp = [], tr = [], i;
        for (i = 0; i < c.length; i++) { var pc = i ? c[i - 1].close : c[i].close; bp.push(c[i].close - Math.min(c[i].low, pc)); tr.push(Math.max(c[i].high, pc) - Math.min(c[i].low, pc)); }
        function ratio(p, k) { var a = 0, b2 = 0; for (var j = 0; j < p; j++) { a += bp[k - j]; b2 += tr[k - j]; } return b2 ? a / b2 : 0; }
        var o = []; for (i = 0; i < c.length; i++) o.push(i < 28 ? null : 100 * (4 * ratio(7, i) + 2 * ratio(14, i) + ratio(28, i)) / 7);
        return [{ data: line(c, o, 1), color: C.b, width: 1 }]; } },
    tsi: { label: 'True strength index', group: 'Momentum', pane: 1, height: 100, bands: [0], params: [{ k: 'l', label: 'Long', def: 25 }, { k: 's', label: 'Short', def: 13 }], about: 'Double-smoothed price change against double-smoothed absolute change.',
      build: function (c, vol, g) { var d = c.map(function (b, i) { return i ? b.close - c[i - 1].close : 0; }), z = function (a) { return a.map(function (v) { return v == null ? 0 : v; }); };
        var n = ema(z(ema(d, g.l)), g.s), m = ema(z(ema(d.map(Math.abs), g.l)), g.s), o = [];
        for (var i = 0; i < d.length; i++) o.push(n[i] == null || !m[i] ? null : 100 * n[i] / m[i]);
        return [{ data: line(c, o, 2), color: C.b, width: 1 }, { data: line(c, ema(z(o), 13), 2), color: C.dn, width: 1 }]; } },
    coppock: { label: 'Coppock curve', group: 'Momentum', pane: 1, height: 90, bands: [0], params: [], about: 'A weighted average of two long rates of change, built for bottoms.',
      build: function (c) { var cl = c.map(function (x) { return x.close; }), r = cl.map(function (v, i) { return i >= 14 && cl[i - 14] && cl[i - 11] ? (v / cl[i - 14] - 1) * 100 + (v / cl[i - 11] - 1) * 100 : null; });
        return [{ data: line(c, wmaOf(r, 10), 2), color: C.b, width: 1 }]; } },
    efi: { label: 'Elder force index', group: 'Volume', pane: 1, height: 90, bands: [0], params: [{ k: 'p', label: 'Length', def: 13 }], about: 'Price change times volume, smoothed: the force behind the move.',
      build: function (c, vol, g) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var f = c.map(function (b, i) { return i ? (b.close - c[i - 1].close) * (v[i] || 0) / 1e6 : 0; });
        return [{ data: line(c, ema(f, g.p), 2), color: C.b, width: 1 }]; } },
    eom: { label: 'Ease of movement', group: 'Volume', pane: 1, height: 90, bands: [0], params: [{ k: 'p', label: 'Length', def: 14 }], about: 'How far price moved per unit of volume.',
      build: function (c, vol, g) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var e = c.map(function (b, i) { if (!i) return 0; var mv = ((b.high + b.low) - (c[i - 1].high + c[i - 1].low)) / 2, br = (v[i] || 0) / 1e6 / Math.max(1e-9, b.high - b.low); return br ? mv / br : 0; });
        return [{ data: line(c, sma(e, g.p), 3), color: C.b, width: 1 }]; } },
    pvt: { label: 'Price volume trend', group: 'Volume', pane: 1, height: 90, params: [], about: 'Volume added in proportion to the day\'s percent change, cumulated.',
      build: function (c, vol) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var t = 0, o = []; c.forEach(function (b, i) { if (i && c[i - 1].close) t += (b.close / c[i - 1].close - 1) * (v[i] || 0); o.push(t / 1e6); });
        return [{ data: line(c, o, 2), color: C.b, width: 1 }]; } },
    ad: { label: 'Accumulation / distribution', group: 'Volume', pane: 1, height: 90, params: [], about: 'Volume signed by where the close sits in the bar, cumulated.',
      build: function (c, vol) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var t = 0, o = []; c.forEach(function (b, i) { var r = b.high - b.low; t += r ? ((b.close - b.low) - (b.high - b.close)) / r * (v[i] || 0) : 0; o.push(t / 1e6); });
        return [{ data: line(c, o, 2), color: C.b, width: 1 }]; } },
    volosc: { label: 'Volume oscillator', group: 'Volume', pane: 1, height: 90, bands: [0], params: [{ k: 'f', label: 'Fast', def: 5 }, { k: 's', label: 'Slow', def: 10 }], about: 'The fast volume average against the slow one, in percent.',
      build: function (c, vol, g) { var v = volsOf(c, vol).map(function (x) { return x || 0; }); if (!v.some(function (x) { return x; })) return [];
        var f = ema(v, g.f), s2 = ema(v, g.s), o = []; for (var i = 0; i < v.length; i++) o.push(f[i] == null || !s2[i] ? null : (f[i] - s2[i]) / s2[i] * 100);
        return [{ data: line(c, o, 1), color: C.b, width: 1 }]; } },
    chaikinosc: { label: 'Chaikin oscillator', group: 'Volume', pane: 1, height: 90, bands: [0], params: [], about: 'The 3-bar EMA of accumulation/distribution minus its 10-bar EMA.',
      build: function (c, vol) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var t = 0, adl = []; c.forEach(function (b, i) { var r = b.high - b.low; t += r ? ((b.close - b.low) - (b.high - b.close)) / r * (v[i] || 0) : 0; adl.push(t / 1e6); });
        var a = ema(adl, 3), b2 = ema(adl, 10), o = []; for (var i = 0; i < adl.length; i++) o.push(a[i] == null || b2[i] == null ? null : a[i] - b2[i]);
        return [{ data: line(c, o, 2), color: C.b, width: 1 }]; } },
    netvol: { label: 'Net volume', group: 'Volume', pane: 1, height: 80, params: [], about: 'Volume counted up on an up close, down on a down close.',
      build: function (c, vol) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var d = []; c.forEach(function (b, i) { var s2 = !i ? 0 : b.close > c[i - 1].close ? 1 : b.close < c[i - 1].close ? -1 : 0; d.push({ time: b.time, value: +((v[i] || 0) * s2 / 1e6).toFixed(2), color: s2 >= 0 ? TR('good', 0.5) : TR('bad', 0.5) }); });
        return [{ data: d, histogram: true }]; } },
    stdev: { label: 'Standard deviation', group: 'Volatility', pane: 1, height: 80, params: [{ k: 'p', label: 'Length', def: 20 }], about: 'How much the closes spread around their average, in price.',
      build: function (c, vol, g) { return [{ data: line(c, stdev(c.map(function (x) { return x.close; }), g.p)), color: C.d, width: 1 }]; } },
    chaikinvol: { label: 'Chaikin volatility', group: 'Volatility', pane: 1, height: 80, bands: [0], params: [{ k: 'p', label: 'Length', def: 10 }], about: 'The rate of change of the smoothed high-low range.',
      build: function (c, vol, g) { var e = ema(c.map(function (b) { return b.high - b.low; }), g.p), o = [];
        for (var i = 0; i < e.length; i++) o.push(i >= g.p && e[i - g.p] ? (e[i] / e[i - g.p] - 1) * 100 : null);
        return [{ data: line(c, o, 1), color: C.d, width: 1 }]; } },
    bbpct: { label: 'Bollinger %B', group: 'Volatility', pane: 1, height: 80, bands: [0, 1], params: [{ k: 'p', label: 'Length', def: 20 }, { k: 'm', label: 'Deviations', def: 2, step: 0.5 }], about: 'Where the close sits between the bands: 0 at the lower, 1 at the upper.',
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; }), m = sma(cl, g.p), sd = stdev(cl, g.p), o = [];
        for (var i = 0; i < cl.length; i++) o.push(m[i] == null || !sd[i] ? null : (cl[i] - (m[i] - g.m * sd[i])) / (2 * g.m * sd[i]));
        return [{ data: line(c, o, 2), color: C.b, width: 1 }]; } },
    fisher: { label: 'Fisher transform', group: 'Momentum', pane: 1, height: 100, bands: [0], params: [{ k: 'p', label: 'Length', def: 9 }], about: 'Price turned into a bell-shaped scale so the turns stand out.',
      build: function (c, vol, g) { var mid = c.map(function (b) { return (b.high + b.low) / 2; }), v = 0, f = 0, o = [], prev = [];
        for (var i = 0; i < mid.length; i++) { if (i < g.p - 1) { o.push(null); prev.push(null); continue; } var hi = -Infinity, lo = Infinity; for (var j = 0; j < g.p; j++) { hi = Math.max(hi, mid[i - j]); lo = Math.min(lo, mid[i - j]); }
          var x = hi > lo ? (mid[i] - lo) / (hi - lo) - 0.5 : 0; v = 0.66 * x + 0.67 * v; v = Math.max(-0.999, Math.min(0.999, v)); var nf = 0.5 * Math.log((1 + v) / (1 - v)) + 0.5 * f; prev.push(f); f = nf; o.push(f); }
        return [{ data: line(c, o, 2), color: C.b, width: 1 }, { data: line(c, prev, 2), color: C.dn, width: 1 }]; } },
    ppo: { label: 'Price oscillator', group: 'Momentum', pane: 1, height: 90, bands: [0], params: [{ k: 'f', label: 'Fast', def: 12 }, { k: 's', label: 'Slow', def: 26 }], about: 'MACD in percent of the slow average, so names of any price compare.',
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; }), f = ema(cl, g.f), s2 = ema(cl, g.s), o = [];
        for (var i = 0; i < cl.length; i++) o.push(f[i] == null || !s2[i] ? null : (f[i] - s2[i]) / s2[i] * 100);
        return [{ data: line(c, o, 2), color: C.b, width: 1 }]; } },
    elderray: { label: 'Elder ray, bull and bear power', group: 'Momentum', pane: 1, height: 90, bands: [0], params: [{ k: 'p', label: 'Length', def: 13 }], about: 'The high above the EMA (bulls) and the low below it (bears).',
      build: function (c, vol, g) { var e = ema(c.map(function (x) { return x.close; }), g.p);
        var bull = line(c, c.map(function (b, i) { return e[i] == null ? null : b.high - e[i]; }), 2).map(function (x) { return { time: x.time, value: x.value, color: TR('good', 0.6) }; });
        var bear = line(c, c.map(function (b, i) { return e[i] == null ? null : b.low - e[i]; }), 2).map(function (x) { return { time: x.time, value: x.value, color: 'rgba(242,54,69,0.6)' }; });
        return [{ data: bull, histogram: true }, { data: bear, histogram: true }]; } },
    corr: { label: 'Correlation with the S&P', group: 'Our data', pane: 1, height: 90, bands: [0], params: [{ k: 'p', label: 'Length', def: 20 }], about: 'How closely the daily moves follow the index, from -1 to 1.',
      build: function (c, vol, g, o, spy) { var s2 = spyOf(c, spy); if (!s2.some(function (x) { return x; })) return [];
        var a = c.map(function (b, i) { return i && c[i - 1].close ? b.close / c[i - 1].close - 1 : null; }), b2 = c.map(function (b, i) { return i && s2[i] && s2[i - 1] ? s2[i] / s2[i - 1] - 1 : null; }), out = [];
        for (var i = 0; i < c.length; i++) { if (i < g.p) { out.push(null); continue; } var sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0, n = 0;
          for (var j = 0; j < g.p; j++) { var x = a[i - j], y = b2[i - j]; if (x == null || y == null) continue; n++; sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y; }
          var d = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy)); out.push(n > 3 && d ? (n * sxy - sx * sy) / d : null); }
        return [{ data: line(c, out, 2), color: C.a, width: 1 }]; } },
    webbyrsi: { label: 'Webby RSI', group: 'Trader-built', pane: 1, height: 80, bands: [0, 5], params: [{ k: 'p', label: 'EMA', def: 21 }], about: 'Webby\'s read: how far the low sits above the 21-day EMA, in percent. Extended above 5.',
      build: function (c, vol, g) { var e = ema(c.map(function (x) { return x.close; }), g.p);
        return [{ data: line(c, c.map(function (b, i) { return e[i] ? (b.low - e[i]) / e[i] * 100 : null; }), 2), color: C.b, width: 1 }]; } },
    stockbee_ti: { label: 'Stockbee trend intensity', group: 'Trader-built', pane: 1, height: 80, bands: [1.05], params: [], about: 'The 7-day average over the 65-day one: above 1.05 the trend is intense.',
      build: function (c) { var cl = c.map(function (x) { return x.close; }), a = sma(cl, 7), b2 = sma(cl, 65);
        return [{ data: line(c, a.map(function (v, i) { return v == null || !b2[i] ? null : v / b2[i]; }), 3), color: C.b, width: 1 }]; } },
    rolling_vwap: { label: 'Rolling VWAP', group: 'Trend', pane: 0, params: [{ k: 'p', label: 'Bars', def: 20 }], about: 'The volume-weighted average price over a moving window, not from a fixed start.',
      build: function (c, vol, g) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var o = []; for (var i = 0; i < c.length; i++) { if (i < g.p - 1) { o.push(null); continue; } var pv = 0, vv = 0; for (var j = 0; j < g.p; j++) { var b = c[i - j], q = v[i - j] || 0; pv += (b.high + b.low + b.close) / 3 * q; vv += q; } o.push(vv ? pv / vv : null); }
        return [{ data: line(c, o), color: C.a, width: 1 }]; } },
    pivots_fib: { label: 'Pivot points, Fibonacci, from last month', group: 'Trader-built', pane: 0, params: [], about: 'Same pivot as the classic one, with the levels at 38.2, 61.8 and 100 percent of last month\'s range.',
      build: function (c) { if (c.length < 25) return []; var lt = c[c.length - 1].time.slice(0, 7), prev = c.filter(function (b) { return b.time.slice(0, 7) < lt; }); if (!prev.length) return [];
        var pm = prev[prev.length - 1].time.slice(0, 7), mb = prev.filter(function (b) { return b.time.slice(0, 7) === pm; });
        var Hh = Math.max.apply(null, mb.map(function (b) { return b.high; })), L = Math.min.apply(null, mb.map(function (b) { return b.low; })), P = (Hh + L + mb[mb.length - 1].close) / 3, R = Hh - L;
        var cur2 = c.filter(function (b) { return b.time.slice(0, 7) === lt; }); if (!cur2.length) return [];
        return [['P', P, C.a], ['R1', P + 0.382 * R, C.dn], ['R2', P + 0.618 * R, C.dn], ['R3', P + R, C.dn], ['S1', P - 0.382 * R, C.up], ['S2', P - 0.618 * R, C.up], ['S3', P - R, C.up]].map(function (x) {
          return { data: cur2.map(function (b) { return { time: b.time, value: +x[1].toFixed(2) }; }), color: x[2], width: 1, dashed: x[0] !== 'P' }; }); } },
    newsm: { label: 'News on the bars', group: 'Our data', pane: 0, params: [], daily: true, about: 'An N on the session a cached headline landed; hover the bar to read it.',
      build: function (c, vol, g, o) { var items = (o && o.news) || []; if (!items.length) return [];
        var times = {}; c.forEach(function (b, i) { times[b.time] = i; });
        function snap(t) { if (times[t] != null) return t; var last = null; for (var i = 0; i < c.length; i++) { if (c[i].time <= t) last = c[i].time; else break; } return last; }
        var m = [], seen = {};
        items.forEach(function (n) { if (!n.date) return; var t = snap(n.date); if (!t) return;
          try { if (H.note) H.note(t, '<span style="color:'+C.m+'">N</span> ' + (n.title || '').slice(0, 90) + (n.source ? ' <span style="color:'+C.m+'">' + n.source + '</span>' : '')); } catch (e) {}
          if (seen[t]) return; seen[t] = 1; m.push({ time: t, position: 'aboveBar', color: C.m, shape: 'square', text: 'N' }); });
        m.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
        return { markers: m }; } },
    // ── the candle combos of the books, and what followed on this name ─────
    candles: { label: 'Candle patterns, one to three bars', group: 'Trader-built', pane: 0, params: [{ k: 'p', label: 'Trend context, bars', def: 5 }],
      about: 'Hammer, shooting star, doji, engulfing, harami, piercing, dark cloud, morning and evening star, three soldiers and crows, tweezers. Hover a mark: what followed on this name after the same pattern.',
      build: function (c, vol, g) { var n = c.length, out = [], byPat = {}, i;
        function B(b) { return Math.abs(b.close - b.open); } function R(b) { return b.high - b.low || 1e-9; }
        function up(b) { return b.close >= b.open; } function upper(b) { return b.high - Math.max(b.open, b.close); } function lower(b) { return Math.min(b.open, b.close) - b.low; }
        function down_before(i) { return i >= g.p && c[i].close < c[i - g.p].close; } function up_before(i) { return i >= g.p && c[i].close > c[i - g.p].close; }
        function add(i, code, name, bull) { (byPat[code] = byPat[code] || []).push(i); out.push({ i: i, code: code, name: name, bull: bull }); }
        for (i = 2; i < n; i++) { var b = c[i], p1 = c[i - 1], p2 = c[i - 2], body = B(b), rng = R(b);
          if (body <= 0.1 * rng) add(i, 'D', 'Doji', null);
          else if (lower(b) >= 2 * body && upper(b) <= 0.3 * body + 1e-9 && body < 0.5 * rng) { if (down_before(i)) add(i, 'H', 'Hammer', true); else if (up_before(i)) add(i, 'HM', 'Hanging man', false); }
          else if (upper(b) >= 2 * body && lower(b) <= 0.3 * body + 1e-9 && body < 0.5 * rng) { if (down_before(i)) add(i, 'IH', 'Inverted hammer', true); else if (up_before(i)) add(i, 'SS', 'Shooting star', false); }
          if (!up(p1) && up(b) && b.open <= p1.close && b.close >= p1.open && B(p1) > 0.3 * R(p1)) add(i, 'BE', 'Bullish engulfing', true);
          if (up(p1) && !up(b) && b.open >= p1.close && b.close <= p1.open && B(p1) > 0.3 * R(p1)) add(i, 'SE', 'Bearish engulfing', false);
          if (B(p1) >= 0.6 * R(p1) && body < 0.5 * B(p1) && Math.max(b.open, b.close) <= Math.max(p1.open, p1.close) && Math.min(b.open, b.close) >= Math.min(p1.open, p1.close)) add(i, 'HR', up(p1) ? 'Bearish harami' : 'Bullish harami', !up(p1));
          if (!up(p1) && up(b) && b.open < p1.low && b.close > (p1.open + p1.close) / 2 && b.close < p1.open) add(i, 'PL', 'Piercing line', true);
          if (up(p1) && !up(b) && b.open > p1.high && b.close < (p1.open + p1.close) / 2 && b.close > p1.open) add(i, 'DC', 'Dark cloud cover', false);
          if (!up(p2) && B(p2) >= 0.5 * R(p2) && B(p1) <= 0.3 * R(p1) && up(b) && b.close > (p2.open + p2.close) / 2) add(i, 'MS', 'Morning star', true);
          if (up(p2) && B(p2) >= 0.5 * R(p2) && B(p1) <= 0.3 * R(p1) && !up(b) && b.close < (p2.open + p2.close) / 2) add(i, 'ES', 'Evening star', false);
          if (up(p2) && up(p1) && up(b) && p1.close > p2.close && b.close > p1.close && p1.open > p2.open && p1.open < p2.close && b.open > p1.open && b.open < p1.close) add(i, '3W', 'Three white soldiers', true);
          if (!up(p2) && !up(p1) && !up(b) && p1.close < p2.close && b.close < p1.close && p1.open < p2.open && p1.open > p2.close && b.open < p1.open && b.open > p1.close) add(i, '3B', 'Three black crows', false);
          if (Math.abs(b.low - p1.low) <= 0.001 * b.low && down_before(i) && !up(p1) && up(b)) add(i, 'TB', 'Tweezer bottom', true);
          if (Math.abs(b.high - p1.high) <= 0.001 * b.high && up_before(i) && up(p1) && !up(b)) add(i, 'TT', 'Tweezer top', false); }
        // what followed, per pattern, on this name: the cases before each mark
        function after(code, upto) { var idx = byPat[code] || [], r5 = [], r20 = [];
          idx.forEach(function (j) { if (j >= upto) return; if (j + 5 < n) r5.push(c[j + 5].close / c[j].close - 1); if (j + 20 < n) r20.push(c[j + 20].close / c[j].close - 1); });
          function m(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; } function pc(x) { return (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'; }
          if (!r5.length) return 'first time on this name in this window';
          return 'before this one on this name, ' + r5.length + ' case' + (r5.length > 1 ? 's' : '') + ': ' + pc(m(r5)) + ' after 5 bars' + (r20.length ? ', ' + pc(m(r20)) + ' after 20, up ' + Math.round(r20.filter(function (x) { return x > 0; }).length / r20.length * 100) + '% of the time' : ''); }
        var m = [], seen = {};
        out.forEach(function (o) { var key = c[o.i].time + o.code; if (seen[key]) return; seen[key] = 1;
          var col = o.bull === null ? C.m : o.bull ? C.up : C.dn;
          m.push({ time: c[o.i].time, position: o.bull === false ? 'aboveBar' : 'belowBar', color: col, shape: o.bull === null ? 'circle' : o.bull ? 'arrowUp' : 'arrowDown', text: o.code });
          try { if (H.note) H.note(c[o.i].time, '<span style="color:' + col + '">●</span> ' + o.name + ' · ' + after(o.code, o.i)); } catch (e) {} });
        m.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
        return { markers: m }; } },
    // ── the market backdrop and the run of ants (dark chart_surge) ──────────
    ftd: { label: 'Follow-through and distribution days', group: 'Trader-built', pane: 0, params: [], daily: true,
      about: 'The market\'s own days on your chart. A green FTD marks a follow-through day: the index rallied at least 1.25% on rising volume, day 4 or later of a rally after a pullback. An orange D marks a distribution day: the index fell 0.2% or more on higher volume than the day before. Any name gets the S&P 500 days, QQQ gets the Nasdaq 100.',
      build: function (c, vol, g, o) { if (!(o && o.surge)) return []; var d = mktMarks(); if (!d) return [];
        var times = {}; c.forEach(function (b) { times[b.time] = 1; });
        var who = d.index === 'QQQ' ? 'Nasdaq 100' : 'S&P 500', m = [];
        (d.ftd || []).forEach(function (t) { if (!times[t]) return;
          m.push({ time: t, position: 'belowBar', color: C.up, shape: 'arrowUp', text: 'FTD' });
          try { if (H.note) H.note(t, '<span style="color:' + C.up + '">\u25B2</span> Follow-through day, ' + who); } catch (e) {} });
        (d.dist || []).forEach(function (t) { if (!times[t]) return;
          m.push({ time: t, position: 'aboveBar', color: C.d, shape: 'arrowDown', text: 'D' });
          try { if (H.note) H.note(t, '<span style="color:'+C.d+'">\u25BC</span> Distribution day, ' + who); } catch (e) {} });
        m.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
        return { markers: m }; } },
    ants: { label: 'Ants: 12 up days out of 15', group: 'Trader-built', pane: 0, params: [], daily: true,
      about: 'A small circle on a day when, over the last 15 sessions, at least 12 closed up on the session before, the close is 20% or more above the close 15 sessions back, and the stock traded more shares a day than in the 15 sessions before. A steady climb on rising volume. A place to look, not a call.',
      build: function (c, vol, g, o) { if (!(o && o.surge)) return []; var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var m = [];
        for (var i = 29; i < c.length; i++) { var base = c[i - 15].close; if (!base) continue;
          var ups = 0; for (var j = i - 14; j <= i; j++) if (c[j].close > c[j - 1].close) ups++;
          if (ups < 12 || c[i].close / base - 1 < 0.20) continue;
          var a = 0, b = 0; for (var k = 0; k < 15; k++) { a += v[i - k] || 0; b += v[i - 15 - k] || 0; }
          if (a <= b) continue;
          m.push({ time: c[i].time, position: 'aboveBar', color: C.d, shape: 'circle', size: 0.5 });
          try { if (H.note) H.note(c[i].time, '<span style="color:'+C.d+'">\u25CF</span> Ants: ' + ups + ' up days out of 15, ' + ((c[i].close / base - 1) * 100).toFixed(0) + '% in 15 sessions, volume above the 15 sessions before'); } catch (e) {} }
        return { markers: m }; } },
    // ── the legends, as indicators ──────────────────────────────────────────
    darvas: { label: 'Darvas boxes', group: 'Trader-built', pane: 0, params: [{ k: 'p', label: 'Bars to confirm', def: 3 }, { k: 'w', label: 'New high over, bars', def: 60 }],
      about: 'Nicolas Darvas: a box forms when a fresh high holds for three bars and the low after it holds for three; a close above the top opens the next box.',
      build: function (c, vol, g) { var n = c.length, out = [], i = g.w;
        while (i < n) { var hi = -Infinity; for (var k = i - g.w; k < i; k++) hi = Math.max(hi, c[k].high);
          if (c[i].high <= hi) { i++; continue; }
          var top = c[i].high, ti = i, j = i + 1, ok = false;
          while (j < n) { if (c[j].high > top) { top = c[j].high; ti = j; j++; continue; } if (j - ti >= g.p) { ok = true; break; } j++; }
          if (!ok) break;
          var bot = Infinity, bi = ti; for (k = ti; k <= j; k++) if (c[k].low < bot) { bot = c[k].low; bi = k; }
          var e = j, done = false; while (e + 1 < n) { e++; if (c[e].low < bot) { bot = c[e].low; bi = e; } if (e - bi >= g.p) { done = true; break; } }
          var end = e; while (end + 1 < n && c[end + 1].close <= top && c[end + 1].close >= bot) end++;
          var tl = [], bl = []; for (k = ti; k <= end; k++) { tl.push({ time: c[k].time, value: +top.toFixed(2) }); bl.push({ time: c[k].time, value: +bot.toFixed(2) }); }
          if (tl.length > 1) { out.push({ data: tl, color: C.a, width: 1 }); out.push({ data: bl, color: C.a, width: 1, dashed: true }); }
          try { if (H.note) H.note(c[end].time, '<span style="color:' + C.a + '">□</span> Darvas box ' + bot.toFixed(2) + ' to ' + top.toFixed(2) + (end + 1 < n ? (c[end + 1].close > top ? ', left through the top' : ', left through the bottom') : ', still open')); } catch (e2) {}
          i = end + 1; }
        return out; } },
    glb: { label: 'Green line breakout', group: 'Trader-built', pane: 0,
      params: [{ k: 'm', label: 'Months the high must hold', def: 3 }],
      about: "Eric Krull's green line: a high that no later bar took out for months, drawn forward from the day it printed. A close above it is the breakout.",
      build: function (c, vol, g) {
        var n = c.length, hold = Math.max(21, Math.round((+g.m || 3) * 21)), out = [], lines = [], run = -Infinity, i, k;
        for (i = 0; i < n; i++) {
          if (c[i].high <= run) continue;
          run = c[i].high;
          var j = i + 1; while (j < n && c[j].high <= run) j++;   // j = first bar that took it out, n if none
          if (j - i - 1 >= hold) lines.push({ i: i, v: run, end: j });
        }
        lines.slice(-4).forEach(function (L) {
          var stop = Math.min(L.end, n - 1), data = [];
          for (k = L.i; k <= stop; k++) data.push({ time: c[k].time, value: +L.v.toFixed(2) });
          if (data.length < 2) return;
          out.push({ data: data, color: C.up, width: 2 });
          var months = Math.round((stop - L.i) / 21);
          try { if (H.note) H.note(c[stop].time, '<span style="color:'+C.up+'">━</span> Green line ' + L.v.toFixed(2)
            + ', held ' + months + ' month' + (months > 1 ? 's' : '')
            + (L.end < n ? ', cleared on ' + c[L.end].time : ', still the line')); } catch (e) {}
        });
        return out; } },
    htf: { label: 'High tight flag', group: 'Trader-built', pane: 0,
      params: [{ k: 'p', label: 'Pole, min %', def: 90 }, { k: 's', label: 'Pole, max bars', def: 40 }],
      about: 'A pole of 90% or more inside 40 sessions, then a flag of 3 to 15 sessions giving back at most a quarter of it on drying volume, price still within 10% of the pivot. The rule the desk runs nightly, drawn on the bars.',
      build: function (c, vol, g) {
        var n = c.length, v = volsOf(c, vol), out = [], span = Math.max(10, +g.s || 40), minp = (+g.p || 90) / 100, i, k, j;
        function mean(a, b, arr) { var s = 0, m = 0; for (var q = a; q <= b; q++) { if (arr[q] == null) continue; s += arr[q]; m++; } return m ? s / m : 0; }
        function flagAt(end) {                       // the nightly rule, read as of bar `end`
          var best = null;
          for (k = 3; k <= 15; k++) {
            var ph = end - k; if (ph - span < -1 || ph < 5) continue;
            var loStart = Math.max(0, ph - span), lowI = loStart;
            for (j = loStart; j <= ph; j++) if (c[j].close < c[lowI].close) lowI = j;
            var poleLow = c[lowI].close, poleHigh = c[ph].high;
            if (!(poleLow > 0) || ph - lowI < 3) continue;
            var polePct = poleHigh / poleLow - 1;
            if (polePct < minp) continue;
            var flagLow = Infinity; for (j = ph + 1; j <= end; j++) flagLow = Math.min(flagLow, c[j].low);
            var depth = (poleHigh - flagLow) / (poleHigh - poleLow);
            if (!(depth >= 0) || depth > 0.25) continue;
            var last = c[end].close;
            if (last < 0.90 * poleHigh || last > poleHigh * 1.02) continue;
            var pv = mean(lowI, ph, v), fv = mean(ph + 1, end, v);
            if (!(pv > 0)) continue;
            var dry = fv / pv; if (dry > 0.8) continue;
            var cand = { lowI: lowI, ph: ph, end: end, pivot: poleHigh, polePct: polePct * 100,
                         depth: depth * 100, dry: dry, flagDays: k };
            if (!best || cand.polePct > best.polePct) best = cand;
          }
          return best;
        }
        for (i = 60; i < n; i++) {
          var f = flagAt(i); if (!f) continue;
          var pole = [{ time: c[f.lowI].time, value: +c[f.lowI].close.toFixed(2) },
                      { time: c[f.ph].time, value: +f.pivot.toFixed(2) }];
          var lvl = []; for (k = f.ph; k <= f.end; k++) lvl.push({ time: c[k].time, value: +f.pivot.toFixed(2) });
          out.push({ data: pole, color: C.a, width: 2 });
          if (lvl.length > 1) out.push({ data: lvl, color: C.a, width: 1, dashed: true });
          try { if (H.note) H.note(c[f.end].time, '<span style="color:'+C.a+'">⚑</span> High tight flag: pole '
            + f.polePct.toFixed(0) + '% in ' + (f.ph - f.lowI) + ' sessions, flag ' + f.flagDays
            + ' sessions giving back ' + f.depth.toFixed(0) + '%, volume at ' + f.dry.toFixed(2)
            + ' of the pole · pivot ' + f.pivot.toFixed(2)); } catch (e) {}
          i = f.end + f.flagDays;                   // one read per flag, not one per bar
        }
        return out; } },
    vcp: { label: 'Minervini VCP: the contractions and the pivot', group: 'Trader-built', pane: 0, params: [{ k: 'p', label: 'Base, min bars', def: 25 }, { k: 'd', label: 'Base, max depth %', def: 35 }],
      about: 'Inside the last base, each pullback from a swing high to the next low; a VCP is two or more contractions, each shallower than the last, the pivot being the last swing high.',
      build: function (c, vol, g) { var n = c.length; if (n < g.p + 5) return [];
        var s0 = n - 1, hi = c[s0].high, lo = c[s0].low; while (s0 > 0) { var h2 = Math.max(hi, c[s0 - 1].high), l2 = Math.min(lo, c[s0 - 1].low); if ((h2 - l2) / h2 * 100 > g.d) break; hi = h2; lo = l2; s0--; }
        if (n - s0 < g.p) return [];
        var piv = [], i, j;
        for (i = s0 + 3; i < n - 3; i++) { var isH = true, isL = true; for (j = 1; j <= 3; j++) { if (c[i - j].high >= c[i].high || c[i + j].high >= c[i].high) isH = false; if (c[i - j].low <= c[i].low || c[i + j].low <= c[i].low) isL = false; }
          if (isH) piv.push({ i: i, k: 'H', v: c[i].high }); else if (isL) piv.push({ i: i, k: 'L', v: c[i].low }); }
        var cons = []; for (i = 0; i < piv.length - 1; i++) if (piv[i].k === 'H' && piv[i + 1].k === 'L') cons.push({ hi: piv[i], lo: piv[i + 1], depth: (piv[i].v - piv[i + 1].v) / piv[i].v * 100 });
        if (cons.length < 2) return [];
        var tight = true; for (i = 1; i < cons.length; i++) if (cons[i].depth >= cons[i - 1].depth) tight = false;
        var out = [], lastH = null; piv.forEach(function (p) { if (p.k === 'H') lastH = p; });
        cons.forEach(function (k) { var d = []; for (i = k.hi.i; i <= Math.min(n - 1, k.lo.i + 3); i++) d.push({ time: c[i].time, value: +k.lo.v.toFixed(2) }); out.push({ data: d, color: C.b, width: 1, dashed: true }); });
        if (lastH) { var pv = []; for (i = lastH.i; i < n; i++) pv.push({ time: c[i].time, value: +(lastH.v + 0.1).toFixed(2) }); if (pv.length > 1) out.push({ data: pv, color: tight ? C.up : C.g, width: 1 });
          try { if (H.note) H.note(c[n - 1].time, '<span style="color:' + (tight ? C.up : C.g) + '">VCP</span> ' + cons.length + ' contraction' + (cons.length > 1 ? 's' : '') + ': ' + cons.map(function (k) { return k.depth.toFixed(0) + '%'; }).join(' → ') + (tight ? ', each tighter' : ', not tightening') + ' · pivot ' + (lastH.v + 0.1).toFixed(2)); } catch (e) {} }
        return out; } },
    oneil: { label: "O'Neil bases and the pivot", group: 'Trader-built', pane: 0, params: [{ k: 'p', label: 'Base, min bars', def: 35 }, { k: 'd', label: 'Base, max depth %', def: 35 }],
      about: "William O'Neil: a base of seven weeks or more, no deeper than a third; the pivot is a dime above the base's high, the buy zone runs five percent above it. Bases are counted along the advance.",
      build: function (c, vol, g) { var out = [], i = 0, n = c.length, count = 0, lastEnd = -1;
        while (i < n) { var hi = c[i].high, lo = c[i].low, j = i;
          while (j + 1 < n) { var h2 = Math.max(hi, c[j + 1].high), l2 = Math.min(lo, c[j + 1].low); if ((h2 - l2) / h2 * 100 > g.d) break; hi = h2; lo = l2; j++; }
          if (j - i + 1 >= g.p) { count++; var top = [], buy = []; for (var k = i; k <= Math.min(n - 1, j + 10); k++) { top.push({ time: c[k].time, value: +(hi + 0.1).toFixed(2) }); buy.push({ time: c[k].time, value: +((hi + 0.1) * 1.05).toFixed(2) }); }
            out.push({ data: top, color: C.up, width: 1 }); out.push({ data: buy, color: C.up, width: 1, dashed: true });
            try { if (H.note) H.note(c[j].time, '<span style="color:' + C.up + '">B' + count + '</span> Base ' + count + ', ' + Math.round((j - i + 1) / 5) + ' weeks, ' + ((hi - lo) / hi * 100).toFixed(0) + '% deep · pivot ' + (hi + 0.1).toFixed(2) + ', buy zone to ' + ((hi + 0.1) * 1.05).toFixed(2)); } catch (e) {}
            lastEnd = j; i = j + 1; } else i++; }
        return out; } },
    livermore: { label: 'Livermore pivotal points', group: 'Trader-built', pane: 0, params: [{ k: 'p', label: 'Bars each side', def: 6 }],
      about: 'Jesse Livermore: the swing highs and lows that held for a while on both sides, the points a trend has to take out to continue.',
      build: function (c, vol, g) { var m = [], n = c.length;
        for (var i = g.p; i < n - g.p; i++) { var isH = true, isL = true; for (var j = 1; j <= g.p; j++) { if (c[i - j].high >= c[i].high || c[i + j].high >= c[i].high) isH = false; if (c[i - j].low <= c[i].low || c[i + j].low <= c[i].low) isL = false; if (!isH && !isL) break; }
          if (isH) m.push({ time: c[i].time, position: 'aboveBar', color: C.dn, shape: 'square', text: 'P' }); else if (isL) m.push({ time: c[i].time, position: 'belowBar', color: C.up, shape: 'square', text: 'P' });
          if (isH || isL) { try { if (H.note) H.note(c[i].time, '<span style="color:'+C.m+'">P</span> Livermore pivotal point at ' + (isH ? c[i].high : c[i].low).toFixed(2)); } catch (e) {} } }
        return { markers: m }; } },
    ours_stage: { label: 'Weinstein stage, session by session', group: 'Our data', pane: 1, height: 70, params: [], daily: true,
      // 1 = basing, 2 = advancing, 3 = topping, 4 = declining, from our nightly classifier
      build: function (c, vol, g, o) { var st = o.extra && o.extra.stage; if (!st) return [];
        var col = { 1: TR('mute', 0.55), 2: TR('good', 0.75), 3: TR('warn', 0.75), 4: TR('bad', 0.75) }, out = [];
        for (var i = 0; i < c.length; i++) { var v = st[c[i].time]; if (v == null) continue; out.push({ time: c[i].time, value: v, color: col[v] || col[1] }); }
        return out.length ? [{ data: out, histogram: true }] : []; } },
    ours_rsr: { label: 'RS rating through time', group: 'Our data', pane: 1, height: 100, bands: [90], params: [], daily: true,
      build: function (c, vol, g, o) { var r = o.extra && o.extra.rsr; if (!r) return [];
        var out = []; for (var i = 0; i < c.length; i++) if (r[c[i].time] != null) out.push({ time: c[i].time, value: r[c[i].time] });
        return out.length ? [{ data: out, color: C.a, width: 2 }] : []; } },
    ours_divs: { label: 'Dividends and splits on the bars', group: 'Our data', pane: 0, params: [], daily: true,
      build: function (c, vol, g, o) { var x = o.extra || {}; if (!(x.divs || []).length && !(x.splits || []).length) return [];
        var times = {}; c.forEach(function (b, i) { times[b.time] = i; });
        function snap(t) { if (times[t] != null) return t; var last = null; for (var i = 0; i < c.length; i++) { if (c[i].time <= t) last = c[i].time; else break; } return last; }
        var m = [];
        (x.divs || []).forEach(function (d) { var t = snap(d.t); if (t) m.push({ time: t, position: 'belowBar', color: C.b, shape: 'square', text: 'D' + (d.amt != null ? ' ' + d.amt : '') }); });
        (x.splits || []).forEach(function (d) { var t = snap(d.t); if (t) m.push({ time: t, position: 'aboveBar', color: C.d, shape: 'square', text: 'S' + (d.ratio ? ' ' + d.ratio : '') }); });
        m.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
        return { markers: m }; } },
    ours_pocket: { label: 'Pocket pivots (volume beats the biggest down day of the last 10)', group: 'Our data', pane: 0, params: [], daily: true,
      about: 'Morales and Kacher: an up day whose volume tops the heaviest down-day volume of the 10 sessions before, with the close near or above the 10 or 50-day average. A place to look, not a call.',
      build: function (c, vol, g, o) { var x = o.extra || {}; if (!(x.pp || []).length) return [];
        var times = {}; c.forEach(function (b, i) { times[b.time] = i; });
        var m = [];
        x.pp.forEach(function (d) { if (times[d.t] != null) m.push({ time: d.t, position: 'belowBar', color: C.up, shape: 'arrowUp', text: 'PP' + (d.x != null ? ' ' + d.x + 'x' : '') }); });
        m.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
        return m.length ? { markers: m } : []; } },
    // dark chart_tv_lot2: what the filings said, quarter by quarter, each bar held until the next report
    ours_eps: { label: 'Earnings per share, quarter by quarter', group: 'Our data', pane: 1, height: 90, bands: [0], params: [], daily: true,
      about: 'Diluted earnings per share of each reported quarter, from the company filing, held from the day it was filed to the next one. Green: up on the same quarter a year before. Red: down.',
      build: function (c, vol, g, o) { return fqParts(c, o, 'eps', 'eps_yoy', 1); } },
    ours_rev: { label: 'Revenue, quarter by quarter, in $ millions', group: 'Our data', pane: 1, height: 90, params: [], daily: true,
      about: 'Revenue of each reported quarter, from the company filing, held from the day it was filed to the next one. Green: up on the same quarter a year before. Red: down.',
      build: function (c, vol, g, o) { return fqParts(c, o, 'rev', 'rev_yoy', 1e6); } },
    ours_sv: { label: 'Share of volume sold short, daily', group: 'Our data', pane: 1, height: 90, bands: [50], params: [], daily: true,
      about: 'The part of each session\u2019s volume FINRA reports as short sales. This is short-sale volume, not short interest: market makers sell short every day to fill buyers, so 40 to 50% is ordinary. Watch the change, not the level.',
      build: function (c, vol, g, o) { var sv = o.extra && o.extra.sv; if (!sv) return [];
        var out = []; for (var i = 0; i < c.length; i++) if (sv[c[i].time] != null) out.push({ time: c[i].time, value: sv[c[i].time] });
        return out.length ? [{ data: out, color: C.b, width: 2 }] : []; } },
    ours_seas: { label: 'Seasonality: this year against the average year', group: 'Our data', pane: 1, height: 110, bands: [0], params: [], daily: true,
      about: 'Purple: this year so far, in % from the last close of last year. Dashed: the average path of the past years on this name, session by session. History, never a forecast.',
      build: function (c, vol, g, o) { var sz = o.extra && o.extra.seas; if (!sz || !sz.avg || !c.length || typeof c[0].time !== 'string') return [];
        var i0 = -1; for (var i = 0; i < c.length; i++) { if (c[i].time.slice(0, 4) === sz.year) { i0 = i; break; } }
        if (i0 < 1) return [];   // the year has to start inside the window: the bar before it anchors the line
        var base = c[i0 - 1].close, me = [], av = [];
        for (var k = 0; i0 + k < c.length; k++) { var b = c[i0 + k];
          me.push({ time: b.time, value: +((b.close / base - 1) * 100).toFixed(2) });
          if (k < sz.avg.length) av.push({ time: b.time, value: sz.avg[k] }); }
        return [{ data: av, color: C.c, width: 2, dashed: true }, { data: me, color: C.a, width: 2 }]; } },
    // dark chart_tv_lot4: the trailing year at each filing, held to the next one
    ours_pe: { label: 'P/E through time, trailing year', group: 'Our data', pane: 1, height: 90, params: [], daily: true,
      about: 'Each close divided by the earnings per share of the last four reported quarters, as filed. Blank while the company loses money: a P/E on a loss means nothing.',
      build: function (c, vol, g, o) { var q = fqxRows(o); if (!q.length) return [];
        var out = [], j = -1; for (var i = 0; i < c.length; i++) { while (j + 1 < q.length && q[j + 1].t <= c[i].time) j++;
          if (j >= 0 && q[j].eps > 0) out.push({ time: c[i].time, value: +(c[i].close / q[j].eps).toFixed(1) }); }
        return out.length ? [{ data: out, color: C.a, width: 2 }] : []; } },
    ours_margin: { label: 'Net margin, trailing year, %', group: 'Our data', pane: 1, height: 90, bands: [0], params: [], daily: true,
      about: 'Net income over revenue across the last four reported quarters, from the filings, held from each filing to the next.',
      build: function (c, vol, g, o) { return fqxStep(c, o, 'margin', 1, false, C.b); } },
    ours_cfo: { label: 'Operating cash flow, trailing year, $ billions', group: 'Our data', pane: 1, height: 90, bands: [0], params: [], daily: true,
      about: 'Cash the business brought in from operations over the last four reported quarters. Red: it burned cash.',
      build: function (c, vol, g, o) { return fqxStep(c, o, 'cfo', 1e9, true); } },
    ours_shares: { label: 'Shares outstanding, diluted, millions', group: 'Our data', pane: 1, height: 90, params: [], daily: true,
      about: 'The diluted share count each quarter reported. Rising means dilution, falling means buybacks.',
      build: function (c, vol, g, o) { return fqxStep(c, o, 'shares', 1e6, false, C.d); } },
    ours_macro: { label: 'Fed, CPI, jobs and PCE dates', group: 'Our data', pane: 0, params: [], daily: true,
      about: 'F: Fed decision. C: CPI. J: jobs report. P: PCE inflation. The days the whole tape tends to move, from the Fed calendar and the government release schedules.',
      build: function (c, vol, g, o) { var x = (o.extra && o.extra.macro) || []; if (!x.length || !c.length) return [];
        var have = {}; c.forEach(function (b) { have[b.time] = 1; });
        var col = { F: C.dn, C: C.a, J: C.b, P: C.d }, by = {};
        x.forEach(function (r) { if (have[r.t]) (by[r.t] = by[r.t] || []).push(r.k); });
        var m = Object.keys(by).sort().map(function (t) { return { time: t, position: 'aboveBar', color: col[by[t][0]] || C.m, shape: 'square', text: by[t].join('') }; });
        return m.length ? { markers: m } : []; } },
    // dark weekly_mas: the 10 and 30 week averages of the weekly closes, stepped on the daily bars.
    // The page sends one row per week (first session + the two averages); each session takes its week's value.
    wk_ma10: { label: '10-week average, stepped', group: 'Trend', pane: 0, params: [], daily: true,
      about: 'The average of the last 10 weekly closes, drawn as a stair on the daily chart: each week keeps one value, the one the weekly chart prints for that week (the week in progress uses its latest close). A pullback often finds support here before the 50-day.',
      build: function (c, vol, g, o) { return wkMaParts(c, o, 'm10', C.b); } },
    wk_ma30: { label: '30-week average, stepped', group: 'Trend', pane: 0, params: [], daily: true,
      about: 'The average of the last 30 weekly closes, drawn as a stair on the daily chart: each week keeps one value, the one the weekly chart prints for that week (the week in progress uses its latest close). The line a long trend is held to.',
      build: function (c, vol, g, o) { return wkMaParts(c, o, 'm30', C.d); } },
    ours_bases: { label: "O'Neil bases from our night run: type, pivot, base number", group: 'Our data', pane: 0, params: [],
      // the legend used to print the last value of its last line (a buy-zone or base-low level, no name): say the pivot in words instead
      lgName: "O'Neil bases (our night run)",
      words: function (o) { var x = (o.extra || {}).bases, b = x && (x.bases || []).filter(function (q) { return q.cur; })[0];
        return b ? 'current base B' + b.no + ', pivot ' + (+b.pivot).toFixed(2) : ''; },
      about: "The base each name built on weekly bars (cup with handle, cup, double bottom, flat base, base on base, ascending base, IPO base), found by fixed rules every night. The solid line is the pivot, the buy point; the dashed line under it is the base low; the dotted line over a current base is the top of the 5% buy zone. The label gives the base number since the last market correction. A map of the base, not a call.",
      build: function (c, vol, g, o) { var x = (o.extra || {}).bases; if (!x || !(x.bases || []).length || !c.length || typeof c[0].time !== 'string') return [];
        var n = c.length, last = n - 1, first = c[0].time, parts = [], labels = [];
        function idx(t) { var lo = 0, hi = last, r = -1; while (lo <= hi) { var m = (lo + hi) >> 1; if (c[m].time <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
        function line(i0, i1, v, color, w, dashed) { if (i0 < 0) i0 = 0; if (i1 <= i0) return; var d = []; for (var k = i0; k <= i1; k++) d.push({ time: c[k].time, value: +(+v).toFixed(2) }); parts.push({ data: d, color: color, width: w, dashed: dashed }); }
        x.bases.forEach(function (b) {
          if (b.end < first) return;
          var i0 = idx(b.start), i1 = idx(b.end); if (i1 < 0) return; if (i0 < 0) i0 = 0;
          var col = b.status === 'failed' ? C.dn : b.status === 'breakout' ? C.up : C.a;
          var pts = [], seen = {};
          (b.pts || []).forEach(function (p) { var i = idx(p.t); if (i < 0) return; if (seen[i] != null) pts[seen[i]] = { time: c[i].time, value: +p.v }; else { seen[i] = pts.length; pts.push({ time: c[i].time, value: +p.v }); } });
          pts.sort(function (a, b2) { return a.time < b2.time ? -1 : a.time > b2.time ? 1 : 0; });
          if (pts.length > 1) parts.push({ data: pts, color: col, width: b.cur ? 2 : 1 });
          var stop = b.cur && b.status === 'forming' ? last : i1;
          line(i0, stop, b.pivot, col, b.cur ? 2 : 1, false);
          line(i0, i1, b.low, C.g, 1, true);
          if (b.cur) line(i1, last, b.pivot * 1.05, col, 1, true);
          // a base still forming runs to the last bar: its label sits on the left side so it never falls off the chart
          labels.push({ time: c[b.cur && b.status === 'forming' ? Math.max(i0, last - 45) : Math.min(i1, last)].time, value: b.pivot, up: b.status !== 'failed',
            text: 'B' + b.no + ' ' + b.short + ' · pivot ' + (+b.pivot).toFixed(2) + (b.status === 'failed' ? ' · failed' : ''),
            act: (b.cur && b.status !== 'failed') ? { pivot: +b.pivot, low: +b.low || 0, no: b.no } : null });   // chart_feats3: the label is clickable
          if (b.cur) { try { if (H.note) H.note(c[Math.min(i1, last)].time, '<span style="color:' + col + '">B' + b.no + '</span> ' + b.label + ', ' + b.nth + ' base, ' + b.weeks + ' weeks, ' + Math.round(b.depth) + '% deep · pivot ' + (+b.pivot).toFixed(2) + (b.dist != null ? ', ' + (b.dist > 0 ? '+' : '') + b.dist + '% from the last close' : '')); } catch (e) {} }
        });
        parts.labels = labels;
        return parts.length ? parts : []; } },
    bases: { label: 'Bases: where the price went sideways', group: 'Trader-built', pane: 0,
      params: [{ k: 'p', label: 'Min length, bars', def: 15 }, { k: 'd', label: 'Max depth %', def: 25 }],
      // a base = a stretch where the whole range stays within d% of its high;
      // drawn as a dashed top and bottom, described in the menu, never a signal
      build: function (c, vol, g) { var out = [], i = 0, n = c.length;
        while (i < n) { var hi = c[i].high, lo = c[i].low, j = i;
          while (j + 1 < n) { var h2 = Math.max(hi, c[j + 1].high), l2 = Math.min(lo, c[j + 1].low); if ((h2 - l2) / h2 * 100 > g.d) break; hi = h2; lo = l2; j++; }
          if (j - i + 1 >= g.p) {
            var top = [], bot = []; for (var k = i; k <= j; k++) { top.push({ time: c[k].time, value: +hi.toFixed(2) }); bot.push({ time: c[k].time, value: +lo.toFixed(2) }); }
            out.push({ data: top, color: C.a, width: 1, dashed: true }); out.push({ data: bot, color: C.a, width: 1, dashed: true });
            i = j + 1; } else i++; }
        return out; } },
    // ── Deepvue-style reads, all from the bars, the volume and the S&P line already on the page ──
    base_pivots: { label: 'Base pivots', group: 'Trader-built', pane: 0,
      params: [{ k: 'p', label: 'Min length, bars', def: 15 }, { k: 'd', label: 'Max depth %', def: 40 }],
      about: 'Each flat stretch (a base) gets a dotted line at its high, from the day the high was made until the price closes above it. The label reads: the pivot price, how long the base ran, how deep it was. A place to look, not a call.',
      // same base rule as "Bases": the whole range stays within d% of its high
      build: function (c, vol, g) { var out = [], i = 0, n = c.length, found = [], unit = (H.tf && H.tf() === '1D') ? 'days' : 'bars';
        while (i < n) { var hi = c[i].high, lo = c[i].low, j = i;
          while (j + 1 < n) { var h2 = Math.max(hi, c[j + 1].high), l2 = Math.min(lo, c[j + 1].low); if ((h2 - l2) / h2 * 100 > g.d) break; hi = h2; lo = l2; j++; }
          if (j - i + 1 >= g.p) { var pb = i, k; for (k = i; k <= j; k++) if (c[k].high >= c[pb].high) pb = k;
            found.push({ from: i, to: j, pb: pb, hi: hi, lo: lo }); i = j + 1; } else i++; }
        found.slice(-12).forEach(function (f) {   // the 12 latest keep the pane light
          var d = [], broke = false;
          for (var k = f.pb; k < n && !broke; k++) { d.push({ time: c[k].time, value: +f.hi.toFixed(2) }); if (k > f.to && c[k].close > f.hi) broke = true; }
          if (d.length < 2) return;
          var depth = (f.hi - f.lo) / f.hi * 100, len = f.to - f.from + 1, txt = '$' + f.hi.toFixed(2) + ' · ' + len + ' ' + unit + ' · ' + depth.toFixed(0) + '%';
          out.push({ data: d, color: broke ? C.g : C.d, width: 1, dotted: true,
            marks: [{ time: c[f.pb].time, position: 'aboveBar', color: broke ? C.g : C.d, shape: 'circle', size: 0.5, text: txt }] });
          try { if (H.note) H.note(c[f.pb].time, '<span style="color:' + C.d + '">●</span> Base pivot ' + txt + (broke ? ' · price has closed above it since' : ' · price has not closed above it yet')); } catch (e) {} });
        return out; } },
    rs_line_box: { label: 'RS line with 1M/3M/6M/12M', group: 'Trader-built', pane: 1, height: 100,
      params: [{ k: 'h', label: 'Dots on new RS highs, 1 = on', def: 1 }],
      about: 'The close divided by the S&P 500 close, so the line rises when the name beats the index. A dot marks a new high of the line over the last year. The note on the last bar gives how far the line moved over 1, 3, 6 and 12 months. It is a line, not a rating.',
      build: function (c, vol, g, o, spy) { var s = spyOf(c, spy); if (!s.some(function (x) { return x; })) return [];
        var r = c.map(function (b, i) { return s[i] ? b.close / s[i] : null; }), r0 = null, i, j;
        for (i = 0; i < r.length; i++) if (r[i] != null) { r0 = r[i]; break; }
        if (!r0) return [];
        var rs = r.map(function (x) { return x == null ? null : x / r0 * 100; }), marks = [];
        // on the S&P itself the line is flat at 100: nothing to show
        var rv = rs.filter(function (x) { return x != null; }); if (Math.max.apply(null, rv) - Math.min.apply(null, rv) < 0.5) return [];
        if (+g.h) for (i = 20; i < c.length; i++) { if (rs[i] == null) continue;
          var mx = -Infinity; for (j = Math.max(0, i - 252); j < i; j++) if (rs[j] != null && rs[j] > mx) mx = rs[j];
          if (mx > -Infinity && rs[i] > mx) marks.push({ time: c[i].time, position: 'inBar', color: C.up, shape: 'circle', size: 0.5 }); }
        var last = c.length - 1, bits = [];
        [['1M', 21], ['3M', 63], ['6M', 126], ['12M', 252]].forEach(function (q) {
          if (last - q[1] >= 0 && rs[last] != null && rs[last - q[1]]) { var pc = (rs[last] / rs[last - q[1]] - 1) * 100; bits.push(q[0] + ' ' + (pc >= 0 ? '+' : '') + pc.toFixed(1) + '%'); } });
        var part = { data: line(c, rs, 2), color: C.a, width: 2 };
        if (marks.length) part.marks = marks;
        if (bits.length) { part.legend = 'against the S&P: ' + bits.join(' · ');
          try { if (H.note) H.note(c[last].time, '<span style="color:' + C.a + '">▬</span> RS line against the S&P, change over ' + bits.join(' · ')); } catch (e) {} }
        return [part]; } },
    vol_plus: { label: 'Volume, unusual days marked', lgShort: 'Volume', group: 'Trader-built', pane: 1, height: 90,
      lgTag: function (g) { return '\u00b7 unusual days (' + g.x + '\u00d7 the ' + g.p + '-day average)'; },
      lgFmt: function (x) { return x >= 1e9 ? (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : String(Math.round(x)); },
      params: [{ k: 'x', label: 'Unusual at, times the average', def: 1.5, step: 0.1 }, { k: 'p', label: 'Average length, bars', def: 50 }],
      about: 'Volume bars. A bar is bold green or red when its volume is at least 1.5 times the average of the 50 bars before it (green on an up day, red on a down day). HVE marks the heaviest volume in all the history loaded, HV1Y the heaviest of the last year. The note on the last bar gives the average volume, the average dollar volume and the up/down volume ratio.',
      build: function (c, vol, g) { var v = volsOf(c, vol); if (!v.some(function (x) { return x; })) return [];
        var av = sma(v, g.p), n = c.length, bars2 = [], i, hvE = -1, hv1 = -1;
        for (i = 0; i < n; i++) { if (v[i] == null) continue;
          var up = i ? c[i].close >= c[i - 1].close : c[i].close >= c[i].open, big = i > 0 && av[i - 1] && v[i] >= g.x * av[i - 1];
          bars2.push({ time: c[i].time, value: v[i], color: up ? TR('good', big ? 0.9 : 0.3) : TR('bad', big ? 0.9 : 0.3) });
          if (hvE < 0 || v[i] > v[hvE]) hvE = i;
          if (i >= n - 252 && (hv1 < 0 || v[i] > v[hv1])) hv1 = i; }
        var marks = [];
        if (hvE >= 0) { var same = hvE === hv1; marks.push({ time: c[hvE].time, position: 'aboveBar', color: C.d, shape: 'arrowDown', text: same ? 'HVE · HV1Y' : 'HVE' }); }
        if (hv1 >= 0 && hv1 !== hvE) marks.push({ time: c[hv1].time, position: 'aboveBar', color: C.b, shape: 'arrowDown', text: 'HV1Y' });
        marks.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
        function fmt(x) { return x >= 1e9 ? (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : x.toFixed(0); }
        var part = { data: bars2, histogram: true, marks: marks, volFmt: true }, last = n - 1;
        if (last >= g.p && av[last] != null) { var sd = 0, cnt = 0, upv = 0, dnv = 0;
          for (i = last - g.p + 1; i <= last; i++) { if (v[i] == null) continue; sd += c[i].close * v[i]; cnt++;
            if (i > 0) { if (c[i].close > c[i - 1].close) upv += v[i]; else if (c[i].close < c[i - 1].close) dnv += v[i]; } }
          var ud = dnv ? (upv / dnv).toFixed(2) : null;
          var txt = g.p + '-bar average volume ' + fmt(av[last]) + (cnt ? ' · average dollar volume $' + fmt(sd / cnt) : '') + (ud ? ' · up/down volume ' + ud : '');
          part.legend = txt;
          try { if (H.note) H.note(c[last].time, '<span style="color:' + C.b + '">▬</span> ' + txt); } catch (e) {} }
        return [part]; } },
    atr_ext_marks: { label: 'Stretched above the average, in ATRs', group: 'Trader-built', pane: 0,
      params: [{ k: 'a', label: 'ATR length', def: 14 }, { k: 'p', label: 'Average length', def: 50 }, { k: 't', label: 'Mark at, ATRs above', def: 7, step: 0.5 }],
      about: 'A mark above each bar that closes at least 7 ATRs above its 50-day average: far stretched from its own trend, the way fast runners get before they rest. The note on the last bar gives today\'s distance in ATRs and in percent.',
      build: function (c, vol, g) { var n = c.length; if (n <= Math.max(g.a, g.p)) return [];
        var cl = c.map(function (x) { return x.close; }), m = sma(cl, g.p), a = atr(c, g.a), ext = [], i;
        for (i = 0; i < n; i++) ext.push(m[i] != null && a[i] ? (cl[i] - m[i]) / a[i] : null);
        var marks = [], peaks = [];
        for (i = 0; i < n; i++) { if (ext[i] == null || ext[i] < g.t) continue;
          var isPeak = !(ext[i + 1] != null && ext[i + 1] >= g.t && ext[i + 1] > ext[i]) && !(ext[i - 1] != null && ext[i - 1] >= g.t && ext[i - 1] >= ext[i]);
          marks.push({ time: c[i].time, position: 'aboveBar', color: C.d, shape: 'circle', size: 0.6, text: isPeak ? ext[i].toFixed(1) + 'x' : '' });
          if (isPeak) peaks.push(i); }
        peaks.forEach(function (k) {
          try { if (H.note) H.note(c[k].time, '<span style="color:' + C.d + '">●</span> Stretched: ' + ext[k].toFixed(1) + ' ATRs above the ' + g.p + '-bar average (' + ((cl[k] / m[k] - 1) * 100).toFixed(1) + '% above it)'); } catch (e) {} });
        var L = n - 1;
        if (ext[L] != null) { try { if (H.note && !(peaks.indexOf(L) >= 0)) H.note(c[L].time, '<span style="color:' + C.d + '">○</span> ' + ext[L].toFixed(1) + ' ATRs from the ' + g.p + '-bar average (' + ((cl[L] / m[L] - 1) * 100).toFixed(1) + '%); marks start at ' + g.t); } catch (e) {} }
        marks.sort(function (x, y) { return x.time < y.time ? -1 : x.time > y.time ? 1 : 0; });
        return marks.length ? { markers: marks } : []; } },
    rmv_pivots: { label: 'Tight spots: RMV pivot lines', group: 'Trader-built', pane: 0,
      params: [{ k: 'p', label: 'RMV lookback', def: 15 }, { k: 't', label: 'Tight under', def: 15 }, { k: 'r', label: 'Min bars in a row', def: 2 }, { k: 'e', label: 'Extend, bars', def: 10 }],
      about: 'When the relative measured volatility stays under the threshold for two bars or more, the price is coiled. A line is drawn at the high of that tight spot and runs on for ten bars, or until the price closes above it.',
      build: function (c, vol, g) { var n = c.length, rv = STUDIES.rmv.build(c, vol, { p: g.p }), by = {}, runs = [], i, j;
        if (!rv || !rv[0]) return [];
        rv[0].data.forEach(function (pt) { by[pt.time] = pt.value; });
        i = 0;
        while (i < n) { if (by[c[i].time] != null && by[c[i].time] < g.t) { j = i; while (j + 1 < n && by[c[j + 1].time] != null && by[c[j + 1].time] < g.t) j++;
            if (j - i + 1 >= g.r) { var hi = -Infinity; for (var k = i; k <= j; k++) hi = Math.max(hi, c[k].high); runs.push({ from: i, to: j, hi: hi }); }
            i = j + 1; } else i++; }
        var out = [];
        runs.slice(-20).forEach(function (r) { var d = [], stop = Math.min(n - 1, r.to + g.e), broke = false;
          for (var k = r.from; k <= stop && !broke; k++) { d.push({ time: c[k].time, value: +r.hi.toFixed(2) }); if (k > r.to && c[k].close > r.hi) broke = true; }
          if (d.length < 2) return;
          out.push({ data: d, color: C.b, width: 1 });
          try { if (H.note) H.note(c[r.to].time, '<span style="color:' + C.b + '">▬</span> Tight spot: RMV under ' + g.t + ' for ' + (r.to - r.from + 1) + ' bars · high $' + r.hi.toFixed(2)); } catch (e) {} });
        return out; } },
    tech_patterns: { label: 'Short-term patterns', group: 'Trader-built', pane: 0,
      params: [{ k: 'id', label: 'Inside days, 1 = on', def: 1 }, { k: 'ob', label: 'Outside days, up, 1 = on', def: 0 }, { k: 'os', label: 'Outside days, down, 1 = on', def: 0 },
               { k: 'or', label: 'Oops reversals, 1 = on', def: 1 }, { k: 'w3', label: '3 weeks tight, 1 = on', def: 1 }, { k: 't', label: '3 weeks tight, within %', def: 1.5, step: 0.1 },
               { k: 'n', label: 'Max patterns shown', def: 20 }],
      about: 'ID inside day, OB and OS outside day up and down, OR oops reversal, 3WT three weeks tight (daily chart). Hover a mark for what it means. A place to look, not a call.',
      build: function (c, vol, g) { var n = c.length, hits = [], i; if (n < 3) return [];
        function add(i, code, text, kind) { hits.push({ i: i, code: code, text: text, kind: kind }); }
        for (i = 1; i < n; i++) { var b = c[i], p = c[i - 1];
          if (+g.id && b.high < p.high && b.low > p.low) add(i, 'ID', 'Inside day: the whole day fits inside yesterday\'s range. The price is coiling.', 0);
          if (b.high > p.high && b.low < p.low) {
            if (+g.ob && b.close > p.close) add(i, 'OB', 'Outside day, up: the day went above yesterday\'s high and below its low, and closed above yesterday\'s close. Buyers won the wider range.', 1);
            if (+g.os && b.close < p.close) add(i, 'OS', 'Outside day, down: the day went above yesterday\'s high and below its low, and closed below yesterday\'s close. Sellers won the wider range.', -1); }
          if (+g.or && b.open < p.low && b.close > p.low) add(i, 'OR', 'Oops reversal: it opened below yesterday\'s low, then closed back above it. The gap down failed.', 1); }
        // three weeks tight: the last day of the third week, daily bars only
        var daily = false; try { daily = H.tf() === '1D' && typeof c[0].time === 'string' && c[0].time.length === 10; } catch (e) {}
        if (+g.w3 && daily) { var wk = [], key = null;
          for (i = 0; i < n; i++) { var dt = new Date(c[i].time + 'T00:00:00Z'), mon = new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
            if (mon !== key) { wk.push({ close: c[i].close, last: i, dow: dt.getUTCDay() }); key = mon; } else { wk[wk.length - 1].close = c[i].close; wk[wk.length - 1].last = i; wk[wk.length - 1].dow = dt.getUTCDay(); } }
          for (var w = 2; w < wk.length; w++) { if (w === wk.length - 1 && wk[w].dow !== 5) continue;   // the week in progress is not a close yet
            var cs = [wk[w].close, wk[w - 1].close, wk[w - 2].close], mn = Math.min.apply(null, cs), mx = Math.max.apply(null, cs), spread = (mx - mn) / mn * 100;
            if (spread <= g.t) add(wk[w].last, '3WT', '3 weeks tight: the last three weekly closes sit within ' + spread.toFixed(1) + '% of each other.', 0); } }
        hits.sort(function (x, y) { return x.i - y.i; });
        hits = hits.slice(-Math.max(1, g.n));
        var m = hits.map(function (h) { var col = h.kind > 0 ? C.up : h.kind < 0 ? C.dn : C.m;
          try { if (H.note) H.note(c[h.i].time, '<span style="color:' + col + '">●</span> ' + h.text); } catch (e) {}
          return { time: c[h.i].time, position: h.kind < 0 ? 'aboveBar' : 'belowBar', color: col, shape: h.kind > 0 ? 'arrowUp' : h.kind < 0 ? 'arrowDown' : 'circle', text: h.code }; });
        m.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
        return m.length ? { markers: m } : []; } },
    levels: { label: 'Levels: last week, last month, 52 weeks, year open', group: 'Trader-built', pane: 0, params: [], daily: true,
      // the reference prices a desk keeps on screen, each drawn from where it
      // formed to today: prior week high/low/close, prior month high/low, the
      // 52-week high and low, and the first open of the year
      build: function (c, vol) { if (c.length < 10) return [];
        var last = c[c.length - 1], lt = last.time, yr = lt.slice(0, 4), mo = lt.slice(0, 7);
        function wk(t) { var d = new Date(t + 'T00:00:00Z'), day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); }
        var curW = wk(lt), prevW = c.filter(function (b) { return wk(b.time) < curW; }); var pw = prevW.filter(function (b) { return wk(b.time) === wk(prevW[prevW.length - 1].time); });
        var pm = c.filter(function (b) { return b.time.slice(0, 7) < mo; }); var pmm = pm.filter(function (b) { return b.time.slice(0, 7) === pm[pm.length - 1].time.slice(0, 7); });
        var y = c.filter(function (b) { return b.time.slice(0, 4) === yr; }), w52 = c.slice(-252), out = [];
        function seg(fromT, val, color, dashed) { var d = []; for (var i = 0; i < c.length; i++) if (c[i].time >= fromT) d.push({ time: c[i].time, value: +val.toFixed(2) }); if (d.length > 1) out.push({ data: d, color: color, width: 1, dashed: dashed }); }
        if (pw.length) { var ph = Math.max.apply(null, pw.map(function (b) { return b.high; })), pl = Math.min.apply(null, pw.map(function (b) { return b.low; }));
          seg(pw[0].time, ph, C.b, false); seg(pw[0].time, pl, C.b, false); seg(pw[0].time, pw[pw.length - 1].close, C.b, true); }
        if (pmm.length) { seg(pmm[0].time, Math.max.apply(null, pmm.map(function (b) { return b.high; })), C.d, false); seg(pmm[0].time, Math.min.apply(null, pmm.map(function (b) { return b.low; })), C.d, false); }
        if (w52.length > 20) { var hh = Math.max.apply(null, w52.map(function (b) { return b.high; })), ll = Math.min.apply(null, w52.map(function (b) { return b.low; }));
          seg(w52[0].time, hh, C.up, true); seg(w52[0].time, ll, C.dn, true); }
        if (y.length) seg(y[0].time, y[0].open, C.g, true);
        return out; } },
    pivots: { label: 'Pivot points, classic, from last month', group: 'Trader-built', pane: 0, params: [],
      about: 'P, R1, R2, S1, S2 from the previous calendar month\'s high, low and close, drawn across the current month.',
      build: function (c) { if (c.length < 25) return []; var lt = c[c.length - 1].time.slice(0, 7);
        var prev = c.filter(function (b) { return b.time.slice(0, 7) < lt; }); if (!prev.length) return [];
        var pm = prev[prev.length - 1].time.slice(0, 7), mb = prev.filter(function (b) { return b.time.slice(0, 7) === pm; });
        var Hh = Math.max.apply(null, mb.map(function (b) { return b.high; })), L = Math.min.apply(null, mb.map(function (b) { return b.low; })), Cc = mb[mb.length - 1].close;
        var P = (Hh + L + Cc) / 3, lv = [['P', P, C.a], ['R1', 2 * P - L, C.dn], ['S1', 2 * P - Hh, C.up], ['R2', P + (Hh - L), C.dn], ['S2', P - (Hh - L), C.up]];
        var cur2 = c.filter(function (b) { return b.time.slice(0, 7) === lt; }); if (!cur2.length) return [];
        return lv.map(function (x) { return { data: cur2.map(function (b) { return { time: b.time, value: +x[1].toFixed(2) }; }), color: x[2], width: 1, dashed: x[0] !== 'P' }; }); } },
    autofib: { label: 'Auto Fibonacci on the last swing', group: 'Trader-built', pane: 0,
      params: [{ k: 'p', label: 'Lookback, bars', def: 60 }],
      about: 'The highest high and lowest low of the lookback set the swing; the retracement levels sit between them, 0.618 in accent.',
      build: function (c, vol, g) { var n = c.length, s0 = Math.max(0, n - g.p), hi = -Infinity, lo = Infinity, ih = -1, il = -1, i;
        for (i = s0; i < n; i++) { if (c[i].high > hi) { hi = c[i].high; ih = i; } if (c[i].low < lo) { lo = c[i].low; il = i; } }
        if (ih < 0 || il < 0 || !(hi > lo)) return []; var from = Math.min(ih, il), up = il < ih;
        return [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map(function (r) { var v = up ? hi - (hi - lo) * r : lo + (hi - lo) * r, d = [];
          for (var k = from; k < n; k++) d.push({ time: c[k].time, value: +v.toFixed(2) });
          return { data: d, color: r === 0.618 ? C.a : C.g, width: 1, dashed: r !== 0 && r !== 1 }; }); } },
    zigzag: { label: 'ZigZag: the swings, joined', group: 'Trader-built', pane: 0,
      params: [{ k: 'p', label: 'Bars each side', def: 5 }],
      about: 'A swing high is the highest high with p bars lower on both sides; a swing low the mirror. The line joins them, alternating.',
      build: function (c, vol, g) { var pts = [], n = c.length, i, j, last = null;
        for (i = g.p; i < n - g.p; i++) { var isH = true, isL = true;
          for (j = 1; j <= g.p; j++) { if (c[i - j].high >= c[i].high || c[i + j].high >= c[i].high) isH = false; if (c[i - j].low <= c[i].low || c[i + j].low <= c[i].low) isL = false; if (!isH && !isL) break; }
          var kind = isH ? 'H' : isL ? 'L' : null; if (!kind) continue;
          var v = kind === 'H' ? c[i].high : c[i].low;
          if (last && last.k === kind) { if ((kind === 'H' && v > last.v) || (kind === 'L' && v < last.v)) { pts[pts.length - 1] = { time: c[i].time, value: v }; last = { k: kind, v: v }; } continue; }
          pts.push({ time: c[i].time, value: v }); last = { k: kind, v: v }; }
        return pts.length > 1 ? [{ data: pts.map(function (x) { return { time: x.time, value: +x.value.toFixed(2) }; }), color: C.a, width: 1 }] : []; } },
    autopat: { label: 'Auto patterns', group: 'Trader-built', pane: 0,
      params: [{ k: 'p', label: 'Bars each side of a swing', def: 5 }, { k: 'n', label: 'Patterns shown', def: 3 }],
      about: 'Classic shapes read off the swing points: double tops and bottoms, head and shoulders, triangles, wedges, channels and flags. Each one shows its breakout line and the measured target. A detected shape, not a signal: shapes fail as often as they work.',
      build: function (c, vol, g) { if (c.length < 40) return [];
        var pats = findPatterns(c, Math.max(2, g.p | 0), Math.max(1, Math.min(6, g.n | 0))), parts = [], labels = [], last = c.length - 1;
        function pt(i, v) { return { time: c[Math.max(0, Math.min(last, i))].time, value: +v.toFixed(2) }; }
        function seg(a, b, ext) { var e2 = ext ? Math.min(last, b.i + Math.max(5, Math.round((b.i - a.i) * 0.6))) : b.i;
          var v2 = a.v + (b.v - a.v) * (e2 - a.i) / ((b.i - a.i) || 1);
          return a.i === e2 ? null : [pt(a.i, a.v), pt(e2, v2)]; }
        pats.forEach(function (o) {
          if (o.neck) {
            parts.push({ data: o.piv.map(function (x) { return pt(x.i, x.v); }), color: o.dir > 0 ? C.up : C.dn, width: 2 });
            var nl = seg(o.neck[0], o.neck[1], true); if (nl) parts.push({ data: nl, color: C.a, width: 1, dashed: true });
            var lp = o.piv[o.piv.length - 1];
            if (lp.i < last) parts.push({ data: [pt(lp.i, o.target), pt(last, o.target)], color: C.g, width: 1, dashed: true });
            labels.push({ time: c[lp.i].time, value: lp.v, up: o.dir > 0, text: o.name + ' · target ' + o.target.toFixed(2) });
          } else {
            var u = seg(o.up[0], o.up[1], true), d = seg(o.dn[0], o.dn[1], true);
            if (u) parts.push({ data: u, color: C.dn, width: 2 }); if (d) parts.push({ data: d, color: C.up, width: 2 });
            var top = o.up[0]; labels.push({ time: c[top.i].time, value: top.v, up: false, text: o.name });
          }
        });
        parts.labels = labels;
        return parts; } },
    regression: { label: 'Regression channel', group: 'Trader-built', pane: 0,
      params: [{ k: 'p', label: 'Bars', def: 100 }, { k: 'm', label: 'Deviations', def: 2, step: 0.5 }],
      about: 'A straight line fitted to the closes of the last p bars, with bands at m standard deviations of the residuals.',
      build: function (c, vol, g) { var n = c.length, p = Math.min(g.p, n), s0 = n - p; if (p < 10) return [];
        var sx = 0, sy = 0, sxy = 0, sxx = 0, i; for (i = 0; i < p; i++) { var y = c[s0 + i].close; sx += i; sy += y; sxy += i * y; sxx += i * i; }
        var d = p * sxx - sx * sx, b = d ? (p * sxy - sx * sy) / d : 0, a = (sy - b * sx) / p, res = 0;
        for (i = 0; i < p; i++) res += Math.pow(c[s0 + i].close - (a + b * i), 2); var sd = Math.sqrt(res / p);
        function ln(off) { var o = []; for (var k = 0; k < p; k++) o.push({ time: c[s0 + k].time, value: +(a + b * k + off).toFixed(2) }); return o; }
        return [{ data: ln(0), color: C.b, width: 1 }, { data: ln(g.m * sd), color: C.g, width: 1, dashed: true }, { data: ln(-g.m * sd), color: C.g, width: 1, dashed: true }]; } },
    ours_oi: { label: 'Open interest through time', group: 'Our data', pane: 1, height: 100,
      params: [], daily: true,
      build: function (c, vol, g, o) { if (!o.oic) return [];
        var m = 1e3;
        return [{ data: tail(c, o.oic.map(function (x) { return x / m; }), 0), color: C.up, width: 2 },
                { data: tail(c, (o.oip || []).map(function (x) { return x / m; }), 0), color: C.dn, width: 2 }]; } }
  };
  // item 1001 (dark flag chart_trendlines): the sloping lines through the most swing highs (resistance) and
  // swing lows (support), found server-side by fixed rules (app/trendlines.py, rules in its docstring) and
  // handed over in OURS.extra.trendlines; the page sets window.__piTrendlines only when the flag is lit.
  // Each line is two dated points; drawn bar by bar between them. A line broken by the last close is dashed.
  // chart_kerb_set (10/11): a rolling correlation pane and a z-score pane. The second name is the first
  // one in Compare, or the S&P 500 line when Compare is empty.
  function otherOf(c, spy) {
    var t = cmpList && cmpList[0], raw = t && cmpData[t];
    if (raw && raw.length) { var by = {}; raw.forEach(function (x) { by[x.time] = x.close; });
      return c.map(function (b) { return by[b.time] == null ? null : by[b.time]; }); }
    return spyOf(c, spy);
  }
  if (window.__piKerbSet) {
    STUDIES.corr = { label: 'Correlation with the compared name', group: 'Trader-built', pane: 1, height: 90, bands: [-0.5, 0, 0.5],
      params: [{ k: 'p', label: 'Length', def: 50 }],
      about: 'Rolling correlation of daily changes with the first name in Compare, or with the S&P 500 when Compare is empty. Near +1 the two move together, near -1 they move opposite.',
      build: function (c, vol, g, o, spy) { var s = otherOf(c, spy), p = Math.max(3, g.p | 0), ra = [], rb = [], out = [], i, j;
        for (i = 0; i < c.length; i++) {
          ra.push(i && c[i - 1].close ? c[i].close / c[i - 1].close - 1 : null);
          rb.push(i && s[i] && s[i - 1] ? s[i] / s[i - 1] - 1 : null); }
        for (i = 0; i < c.length; i++) {
          if (i < p) { out.push(null); continue; }
          var n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
          for (j = i - p + 1; j <= i; j++) { var x = ra[j], y = rb[j]; if (x == null || y == null) continue;
            n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
          var vx = n * sxx - sx * sx, vy = n * syy - sy * sy;
          out.push(n < p * 0.8 || vx <= 0 || vy <= 0 ? null : (n * sxy - sx * sy) / Math.sqrt(vx * vy)); }
        return [{ data: line(c, out, 2), color: C.a, width: 2 }]; } };
    STUDIES.zscore = { label: 'Z-score of the price', group: 'Volatility', pane: 1, height: 90, bands: [-3, -2, -1, 0, 1, 2, 3],
      params: [{ k: 'p', label: 'Length', def: 100 }],
      about: 'How many standard deviations the close sits from its own average. On a pair such as XLY:XLP it is the z-score of the pair.',
      build: function (c, vol, g) { var cl = c.map(function (x) { return x.close; }), m = sma(cl, g.p), sd = stdev(cl, g.p), out = [];
        for (var i = 0; i < cl.length; i++) out.push(m[i] == null || !sd[i] ? null : (cl[i] - m[i]) / sd[i]);
        return [{ data: line(c, out, 2), color: C.a, width: 2 }]; } };
  }
  // chart_divergence (14/11): price against an oscillator. The block between the two DIVMARKS comments is read by tests/test_chart_divergence.py.
  // DIVMARKS-BEGIN
  function divOsc(c, kind, len) { var cl = c.map(function (x) { return x.close; }), i;
    if (kind !== 2) return rsi(cl, len);
    var f = ema(cl, 12), sl = ema(cl, 26), m = [], hs = [];
    for (i = 0; i < cl.length; i++) m.push(f[i] != null && sl[i] != null ? f[i] - sl[i] : null);
    var sig = ema(m, 9);
    for (i = 0; i < cl.length; i++) hs.push(m[i] != null && sig[i] != null ? m[i] - sig[i] : null);
    return hs; }
  // Pivot low at i: osc[i] is the minimum of [i-P, i+P] (strictly under the P bars before, at most equal to the P after, so a
  // flat run gives one pivot, its first bar); the whole window has a value. Highs mirror it. Known once bar i+P exists.
  // Bullish: the nearest earlier pivot low j with 5 <= i-j <= 60 has a lower oscillator and a higher low than bar i.
  function divMarks(c, osc, P) { var n = c.length, out = [], lo = [], hi = [], i, j, k;
    if (n < 30 || !(P >= 1)) return out;
    for (i = 0; i < n; i++) { lo.push(false); hi.push(false); if (i < P || i + P >= n) continue;
      var ok = true, isLo = true, isHi = true;
      for (k = i - P; k <= i + P; k++) if (osc[k] == null) { ok = false; break; }
      if (!ok) continue;
      for (k = i - P; k <= i + P; k++) { if (k === i) continue;
        if (k < i) { if (osc[k] <= osc[i]) isLo = false; if (osc[k] >= osc[i]) isHi = false; }
        else { if (osc[k] < osc[i]) isLo = false; if (osc[k] > osc[i]) isHi = false; } }
      lo[i] = isLo; hi[i] = isHi; }
    for (i = 0; i < n; i++) { if (!lo[i] && !hi[i]) continue;
      for (j = i - 5; j >= 0 && j >= i - 60; j--) if (lo[i] ? lo[j] : hi[j]) break;
      if (j < 0 || j < i - 60) continue;
      if (lo[i] && osc[i] > osc[j] && c[i].low < c[j].low) out.push({ time: c[i].time, kind: 'bull', j: c[j].time });
      if (hi[i] && osc[i] < osc[j] && c[i].high > c[j].high) out.push({ time: c[i].time, kind: 'bear', j: c[j].time }); }
    return out; }
  // DIVMARKS-END
  if (window.__piDivergence) STUDIES.divergence = { label: 'Divergence', group: 'Momentum', pane: 1, height: 110,
    params: [{ k: 'o', label: 'Oscillator (1 RSI, 2 MACD histogram)', def: 1 }, { k: 'p', label: 'RSI length', def: 14 }, { k: 'w', label: 'Bars to confirm a turn', def: 5 }],
    lgTag: function (g) { return +g.o === 2 ? 'MACD' : 'RSI ' + (Math.max(2, Math.round(g.p) || 14)); },   // the legend says the oscillator, not its number
    about: 'Marks when price and an oscillator disagree. Green arrow: price made a lower low, the oscillator a higher low. Red arrow: price made a higher high, the oscillator a lower high. Each arrow stays on its bar and appears only after the confirming bars have closed.',
    build: function (c, vol, g) { var kind = +g.o === 2 ? 2 : 1, P = Math.max(1, Math.round(g.w) || 5);
      if (c.length < 30) return [];
      STUDIES.divergence.bands = kind === 2 ? [0] : [30, 70];
      var osc = divOsc(c, kind, Math.max(2, Math.round(g.p) || 14)), mk = divMarks(c, osc, P), up = [], dn = [];
      mk.forEach(function (m) { if (m.kind === 'bull') up.push({ time: m.time, position: 'belowBar', color: C.up, shape: 'arrowUp' });
        else dn.push({ time: m.time, position: 'aboveBar', color: C.dn, shape: 'arrowDown' }); });
      var all = up.concat(dn).sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
      var part = kind === 2 ? { data: line(c, osc).map(function (x) { return { time: x.time, value: x.value, color: x.value >= 0 ? TR('good', 0.45) : TR('bad', 0.45) }; }), histogram: true }
                            : { data: line(c, osc, 1), color: C.a, width: 2 };
      if (all.length) part.marks = all.map(function (m) { return { time: m.time, position: m.position, color: m.color, shape: m.shape, text: m.shape === 'arrowUp' ? 'Bull' : 'Bear' }; });   // named on the oscillator pane, bare arrows on the candles
      var res = [part]; res.pmarks = all; return res; } };
  if (window.__piTrendlines) STUDIES.ours_trend = { label: 'Trendlines: sloping support and resistance', group: 'Our data', pane: 0, params: [], daily: true,
    about: 'The straight lines that touch the most swing highs (red) or swing lows (green) of the last year, with no close through them. A dashed line was crossed by the last close.',
    build: function (c, vol, g, o) { var T = o.extra && o.extra.trendlines; if (!T || !T.length || !c.length) return [];
      function at(t, up) { var lo = 0, hi = c.length - 1, r = -1; while (lo <= hi) { var m = (lo + hi) >> 1; if (c[m].time <= t) { r = m; lo = m + 1; } else hi = m - 1; } return up ? r : (r < 0 ? 0 : (c[r].time === t ? r : Math.min(r + 1, c.length - 1))); }
      var out = [];
      T.forEach(function (L) { var i0 = at(L.t0, false), i1 = at(L.t1, true); if (i1 <= i0) return;
        var d = []; for (var k = i0; k <= i1; k++) d.push({ time: c[k].time, value: +(L.v0 + (L.v1 - L.v0) * (k - i0) / (i1 - i0)).toFixed(2) });
        var broken = L.status === 'broken';
        out.push({ data: d, color: L.side === 'resistance' ? C.dn : C.up, width: broken ? 2 : 1, dashed: broken });
        try { if (H.note) H.note(c[i1].time, '<span style="color:' + (L.side === 'resistance' ? C.dn : C.up) + '">╱</span> ' + (L.side === 'resistance' ? 'Resistance' : 'Support') + ' line, ' + L.touches + ' touches since ' + L.t0 + (broken ? ', crossed by this close (' + (L.pct_through > 0 ? '+' : '') + L.pct_through + '%)' : '')); } catch (e) {} });
      return out; } };
  // item 1539 (dark flag period_profiles): one volume profile per month and per week (app/period_profiles.py),
  // handed over in OURS.extra.period_profiles. Per period: VPOC solid, VAH and VAL dashed, from its first to its
  // last session. A VPOC no later session has traded through (naked) goes on to the right, to the last bar.
  if (window.__piPeriodProfiles) STUDIES.ours_pvp = { label: 'Volume profile per month and week (VPOC, VAH, VAL)', group: 'Our data', pane: 0, params: [], daily: true,
    about: 'Purple: one volume profile per month. Grey: per week. Solid line: the VPOC, the price with the most volume. Dashed: the value area, the band with 70% of the volume. A VPOC the price has not come back to is carried to the right, until the day it is touched.',
    build: function (c, vol, g, o) { var P = o.extra && o.extra.period_profiles; if (!P || !c.length) return [];
      function at(t, up) { var lo = 0, hi = c.length - 1, r = -1; while (lo <= hi) { var m = (lo + hi) >> 1; if (c[m].time <= t) { r = m; lo = m + 1; } else hi = m - 1; } return up ? r : (r < 0 ? 0 : (c[r].time === t ? r : Math.min(r + 1, c.length - 1))); }
      function seg(v, i0, i1) { var d = []; for (var k = i0; k <= i1; k++) d.push({ time: c[k].time, value: v }); return d; }
      var out = [];
      (P.weeks || []).concat(P.months || []).forEach(function (L) { var i0 = at(L.t0, false), i1 = at(L.t1, true); if (i1 < i0) return;
        var col = L.kind === 'month' ? C.a : C.m, w = L.kind === 'month' ? 2 : 1;
        var iv = L.naked ? c.length - 1 : (L.touched ? at(L.touched, true) : i1);
        out.push({ data: seg(L.vpoc, i0, Math.max(i1, iv)), color: col, width: w });
        out.push({ data: seg(L.vah, i0, i1), color: col, width: 1, dashed: true });
        out.push({ data: seg(L.val, i0, i1), color: col, width: 1, dashed: true });
        try { if (H.note && L.kind === 'month') H.note(c[i1].time, '<span style="color:'+C.a+'">\u25AC</span> ' + L.t0.slice(0, 7) + ' profile: VPOC ' + L.vpoc + ', value area ' + L.val + ' to ' + L.vah + (L.open ? ' (month still open)' : L.naked ? ', VPOC not touched since' : ', VPOC touched ' + L.touched)); } catch (e) {} });
      return out; } };
  // item 1540 (dark flag f1540_ajouter_vwap_par_periode_sur): VWAP of the running week, month, quarter or year
  // (app/period_vwap.py, OURS.extra.period_vwap), restarted on the first session of the period, with 1 or 2 bands.
  if (window.__piPeriodVwap) STUDIES.ours_pvwap = { label: 'VWAP per period (week, month, quarter, year) with bands', group: 'Our data', pane: 0,
    params: [{ k: 'p', label: 'Period (1 week, 2 month, 3 quarter, 4 year)', def: 2 }, { k: 'm', label: 'Bands (0, 1 or 2)', def: 2 }, { k: 'h', label: 'Past periods (1 yes, 0 open only)', def: 1 }], daily: true,
    about: 'Violet: the average price of the running period, weighted by volume, restarted on its first session. Dashed: one and two standard deviations around it. Daily bars, so a daily approximation.',
    build: function (c, vol, g, o) { var P = o.extra && o.extra.period_vwap; if (!P || !c.length) return [];
      var kind = ['week', 'month', 'quarter', 'year'][Math.max(1, Math.min(4, Math.round(g.p || 2))) - 1], S = P[kind] || [];
      if (!S.length) return [];
      var nb = Math.max(0, Math.min(2, Math.round(g.m == null ? 2 : g.m))), idx = {}; c.forEach(function (b, i) { idx[b.time] = i; });
      var H1 = g.h == null || g.h >= 1 ? ((P.hist || {})[kind] || null) : null;   // every period, restarted at each first session
      var pts = (H1 && H1.length ? H1 : S).filter(function (r) { return idx[r.t] != null; });
      // Past periods: even and odd periods go to two series per line, with whitespace points in between,
      // so the line never joins one period to the next (it restarts on the first session).
      var par = {}, np = -1; pts.forEach(function (r) { if (r.new || np < 0) np++; par[r.t] = np % 2; });
      var first = pts.length ? idx[pts[0].t] : 0, byT = {}; pts.forEach(function (r) { byT[r.t] = r; });
      function ln(f, p2) { var o = []; for (var i = first; i < c.length; i++) {
        var r = byT[c[i].time]; o.push(r && par[r.t] === p2 ? { time: c[i].time, value: +f(r).toFixed(2) } : { time: c[i].time }); } return o; }
      var out = [];
      function add(f, w, dashed) { [0, 1].forEach(function (p2) { out.push({ data: ln(f, p2), color: C.a, width: w, dashed: dashed }); }); }
      add(function (r) { return r.vwap; }, 2, false);
      for (var n = 1; n <= nb; n++) (function (n) {
        add(function (r) { return r.vwap + n * r.sd; }, 1, true);
        add(function (r) { return r.vwap - n * r.sd; }, 1, true); })(n);
      return out; } };
  // TASC pass (2026-09-05): studies registered by chart-ehlers.js (loaded before this file)
  try { var __ext = window.__cpExtraStudies || {}; Object.keys(__ext).forEach(function (k) { if (!STUDIES[k]) STUDIES[k] = __ext[k]({ ema: ema, sma: sma, stdev: stdev, line: line, C: C }); }); } catch (e) {}

  // ── your own formula: a small, safe language over the bars on the chart ──
  // names: open high low close volume spy · functions: sma ema wma hma atr rsi
  // stdev hhv llv roc ref abs max min · operators: + - * / ( ) and > < >= <=
  // (a comparison draws 0/1), joined by and / or; rsi(14) reads the close. No eval anywhere: tokens, a tree, then arrays.
  var FX = (function () {
    function err(msg, pos) { var e = new Error(msg); e.pos = pos; return e; }
    function tokenize(src) {
      var out = [], i = 0, re = /\s*(?:(\d+\.?\d*)|([A-Za-z_]\w*)|(>=|<=|[-+*\/(),<>]))/y;
      while (i < src.length) {
        re.lastIndex = i; var m = re.exec(src);
        if (!m) { if (/^\s*$/.test(src.slice(i))) break; throw err('Unexpected "' + src[i] + '"', i); }
        i = re.lastIndex;
        if (m[1] != null) out.push({ t: 'num', v: +m[1], p: i - m[1].length });
        else if (m[2] != null) out.push({ t: 'id', v: m[2].toLowerCase(), p: i - m[2].length });
        else out.push({ t: 'op', v: m[3], p: i - m[3].length });
      }
      out.push({ t: 'end', p: src.length }); return out;
    }
    function parse(src) {
      var tk = tokenize(src), k = 0;
      function peek() { return tk[k]; } function next() { return tk[k++]; }
      function expect(v) { var x = next(); if (x.t !== 'op' || x.v !== v) throw err('Expected "' + v + '"', x.p); }
      function primary() { var x = next();
        if (x.t === 'num') return { k: 'num', v: x.v };
        if (x.t === 'id') { if (peek().t === 'op' && peek().v === '(') { next(); var args = [];
            if (!(peek().t === 'op' && peek().v === ')')) { args.push(expr()); while (peek().t === 'op' && peek().v === ',') { next(); args.push(expr()); } }
            expect(')'); return { k: 'call', f: x.v, a: args, p: x.p }; }
          return { k: 'id', v: x.v, p: x.p }; }
        if (x.t === 'op' && x.v === '(') { var e = expr(); expect(')'); return e; }
        if (x.t === 'op' && x.v === '-') return { k: 'neg', a: primary() };
        throw err(x.t === 'end' ? 'The formula stops short' : 'Unexpected "' + x.v + '"', x.p); }
      function mul() { var a = primary(); while (peek().t === 'op' && (peek().v === '*' || peek().v === '/')) { var o = next().v; a = { k: 'bin', o: o, a: a, b: primary() }; } return a; }
      function add() { var a = mul(); while (peek().t === 'op' && (peek().v === '+' || peek().v === '-')) { var o = next().v; a = { k: 'bin', o: o, a: a, b: mul() }; } return a; }
      function cmp() { var a = add(); if (peek().t === 'op' && ['>', '<', '>=', '<='].indexOf(peek().v) >= 0) { var o = next().v; return { k: 'cmp', o: o, a: a, b: add() }; } return a; }
      // `and` / `or` join yes/no answers (same grammar as app/formula.py)
      function both() { var a = cmp(); while (peek().t === 'id' && peek().v === 'and') { next(); a = { k: 'logic', o: 'and', a: a, b: cmp() }; } return a; }
      function expr() { var a = both(); while (peek().t === 'id' && peek().v === 'or') { next(); a = { k: 'logic', o: 'or', a: a, b: both() }; } return a; }
      var tree = expr(); if (peek().t !== 'end') throw err('Unexpected "' + peek().v + '"', peek().p); return tree;
    }
    function wma(v, p) { var o = []; for (var i = 0; i < v.length; i++) { if (i < p - 1) { o.push(null); continue; }
        var s = 0, w = 0, ok = true; for (var j = 0; j < p; j++) { var x = v[i - j]; if (x == null) { ok = false; break; } s += x * (p - j); w += p - j; }
        o.push(ok ? s / w : null); } return o; }
    function hmaOf(v, p) { var h = Math.max(1, Math.round(p / 2)), r = Math.max(1, Math.round(Math.sqrt(p)));
      var a = wma(v, h), b = wma(v, p), d = a.map(function (x, i) { return x != null && b[i] != null ? 2 * x - b[i] : null; }); return wma(d, r); }
    function roll(v, p, fn) { var o = []; for (var i = 0; i < v.length; i++) { if (i < p - 1) { o.push(null); continue; }
        var w = v.slice(i - p + 1, i + 1); if (w.some(function (x) { return x == null; })) { o.push(null); continue; } o.push(fn(w)); } return o; }
    var FN = {
      sma: [2, function (x, p) { return sma(x, p); }], ema: [2, function (x, p) { return ema(x, p); }],
      wma: [2, wma], hma: [2, hmaOf],
      rsi: [2, function (x, p) { return rsi(x, p); }], stdev: [2, function (x, p) { return roll(x, p, function (w) { var m = w.reduce(function (a, b) { return a + b; }, 0) / w.length; return Math.sqrt(w.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / w.length); }); }],
      hhv: [2, function (x, p) { return roll(x, p, function (w) { return Math.max.apply(null, w); }); }],
      llv: [2, function (x, p) { return roll(x, p, function (w) { return Math.min.apply(null, w); }); }],
      roc: [2, function (x, p) { return x.map(function (v, i) { return i >= p && x[i - p] ? (v / x[i - p] - 1) * 100 : null; }); }],
      ref: [2, function (x, p) { return x.map(function (v, i) { return i >= p ? x[i - p] : null; }); }],
      atr: [1, null], abs: [1, function (x) { return x.map(function (v) { return v == null ? null : Math.abs(v); }); }],
      max: [2, 'pair'], min: [2, 'pair']
    };
    function evalTree(t, ctx) {
      var n = ctx.n;
      function series(v) { if (Array.isArray(v)) return v; var o = []; for (var i = 0; i < n; i++) o.push(v); return o; }
      function num(v, what, p) { if (Array.isArray(v)) throw err(what + ' wants a number', p); return v; }
      function zip(a, b, f) { a = series(a); b = series(b); var o = []; for (var i = 0; i < n; i++) o.push(a[i] == null || b[i] == null ? null : f(a[i], b[i])); return o; }
      function ev(t) {
        if (t.k === 'num') return t.v;
        if (t.k === 'id') { if (ctx.vars[t.v]) return ctx.vars[t.v]; throw err('Unknown name "' + t.v + '"', t.p); }
        if (t.k === 'neg') { var a = ev(t.a); return Array.isArray(a) ? a.map(function (x) { return x == null ? null : -x; }) : -a; }
        if (t.k === 'bin') { var x = ev(t.a), y = ev(t.b);
          if (!Array.isArray(x) && !Array.isArray(y)) return t.o === '+' ? x + y : t.o === '-' ? x - y : t.o === '*' ? x * y : (y ? x / y : null);
          return zip(x, y, function (p, q) { return t.o === '+' ? p + q : t.o === '-' ? p - q : t.o === '*' ? p * q : (q ? p / q : null); }); }
        if (t.k === 'cmp') { var l = ev(t.a), r = ev(t.b);
          return zip(l, r, function (p, q) { return (t.o === '>' ? p > q : t.o === '<' ? p < q : t.o === '>=' ? p >= q : p <= q) ? 1 : 0; }); }
        if (t.k === 'logic') { var la = ev(t.a), lb = ev(t.b);
          return zip(la, lb, function (p, q) { return (t.o === 'and' ? (p && q) : (p || q)) ? 1 : 0; }); }
        if (t.k === 'call' && !FN[t.f] && window.PIFX && PIFX.has(t.f)) {   // the indicator library, same maths as the server
          var lv = t.a.map(function (x) { return ev(x); }), V = ctx.vars;
          return PIFX.call(t.f, lv, { o: V.open, h: V.high, l: V.low, c: V.close, v: V.volume }, function (m) { throw err(m, t.p); }); }
        if (t.k === 'call') { var f = FN[t.f]; if (!f) throw err('Unknown function "' + t.f + '"', t.p);
          if (t.f === 'rsi' && t.a.length === 1) return rsi(ctx.vars.close, Math.max(1, Math.round(num(ev(t.a[0]), 'rsi', t.p))));
          if (t.a.length !== f[0]) throw err(t.f + ' wants ' + f[0] + ' argument' + (f[0] > 1 ? 's' : ''), t.p);
          if (t.f === 'atr') return ctx.atr(Math.max(1, Math.round(num(ev(t.a[0]), 'atr', t.p))));
          if (f[1] === 'pair') return zip(ev(t.a[0]), ev(t.a[1]), t.f === 'max' ? Math.max : Math.min);
          if (f[0] === 1) return f[1](series(ev(t.a[0])));
          var p2 = Math.max(1, Math.round(num(ev(t.a[1]), t.f, t.p)));
          return f[1](series(ev(t.a[0])), p2); }
        throw err('Cannot read this', 0);
      }
      return series(ev(t));
    }
    function splitStatements(src) { var out = [], depth = 0, start = 0;
      for (var i = 0; i < src.length; i++) { var ch = src[i]; if (ch === '(') depth++; else if (ch === ')') depth--;
        else if (ch === ';' && depth === 0) { out.push({ text: src.slice(start, i), at: start }); start = i + 1; } }
      out.push({ text: src.slice(start), at: start }); return out.filter(function (x) { return x.text.trim(); }); }
    function run(src, ctx) {
      var st = splitStatements(src); if (!st.length) throw err('Nothing to draw', 0);
      for (var i = 0; i < st.length; i++) {
        var m = /^\s*([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]+)$/.exec(st[i].text), last = i === st.length - 1;
        try {
          if (m && !last) { ctx.vars[m[1].toLowerCase()] = evalTree(parse(m[2]), ctx); }
          else if (m && last) { var v = evalTree(parse(m[2]), ctx); ctx.vars[m[1].toLowerCase()] = v; return v; }
          else return evalTree(parse(st[i].text), ctx);
        } catch (e) { if (e && e.pos != null) e.pos += st[i].at + (m ? st[i].text.indexOf(m[2]) : 0); throw e; }
      }
    }
    return { parse: parse, run: run };
  })();
  var formulas = [0, 1, 2, 3, 4, 5].map(function () { return { on: false, expr: '', price: false }; });
  var FX_SLOTS = [0, 1, 2, 3, 4, 5];
  // what happened after a fresh "yes" on this name: descriptive, one name, one window
  function fxStats(vals, c) {
    var cl = c.map(function (x) { return x.close; }), rows = [], i;
    for (i = 1; i < vals.length; i++) if (vals[i] === 1 && vals[i - 1] !== 1) rows.push(i);
    function avg(h) { var a = [], k; for (k = 0; k < rows.length; k++) if (rows[k] + h < cl.length) a.push(cl[rows[k] + h] / cl[rows[k]] - 1);
      return a.length ? { m: a.reduce(function (x, y) { return x + y; }, 0) / a.length, up: a.filter(function (x) { return x > 0; }).length / a.length, n: a.length } : null; }
    var a5 = avg(5), a20 = avg(20), a60 = avg(60); if (!a20) return rows.length ? 'Too few fresh signals with 20 bars after them to say anything.' : 'No fresh signal in this window.';
    function pc(x) { return (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'; }
    return 'After a fresh yes (n=' + a20.n + '): ' + (a5 ? pc(a5.m) + ' in 5 bars, ' : '') + pc(a20.m) + ' in 20' + (a60 ? ', ' + pc(a60.m) + ' in 60' : '')
      + ', up ' + Math.round(a20.up * 100) + '% of the time after 20. This name, this window, not a proof.';
  }
  function fxCtx(c, vol, spy) {
    var v = volsOf(c, vol), sp = spyOf(c, spy);
    return { n: c.length, atr: function (p) { return atr(c, p); },
      vars: { open: c.map(function (x) { return x.open; }), high: c.map(function (x) { return x.high; }), low: c.map(function (x) { return x.low; }),
              close: c.map(function (x) { return x.close; }), volume: v, spy: sp } };
  }
  function fxError(i, msg) { var e = document.getElementById('cp-fxerr-' + i); if (e) e.textContent = msg || ''; }
  function fxBuild(i) {
    return function (c, vol, g, o, spy) {
      var f = formulas[i]; if (!f || !f.expr.trim()) return [];
      var vals;
      try { vals = FX.run(f.expr, fxCtx(c, vol, spy)); fxError(i, ''); }
      catch (e) { fxError(i, (e.message || 'Error') + (e.pos != null ? ' (at character ' + (e.pos + 1) + ')' : '')); return []; }
      var isFlag = vals.every(function (v) { return v == null || v === 0 || v === 1; }) && /[<>]|\b(?:crossed|crossup|crossdown)\s*\(/i.test(f.expr);
      var st = document.getElementById('cp-fxstat-' + i); if (st) st.textContent = isFlag ? fxStats(vals, c) : '';
      if (isFlag) return [{ data: line(c, vals, 0).map(function (x) { return { time: x.time, value: x.value, color: x.value ? TR('text', 0.75) : TR('mute', 0.15) }; }), histogram: true }];
      return [{ data: line(c, vals, 4), color: [C.a, C.b, C.d, C.up, C.dn, C.c][i], width: 2 }];
    };
  }
  FX_SLOTS.forEach(function (i) {
    STUDIES['fx' + (i + 1)] = { label: 'Your formula ' + (i + 1), group: 'Your formulas', pane: 1, height: 100, params: [], formula: i, build: fxBuild(i),
      about: 'One line, or several separated by ; with name = value. The last line is drawn. A comparison draws yes/no bars and tells you what followed.' };
  });
  function fxApply(i) {
    var f = formulas[i], def = STUDIES['fx' + (i + 1)];
    def.pane = f.price ? 0 : 1; studyState['fx' + (i + 1)] = !!(f.on && f.expr.trim());
    drawStudy('fx' + (i + 1)); fitHeight(); saveState();
  }

  // cfg per study, defaults from the catalogue
  function cfgOf(k) {
    var d = {}; ((defOf(k) || {}).params || []).forEach(function (x) { d[x.k] = x.def; });
    var saved = (studyCfg[k] || {});
    Object.keys(saved).forEach(function (x) { if (d[x] != null) d[x] = saved[x]; });
    return d;
  }

  var studyMarkers = {}, studyPM = {}, studyLabels = {}, labelEl = null;
  // text labels a study pins to (time, price), redrawn on scroll and zoom
  function drawStudyLabels() {
    if (!H || !H.el || !chart) return;
    if (!labelEl) { labelEl = document.createElement('div'); labelEl.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:4;overflow:hidden'; H.el.appendChild(labelEl); }
    while (labelEl.firstChild) labelEl.removeChild(labelEl.firstChild);
    var ts = chart.timeScale();
    Object.keys(studyLabels).forEach(function (k) { if (!studyState[k]) return;
      (studyLabels[k] || []).forEach(function (L) {
        var x = ts.timeToCoordinate(L.time), y = H.cs.priceToCoordinate(L.value); if (x == null || y == null) return;
        var d = document.createElement('div'); d.textContent = L.text;
        d.style.cssText = 'position:absolute;left:' + (x - 4) + 'px;top:' + (L.up ? y + 8 : y - 22) + 'px;font-size:10.5px;font-weight:600;white-space:nowrap;'
          + 'padding:1px 5px;border-radius:4px;background:rgba(255,255,255,0.88);border:1px solid ' + (L.up ? TR('good', 1) : TR('bad', 1)) + ';color:' + (L.up ? TR('good', 1) : TR('bad', 1));
        if (L.act && feats3()) { d.style.pointerEvents = 'auto'; d.style.cursor = 'pointer'; d.setAttribute('data-base-act', '1'); d.title = 'Click: set an alert on the pivot, or plan the trade';
          d.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
          d.addEventListener('click', function (ev) { ev.stopPropagation(); openBaseMenu(L, d); }); }
        labelEl.appendChild(d); }); }); }

  // ── chart_feats3: click a base label on the chart ──────────────────────────
  // The menu offers an alert on the pivot (the existing /alerts/create, answered in JSON)
  // and a trade plan: entry, stop and target as three lines you drag, with the size
  // from the member's saved account (same rule as the trade planner: risk $ / (entry - stop)).
  var bmenu = null, bmenuBound = false, plan = null;
  function feats3() { try { return (H.ours && H.ours() || {}).feats3 || null; } catch (e) { return null; } }
  function closeBaseMenu() { if (bmenu && bmenu.parentNode) bmenu.parentNode.removeChild(bmenu); bmenu = null; }
  function r2(x) { return Math.round(x * 100) / 100; }
  function openBaseMenu(L, anchor) {
    var a = L.act; if (!a || !feats3()) return;
    closeBaseMenu();
    var btn = 'block w-full text-left px-2 py-1 rounded-lg hover:bg-sepia-hover text-ink';
    bmenu = document.createElement('div');
    bmenu.className = 'bg-white border border-sepia-border rounded-lg shadow-lg text-xs';
    var left = Math.max(40, Math.min(parseFloat(anchor.style.left) || 40, H.el.clientWidth - 260));
    var top = Math.max(4, Math.min((parseFloat(anchor.style.top) || 0) + 24, H.el.clientHeight - 130));
    bmenu.style.cssText = 'position:absolute;z-index:12;width:15.5rem;padding:6px;left:' + left + 'px;top:' + top + 'px';
    bmenu.innerHTML = '<div class="px-2 py-1 text-ink-mute">' + esc(L.text) + '</div>'
      + '<button type="button" data-a="alert" class="' + btn + '">Alert when price crosses the pivot</button>'
      + '<button type="button" data-a="plan" class="' + btn + '">Plan the trade</button>'
      + '<div data-msg class="px-2 pt-1 font-semibold text-ink" style="display:none"></div>';
    H.el.appendChild(bmenu);
    var msg = bmenu.querySelector('[data-msg]');
    function say(t) { msg.textContent = t; msg.style.display = ''; }
    bmenu.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
    bmenu.addEventListener('click', function (ev) { ev.stopPropagation();
      var b = ev.target && ev.target.closest && ev.target.closest('[data-a]'); if (!b) return;
      if (b.getAttribute('data-a') === 'alert') pivotAlert(a, say); else startPlan(a); });
    if (!bmenuBound) { bmenuBound = true;
      document.addEventListener('mousedown', function (ev) { if (bmenu && !bmenu.contains(ev.target)) closeBaseMenu(); }, true); }
  }
  function pivotAlert(a, say) {
    var tk = tickerNow(), c = bars(), last = c.length ? c[c.length - 1].close : null, lv = r2(a.pivot);
    if (!tk || !(lv > 0)) return;
    var kind = (last != null && lv < last) ? 'below' : 'above';   // the side the price has to cross
    say('Setting the alert...');
    fetch('/alerts/create', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-PI-Json': '1' },
      body: 'ticker=' + encodeURIComponent(tk) + '&level=' + lv.toFixed(2) + '&kind=' + kind + '&back=' + encodeURIComponent(location.pathname) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!(j && j.ok)) { say('That did not go through.'); return; }
        var L2 = alertList(), hit = null; L2.forEach(function (x) { if (x.id === j.id) hit = x; });
        if (hit) hit.level = lv; else L2.push({ id: j.id, level: lv, kind: kind, paused: false });
        drawAlertLines(); say('Alert set at ' + lv.toFixed(2)); })
      .catch(function () { say('Sign in again to set alerts.'); });
  }
  var PLAN_KINDS = [['entry', 'Entry', 0], ['stop', 'Stop', 2], ['target', 'Target', 2]];
  function planColor(k) { return k === 'stop' ? C.dn : k === 'target' ? C.up : C.a; }
  function clearPlan() {
    if (plan) { PLAN_KINDS.forEach(function (x) { try { H.cs.removePriceLine(plan.lines[x[0]]); } catch (e) {} }); clearInterval(plan.tick); try { H.cs.applyOptions({ autoscaleInfoProvider: undefined }); } catch (e) {} }
    plan = null; var h = document.getElementById('cp-plan'); if (h && h.parentNode) h.parentNode.removeChild(h);
  }
  function startPlan(a, saved) {
    closeBaseMenu(); clearPlan();
    var piv = r2(a.pivot), low = (a.low > 0 && a.low < piv) ? a.low : 0;
    // O'Neil: cut a loss at 7-8 %. The base low is the stop when it sits inside 8 %, else 8 % under the pivot. Target = +20 %.
    plan = { tk: tickerNow(), no: a.no, v: saved || { entry: piv, stop: r2(Math.max(low, piv * 0.92)), target: r2(piv * 1.2) }, lines: {}, drag: null };
    savePlan();
    PLAN_KINDS.forEach(function (x) { plan.lines[x[0]] = H.cs.createPriceLine({ price: plan.v[x[0]], color: planColor(x[0]), lineWidth: 1, lineStyle: x[2], axisLabelVisible: true, title: '' }); });
    var host = document.createElement('div'); host.id = 'cp-plan'; host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:7'; H.el.appendChild(host);
    PLAN_KINDS.forEach(function (x) { var b = document.createElement('div'); b.setAttribute('data-pl', x[0]); b.title = 'Drag to move the ' + x[0].toLowerCase();
      b.style.cssText = 'position:absolute;pointer-events:auto;cursor:ns-resize;padding:1px 6px;border-radius:4px;font-size:0.66rem;font-weight:600;line-height:15px;white-space:nowrap;'
        + 'background:rgb(var(--pi-card));border:1px solid ' + planColor(x[0]) + ';color:' + planColor(x[0]); host.appendChild(b); });
    var box = document.createElement('div'); box.setAttribute('data-plbox', '1'); box.className = 'bg-white border border-sepia-border rounded-lg shadow-lg';
    box.style.cssText = 'position:absolute;pointer-events:auto;width:13.5rem;padding:6px 8px;line-height:1.45;font-size:0.7rem'; host.appendChild(box);
    host.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
    host.addEventListener('click', function (ev) { if (ev.target && ev.target.closest && ev.target.closest('[data-plx]')) { forgetPlan(); clearPlan(); } });
    H.el.addEventListener('mousedown', planDown, true);
    if (!planBound) { planBound = true;
      document.addEventListener('mousemove', planMove); document.addEventListener('mouseup', function () { if (plan && plan.drag) { plan.drag = null; savePlan(); } }); }
    // the scale makes room for stop and target once, at the start (not while dragging, or the lines would chase the mouse)
    var lo = plan.v.stop * 0.99, hi = plan.v.target * 1.01;
    try { H.cs.applyOptions({ autoscaleInfoProvider: function (orig) { var r = orig(); if (r && r.priceRange) { r.priceRange.minValue = Math.min(r.priceRange.minValue, lo); r.priceRange.maxValue = Math.max(r.priceRange.maxValue, hi); } return r; } }); } catch (e) {}
    plan.tick = setInterval(placePlan, 300);   // the price scale can rescale under the lines
    placePlan();
  }
  var planBound = false;
  // the plan stays on the name across reloads, one per ticker, until its \u00d7 removes it
  function planKey(tk) { return 'pi_plan_' + (tk || tickerNow()); }
  function savePlan() { if (!plan) return; try { localStorage.setItem(planKey(plan.tk), JSON.stringify({ no: plan.no, v: plan.v })); } catch (e) {} }
  function forgetPlan() { if (!plan) return; try { localStorage.removeItem(planKey(plan.tk)); } catch (e) {} }
  function restorePlan() { if (!feats3()) return; var j = null; try { j = JSON.parse(localStorage.getItem(planKey()) || 'null'); } catch (e) {}
    if (!j || !j.v || !(j.v.entry > 0)) return; startPlan({ pivot: j.v.entry, no: j.no }, j.v); }
  function planDown(ev) {
    var b = plan && ev.target && ev.target.closest && ev.target.closest('[data-pl]'); if (!b) return;
    ev.preventDefault(); ev.stopPropagation(); plan.drag = b.getAttribute('data-pl');
  }
  function planMove(ev) {
    if (!plan || !plan.drag) return;
    var bb = H.el.getBoundingClientRect(), p = null; try { p = H.cs.coordinateToPrice(ev.clientY - bb.top); } catch (e) {}
    if (p == null || !(p > 0)) return;
    plan.v[plan.drag] = r2(p);
    try { plan.lines[plan.drag].applyOptions({ price: plan.v[plan.drag] }); } catch (e) {}
    placePlan();
  }
  function planCalc() {
    var f = feats3() || {}, v = plan.v, per = v.entry - v.stop;
    if (!(per > 0)) return { err: 'The stop has to sit below the entry.' };
    var o = { per: per, stopPct: per / v.entry * 100, tgtPct: (v.target / v.entry - 1) * 100, rr: v.target > v.entry ? (v.target - v.entry) / per : null };
    if (f.acct > 0) { o.riskD = f.acct * f.risk / 100; o.shares = Math.floor(o.riskD / per);
      var capSh = Math.floor(f.acct * (f.cap || 25) / 100 / v.entry); if (capSh < o.shares) { o.shares = capSh; o.capped = true; }
      o.value = o.shares * v.entry; o.pos = o.value / f.acct * 100; o.risk = o.shares * per; o.reward = o.shares * (v.target - v.entry); }
    return o;
  }
  function placePlan() {
    var host = plan && document.getElementById('cp-plan'); if (!host) return;
    var axisW = 0; try { axisW = chart.priceScale('right').width(); } catch (e) {}
    var ys = {};
    PLAN_KINDS.forEach(function (x) { var k = x[0], b = host.querySelector('[data-pl="' + k + '"]'), y = null; try { y = H.cs.priceToCoordinate(plan.v[k]); } catch (e) {}
      ys[k] = y; b.style.display = y == null ? 'none' : ''; if (y == null) return;
      b.style.right = (axisW + 8) + 'px'; b.style.top = Math.round(y - 8) + 'px'; b.textContent = x[1] + ' ' + plan.v[k].toFixed(2); });
    var f = feats3() || {}, c = planCalc(), v = plan.v, box = host.querySelector('[data-plbox]'), h = '';
    function m(x) { return '$' + Math.round(x).toLocaleString('en-US'); }
    h += '<div class="flex justify-between items-center"><span class="font-semibold text-ink">Plan B' + esc(plan.no) + ' · ' + esc(plan.tk) + '</span><button type="button" data-plx="1" class="text-ink-mute hover:text-ink" title="Remove the plan">\u00d7</button></div>';
    if (c.err) h += '<div class="text-bad">' + c.err + '</div>';
    else {
      if (c.shares != null) h += '<div><span class="text-ink-mute">Size</span> <b class="text-ink">' + c.shares.toLocaleString('en-US') + ' shares</b> · ' + m(c.value) + ' · ' + c.pos.toFixed(1) + '% of the account' + (c.capped ? ' (capped)' : '') + '</div>'
        + '<div><span class="text-ink-mute">Risk</span> <b class="text-ink">' + m(c.risk) + '</b> of ' + m(f.acct) + ' · stop ' + c.stopPct.toFixed(1) + '% under</div>';
      else h += '<div class="text-ink-mute">Stop ' + c.stopPct.toFixed(1) + '% under the entry. Save your account size in the trade planner to get the number of shares.</div>';
      h += '<div><span class="text-ink-mute">Target</span> +' + c.tgtPct.toFixed(1) + '%' + (c.rr != null ? ' · <b class="text-ink">' + c.rr.toFixed(1) + 'R</b>' : '') + (c.reward != null ? ' · +' + m(c.reward) : '') + '</div>';
    }
    if (f.planner) h += '<a class="text-accent" href="/plan/' + encodeURIComponent(plan.tk) + '?entry=' + v.entry.toFixed(2) + '&stop=' + v.stop.toFixed(2) + '&target=' + v.target.toFixed(2) + '">Open in the trade planner</a>';
    box.innerHTML = h;
    var ye = ys.entry != null ? ys.entry : 80, bh = box.offsetHeight || 90;
    box.style.right = (axisW + 110) + 'px'; box.style.top = Math.max(36, Math.min(ye - bh / 2, H.el.clientHeight - bh - 40)) + 'px';
  }
  function clearStudy(k) {
    if (studyLabels[k]) { delete studyLabels[k]; setTimeout(drawStudyLabels, 0); }
    try { setTimeout(function () { document.dispatchEvent(new CustomEvent('cp-studies')); }, 0); } catch (e) {}
    (studySeries[k] || []).forEach(function (s) { try { chart.removeSeries(s); } catch (e) {} });
    studySeries[k] = [];
    if (studyMarkers[k]) { try { studyMarkers[k].setMarkers([]); } catch (e) {} }
    if (studyPM[k]) { try { studyPM[k].setMarkers([]); } catch (e) {} }
    if (studyPane[k] != null) {
      try { var ps = chart.panes(); if (ps[studyPane[k]] && !ps[studyPane[k]].getSeries().length) chart.removePane(studyPane[k]); } catch (e) {}
      studyPane[k] = null;
    }
  }

  // a study's source (another live study), one level deep, never itself
  // a study's source (another live study). Chains are fine (an average of the
  // RSI of OBV), up to three deep; a loop back to the study is refused.
  function srcOf(k) { var sc = studyCfg[k] || {}, src = sc.src;
    if (!src || src === k || !studyState[src] || !defOf(src)) return null;
    var seen = {}, x = src; seen[k] = 1;
    for (var n = 0; x && n < 4; n++) { if (seen[x]) return null; seen[x] = 1; x = (studyCfg[x] || {}).src; if (x && !studyState[x]) x = null; }
    return x ? null : src; }
  function sourceBars(src, depth) {
    var d = defOf(src); if (!d || !d.build || (depth || 0) > 3) return null;
    var up = srcOf(src), inp = up ? sourceBars(up, (depth || 0) + 1) : bars(); if (!inp) return null;
    var pp = null; try { pp = d.build(inp, up ? [] : H.vol(), cfgOf(src), (H.ours && H.ours()) || {}, (H.spy && H.spy()) || []) || []; } catch (e) { return null; }
    if (pp.markers || !pp.length) return null;
    var first = pp.filter(function (x) { return !x.histogram; })[0] || pp[0];
    var out = []; (first.data || []).forEach(function (pt) {
      if (pt && pt.value != null && isFinite(pt.value)) out.push({ time: pt.time, open: pt.value, high: pt.value, low: pt.value, close: pt.value, volume: 0 }); });
    return out.length > 5 ? out : null; }
  // the studies that read this one: cleared before it redraws (they may sit on
  // its pane), drawn again after it
  function dependentsOf(k) { return liveKeys().filter(function (x) { return x !== k && (studyCfg[x] || {}).src === k; }); }
  function clearTree(k, d) { if ((d || 0) > 4) return; dependentsOf(k).forEach(function (x) { clearTree(x, (d || 0) + 1); }); clearStudy(k); }
  function drawStudy(k, d) {
    if ((d || 0) > 4) return;
    var deps = dependentsOf(k);
    deps.forEach(function (x) { clearTree(x); });
    drawStudyCore(k);
    deps.forEach(function (x) { drawStudy(x, (d || 0) + 1); });
  }
  function drawStudyCore(k) {
    var def = defOf(k); if (!def) return;
    clearStudy(k);
    if (k === 'vol_plus') { try { H.volVisible(LOOK.vol !== false && !studyState.vol_plus); } catch (e) {} }
    if (!studyState[k]) return;
    if (def.daily && (H.tf() !== '1D' || interval !== 'D')) return;   // our series are daily by nature
    var sc = studyCfg[k] || {};
    if (sc.tfs && sc.tfs[H.tf()] === false) return;   // the member hid it on this timeframe
    // Indicator on indicator: with a source set, the study reads another study's
    // first line as if it were the close (RSI of OBV, a moving average of RSI).
    var srcKey = srcOf(k), srcBars = null;
    if (srcKey) srcBars = sourceBars(srcKey);
    if (srcKey && !srcBars) return;
    var htf = (!srcKey && sc.htf && tvMore() && !def.daily && !intraBars && interval === 'D' && H.tf() === '1D') ? sc.htf : null, parts;
    if (htf) {
      var dayBars = bars(), hb = htfBars(dayBars, htf);
      parts = def.build(hb.bars, hb.vol, cfgOf(k), (H.ours && H.ours()) || {}, []) || [];
      if (parts.markers || !parts.length) return;   // a marker layer has no weekly reading to step back
      var lbl = parts.labels; parts = htfSpread(parts, dayBars, hb, htf); if (lbl) parts.labels = lbl;
    } else parts = def.build(srcBars || bars(), srcBars ? [] : H.vol(), cfgOf(k), (H.ours && H.ours()) || {}, (H.spy && H.spy()) || []) || [];
    if (parts.pmarks || studyPM[k]) { var pm = parts.pmarks || []; try { if (!studyPM[k]) studyPM[k] = LWC.createSeriesMarkers(H.cs, pm); else studyPM[k].setMarkers(pm); } catch (e) {} }   // arrows on the candles too (divergence); an empty build clears the old ones
    var colr = (studyCfg[k] || {}).color; if (colr && parts.length) parts.forEach(function (pp) { if (!pp.histogram) pp.color = colr; });
    if (parts.markers) {   // a marker layer rides on the candles, no series of its own
      try { if (!studyMarkers[k]) studyMarkers[k] = LWC.createSeriesMarkers(H.cs, parts.markers); else studyMarkers[k].setMarkers(parts.markers); } catch (e) {}
      return;
    }
    if (!parts.length) return;
    if (parts.labels) { studyLabels[k] = parts.labels; setTimeout(drawStudyLabels, 0); }
    var paneIdx = 0, ownPane = !!def.pane;
    if (srcKey) {   // an oscillator of a study gets its own pane and scale (RSI of OBV);
      // a line drawn on a study shares the study's pane and scale (an average of the RSI)
      if (def.pane) ownPane = true;
      else if (studyPane[srcKey] != null) { paneIdx = studyPane[srcKey]; ownPane = false; }
      else ownPane = !!defOf(srcKey).pane;
    }
    if (ownPane) { try { chart.addPane(); paneIdx = chart.panes().length - 1; } catch (e) { paneIdx = 0; } }
    studyPane[k] = ownPane ? paneIdx : null;
    var made = [];
    parts.forEach(function (p) {
      var s;
      var prec = sc.prec == null ? 2 : sc.prec;
      var scaleId = sc.scale === 'left' ? 'left' : undefined;
      var fmt = p.volFmt ? { type: 'volume' } : { type: 'price', precision: prec, minMove: Math.pow(10, -prec) };
      if (p.histogram) s = chart.addSeries(LWC.HistogramSeries,
            { priceLineVisible: false, lastValueVisible: !!sc.axis, priceFormat: fmt,
              visible: !sc.hidden, priceScaleId: scaleId }, paneIdx);
      else s = chart.addSeries(LWC.LineSeries,
            { color: p.color, lineWidth: sc.width || p.width || 1, lineType: (p.steps && LWC.LineType) ? LWC.LineType.WithSteps : 0,
              lineStyle: sc.style != null ? sc.style : (p.dashed ? 2 : p.dotted ? 1 : 0),
              priceLineVisible: false, lastValueVisible: !!sc.axis, priceFormat: fmt,
              visible: !sc.hidden, priceScaleId: scaleId }, paneIdx);
      s.setData(p.data); made.push(s);
      if (p.marks && p.marks.length) { try { studyMarkers[k] = LWC.createSeriesMarkers(s, p.marks); } catch (e) {} }   // markers on the study's own line
      (def.bands || []).forEach(function (b) {
        try { s.createPriceLine({ price: b, color: TR('mute', 0.45), lineWidth: 1, lineStyle: 2, axisLabelVisible: false }); } catch (e) {}
      });
    });
    studySeries[k] = made;
    try { window.__cpDrawn = made.length; } catch (e) {}
    if (def.pane) {
      try {
        if (def.height) chart.panes()[paneIdx].setHeight(def.height);
        var g = cfgOf(k), tag = (def.params || []).map(function (x) { return g[x.k]; }).join(', ');
        if (!window.__piShell) LWC.createTextWatermark(chart.panes()[paneIdx], { horzAlign: 'left', vertAlign: 'top',
          lines: [{ text: '  ' + def.label + (tag ? '  ' + tag : ''),
                    color: TR('mute', 0.85), fontSize: 11 }].concat(parts[0] && parts[0].legend
                    ? [{ text: '  ' + parts[0].legend, color: TR('mute', 0.85), fontSize: 10 }] : []) });
      } catch (e) {}
    }
  }

  function baseH() { return (window.__piChartHeight && +window.__piChartHeight) || 400; }
  var PANE_MIN = 90, PRICE_MIN = 260;
  function fitHeight() {
    var extra = 0, panes = 0;
    liveKeys().forEach(function (k) {
      var d = defOf(k); if (d && d.pane) { extra += (d.height || 100); panes++; } });
    // In the workspace the chart fills the screen; past a few panes it would squeeze the
    // price into a band, so the chart grows and the column scrolls instead.
    var BASE_H = baseH();
    var need = window.__piShell ? Math.max(BASE_H, PRICE_MIN + panes * PANE_MIN + 20) : BASE_H + extra + (window.__piVolPane ? 80 : 0);
    try { if (!document.fullscreenElement) H.el.style.height = need + 'px'; } catch (e) {}
    // the price keeps the room, each study pane keeps a readable share: stretch
    // factors survive a redraw, a height set by hand does not
    try {
      var ps = chart.panes();
      var vsz = { small: 0.35, normal: 0.6, large: 1 }[(typeof LOOK !== 'undefined' && LOOK.volSize) || 'normal'] || 0.6;
      ps.forEach(function (p2, i) { p2.setStretchFactor(i === 0 ? Math.max(3, ps.length + 1) : (i === 1 && window.__piVolPane ? vsz : 1)); });
    } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {}
  }
  function redrawStudies() {
    liveKeys().forEach(function (k) { drawStudy(k); });
    fitHeight();
  }

  // ── alternative price renderings ─────────────────────────────────────────
  function heikin(c) { var o = [], pO = null, pC = null;
    for (var i = 0; i < c.length; i++) { var b = c[i];
      var hc = (b.open + b.high + b.low + b.close) / 4;
      var ho = pO == null ? (b.open + b.close) / 2 : (pO + pC) / 2;
      o.push({ time: b.time, open: +ho.toFixed(2), high: +Math.max(b.high, ho, hc).toFixed(2),
               low: +Math.min(b.low, ho, hc).toFixed(2), close: +hc.toFixed(2) });
      pO = ho; pC = hc; } return o; }

  function brickSize(c) { var a = atr(c, 14), last = null;
    for (var i = a.length - 1; i >= 0; i--) if (a[i] != null) { last = a[i]; break; }
    return last || (c.length ? c[c.length - 1].close * 0.02 : 1); }

  // Transform charts drop the calendar: several bricks can come from one session,
  // so each step gets its own slot on the axis and the dates stop being literal.
  function tsOf(day) { var p = day.slice(0, 10).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 1000; }
  function stepped(rows) {
    var out = [], last = -1;
    for (var i = 0; i < rows.length; i++) {
      var t = tsOf(rows[i].at);
      if (t <= last) t = last + 3600;      // several steps in one session
      last = t;
      out.push({ time: t, open: rows[i].open, high: rows[i].high,
                 low: rows[i].low, close: rows[i].close });
    }
    return out;
  }

  function renko(c) { var bs = brickSize(c), out = [], base = null;
    for (var i = 0; i < c.length; i++) { var p = c[i].close;
      if (base == null) { base = Math.round(p / bs) * bs; continue; }
      while (p - base >= bs) { out.push({ at: c[i].time, open: base, close: base + bs, high: base + bs, low: base }); base += bs; }
      while (base - p >= bs) { out.push({ at: c[i].time, open: base, close: base - bs, high: base, low: base - bs }); base -= bs; } }
    return stepped(out); }

  function lineBreak(c, n) { n = n || 3; var out = [], hi = [], lo = [];
    for (var i = 0; i < c.length; i++) { var p = c[i].close;
      if (!out.length) { out.push({ at: c[i].time, open: p, close: p, high: p, low: p }); hi.push(p); lo.push(p); continue; }
      var rh = Math.max.apply(null, hi.slice(-n)), rl = Math.min.apply(null, lo.slice(-n));
      if (p > rh) { out.push({ at: c[i].time, open: rh, close: p, high: p, low: rh }); hi.push(p); lo.push(rh); }
      else if (p < rl) { out.push({ at: c[i].time, open: rl, close: p, high: rl, low: p }); hi.push(rl); lo.push(p); } }
    return stepped(out); }

  // Range bars: a bar closes once its high-low spans one step (one ATR). Daily bars only give
  // four prices a day, so the path inside a day is read open, nearer extreme, far extreme, close.
  function rangeBars(c) { var bs = brickSize(c), out = [], cur = null;
    function feed(at, p) {
      if (!cur) { cur = { at: at, open: p, high: p, low: p, close: p }; return; }
      while (true) {
        if (p > cur.high) cur.high = Math.min(p, cur.low + bs);
        if (p < cur.low) cur.low = Math.max(p, cur.high - bs);
        if (cur.high - cur.low >= bs - 1e-9 && (p >= cur.low + bs - 1e-9 || p <= cur.high - bs + 1e-9)) {
          var up = p >= cur.high; cur.close = up ? cur.high : cur.low; out.push(cur);
          var o = cur.close; cur = { at: at, open: o, high: o, low: o, close: o };
          if (Math.abs(p - o) < 1e-9) return;
          continue;
        }
        cur.close = p; return;
      } }
    for (var i = 0; i < c.length; i++) { var b = c[i], downFirst = b.close >= b.open;
      [b.open, downFirst ? b.low : b.high, downFirst ? b.high : b.low, b.close].forEach(function (p) { feed(b.time, p); }); }
    if (cur && cur.high > cur.low) out.push(cur);
    return stepped(out); }

  // Kagi: the line only turns when price gives back a full step from its extreme
  function kagi(c) {
    if (c.length < 3) return [];
    var bs = brickSize(c), out = [], dir = 1, ext = c[0].close, start = c[0].close;
    for (var i = 1; i < c.length; i++) {
      var p = c[i].close;
      if (dir > 0) {
        if (p > ext) { ext = p; continue; }
        if (ext - p >= bs) { out.push({ at: c[i].time, open: start, close: ext, high: ext, low: Math.min(start, ext) });
          start = ext; ext = p; dir = -1; }
      } else {
        if (p < ext) { ext = p; continue; }
        if (p - ext >= bs) { out.push({ at: c[i].time, open: start, close: ext, high: Math.max(start, ext), low: ext });
          start = ext; ext = p; dir = 1; }
      }
    }
    out.push({ at: c[c.length - 1].time, open: start, close: ext,
               high: Math.max(start, ext), low: Math.min(start, ext) });
    return stepped(out);
  }

  // Point & Figure: one column per reversal, boxes about a third of a step so the
  // columns stay readable instead of collapsing into two or three blocks
  function pointFigure(c) {
    if (c.length < 3) return [];
    var bs = Math.max(brickSize(c) / 3, c[c.length - 1].close * 0.005), rev = 3;
    var out = [], dir = 1, top = c[0].close, bot = c[0].close;
    for (var i = 1; i < c.length; i++) {
      var p = c[i].close;
      if (dir > 0) {
        if (p >= top + bs) { top = Math.floor(p / bs) * bs; continue; }
        if (top - p >= rev * bs) { out.push({ at: c[i].time, open: bot, close: top, high: top, low: bot });
          bot = Math.ceil(p / bs) * bs; dir = -1; }
      } else {
        if (p <= bot - bs) { bot = Math.ceil(p / bs) * bs; continue; }
        if (p - bot >= rev * bs) { out.push({ at: c[i].time, open: top, close: bot, high: top, low: bot });
          top = Math.floor(p / bs) * bs; dir = 1; }
      }
    }
    out.push(dir > 0 ? { at: c[c.length - 1].time, open: bot, close: top, high: top, low: bot }
                     : { at: c[c.length - 1].time, open: top, close: bot, high: top, low: bot });
    return stepped(out);
  }

  var TYPES = {
    candles:  { label: 'Candles', note: 'The classic. Open, high, low, close.' },
    hollow:   { label: 'Hollow candles', note: 'Up bars left open, so closes read faster.' },
    bars:     { label: 'OHLC bars', note: 'Ticks instead of bodies.' },
    line:     { label: 'Line', note: 'The close, nothing else.' },
    area:     { label: 'Area', note: 'The line, with weight under it.' },
    baseline: { label: 'Baseline', note: 'Two tones split at the last close.' },
    hlc:      { label: 'HLC bars', note: 'High, low, close. Clean and minimal.' },
    heikin:   { label: 'Heikin-Ashi', note: 'Smoothed candles for trend clarity.' },
    renko:    { label: 'Renko', transform: true, note: 'One block per step of price.' },
    kagi:     { label: 'Kagi', transform: true, note: 'The line turns only on a real reversal.' },
    lbreak:   { label: 'Line break', transform: true, note: 'A block when price clears the last three.' },
    pnf:      { label: 'Point & Figure', transform: true, note: 'One column per reversal, time removed.' },
    rangebars: { label: 'Range bars', transform: true, note: 'A new bar each time price covers a fixed range.' },   // dark chart_tv_lot4
    columns:  { label: 'Columns', note: 'One column per close, tinted by the day.' },
    highlow:  { label: 'High-low', note: 'The full range of each bar, no open or close.' },
    step:     { label: 'Step line', note: 'The close held flat until the next one.' },
    volcandles: { label: 'Volume candles', note: 'Each candle is as wide as its volume is heavy.' }   // dark vol_candles
    ,raindrop: { label: 'Raindrop', note: 'Each session is a drop, widest where the volume sat.' }   // dark f5104_ajouter_graphique_raindrop_menu_style
  };
  // a small sketch per style, drawn inline so the picker shows the shape
  var UPC = C.up, DNC = C.dn, LNC = C.b;
  function sketch(k) {
    function bar(x, o, c2, h, l, hollow) {
      var up = c2 < o, col = up ? UPC : DNC, y = Math.min(o, c2), hh = Math.abs(c2 - o) || 1;
      return '<line x1="' + x + '" x2="' + x + '" y1="' + h + '" y2="' + l + '" stroke="' + col + '" stroke-width="1"/>'
        + '<rect x="' + (x - 2.5) + '" y="' + y + '" width="5" height="' + hh + '" fill="'
        + (hollow && up ? 'none' : col) + '" stroke="' + col + '"/>';
    }
    var g = '';
    if (k === 'line' || k === 'area' || k === 'baseline') {
      var pts = '4,30 14,24 24,27 34,17 44,20 54,10';
      if (k === 'area') g += '<polygon points="' + pts + ' 54,34 4,34" fill="'+TR('s2', 0.18)+'"/>';
      if (k === 'baseline') { g += '<line x1="2" x2="58" y1="22" y2="22" stroke="#b4a78c" stroke-dasharray="2 2"/>';
        g += '<polygon points="' + pts + ' 54,22 4,22" fill="'+TR('good', 0.18)+'"/>'; }
      g += '<polyline points="' + pts + '" fill="none" stroke="' + (k === 'baseline' ? UPC : LNC) + '" stroke-width="1.6"/>';
      return g;
    }
    if (k === 'bars' || k === 'hlc') {
      [[8, 26, 20], [20, 22, 15], [32, 24, 18], [44, 16, 9]].forEach(function (b2, i) {
        var col = i === 1 ? DNC : UPC;
        g += '<line x1="' + b2[0] + '" x2="' + b2[0] + '" y1="' + (b2[1] + 6) + '" y2="' + (b2[2] - 4) + '" stroke="' + col + '"/>'
          + '<line x1="' + b2[0] + '" x2="' + (b2[0] + 4) + '" y1="' + b2[1] + '" y2="' + b2[1] + '" stroke="' + col + '"/>'
          + (k === 'bars' ? '<line x1="' + (b2[0] - 4) + '" x2="' + b2[0] + '" y1="' + b2[2] + '" y2="' + b2[2] + '" stroke="' + col + '"/>' : '');
      });
      return g;
    }
    if (k === 'renko' || k === 'lbreak' || k === 'pnf') {
      [[6, 24, UPC], [14, 18, UPC], [22, 12, UPC], [30, 18, DNC], [38, 12, UPC], [46, 6, UPC]].forEach(function (b2) {
        g += '<rect x="' + b2[0] + '" y="' + b2[1] + '" width="7" height="7" fill="' + b2[2] + '"/>';
      });
      return g;
    }
    if (k === 'columns') { [[6, 20], [16, 14], [26, 18], [36, 10], [46, 6]].forEach(function (b2, i) {
        g += '<rect x="' + b2[0] + '" y="' + b2[1] + '" width="7" height="' + (32 - b2[1]) + '" fill="' + (i === 2 ? DNC : UPC) + '"/>'; }); return g; }
    if (k === 'highlow') { [[8, 14, 28], [20, 10, 22], [32, 16, 26], [44, 6, 18]].forEach(function (b2, i) {
        g += '<rect x="' + (b2[0] - 3) + '" y="' + b2[1] + '" width="6" height="' + (b2[2] - b2[1]) + '" fill="none" stroke="' + (i === 2 ? DNC : UPC) + '"/>'; }); return g; }
    if (k === 'step') return '<polyline points="4,28 14,28 14,22 26,22 26,25 38,25 38,14 54,14" fill="none" stroke="' + LNC + '" stroke-width="1.6"/>';
    if (k === 'kagi') return '<polyline points="4,28 14,28 14,16 26,16 26,24 38,24 38,8 54,8" fill="none" stroke="' + UPC + '" stroke-width="1.8"/>';
    if (k === 'raindrop') { [[10, 5, 6, 28], [24, 8, 2, 22], [38, 6, 4, 26]].forEach(function (b2, i) {
        var m = (b2[2] + b2[3]) / 2;
        g += '<polygon points="' + b2[0] + ',' + b2[2] + ' ' + (b2[0] + b2[1]) + ',' + m + ' ' + b2[0] + ',' + b2[3] + ' ' + (b2[0] - b2[1]) + ',' + m
          + '" fill="' + (i === 1 ? DNC : UPC) + '"/>'; }); return g; }
    if (k === 'volcandles') { [[10, 4, 22, 27], [24, 9, 24, 16], [34, 3, 18, 22], [46, 7, 20, 11]].forEach(function (b2, i) {
        g += '<line x1="' + b2[0] + '" x2="' + b2[0] + '" y1="' + (Math.min(b2[2], b2[3]) - 5) + '" y2="' + (Math.max(b2[2], b2[3]) + 5) + '" stroke="' + (i === 1 ? DNC : UPC) + '"/>'
          + '<rect x="' + (b2[0] - b2[1] / 2) + '" y="' + Math.min(b2[2], b2[3]) + '" width="' + b2[1] + '" height="' + Math.abs(b2[3] - b2[2]) + '" fill="' + (i === 1 ? DNC : UPC) + '"/>'; }); return g; }
    var set = k === 'heikin' ? [[10, 24, 18], [22, 20, 14], [34, 17, 11], [46, 13, 7]]
                             : [[10, 22, 27], [22, 24, 16], [34, 18, 22], [46, 20, 11]];
    set.forEach(function (b2, i) { g += bar(b2[0], b2[1], b2[2], b2[2] - 5, b2[1] + 5, k === 'hollow'); });
    return g;
  }

  var UP = C.up, DN = C.dn;
  function applyType() {
    var c = bars(); if (!c.length) return;
    if (baseSeries) { try { chart.removeSeries(baseSeries); } catch (e) {} baseSeries = null; }
    var t = TYPES[mode] || TYPES.candles, note = document.getElementById('cp-note');
    // a custom interval (2D, 3D, 2W, Q) rebuilds the bars here, so the desk
    // layers keyed to the server's sessions step aside, like a rebuilt price
    try { H.overlays(!t.transform && interval === 'D'); H.hideReadout(!!t.transform || interval !== 'D'); } catch (e) {}
    drawLayerVisible(!t.transform);
    // the built-in candle series stays the default view; everything else replaces it
    var showBase = (mode === 'candles' && interval === 'D');
    try { H.cs.applyOptions({ visible: showBase }); } catch (e) {}
    try { if (H.mmSync) H.mmSync(); } catch (e) {}   // the money map follows the candle series
    if (showBase) { if (note) note.style.display = 'none'; markReplay(); drawMarks(); return; }
    var data = c, opts, def;
    if (mode === 'heikin') data = heikin(c);
    else if (mode === 'renko') data = renko(c);
    else if (mode === 'kagi') data = kagi(c);
    else if (mode === 'lbreak') data = lineBreak(c);
    else if (mode === 'pnf') data = pointFigure(c);
    else if (mode === 'rangebars') data = rangeBars(c);
    if (mode === 'volcandles' || mode === 'raindrop') {
      // dark vol_candles / raindrop: a custom series (chart-volcandles.js) whose width follows the volume
      var vv = volsOf(c, H.vol());
      data = c.map(function (b, i) { return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: vv[i] }; });
    } else if (mode === 'columns') {
      data = c.map(function (b, i) { return { time: b.time, value: b.close,
        color: (i && b.close < c[i - 1].close) ? TR('bad', 0.75) : TR('good', 0.75) }; });
      def = LWC.HistogramSeries; opts = { priceLineVisible: false, base: 0 };
    } else if (mode === 'highlow') {
      // a box from low to high, tinted by the close against the previous close
      data = c.map(function (b, i) { var up = !i || b.close >= c[i - 1].close;
        return { time: b.time, open: up ? b.low : b.high, high: b.high, low: b.low, close: up ? b.high : b.low }; });
      def = LWC.CandlestickSeries;
      opts = { upColor: TR('good', 0.18), downColor: TR('bad', 0.18), borderUpColor: UP, borderDownColor: DN,
               wickVisible: false, borderVisible: true, priceLineVisible: false };
    } else if (mode === 'step') {
      data = c.map(function (b) { return { time: b.time, value: b.close }; });
      def = LWC.LineSeries; opts = { color: C.b, lineWidth: 2, lineType: 1, priceLineVisible: false };
    } else if (mode === 'line' || mode === 'area' || mode === 'baseline') {
      data = c.map(function (b) { return { time: b.time, value: b.close }; });
      def = mode === 'line' ? LWC.LineSeries : mode === 'area' ? LWC.AreaSeries : LWC.BaselineSeries;
      opts = mode === 'baseline'
        ? { baseValue: { type: 'price', price: c[Math.max(0, c.length - 1)].close },
            topLineColor: UP, bottomLineColor: DN, priceLineVisible: false }
        : { color: C.b, lineWidth: 2, topColor: PI_CHART.theme().rgba('s2', 0.22),
            bottomColor: TR('s2', 0.02), priceLineVisible: false };
    } else if (mode === 'bars' || mode === 'hlc') {
      def = LWC.BarSeries;
      opts = { upColor: UP, downColor: DN, thinBars: mode === 'hlc', priceLineVisible: false };
    } else {
      def = LWC.CandlestickSeries;
      opts = { upColor: mode === 'hollow' ? 'rgba(0,0,0,0)' : UP, downColor: DN,
               borderUpColor: UP, borderDownColor: DN, wickUpColor: UP, wickDownColor: DN,
               borderVisible: true, priceLineVisible: false };
    }
    baseSeries = mode === 'volcandles' ? chart.addCustomSeries(window.__cpVolCandles(UP, DN), { priceLineVisible: false }, 0) :
      mode === 'raindrop' ? chart.addCustomSeries(window.__cpRaindrop(UP, DN), { priceLineVisible: false }, 0) : chart.addSeries(def, opts, 0);
    baseSeries.setData(data);
    try { window.__cpProbe = data.length; } catch (e) {}
    // a rebuilt price has far fewer points than the window: space them out
    if (t.transform) {
      // far fewer points than the window: widen the blocks so they read as steps
      // keep the whole history in view; the gaps are sessions that never completed
      // a step, which is information rather than a rendering fault
      try { chart.timeScale().fitContent(); } catch (e) {}
    } else { try { chart.timeScale().applyOptions({ barSpacing: interval === 'D' ? 6 : 10 }); if (interval !== 'D') chart.timeScale().fitContent(); } catch (e) {} }
    if (note) {
      note.textContent = t.transform
        ? t.label + ' redraws the price as steps of about ' + brickSize(c).toFixed(2)
          + '. Each block marks a completed move and sits on the date it finished, so a gap is a stretch that never completed a step. '
          + 'Moving averages, volume and the markers are keyed to sessions, so they step aside here.'
        : '';
      note.style.display = t.transform ? '' : 'none';
    }
    markReplay(); drawMarks();
  }

  // ── bar replay: walk the window forward one bar at a time ────────────────
  function markReplay() {
    var btn = document.getElementById('cp-replay'); if (!btn) return;
    btn.textContent = replay ? '⏸ Replay' : '▶ Replay';
    pill(btn, !!replay);
  }
  function stopReplay() {
    if (replay && replay.timer) clearInterval(replay.timer);
    if (replay && (replay.pos || replay.trades.length)) {
      var c = bars(), b = c[c.length - 1]; if (replay.pos && b) replayClose(b.close);
      var you = replay.eq - 1, hold = b ? b.close / replay.start - 1 : 0;
      try { var log = JSON.parse(localStorage.getItem('pi_replay_log') || '[]') || [];
        log.push({ t: ((document.getElementById('chart-snap') || {}).dataset || {}).ticker || '', on: new Date().toISOString().slice(0, 10), you: you, hold: hold, n: replay.trades.length });
        localStorage.setItem('pi_replay_log', JSON.stringify(log.slice(-30))); } catch (e) {}
      hint('Replay over: you ' + fmtPct(you) + ' over ' + replay.trades.length + ' trade' + (replay.trades.length > 1 ? 's' : '') + ', buy and hold ' + fmtPct(hold));
      setTimeout(function () { hint(''); }, 5000);
    }
    try { if (replayMk) replayMk.setMarkers([]); } catch (e) {}
    replay = null;
    var bar = document.getElementById('cp-replay-bar'); if (bar) bar.style.display = 'none';
    try { H.clip(null); } catch (e) {}
    applyType(); redrawStudies(); markReplay();
  }
  function feed() {
    var c = bars();
    try { H.clip(replay ? replay.i : null); } catch (e) {}
    if (mode !== 'candles') applyType();
    redrawStudies();
    var lbl = document.getElementById('cp-replay-at');
    if (lbl && c.length) lbl.textContent = c[c.length - 1].time + '  \u00b7  bar ' + c.length + ' of ' + (interval === 'D' ? H.candles().length : resampleBars(H.candles(), interval).length);
    replayPnl();
    if (replaySim()) simBoards();
  }
  // TradingView asks you where to start: the button arms a pick, the next click
  // on the chart is the bar the replay opens on.
  var replayPick = false;
  function startReplay() {
    var all = bars(); if (all.length < 30) return;
    if (replay) { startReplayAt(Math.max(20, Math.floor(all.length * 0.5))); return; }
    replayPick = true;
    if (H.el) H.el.style.cursor = 'crosshair';
    hint('Click the bar the replay starts on, Esc to take the middle');
  }
  function replayHere(ev) {
    replayPick = false; hint('');
    if (H.el) H.el.style.cursor = activeTool ? 'crosshair' : cursorCss();
    var all = bars(), pt = pointAt(ev), i = -1;
    if (pt) for (var n = 0; n < all.length; n++) if (all[n].time === pt.time) i = n;
    if (i < 5) i = Math.max(20, Math.floor(all.length * 0.5));
    startReplayAt(i);
  }
  function startReplayAt(i) {
    var all = bars(); if (all.length < 30) return;
    if (replay && replay.timer) clearInterval(replay.timer);
    replay = { i: Math.max(20, Math.min(all.length, i)), timer: null, ms: 320, pos: null, trades: [], eq: 1, start: null };
    simBoardsAt = '';
    replay.start = all[replay.i - 1].close;
    var bar = document.getElementById('cp-replay-bar'); if (bar) bar.style.display = '';
    var rec = replayRecord(), lbl = document.getElementById('cp-record');
    if (lbl) lbl.textContent = rec.n ? 'Your record: ' + rec.n + ' replays, you ' + fmtPct(rec.you) + ' on average, buy and hold ' + fmtPct(rec.hold) : 'Trade the tape: buy, sell, flat. Nothing from the future is on screen.';
    feed(); markReplay();
  }
  function fmtPct(x) { return (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'; }
  function replayRecord() { var log = []; try { log = JSON.parse(localStorage.getItem('pi_replay_log') || '[]') || []; } catch (e) {}
    var n = log.length; if (!n) return { n: 0 };
    return { n: n, you: log.reduce(function (a, r) { return a + r.you; }, 0) / n, hold: log.reduce(function (a, r) { return a + r.hold; }, 0) / n }; }
  function replayClose(px, why, time) {
    var p = replay.pos; if (!p) return;
    var ret = p.side * (px / p.entry - 1); replay.eq *= (1 + ret);
    if (!time) { var c = bars(), b = c[c.length - 1]; time = b && b.time; }
    replay.trades.push({ side: p.side, entry: p.entry, exit: px, ret: ret, opened: dayOf(p.time), closed: dayOf(time), why: why || '' }); replay.pos = null;
  }
  // ── replay simulator (dark replay_sim): stop and target orders that fill on
  // the bar that touches them, our boards on the replayed day, trades to the journal
  function replaySim() { var b = document.getElementById('chart-snap'); return !!(b && b.dataset && b.dataset.replaySim === '1'); }
  function dayOf(t) {
    if (typeof t === 'string') return t.slice(0, 10);
    if (typeof t === 'number') return new Date(t * 1000).toISOString().slice(0, 10);
    if (t && t.year) return t.year + '-' + ('0' + t.month).slice(-2) + '-' + ('0' + t.day).slice(-2);
    return '';
  }
  function simPct(id) { var el = document.getElementById(id), v = el ? parseFloat(el.value) : NaN; return v > 0 ? v / 100 : null; }
  // A gap through the level fills at the open; a bar that spans both the stop
  // and the target is read as the stop (the bar's path is unknown, assume the worst).
  function simCheck(b) {
    var p = replay && replay.pos; if (!p || !b || b.time === p.time) return;
    if (p.stop != null && (p.side === 1 ? b.low <= p.stop : b.high >= p.stop)) {
      replayClose(p.side === 1 ? Math.min(b.open, p.stop) : Math.max(b.open, p.stop), 'stop hit', b.time); simMark(b, 'Stop'); return; }
    if (p.target != null && (p.side === 1 ? b.high >= p.target : b.low <= p.target)) {
      replayClose(p.side === 1 ? Math.max(b.open, p.target) : Math.min(b.open, p.target), 'target hit', b.time); simMark(b, 'Target'); }
  }
  function simMark(b, txt) {
    replay.marks = (replay.marks || []).concat([{ time: b.time, position: 'aboveBar', color: txt === 'Stop' ? C.dn : C.up, shape: 'circle', text: txt }]);
    try { if (!replayMk) replayMk = LWC.createSeriesMarkers(H.cs, replay.marks); else replayMk.setMarkers(replay.marks); } catch (e) {}
  }
  var simBoardsAt = '', simBoardsCache = {};
  function simBoards() {
    var el = document.getElementById('cp-sim-boards'); if (!el || !replay) return;
    if (interval !== 'D') { el.textContent = ''; return; }
    var c = bars(), b = c[c.length - 1], d = b ? dayOf(b.time) : '', tk = ((document.getElementById('chart-snap') || {}).dataset || {}).ticker || '';
    if (!d || !tk || d === simBoardsAt) return; simBoardsAt = d;
    function show(list) {
      if (simBoardsAt !== d) return;
      if (d < '2021-05-01') { el.textContent = 'Our boards start in May 2021.'; return; }
      el.textContent = list.length ? 'On our boards this week: ' + list.map(function (h) { return h.name + ' ' + h.score + (h.dir === 'short' ? ' (short)' : ''); }).join(' \u00b7 ') : 'On none of our boards this week.';
    }
    if (simBoardsCache[d]) { show(simBoardsCache[d]); return; }
    clearTimeout(simBoards.t);
    simBoards.t = setTimeout(function () {
      fetch('/api/replay/boards?t=' + encodeURIComponent(tk) + '&d=' + d, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : { boards: [] }; })
        .then(function (j) { simBoardsCache[d] = j.boards || []; show(simBoardsCache[d]); }).catch(function () {});
    }, replay.timer ? 600 : 150);
  }
  function simSave() {
    if (!replay) return; var btn = document.getElementById('cp-sim-save');
    var tk = ((document.getElementById('chart-snap') || {}).dataset || {}).ticker || '';
    if (!replay.trades.length) { hint('Close a trade first: only closed replay trades go to the journal'); return; }
    if (btn) btn.disabled = true;
    fetch('/api/replay/journal', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: tk, trades: replay.trades }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (btn) btn.disabled = false;
        if (j.error) { hint(j.error); return; }
        hint(j.inserted ? j.inserted + ' trade' + (j.inserted > 1 ? 's' : '') + ' saved to your journal, account Replay' : 'Already in your journal');
      }).catch(function () { if (btn) btn.disabled = false; });
  }
  var replayMk = null;
  function replayTrade(side) {   // 1 = long, -1 = short, 0 = flat
    if (!replay) return; var c = bars(), b = c[c.length - 1]; if (!b) return;
    if (replay.pos && (side === 0 || replay.pos.side !== side)) replayClose(b.close, side === 0 ? 'closed by hand' : 'reversed');
    if (side !== 0 && !replay.pos) {
      replay.pos = { side: side, entry: b.close, time: b.time };
      if (replaySim()) { var sp = simPct('cp-sim-stop'), tp = simPct('cp-sim-target');
        if (sp) replay.pos.stop = b.close * (1 - side * sp);
        if (tp) replay.pos.target = b.close * (1 + side * tp); }
    }
    replay.marks = (replay.marks || []).concat([{ time: b.time, position: side === 1 ? 'belowBar' : 'aboveBar', color: side === 1 ? C.up : side === -1 ? C.dn : C.g, shape: side === 0 ? 'circle' : side === 1 ? 'arrowUp' : 'arrowDown', text: side === 1 ? 'B' : side === -1 ? 'S' : 'F' }]);
    try { if (!replayMk) replayMk = LWC.createSeriesMarkers(H.cs, replay.marks); else replayMk.setMarkers(replay.marks); } catch (e) {}
    feed();
  }
  function replayPnl() {
    var el = document.getElementById('cp-pnl'); if (!el || !replay) return;
    var c = bars(), b = c[c.length - 1]; if (!b) return;
    var open = replay.pos ? ((replay.pos.side === 1 ? 'Long' : 'Short') + ' from ' + replay.pos.entry.toFixed(2) + ' ' + fmtPct(replay.pos.side * (b.close / replay.pos.entry - 1))
      + (replay.pos.stop != null ? ', stop ' + replay.pos.stop.toFixed(2) : '') + (replay.pos.target != null ? ', target ' + replay.pos.target.toFixed(2) : '')) : 'Flat';
    var closed = replay.trades.length ? ' \u00b7 closed ' + fmtPct(replay.eq - 1) + ' over ' + replay.trades.length + ' trade' + (replay.trades.length > 1 ? 's' : '') : '';
    el.textContent = open + closed + ' \u00b7 buy and hold ' + fmtPct(b.close / replay.start - 1);
  }
  function step(d) {
    if (!replay) return;
    var all = fullBars();   // bars() is already cut at the replay position
    if (d > 0 && replaySim() && replay.pos) {
      for (var k = 0; k < d && replay.i < all.length; k++) { replay.i++; simCheck(all[replay.i - 1]); }
    } else replay.i = Math.max(5, Math.min(all.length, replay.i + d));
    feed();
    if (replay.i >= all.length && replay.timer) { clearInterval(replay.timer); replay.timer = null; markReplay(); }
  }
  function playPause() {
    if (!replay) return;
    if (replay.timer) { clearInterval(replay.timer); replay.timer = null; }
    else replay.timer = setInterval(function () { step(1); }, replay.ms || 320);
    markReplay();
  }
  function setSpeed(x) { if (!replay) return; replay.ms = Math.round(320 / x);
    if (replay.timer) { clearInterval(replay.timer); replay.timer = setInterval(function () { step(1); }, replay.ms); }
    Array.prototype.forEach.call(document.querySelectorAll('#cp-replay-bar [data-spd]'), function (b) { pill(b, +b.getAttribute('data-spd') === x); }); }


  // ── drawing tools ────────────────────────────────────────────────────────
  // The library owns the mouse and the rendering; we own the picker, the
  // persistence and the rule that a rebuilt price hides the layer, because
  // Renko and Point & Figure sit on their own times and the anchors would lie.
  var DM = null, drawKey = null, activeTool = null;
  var CAT_LABEL = { line: 'Lines', channel: 'Channels', fibonacci: 'Fibonacci',
                    pitchfork: 'Pitchforks', gann: 'Gann', shape: 'Shapes',
                    forecasting: 'Forecasting', measurement: 'Measure', annotation: 'Notes' };

  function attach(d) { try { H.cs.attachPrimitive(d); } catch (e) {} }
  function detach(d) { try { H.cs.detachPrimitive(d); } catch (e) {} }
  function attachAll() { try { DM.getAllDrawings().forEach(attach); } catch (e) {} }
  function detachAll() { try { DM.getAllDrawings().forEach(detach); } catch (e) {} }
  // We serialise the drawings ourselves: the library's own export/import round trip
  // does not come back, and the shape we need is small and stable.
  function saveDrawings() {
    if (!DM || !drawKey) return;
    try {
      // the Auto layer (chart-autota.js) lives in the same manager but is never
      // saved: it is recomputed from the bars; a member keeps a line by taking it
      var out = DM.getAllDrawings().filter(function (d) { return !d._auto; }).map(function (d) {
        return { type: d.type, anchors: d._orig || d._anchors, style: d._style || {},
                 hidden: !!d._hidden, locked: !!d._locked };
      });
      if (out.length) localStorage.setItem(drawKey, JSON.stringify(out));
      else localStorage.removeItem(drawKey);
      snapKeep(JSON.stringify(out));
      patSoon();
      pushSettings();
    } catch (e) {}
    renderObjs();
  }
  // an Auto line the member takes (button, a drag or a restyle) becomes one of
  // their drawings: saved with the others, gone from the Auto layer
  function keepAuto(d) {
    if (!d || !d._auto) return;
    delete d._auto; d._orig = JSON.parse(JSON.stringify(d._orig || d._anchors));
    saveDrawings();
    try { document.dispatchEvent(new CustomEvent('pi-auto-kept', { detail: { id: d.id } })); } catch (e) {}
    hint('Saved as your drawing'); setTimeout(function () { hint(''); }, 1500);
  }
  function putRows(rows) {
      var reg = window.LightweightChartsDrawing.getToolRegistry();
      rows.forEach(function (r, i) {
        if (!r || !r.type || !r.anchors || !reg.has(r.type)) return;
        var d = reg.createDrawing(r.type, 'r' + i + '_' + Date.now(), r.anchors, r.style || {}, wantsText(r.type) ? r.style : undefined);
        if (!d) return;
        d._locked = !!r.locked; d._hidden = !!r.hidden;
        DM.addDrawing(d); if (!d._hidden) attach(d);
      });
      resnapDrawings();
  }
  function loadDrawings() {
    if (!DM || !drawKey) return;
    snapPrev = '[]';
    try {
      var raw = localStorage.getItem(drawKey); if (!raw) return;
      var rows = JSON.parse(raw); if (!rows || !rows.length) return;
      putRows(rows); snapPrev = JSON.stringify(rows);
    } catch (e) { try { localStorage.removeItem(drawKey); } catch (e2) {} }
  }
  // chart_undo_full: saveDrawings is the one door every change goes through (add, move, restyle, lock, remove),
  // so the state it saved before is the step to come back to. Cmd+Z walks back, Cmd+Y forward.
  var snapPrev = null, snapUndo = [], snapRedo = [], snapBusy = false;
  function snapKeep(js) {
    if (snapBusy) return;
    if (window.__piUndoFull && snapPrev != null && js !== snapPrev) { snapUndo.push(snapPrev); if (snapUndo.length > 60) snapUndo.shift(); snapRedo = []; }
    snapPrev = js;
  }
  function snapStep(dir) {
    var from = dir < 0 ? snapUndo : snapRedo, to = dir < 0 ? snapRedo : snapUndo;
    if (!DM || !from.length) { hint(dir < 0 ? 'Nothing to undo' : 'Nothing to redo'); setTimeout(function () { hint(''); }, 1200); return; }
    var js = from.pop(); to.push(snapPrev == null ? '[]' : snapPrev);
    snapBusy = true;
    try {
      try { hideStyle(); } catch (e) {}
      DM.getAllDrawings().filter(function (d) { return !d._auto; }).forEach(function (d) { detach(d); try { DM.removeDrawing(d.id); } catch (e) {} });
      putRows(JSON.parse(js) || []);
      snapPrev = js; saveDrawings();
    } catch (e) {}
    snapBusy = false;
  }
  // a drawing is anchored on daily dates; on weeks and months those dates are
  // not on the axis, so each anchor is shown on the bar that contains it
  function nearestBarTime(t) {
    var c = H.candles(); if (!c.length) return t;
    var last = c[0].time;
    for (var i = 0; i < c.length; i++) { if (c[i].time <= t) last = c[i].time; else break; }
    return last;
  }
  function resnapDrawings() {
    if (!DM) return;
    try {
      DM.getAllDrawings().forEach(function (d) {
        if (!d._anchors) return;
        d._orig = d._orig || JSON.parse(JSON.stringify(d._anchors));
        d._anchors = d._orig.map(function (a) { return { time: nearestBarTime(a.time), price: a.price }; });
        repaintDrawing(d);
      });
    } catch (e) {}
  }
  var undoStack = [];
  // copy, paste, duplicate: a drawing travels as {type, anchors, style}, across names too
  function copyDrawing(d) { if (!d) return; try { localStorage.setItem('pi_clip', JSON.stringify({ type: d.type, anchors: d._orig || d._anchors, style: d._style || {} })); } catch (e) {}
    hint('Copied: ' + toolName(d.type, d)); setTimeout(function () { hint(''); }, 1500); renderObjs(); }
  function pasteDrawing(shift) {
    var r = null; try { r = JSON.parse(localStorage.getItem('pi_clip') || 'null'); } catch (e) {} if (!r || !r.type) return;
    try { var reg = window.LightweightChartsDrawing.getToolRegistry(), c = H.candles(), anchors = r.anchors.map(function (a) { var t = a.time;
        if (shift) { var i = -1; for (var k = 0; k < c.length; k++) if (c[k].time === t) i = k; if (i >= 0) t = c[Math.min(c.length - 1, i + shift)].time; }
        return { time: nearestBarTime(t), price: a.price }; });
      var d = reg.createDrawing(r.type, 'p' + Date.now(), anchors, r.style || {}, wantsText(r.type) ? r.style : undefined); if (!d) return;
      if (r.style && r.style.pattern) d._style = r.style; d._orig = JSON.parse(JSON.stringify(anchors));
      DM.addDrawing(d); attach(d); undoStack.push(d.id); saveDrawings(); try { DM.selectDrawing(d.id); showStyle(d); } catch (e) {} } catch (e) {}
  }
  function duplicateDrawing(d) { if (!d) return; copyDrawing(d); pasteDrawing(3); }
  // The library renders the 67 tools but leaves the mouse to the host, so we place
  // the anchors ourselves: click once per anchor, then it draws.
  var pending = [], anchorsNeeded = 0, hintEl = null;
  function toolDefs() {
    var L = window.LightweightChartsDrawing, d = L.TOOL_DEFINITIONS;
    var base = Array.isArray(d) ? d.slice() : Object.values(d || {});
    return base.concat(Object.keys(NATIVE).filter(function (k) { return !NATIVE[k].plus || drawPlus(); }).map(function (k) { return NATIVE[k]; }));
  }
  // the dark flag chart_draw_plus (4 drawing features): the page sets data-draw-plus on #chart-snap
  function drawPlus() { var b = document.getElementById('chart-snap'); return !!(b && b.dataset && b.dataset.drawPlus === '1'); }
  var NATIVE = { avwap: { type: 'avwap', name: 'Anchored VWAP', category: 'measurement', requiredAnchors: 1 },
                 measure: { type: 'measure', name: 'Measure', category: 'measurement', requiredAnchors: 0 },
                 'avwap-clear': { type: 'avwap-clear', name: 'Clear anchored VWAPs', category: 'measurement', requiredAnchors: 0 },
                 'range-vp': { type: 'range-vp', name: 'Volume profile on a range', category: 'measurement', requiredAnchors: 2 },
                 'pat-hs': { type: 'pat-hs', name: 'Head and shoulders (7 points)', category: 'shape', requiredAnchors: 7, pattern: 'Head and shoulders' },
                 'pat-xabcd': { type: 'pat-xabcd', name: 'XABCD pattern (5 points)', category: 'shape', requiredAnchors: 5, pattern: 'XABCD' },
                 'pat-tri': { type: 'pat-tri', name: 'Triangle pattern (4 points)', category: 'shape', requiredAnchors: 4, pattern: 'Triangle' },
                 'range-vp-clear': { type: 'range-vp-clear', name: 'Clear range profiles', category: 'measurement', requiredAnchors: 0 },
                 // draw plus (flag chart_draw_plus): Elliott, harmonics, emoji, VWAP bands
                 'pat-ew5': { type: 'pat-ew5', name: 'Elliott impulse (6 points)', category: 'shape', requiredAnchors: 6, pattern: 'Elliott impulse', plus: true },
                 'pat-ewabc': { type: 'pat-ewabc', name: 'Elliott correction (4 points)', category: 'shape', requiredAnchors: 4, pattern: 'Elliott correction', plus: true },
                 'pat-abcd': { type: 'pat-abcd', name: 'ABCD pattern (4 points)', category: 'shape', requiredAnchors: 4, pattern: 'ABCD', plus: true },
                 'pat-cypher': { type: 'pat-cypher', name: 'Cypher pattern (5 points)', category: 'shape', requiredAnchors: 5, pattern: 'Cypher', plus: true },
                 'avwap-bands': { type: 'avwap-bands', name: 'Anchored VWAP bands (on/off)', category: 'measurement', requiredAnchors: 0, plus: true },
                 'emoji': { type: 'emoji', name: 'Emoji', category: 'annotation', requiredAnchors: 1, plus: true } };
  // ── volume profile on a chosen range: the volume of each bar spread over the
  // prices it traded, 24 bins, the 70% value area around the busiest bin ──────
  var rvpRanges = [], rvpEl = null;
  function rvpKey() { return 'pi_rvp_' + (((document.getElementById('chart-snap') || {}).dataset || {}).ticker || 'x'); }
  function saveRvp() { try { if (rvpRanges.length) localStorage.setItem(rvpKey(), JSON.stringify(rvpRanges)); else localStorage.removeItem(rvpKey()); } catch (e) {} try { pushSettings(); } catch (e) {} }
  function loadRvp() { try { rvpRanges = JSON.parse(localStorage.getItem(rvpKey()) || '[]') || []; } catch (e) { rvpRanges = []; } }
  function profileOf(c, vol, i0, i1, bins) {
    var v = volsOf(c, vol), lo = Infinity, hi = -Infinity, i;
    for (i = i0; i <= i1; i++) { lo = Math.min(lo, c[i].low); hi = Math.max(hi, c[i].high); }
    if (!(hi > lo)) return null;
    var step = (hi - lo) / bins, acc = []; for (i = 0; i < bins; i++) acc.push(0);
    for (i = i0; i <= i1; i++) { var q = v[i] || 0, b0 = Math.floor((c[i].low - lo) / step), b1 = Math.min(bins - 1, Math.floor((c[i].high - lo) / step));
      b0 = Math.max(0, Math.min(bins - 1, b0)); var n = b1 - b0 + 1; for (var j = b0; j <= b1; j++) acc[j] += q / n; }
    var poc = 0; for (i = 1; i < bins; i++) if (acc[i] > acc[poc]) poc = i;
    var total = acc.reduce(function (a2, x) { return a2 + x; }, 0), got = acc[poc], a = poc, b = poc;
    while (got < total * 0.7 && (a > 0 || b < bins - 1)) {
      var up = b < bins - 1 ? acc[b + 1] : -1, dn = a > 0 ? acc[a - 1] : -1;
      if (up >= dn) { b++; got += acc[b]; } else { a--; got += acc[a]; } }
    return { lo: lo, hi: hi, step: step, acc: acc, poc: poc, va: [a, b], max: acc[poc],
             vpoc: lo + (poc + 0.5) * step, val: lo + a * step, vah: lo + (b + 1) * step };
  }
  var older = { busy: false, done: false };
  function maybeLoadOlder(r) {
    if (!r || older.busy || older.done || !H.prepend || window.__piNoOlder) return;   // a coin ships its whole history at once
    if (r.from > 15 || interval !== 'D' || H.tf() !== '1D' || replay || intraBars) return;
    var c = H.candles(); if (!c.length) return;
    var tk = ((document.getElementById('chart-snap') || {}).dataset || {}).ticker; if (!tk) return;
    older.busy = true; hint('Loading older bars\u2026');
    fetch('/api/bars?t=' + encodeURIComponent(tk) + '&before=' + c[0].time + '&n=300').then(function (x) { return x.ok ? x.json() : null; }).then(function (j) {
      older.busy = false; hint('');
      var add = (j && j.candles) || []; if (add.length < 300) older.done = true; if (!add.length) return;
      var vr = chart.timeScale().getVisibleLogicalRange();
      H.prepend(add, (j && j.vol) || []);
      try { if (vr) chart.timeScale().setVisibleLogicalRange({ from: vr.from + add.length, to: vr.to + add.length }); } catch (e) {}
      redrawStudies(); resnapDrawings(); drawRvp();
    }).catch(function () { older.busy = false; hint(''); });
  }
  var rvpFollow = false; try { rvpFollow = localStorage.getItem('pi_rvp_follow') === '1'; } catch (e) {}
  function setRvpFollow(on) { rvpFollow = !!on; try { localStorage.setItem('pi_rvp_follow', rvpFollow ? '1' : '0'); } catch (e) {}
    var b = document.getElementById('tf-vpvr'); if (b) pill(b, rvpFollow);
    drawRvp(); try { pushSettings(); } catch (e) {} }
  // ── export: the bars in view and every study line drawn on them, as a CSV ──
  function exportCsv() {
    var c = bars(); if (!c.length) return;
    var i0 = 0, i1 = c.length - 1;
    try { var vr = chart.timeScale().getVisibleLogicalRange(); if (vr) { i0 = Math.max(0, Math.floor(vr.from)); i1 = Math.min(c.length - 1, Math.ceil(vr.to)); } } catch (e) {}
    var vmap = {}; try { (H.vol() || []).forEach(function (x) { vmap[x.time] = x.value; }); } catch (e) {}
    var cols = [], maps = [];
    liveKeys().forEach(function (k) {
      var d = defOf(k); if (!d || !d.build) return;
      var pp; try { var sb = srcOf(k) ? sourceBars(srcOf(k)) : null; pp = d.build(sb || c, sb ? [] : H.vol(), cfgOf(k), (H.ours && H.ours()) || {}, (H.spy && H.spy()) || []) || []; } catch (e) { return; }
      if (pp.markers || pp.labels) return;   // markers and pattern drawings are not series
      pp.forEach(function (part, j) { var m = {}; (part.data || []).forEach(function (pt) { if (pt && pt.value != null) m[pt.time] = pt.value; });
        cols.push(d.label + (k.indexOf('#') > 0 ? ' ' + k.split('#')[1] : '') + (pp.length > 1 ? ' (' + (j + 1) + ')' : '')); maps.push(m); });
    });
    function q(x) { x = String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }
    var lines = [['time', 'open', 'high', 'low', 'close', 'volume'].concat(cols).map(q).join(',')];
    for (var i = i0; i <= i1; i++) { var b = c[i], t = b.time;
      var row = [typeof t === 'number' ? new Date(t * 1000).toISOString() : t, b.open, b.high, b.low, b.close, vmap[t] != null ? vmap[t] : (b.volume != null ? b.volume : '')];
      maps.forEach(function (m) { var v = m[t]; row.push(v == null ? '' : Math.round(v * 1e6) / 1e6); });
      lines.push(row.join(',')); }
    var tk = ((document.getElementById('chart-snap') || {}).dataset || {}).ticker || 'chart';
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = tk + '-' + (intraTf || (interval !== 'D' ? interval : H.tf())) + '-' + String(c[i1].time).slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  window.__cpExportCsv = exportCsv;
  // one listener for the new chart buttons, whenever the toolbar was built
  document.addEventListener('click', function (e) { var t = e.target && e.target.closest && e.target.closest('#chart-csv,#tf-vpvr,#tf-svp,#tf-tpo'); if (!t || !chart) return;
    if (t.id === 'chart-csv') exportCsv();
    else if (t.id === 'tf-vpvr') setRvpFollow(!rvpFollow);
    else if (t.id === 'tf-svp') setSessionLayer('svp', !svpOn);
    else setSessionLayer('tpo', !tpoOn); });
  // ── session profiles on intraday bars: a volume profile per session, and the
  // TPO / market profile (one letter per 30-minute period, regular hours) ─────
  var svpOn = false, tpoOn = false;
  try { svpOn = localStorage.getItem('pi_svp') === '1'; tpoOn = localStorage.getItem('pi_tpo') === '1'; } catch (e) {}
  function etParts(t) { try { var d = new Date((typeof t === 'number' ? t : Date.parse(t) / 1000) * 1000);
      var f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d), m = {};
      f.forEach(function (x) { m[x.type] = x.value; }); return { day: m.year + '-' + m.month + '-' + m.day, min: (+m.hour % 24) * 60 + +m.minute }; } catch (e) { return null; } }
  function sessionsOf(c, rthOnly) { var out = [], cur = null;
    c.forEach(function (b, i) { var e = etParts(b.time); if (!e) return; if (rthOnly && (e.min < 570 || e.min >= 960)) return;
      if (!cur || cur.day !== e.day) { cur = { day: e.day, idx: [] }; out.push(cur); } cur.idx.push(i); });
    return out; }
  function setSessionLayer(which, on) { if (which === 'svp') svpOn = !!on; else tpoOn = !!on;
    try { localStorage.setItem(which === 'svp' ? 'pi_svp' : 'pi_tpo', on ? '1' : '0'); } catch (e) {}
    var b = document.getElementById(which === 'svp' ? 'tf-svp' : 'tf-tpo'); if (b) pill(b, !!on);
    if (on && !intraBars) hint('Pick an intraday timeframe (More \u2192 5 or 15 minutes) to see it');
    else hint('');
    if (on && which === 'tpo' && intraBars) {   // a profile reads best on the last few sessions
      try { var ss = sessionsOf(bars(), false).slice(-3); if (ss.length) chart.timeScale().setVisibleRange({ from: bars()[ss[0].idx[0]].time, to: bars()[bars().length - 1].time }); } catch (e) {} }
    drawRvp(); overlaysSoon(); }
  // the HTML layers read the price scale: draw them again once it has settled
  // on new data (it rescales a frame or two after setData)
  function overlaysSoon() { [60, 300].forEach(function (ms) { setTimeout(function () { try { drawRvp(); drawStudyLabels(); drawPatLabels(); } catch (e) {} }, ms); }); }
  function priceH() { try { return chart.panes()[0].getHeight(); } catch (e) { return H.el.clientHeight; } }
  var tpoEl = null;
  function drawTpo() {
    if (!tpoEl) { tpoEl = document.createElement('div'); tpoEl.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:4;overflow:hidden'; H.el.appendChild(tpoEl); }
    while (tpoEl.firstChild) tpoEl.removeChild(tpoEl.firstChild);
    if (!tpoOn || !intraBars || _hiddenLayer || ['1min', '5min', '15min'].indexOf(intraTf) < 0) return;
    var c = bars(), ts = chart.timeScale(), sess = sessionsOf(c, true).slice(-3), L = 'ABCDEFGHIJKLMN';
    sess.forEach(function (S) { if (S.idx.length < 2) return;
      var lo = Infinity, hi = -Infinity; S.idx.forEach(function (i) { lo = Math.min(lo, c[i].low); hi = Math.max(hi, c[i].high); });
      if (!(hi > lo)) return;
      // as many rows as the height allows (about 10 px each), 8 to 30
      var pyh = Math.abs((H.cs.priceToCoordinate(lo) || 0) - (H.cs.priceToCoordinate(hi) || 0));
      var rows = Math.max(8, Math.min(30, Math.floor(pyh / 10))), step = (hi - lo) / rows, cells = []; for (var r = 0; r < rows; r++) cells.push('');
      var ib = [Infinity, -Infinity];
      S.idx.forEach(function (i) { var e = etParts(c[i].time), per = Math.floor((e.min - 570) / 30); if (per < 0 || per > 13) return;
        var r0 = Math.max(0, Math.floor((c[i].low - lo) / step)), r1 = Math.min(rows - 1, Math.floor((c[i].high - lo) / step));
        if (per < 2) { ib[0] = Math.min(ib[0], c[i].low); ib[1] = Math.max(ib[1], c[i].high); }
        for (var r2 = r0; r2 <= r1; r2++) if (cells[r2].indexOf(L[per]) < 0) cells[r2] += L[per]; });
      var cnt = cells.map(function (x) { return x.length; }), poc = 0; for (var q = 1; q < rows; q++) if (cnt[q] > cnt[poc]) poc = q;
      var tot = cnt.reduce(function (a, x) { return a + x; }, 0), got = cnt[poc], va0 = poc, va1 = poc;
      while (got < tot * 0.7 && (va0 > 0 || va1 < rows - 1)) { var up = va1 < rows - 1 ? cnt[va1 + 1] : -1, dn = va0 > 0 ? cnt[va0 - 1] : -1;
        if (up >= dn) { va1++; got += cnt[va1]; } else { va0--; got += cnt[va0]; } }
      var sp = (ts.options().barSpacing || 6), x0 = ts.timeToCoordinate(c[S.idx[0]].time), x1 = ts.timeToCoordinate(c[S.idx[S.idx.length - 1]].time);
      if (x0 == null && x1 != null) x0 = sp / 2;   // a session that starts off screen still shows its part
      if (x0 == null || x1 == null) return; x0 -= sp / 2; x1 += sp / 2;
      var w = Math.max(30, x1 - x0);
      var PH = priceH();
      for (var k = 0; k < rows; k++) { if (!cells[k]) continue;
        var yb = H.cs.priceToCoordinate(lo + k * step), yt = H.cs.priceToCoordinate(lo + (k + 1) * step); if (yb == null || yt == null || yt < 0 || yb > PH) continue;
        var d = document.createElement('div'); d.textContent = cells[k];
        d.style.cssText = 'position:absolute;left:' + x0 + 'px;top:' + yt + 'px;height:' + Math.max(6, yb - yt) + 'px;max-width:' + w + 'px;overflow:hidden;white-space:nowrap;'
          + 'font:600 ' + Math.max(7, Math.min(11, yb - yt)) + 'px/1 JetBrains Mono,monospace;letter-spacing:0.5px;'
          + 'color:' + (k === poc ? TR('card', 1) : (cnt[k] === 1 ? TR('warn', 1) : TR('mute', 1))) + ';background:' + (k === poc ? TR('text', 0.85) : (k >= va0 && k <= va1 ? TR('s2', 0.16) : 'transparent'));
        tpoEl.appendChild(d); }
      if (ib[1] > ib[0]) { var yi0 = H.cs.priceToCoordinate(ib[1]), yi1 = H.cs.priceToCoordinate(ib[0]);
        if (yi0 != null && yi1 != null && yi0 < PH && yi1 > 0) { yi0 = Math.max(0, yi0); yi1 = Math.min(PH, yi1); var ibd = document.createElement('div');
          ibd.title = 'Initial balance: the range of the first hour';
          ibd.style.cssText = 'position:absolute;left:' + (x0 - 4) + 'px;top:' + yi0 + 'px;width:3px;height:' + (yi1 - yi0) + 'px;background:' + TR('s2', 1);
          tpoEl.appendChild(ibd); } }
      [['POC', lo + (poc + 0.5) * step, C.a], ['VAH', lo + (va1 + 1) * step, C.m], ['VAL', lo + va0 * step, C.m]].forEach(function (Lb) {
        var y = H.cs.priceToCoordinate(Lb[1]); if (y == null || y < 0 || y > PH) return;
        var lb = document.createElement('div'); lb.textContent = Lb[0] + ' ' + Lb[1].toFixed(2);
        lb.style.cssText = 'position:absolute;left:' + (x0 + w + 3) + 'px;top:' + (y - 7) + 'px;font-size:10px;font-family:JetBrains Mono,monospace;color:' + Lb[2] + ';white-space:nowrap';
        tpoEl.appendChild(lb); });
    });
  }
  function drawRvp() {
    if (!rvpEl) { rvpEl = document.createElement('div'); rvpEl.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:4;overflow:hidden'; H.el.appendChild(rvpEl); }
    while (rvpEl.firstChild) rvpEl.removeChild(rvpEl.firstChild);
    var c = bars(), vol = H.vol(), ts = chart.timeScale(), ranges = rvpRanges.slice();
    if (rvpFollow && c.length) { try { var vr = ts.getVisibleRange();   // by time: other series can shift the logical index
      if (vr) { var ins = c.filter(function (b) { return b.time >= vr.from && b.time <= vr.to; });
        if (ins.length > 3) ranges.push({ t0: ins[0].time, t1: ins[ins.length - 1].time }); } } catch (e) {} }
    if (svpOn && intraBars && c.length) { sessionsOf(c, false).slice(-5).forEach(function (S) {
        if (S.idx.length > 3) ranges.push({ t0: c[S.idx[0]].time, t1: c[S.idx[S.idx.length - 1]].time }); }); }
    try { drawTpo(); } catch (e) {}
    if (!ranges.length || _hiddenLayer) return;
    ranges.forEach(function (r) {
      var i0 = -1, i1 = -1;
      for (var i = 0; i < c.length; i++) { if (i0 < 0 && c[i].time >= r.t0) i0 = i; if (c[i].time <= r.t1) i1 = i; }
      if (i0 < 0 || i1 <= i0) return;
      var pf = profileOf(c, vol, i0, i1, 24); if (!pf) return;
      var sp = (ts.options().barSpacing || 6), x0 = ts.timeToCoordinate(c[i0].time), x1 = ts.timeToCoordinate(c[i1].time);
      if (x0 == null && x1 != null) x0 = sp / 2;   // a session that starts off screen still shows its part
      if (x0 == null || x1 == null) return; x0 -= sp / 2; x1 += sp / 2;
      var PH2 = priceH(), w = Math.max(10, x1 - x0), yTop = H.cs.priceToCoordinate(pf.hi), yBot = H.cs.priceToCoordinate(pf.lo); if (yTop == null || yBot == null) return;
      yTop = Math.max(0, yTop); yBot = Math.min(PH2, yBot); if (yBot <= yTop) return;
      var box = document.createElement('div');
      box.style.cssText = 'position:absolute;left:' + x0 + 'px;top:' + yTop + 'px;width:' + w + 'px;height:' + (yBot - yTop) + 'px;border:1px dashed ' + TR('text', 0.45);
      rvpEl.appendChild(box);
      for (var k = 0; k < pf.acc.length; k++) {
        var yb = H.cs.priceToCoordinate(pf.lo + k * pf.step), yt = H.cs.priceToCoordinate(pf.lo + (k + 1) * pf.step); if (yb == null || yt == null || yt < 0 || yb > PH2) continue;
        var bar = document.createElement('div'), inVa = k >= pf.va[0] && k <= pf.va[1];
        bar.style.cssText = 'position:absolute;left:' + x0 + 'px;top:' + yt + 'px;height:' + Math.max(1, yb - yt - 1) + 'px;width:' + Math.max(1, (pf.acc[k] / pf.max) * w * 0.9) + 'px;'
          + 'background:' + (k === pf.poc ? TR('text', 0.55) : inVa ? TR('s2', 0.4) : TR('mute', 0.25));
        rvpEl.appendChild(bar);
      }
      [['VPOC ' + pf.vpoc.toFixed(2), pf.vpoc, C.a], ['VAH ' + pf.vah.toFixed(2), pf.vah, C.m], ['VAL ' + pf.val.toFixed(2), pf.val, C.m]].forEach(function (L) {
        var y = H.cs.priceToCoordinate(L[1]); if (y == null || y < 0 || y > PH2) return;
        var lb = document.createElement('div');
        lb.textContent = L[0]; lb.style.cssText = 'position:absolute;left:' + (x0 + w + 4) + 'px;top:' + (y - 7) + 'px;font-size:10px;font-family:JetBrains Mono,monospace;color:' + L[2] + ';white-space:nowrap';
        rvpEl.appendChild(lb);
      });
    });
  }
  var _hiddenLayer = false;
  function needFor(type) {
    var f = toolDefs().filter(function (t) { return t.type === type; })[0];
    return (f && f.requiredAnchors) || 2;
  }
  function hint(msg) {
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.style.cssText = 'position:absolute;right:8px;top:6px;z-index:6;pointer-events:none;'
        + 'font-size:11px;background:' + TR('text', 0.9) + ';color:' + TR('card', 1) + ';border-radius:6px;padding:2px 8px';
      H.el.appendChild(hintEl);
    }
    hintEl.textContent = msg || '';
    hintEl.style.display = msg ? '' : 'none';
  }
  function pointAt(ev) {
    var bb = H.el.getBoundingClientRect();
    var x = ev.clientX - bb.left, y = ev.clientY - bb.top;
    var t = null, pr = null;
    try { t = chart.timeScale().coordinateToTime(x); } catch (e) {}
    try { pr = H.cs.coordinateToPrice(y); } catch (e) {}
    // a click past the last bar (or before the first) lands on that bar: a
    // position or a level is often drawn in the empty space on the right
    if (t == null) { try { var lg = chart.timeScale().coordinateToLogical(x), c0 = H.candles();
      if (lg != null && c0.length) t = c0[Math.max(0, Math.min(c0.length - 1, Math.round(lg)))].time; } catch (e) {} }
    if (t == null || pr == null) return null;
    // magnet: the point lands on the nearest open, high, low or close of that bar
    if (magnetOn || (ev && (tvKeys() ? (ev.metaKey || ev.ctrlKey) : ev.shiftKey))) {
      var c = H.candles(), j = -1;
      for (var i = 0; i < c.length; i++) if (c[i].time === t) { j = i; break; }
      if (j >= 0) { var b = c[j], best = null;
        [b.open, b.high, b.low, b.close].forEach(function (v) { if (best == null || Math.abs(v - pr) < Math.abs(best - pr)) best = v; });
        pr = best; }
    }
    return { time: t, price: +pr.toFixed(4) };
  }
  function onChartClick(ev) {
    if (activeTool === 'avwap') {
      var pa = pointAt(ev); if (!pa) return;
      avwapAnchors.push(pa.time); if (avwapAnchors.length > 8) avwapAnchors.shift();
      drawAvwaps(); saveAvwap(); setTool(null); return;
    }
    if (activeTool === 'measure') return;   // the drag does the work
    if (activeTool === 'emoji') {
      if (ev.target && ev.target.closest && ev.target.closest('#cp-emoji')) return;
      if (!emojiPick || !DM) return;   // the picker is still open: a click on the chart waits for the choice
      var pe = pointAt(ev); if (!pe) return;
      try { var st = { text: emojiPick, fontSize: 26 }, de = window.LightweightChartsDrawing.getToolRegistry().createDrawing('text-annotation',
          'd' + Date.now() + Math.random().toString(36).slice(2, 6), [pe], st, st);
        if (de) { de._style = JSON.parse(JSON.stringify(st)); DM.addDrawing(de); attach(de); undoStack.push(de.id); saveDrawings();
          try { DM.selectDrawing(de.id); showStyle(de); } catch (e) {} } } catch (e) {}
      emojiPick = null; setTool(null); return;
    }
    if (activeTool === 'range-vp') {
      var pr = pointAt(ev); if (!pr) return;
      pending.push(pr.time);
      if (pending.length < 2) { hint('Click where the range ends'); return; }
      var a = pending[0] < pending[1] ? pending[0] : pending[1], b2 = pending[0] < pending[1] ? pending[1] : pending[0];
      rvpRanges.push({ t0: a, t1: b2 }); if (rvpRanges.length > 3) rvpRanges.shift();
      saveRvp(); drawRvp(); pending = []; setTool(null); return;
    }
    if (!DM) return;
    if (ev.target && ev.target.closest && ev.target.closest('#cp-style')) return;
    var bb = H.el.getBoundingClientRect();
    if (!activeTool) {          // no tool: a click selects, so Delete can remove it
      try {
        var h = DM.hitTest && DM.hitTest({ x: ev.clientX - bb.left, y: ev.clientY - bb.top });
        if (h && cursorMode === 'eraser') {
          var id = h.id || h, dd = DM.getAllDrawings().filter(function (x) { return x.id === id; })[0];
          if (dd) detach(dd); DM.removeDrawing(id); saveDrawings(); hideStyle(); return;
        }
        if (h) DM.selectDrawing(h.id || h); else DM.deselectAll();
      } catch (e) {}
      return;
    }
    var pt = pointAt(ev); if (!pt) return;
    pending.push(pt);
    if (pending.length < anchorsNeeded) {
      var left = anchorsNeeded - pending.length;
      hint(left + ' more click' + (left > 1 ? 's' : ''));
      return;
    }
    try {
      var reg = window.LightweightChartsDrawing.getToolRegistry(), pat = NATIVE[activeTool] && NATIVE[activeTool].pattern;
      // a tool keeps the look you last saved for it
      var dflt = pat ? { lineColor: C.a, lineWidth: 2 } : (toolDefaults()[activeTool] || {});
      var d = reg.createDrawing(pat ? 'polyline' : activeTool,
        'd' + Date.now() + Math.random().toString(36).slice(2, 6), pending.slice(), dflt);
      if (d) { if (pat) d._style = { pattern: pat, lineColor: C.a, lineWidth: 2 };
        else if (Object.keys(dflt).length) d._style = JSON.parse(JSON.stringify(dflt));
        DM.addDrawing(d); attach(d); undoStack.push(d.id); saveDrawings();
        // a finished drawing is the one you want to work on: it comes up selected, bar open
        try { DM.selectDrawing(d.id); showStyle(d); } catch (e) {}
        if (wantsText(activeTool)) askText(d, pending[0] || null); }
    } catch (e) {}
    pending = []; setTool(null);
  }
  // Hover help, the way a terminal does it: dark, instant, the shortcut on the right.
  // The browser's own tooltip takes a second, comes out grey and says nothing about keys.
  var TIP_KEYS = { 'hline': 'Alt+H', 'trend': 'Alt+T', 'vline': 'Alt+V', 'fib': 'Alt+Shift+F',
                   'rect': 'Alt+R', 'measure': 'Alt+Shift+M' };
  var tipBox = null, tipTimer = null;
  function tipFor(el) {
    var t = el.getAttribute('data-tip') || el.getAttribute('title');
    if (t && el.hasAttribute('title')) { el.setAttribute('data-tip', t); el.removeAttribute('title'); }
    return t || el.getAttribute('data-tip');
  }
  function tipKey(el) {
    var k = el.getAttribute('data-key'); if (k) return k;
    if (tvKeys()) return tvTip(el);
    var r = el.getAttribute('data-rail') || el.getAttribute('data-fly'); if (r && TIP_KEYS[r]) return TIP_KEYS[r];
    var id = el.id || '';
    if (id === 'tf-log' || id === 'cp-scale-log') return 'L';
    if (id === 'tf-full') return 'F';
    if (id === 'tv-goto' || id === 'cp-goto') return 'Alt+G';
    return '';
  }
  function hideTip() { if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; } if (tipBox) tipBox.style.display = 'none'; }
  function showTip(el) {
    var txt = tipFor(el); if (!txt) return;
    if (!tipBox) {
      tipBox = document.createElement('div'); tipBox.id = 'cp-tip2';
      tipBox.style.cssText = 'position:fixed;z-index:80;display:none;pointer-events:none;'
        + 'background:rgb(var(--pi-ink));color:rgb(var(--pi-card));border:1px solid rgb(var(--pi-border));border-radius:6px;'
        + 'padding:4px 8px;font-size:11px;line-height:1.4;white-space:nowrap;'
        + 'box-shadow:0 4px 14px rgba(0,0,0,0.28);display:none';
      document.body.appendChild(tipBox);
    }
    var key = tipKey(el);
    tipBox.innerHTML = '<span>' + txt.replace(/</g, '&lt;') + '</span>'
      + (key ? '<span style="color:rgb(var(--pi-ink-mute));margin-left:10px">' + key + '</span>' : '');
    tipBox.style.display = 'block';
    var r = el.getBoundingClientRect(), w = tipBox.offsetWidth, h = tipBox.offsetHeight;
    // a rail button reads to its right, everything else reads underneath
    var rail = !!(el.closest && el.closest('#cp-rail'));
    var x = rail ? r.right + 8 : r.left, y = rail ? r.top + (r.height - h) / 2 : r.bottom + 6;
    if (x + w > window.innerWidth - 6) x = rail ? r.left - w - 8 : window.innerWidth - w - 6;
    if (y + h > window.innerHeight - 6) y = r.top - h - 6;
    tipBox.style.left = Math.max(6, x) + 'px'; tipBox.style.top = Math.max(6, y) + 'px';
  }
  function initTips() {
    document.addEventListener('mouseover', function (ev) {
      var el = ev.target && ev.target.closest && ev.target.closest('[title],[data-tip]');
      if (!el || !el.closest('#lwchart, #tv, #cp-rail, #cp-fly, #cp-ind, #cp-set, .cardbar')) { hideTip(); return; }
      if (tipTimer) clearTimeout(tipTimer);
      tipTimer = setTimeout(function () { showTip(el); }, 150);
    });
    document.addEventListener('mouseout', hideTip);
    document.addEventListener('mousedown', hideTip);
    window.addEventListener('scroll', hideTip, true);
  }

  // Writing on the chart: the library carries text on these shapes, we just never
  // asked for it. A field opens where the shape lands, you type, it stays.
  var EXTENDABLE = ['trend-line', 'ray', 'horizontal-line', 'horizontal-ray', 'vertical-line',
                    'parallel-channel', 'regression-trend', 'extended-line'];
  function toolDefaults() { try { return JSON.parse(localStorage.getItem('pi_tool_style') || '{}') || {}; } catch (e) { return {}; } }
  // dark chart_tv_lot4: several named looks per tool, kept with the account like the default
  function toolTpls() { try { return JSON.parse(localStorage.getItem('pi_tool_tpl') || '{}') || {}; } catch (e) { return {}; } }
  function saveToolTpl(d, name) { var m = toolTpls(); m[d.type] = m[d.type] || {};
    var st = JSON.parse(JSON.stringify(d._style || {})); delete st.text; m[d.type][name] = st;
    try { localStorage.setItem('pi_tool_tpl', JSON.stringify(m)); } catch (e) {} pushSettings();
    hint('Saved \u201c' + name + '\u201d for this tool'); setTimeout(function () { hint(''); }, 1800); }
  function dropToolTpl(type, name) { var m = toolTpls(); if (m[type]) { delete m[type][name]; if (!Object.keys(m[type]).length) delete m[type]; }
    try { localStorage.setItem('pi_tool_tpl', JSON.stringify(m)); } catch (e) {} pushSettings(); }
  function tplPicker(d) { var names = Object.keys(toolTpls()[d.type] || {}).sort(), e2 = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); };
    return '<select data-tpl class="rounded hover:bg-sepia-hover bg-transparent" title="Saved looks for this tool" style="max-width:7rem">'
      + '<option value="">looks\u2026</option>' + names.map(function (n) { return '<option value="' + e2(n) + '">' + e2(n) + '</option>'; }).join('')
      + '<option value="+">Save this look\u2026</option>'
      + (names.length ? '<optgroup label="Remove">' + names.map(function (n) { return '<option value="-:' + e2(n) + '">\u2715 ' + e2(n) + '</option>'; }).join('') + '</optgroup>' : '')
      + '</select>'; }
  function setToolDefault(d) {
    var m = toolDefaults(); m[d.type] = JSON.parse(JSON.stringify(d._style || {}));
    delete m[d.type].text;                   // the words belong to one drawing, not to the tool
    try { localStorage.setItem('pi_tool_style', JSON.stringify(m)); } catch (e) {}
    pushSettings(); hint('Saved as the default for this tool'); setTimeout(function () { hint(''); }, 1800);
  }
  var TEXT_TOOLS = ['text-annotation', 'anchored-text', 'callout', 'note', 'comment',
                    'price-label', 'price-note', 'flag-mark', 'pin', 'signpost'];
  var textBox = null;
  function wantsText(t) { return TEXT_TOOLS.indexOf(t) >= 0; }
  function askText(d, at) {
    if (!textBox) {
      textBox = document.createElement('div'); textBox.id = 'cp-text';
      textBox.style.cssText = 'position:absolute;z-index:9;display:none';
      textBox.innerHTML = '<input id="cp-text-in" placeholder="Type, then Enter" '
        + 'class="border border-sepia-border rounded-lg bg-white px-2 py-1 text-xs" style="width:14rem">';
      H.el.appendChild(textBox);
    }
    var inp = document.getElementById('cp-text-in');
    inp.value = (d._style && d._style.text) || '';
    textBox.style.display = '';
    var x = 20, y = 20;
    try { var ts = chart.timeScale(), a = at || (d._orig || d._anchors || [])[0];
      if (a) { var cx = ts.timeToCoordinate(a.time), cy = H.cs.priceToCoordinate(+a.price);
        if (cx != null) x = Math.max(6, Math.min(cx + 8, H.el.clientWidth - 240));
        if (cy != null) y = Math.max(6, Math.min(cy - 12, H.el.clientHeight - 40)); } } catch (e) {}
    textBox.style.left = Math.round(x) + 'px'; textBox.style.top = Math.round(y) + 'px';
    setTimeout(function () { inp.focus(); inp.select(); }, 20);
    function done(keep) {
      textBox.style.display = 'none';
      inp.onkeydown = null; inp.onblur = null;
      if (!keep) return;
      var v = inp.value.trim();
      if (!v) { try { detach(d); DM.removeDrawing(d.id); } catch (e) {} saveDrawings(); return; }
      restyle(d, { text: v });
    }
    inp.onkeydown = function (e) { e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    inp.onblur = function () { done(true); };
  }
  function editText(d) { if (d && wantsText(d.type)) askText(d); }

  var PLUS_HINT = { 'pat-ew5': 'Click 6 points: start, then waves 1 to 5', 'pat-ewabc': 'Click 4 points: start, then waves A, B, C',
                    'pat-abcd': 'Click 4 points: A, B, C, D', 'pat-cypher': 'Click 5 points: X, A, B, C, D',
                    'pat-xabcd': 'Click 5 points: X, A, B, C, D', 'emoji': 'Pick an emoji, then click the bar' };
  function setTool(t) {
    if (t === 'avwap-clear') { avwapAnchors = []; drawAvwaps(); saveAvwap(); t = null; }
    if (t === 'range-vp-clear') { rvpRanges = []; saveRvp(); drawRvp(); t = null; }
    if (t === 'avwap-bands') { setBands(!bandsOn()); t = null; }
    activeTool = t; pending = [];
    try { document.dispatchEvent(new CustomEvent('cp-tool', { detail: t })); } catch (e) {}   // the floating drawing bar follows the armed tool
    if (t === 'emoji') openEmoji(); else closeEmoji();
    anchorsNeeded = t ? needFor(t) : 0;
    markRail();
    hint(t === 'measure' ? 'Drag across the move you want measured'
  : t === 'avwap' ? 'Click the bar the move started on'
  : t && PLUS_HINT[t] && drawPlus() ? PLUS_HINT[t]
  : t ? (anchorsNeeded + ' clicks to place it, Esc to stop') : '');
    try { DM.setActiveTool(t); } catch (e) {}
    var el = H.el; if (el) el.style.cursor = t ? 'crosshair' : cursorCss();
    var b = document.getElementById('cp-draw-cur'); if (b) pill(b, !t);
    markRail(); if (t) hideStyle();
    Array.prototype.forEach.call(document.querySelectorAll('[data-dt]'), function (x) {
      x.className = 'block w-full text-left px-2 py-1 rounded-lg hover:bg-sepia-hover'
        + (x.getAttribute('data-dt') === t ? ' bg-accent text-white' : '');
    });
  }
  function initDrawings() {
    var L = window.LightweightChartsDrawing;
    if (!L || !L.DrawingManager) return false;
    var tk = (document.getElementById('chart-snap') || {}).dataset;
    drawKey = 'pi_draw_' + ((tk && tk.ticker) || 'x');
    try {
      DM = new L.DrawingManager();
      DM.attach(chart, H.cs, H.el);
      ['change', 'drawing-created', 'drawing-updated', 'drawing-removed'].forEach(function (ev) {
        try { DM.on(ev, saveDrawings); } catch (e) {}
      });
      // the bar is the drawing's own handle: it opens on selection, wherever the selection came from
      try {
        DM.on('drawing:selected', function () { var d = null; try { d = DM.getSelectedDrawing(); } catch (e) {} if (d) showStyle(d); });
        DM.on('drawing:deselected', hideStyle);
        DM.on('drawing:removed', hideStyle);
        DM.on('drawing:updated', function () { setTimeout(trackStyle, 0); });
        chart.timeScale().subscribeVisibleLogicalRangeChange(trackStyle);
      } catch (e) {}
    } catch (e) { DM = null; return false; }
    loadDrawings();
    try { window.__cpDM = DM; } catch (e) {}
    H.el.addEventListener('click', onChartClick, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (replayPick) { replayPick = false; hint('');
          if (H.el) H.el.style.cursor = cursorCss(); startReplayAt(Math.max(20, Math.floor(bars().length * 0.5))); return; }
        setTool(null); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (typingIn(e)) return;
        try { var sel = DM.getSelectedDrawing(); if (sel && !sel._locked) { detach(sel); DM.removeDrawing(sel.id); saveDrawings(); } } catch (e2) {}
      }
    });
    return true;
  }
  // ── two tools the library does not ship ──────────────────────────────────
  // Anchored VWAP: pick the bar the move started on and read the average price
  // everyone has paid since. Measure: drag to read what the leg was worth.
  var avwapSeries = [], avwapAnchors = [], measuring = null, measEl = null;
  var avwapMeta = [];   // {k, label, color, sr, axis}: what the legend lists for each anchored VWAP (chart_fixes2 legend)
  var LNHID = {};       // legend keys (ln:..., cmp:...) the reader hid with the eye
  function avwapFrom(idx) {
    var c = bars(), vol = H.vol(), by = {};
    (vol || []).forEach(function (x) { by[x.time] = x.value; });
    var pv = 0, vv = 0, out = [];
    for (var i = idx; i < c.length; i++) {
      var q = by[c[i].time] || 0, tp = (c[i].high + c[i].low + c[i].close) / 3;
      pv += tp * q; vv += q;
      if (vv) out.push({ time: c[i].time, value: +(pv / vv).toFixed(2) });
    }
    return out;
  }
  var AVWAP_COLS = [C.a, C.b, C.d, C.up];
  // The last-value labels of the lines that carry one (the two automatic AVWAPs) sit on the
  // price axis next to the last price: lightweight-charts does not move them apart, so a label
  // that lands within a label height of one already placed is switched off. Its value stays
  // in the legend row. Price label first, then the lines in draw order.
  function declutterAxis() {
    try {
      var c = bars(); if (!c.length) return;
      var placed = [], y0 = H.cs.priceToCoordinate(c[c.length - 1].close);
      if (y0 != null) placed.push(y0);
      avwapMeta.forEach(function (a) {
        if (!a.axis) return;
        var d = a.sr.data(), v = d.length ? d[d.length - 1].value : null, y = v == null ? null : a.sr.priceToCoordinate(v);
        var show = !LNHID[a.k] && y != null && placed.every(function (p) { return Math.abs(p - y) >= 18; });
        if (show) placed.push(y);
        if (show !== a.on) { a.on = show; a.sr.applyOptions({ lastValueVisible: show }); }
      });
    } catch (e) {}
  }
  function drawAvwaps() {
    avwapSeries.forEach(function (x) { try { chart.removeSeries(x); } catch (e) {} });
    avwapSeries = []; avwapMeta = [];
    var c = bars();
    avwapAnchors.forEach(function (t, n) {
      var i = -1; for (var j = 0; j < c.length; j++) if (c[j].time === t) { i = j; break; }
      if (i < 0) return;
      var d = avwapFrom(i); if (d.length < 2) return;
      var ak = 'ln:av:' + String(t).slice(0, 10);
      var sr = chart.addSeries(LWC.LineSeries, { color: AVWAP_COLS[n % AVWAP_COLS.length], lineWidth: 2,
        priceLineVisible: false, lastValueVisible: false, visible: !LNHID[ak] }, 0);
      sr.setData(d); avwapSeries.push(sr);
      avwapMeta.push({ k: ak, label: 'AVWAP ' + (typeof t === 'number' ? new Date(t * 1000).toISOString().slice(0, 10) : String(t).slice(0, 10)), color: AVWAP_COLS[n % AVWAP_COLS.length], sr: sr });
      if (drawPlus() && bandsOn()) avwapBands(i, AVWAP_COLS[n % AVWAP_COLS.length]);
    });
    // the two lines the chart draws by itself (flag chart_auto_avwap), behind the Layers
    // pill "Auto AVWAP" since the chart opens bare (24/10/2026): the last
    // earnings reaction and the 52-week high. The manual tool stays as it is.
    var auto = (H.autoAvwapOn && !H.autoAvwapOn()) ? null : window.__piAutoAvwap;
    if (auto) [['earnings', 'AVWAP earnings', PI_CHART.theme().s3], ['high52', 'AVWAP 52w high', PI_CHART.theme().s2]].forEach(function (a) {
      var t = auto[a[0]]; if (!t) return;
      var i = -1; for (var j = 0; j < c.length; j++) if (c[j].time === t) { i = j; break; }
      if (i < 0) return;
      var d = avwapFrom(i); if (d.length < 2) return;
      var ak2 = 'ln:av:' + a[0];
      var sr = chart.addSeries(LWC.LineSeries, { color: a[2], lineWidth: 2, lineStyle: 2, title: a[1],
        priceLineVisible: false, lastValueVisible: !LNHID[ak2], visible: !LNHID[ak2] }, 0);
      sr.setData(d); avwapSeries.push(sr);
      avwapMeta.push({ k: ak2, label: a[1], color: a[2], sr: sr, axis: true, on: !LNHID[ak2] });
    });
    avwapChips();
    declutterAxis(); setTimeout(declutterAxis, 120);
    try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {}
  }
  // one chip per anchor, each with a cross that removes only that anchored VWAP
  var avwapChipEl = null;
  function avwapChips() {
    if (!avwapChipEl) {
      avwapChipEl = document.createElement('div');
      avwapChipEl.style.cssText = 'position:absolute;left:8px;bottom:30px;z-index:6;display:flex;flex-wrap:wrap;gap:4px;max-width:70%;font-size:11px';
      H.el.appendChild(avwapChipEl);
    }
    avwapChipEl.innerHTML = '';
    avwapAnchors.forEach(function (t, n) {
      var chip = document.createElement('span'), col = AVWAP_COLS[n % AVWAP_COLS.length];
      chip.style.cssText = 'background:rgb(var(--pi-card));border:1px solid ' + col + ';color:' + col + ';border-radius:10px;padding:1px 4px 1px 8px;display:inline-flex;gap:4px;align-items:center';
      chip.appendChild(document.createTextNode('AVWAP ' + (typeof t === 'number' ? new Date(t * 1000).toISOString().slice(0, 10) : String(t).slice(0, 10))));
      var x = document.createElement('button'); x.type = 'button'; x.textContent = '\u2715'; x.title = 'Remove this anchored VWAP';
      x.style.cssText = 'border:0;background:transparent;color:inherit;cursor:pointer;font-size:11px;padding:0 2px';
      x.addEventListener('click', function (ev) { ev.stopPropagation(); avwapAnchors.splice(n, 1); drawAvwaps(); saveAvwap(); });
      chip.appendChild(x); avwapChipEl.appendChild(chip);
    });
  }
  function saveAvwap() {
    try { localStorage.setItem('pi_avwap_' + ((document.getElementById('chart-snap') || {}).dataset || {}).ticker,
      JSON.stringify(avwapAnchors)); } catch (e) {}
    pushSettings();
  }
  function loadAvwap() {
    try { var k = 'pi_avwap_' + ((document.getElementById('chart-snap') || {}).dataset || {}).ticker;
      var v = JSON.parse(localStorage.getItem(k) || '[]');
      if (Array.isArray(v)) avwapAnchors = v; } catch (e) {}
    drawAvwaps();
  }

  // ── draw plus (flag chart_draw_plus): VWAP bands, pattern letters and ratios, emoji ──
  // pure maths first, so a node test can load it: nothing in here touches the page
  /* pat-math:start */
  var PAT_LETTERS = { 'Head and shoulders': ['S', 'LS', 'N1', 'H', 'N2', 'RS', 'E'],
    'XABCD': ['X', 'A', 'B', 'C', 'D'], 'Triangle': ['A', 'B', 'C', 'D'], 'ABCD': ['A', 'B', 'C', 'D'],
    'Cypher': ['X', 'A', 'B', 'C', 'D'], 'Elliott impulse': ['0', '1', '2', '3', '4', '5'],
    'Elliott correction': ['0', 'A', 'B', 'C'] };
  // a rule: |p[n1]-p[n0]| / |p[d1]-p[d0]| must sit in [lo, hi]; the tag is drawn on leg `at` (point at to at+1)
  var PAT_RULES = {
    'ABCD': [{ at: 1, t: 'BC/AB', n: [1, 2], d: [0, 1], lo: 0.382, hi: 0.886 },
             { at: 2, t: 'CD/BC', n: [2, 3], d: [1, 2], lo: 1.13, hi: 2.618 }],
    'XABCD': [{ at: 1, t: 'AB/XA', n: [1, 2], d: [0, 1], lo: 0.382, hi: 0.886 },
              { at: 2, t: 'BC/AB', n: [2, 3], d: [1, 2], lo: 0.382, hi: 0.886 },
              { at: 3, t: 'CD/BC', n: [3, 4], d: [2, 3], lo: 1.13, hi: 3.618 }],
    'Cypher': [{ at: 1, t: 'AB/XA', n: [1, 2], d: [0, 1], lo: 0.382, hi: 0.618 },
               { at: 2, t: 'XC/XA', n: [0, 3], d: [0, 1], lo: 1.272, hi: 1.414 },
               { at: 3, t: 'XD/XC', n: [3, 4], d: [0, 3], lo: 0.70, hi: 0.85 }],
    'Elliott impulse': [{ at: 1, t: 'w2/w1', n: [1, 2], d: [0, 1], lo: 0.382, hi: 0.786 },
      { at: 2, t: 'w3/w1', n: [2, 3], d: [0, 1], lo: 1, hi: Infinity, chk: function (p) {   // wave 3 is never the shortest of 1, 3, 5
          if (p.length < 6) return true; var w1 = Math.abs(p[1] - p[0]), w3 = Math.abs(p[3] - p[2]), w5 = Math.abs(p[5] - p[4]);
          return !(w3 < w1 && w3 < w5); } },
      { at: 3, t: 'w4/w3', n: [3, 4], d: [2, 3], lo: 0.236, hi: 0.5 }],
    'Elliott correction': [{ at: 1, t: 'B/A', n: [1, 2], d: [0, 1], lo: 0.382, hi: 0.886 },
                           { at: 2, t: 'C/A', n: [2, 3], d: [0, 1], lo: 0.618, hi: 1.618 }] };
  // pr = anchor prices in click order; returns one {at, t, v, ok} per rule the points can answer
  function patRatios(name, pr) {
    var rules = PAT_RULES[name], out = []; if (!rules || !pr) return out;
    rules.forEach(function (r) {
      var top = Math.max(r.n[0], r.n[1], r.d[0], r.d[1]); if (pr.length <= top) return;
      var den = Math.abs(pr[r.d[1]] - pr[r.d[0]]); if (!(den > 0)) return;
      var v = Math.abs(pr[r.n[1]] - pr[r.n[0]]) / den;
      out.push({ at: r.at, t: r.t, v: v, ok: v >= r.lo - 1e-9 && v <= r.hi + 1e-9 && (!r.chk || r.chk(pr)) });
    });
    return out;
  }
  // volume-weighted mean and std dev of the typical price from bar idx on (by = volume per bar time)
  function vwapBandsCalc(c, by, idx) {
    var sq = 0, sqp = 0, sqp2 = 0, out = [];
    for (var i = idx; i < c.length; i++) {
      var q = by[c[i].time] || 0, tp = (c[i].high + c[i].low + c[i].close) / 3;
      sq += q; sqp += q * tp; sqp2 += q * tp * tp;
      if (sq) { var v = sqp / sq; out.push({ time: c[i].time, vwap: v, sd: Math.sqrt(Math.max(0, sqp2 / sq - v * v)) }); }
    }
    return out;
  }
  /* pat-math:end */
  function bandsOn() { try { return localStorage.getItem('pi_avwap_bands') !== '0'; } catch (e) { return true; } }
  function setBands(on) {
    try { localStorage.setItem('pi_avwap_bands', on ? '1' : '0'); } catch (e) {}
    drawAvwaps(); pushSettings();
    hint('VWAP bands ' + (on ? 'on' : 'off') + (avwapAnchors.length ? '' : ': they show on every anchored VWAP')); setTimeout(function () { hint(''); }, 1800);
  }
  function rgba(hex, a) { var n = parseInt(String(hex).replace('#', ''), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  // +/-1 and +/-2 std dev around an anchored VWAP: thin, the VWAP colour paler, the 2s dashed
  function avwapBands(i, col) {
    var by = {}; (H.vol() || []).forEach(function (x) { by[x.time] = x.value; });
    var st = vwapBandsCalc(bars(), by, i); if (st.length < 2) return;
    [[1, 0.6, 0], [2, 0.42, 2]].forEach(function (k) {
      [1, -1].forEach(function (sg) {
        try { var sr = chart.addSeries(LWC.LineSeries, { color: rgba(col, k[1]), lineWidth: 1, lineStyle: k[2],
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
          sr.setData(st.map(function (p) { return { time: p.time, value: +(p.vwap + sg * k[0] * p.sd).toFixed(2) }; })); avwapSeries.push(sr); } catch (e) {}
      });
    });
  }
  // letters on the points and ratios on the legs, as one HTML layer over the chart (never in the way of the mouse)
  var patEl = null, patRaf = 0;
  function patChip(txt, x, y, bg, fg) {
    var e = document.createElement('div'); e.textContent = txt;
    e.style.cssText = 'position:absolute;transform:translate(-50%,-50%);font:600 10px/1 sans-serif;white-space:nowrap;border-radius:8px;padding:2px 5px;'
      + 'left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px;background:' + bg + ';color:' + fg;
    patEl.appendChild(e);
  }
  function drawPatLabels() {
    if (!drawPlus() || !H || !H.el) return;
    if (!patEl) { patEl = document.createElement('div'); patEl.id = 'cp-pat'; patEl.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:hidden'; H.el.appendChild(patEl); }
    while (patEl.firstChild) patEl.removeChild(patEl.firstChild);
    if (!DM) return;
    var ts = chart.timeScale(), W = H.el.clientWidth, ds = []; try { ds = DM.getAllDrawings(); } catch (e) {}
    ds.forEach(function (d) {
      var pat = d._style && d._style.pattern, L = pat && PAT_LETTERS[pat];
      if (!L || d._hidden || !d._series) return;
      var a = d._anchors || d._orig || []; if (a.length < 2) return;
      var pr = a.map(function (x) { return +x.price; }), xs = [], ys = [], col = d._style.lineColor || '#8b5cf6';
      a.forEach(function (x) { var cx = null, cy = null; try { cx = ts.timeToCoordinate(x.time); cy = H.cs.priceToCoordinate(+x.price); } catch (e) {} xs.push(cx); ys.push(cy); });
      a.forEach(function (x, i) {
        if (xs[i] == null || ys[i] == null || xs[i] < -20 || xs[i] > W + 20 || !L[i]) return;
        var nb = []; if (i > 0) nb.push(pr[i - 1]); if (i < pr.length - 1) nb.push(pr[i + 1]);
        var above = pr[i] >= nb.reduce(function (s2, v) { return s2 + v; }, 0) / nb.length;
        patChip(L[i], xs[i], ys[i] + (above ? -12 : 12), col, '#fff');
      });
      patRatios(pat, pr).forEach(function (r) {
        var x0 = xs[r.at], x1 = xs[r.at + 1], y0 = ys[r.at], y1 = ys[r.at + 1];
        if (x0 == null || x1 == null || y0 == null || y1 == null) return;
        var mx = (x0 + x1) / 2; if (mx < -20 || mx > W + 20) return;
        patChip(r.t + ' ' + r.v.toFixed(2), mx, (y0 + y1) / 2 - 9, 'rgba(19,23,34,0.82)', r.ok ? PI_CHART.theme().good : 'rgb(var(--pi-ink-mute))');
      });
    });
  }
  function patSoon() {
    if (patRaf || !drawPlus()) return;
    var f = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    patRaf = f(function () { patRaf = 0; try { drawPatLabels(); } catch (e) {} });
  }
  // emoji: a text drawing from the library, so it saves, drags and undoes like any other
  var EMOJIS = ['🚀', '🔥', '🐻', '🐂', '⚠️', '🎯', '💰', '👀', '✅', '❌', '📈', '📉'];
  var emojiPick = null, emojiBox = null;
  function closeEmoji() { if (emojiBox) emojiBox.style.display = 'none'; }
  function openEmoji() {
    emojiPick = null;
    if (!emojiBox) {
      emojiBox = document.createElement('div'); emojiBox.id = 'cp-emoji';
      emojiBox.className = 'bg-white border border-sepia-border rounded-lg shadow-lg p-2 text-xs';
      emojiBox.style.cssText = 'position:absolute;left:44px;top:2.9rem;z-index:9;display:none';
      emojiBox.innerHTML = '<div class="text-ink-mute mb-1">Pick one, then click the chart</div><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:2px">'
        + EMOJIS.map(function (e) { return '<button type="button" data-em="' + e + '" class="rounded-lg hover:bg-sepia-hover" style="font-size:20px;padding:2px 4px;line-height:1.2">' + e + '</button>'; }).join('') + '</div>';
      H.el.appendChild(emojiBox);
      Array.prototype.forEach.call(emojiBox.querySelectorAll('[data-em]'), function (b) {
        b.addEventListener('click', function (ev) { ev.stopPropagation(); emojiPick = this.getAttribute('data-em'); closeEmoji(); hint('Click the bar to place ' + emojiPick); });
      });
    }
    emojiBox.style.display = '';
  }
  function measBox(html, x, y) {
    if (!measEl) { measEl = document.createElement('div');
      measEl.style.cssText = 'position:absolute;z-index:7;pointer-events:none;font-size:11px;'
        + 'background:rgba(139,92,246,0.94);color:#fff;border-radius:6px;padding:3px 8px;white-space:nowrap';
      H.el.appendChild(measEl); }
    if (!html) { measEl.style.display = 'none'; return; }
    measEl.innerHTML = html; measEl.style.display = '';
    measEl.style.left = Math.max(4, x + 12) + 'px'; measEl.style.top = Math.max(4, y - 28) + 'px';
  }
  function initExtraTools() {
    var el = H.el;
    el.addEventListener('mousedown', function (ev) {
      if (activeTool !== 'measure' && !(tvKeys() && ev.shiftKey && !activeTool && ev.button === 0)) return;   // chart_tv_keys: Shift+drag measures without picking the tool
      var pt = pointAt(ev); if (!pt) return;
      var bb = el.getBoundingClientRect();
      measuring = { p0: pt, i0: idxOf(pt.time), x: ev.clientX - bb.left, y: ev.clientY - bb.top };
      ev.preventDefault(); ev.stopPropagation();
    }, true);
    window.addEventListener('mousemove', function (ev) {
      if (!measuring) return;
      var now = pointAt(ev); if (!now) return;
      var bb = el.getBoundingClientRect(), x = ev.clientX - bb.left, y = ev.clientY - bb.top;
      var dp = now.price - measuring.p0.price;
      var pc = measuring.p0.price ? dp / measuring.p0.price * 100 : 0;
      var nb = Math.abs(idxOf(now.time) - measuring.i0);
      measBox((dp >= 0 ? '+' : '') + dp.toFixed(2) + '  (' + (pc >= 0 ? '+' : '') + pc.toFixed(2) + '%)  \u00b7  '
        + nb + ' bar' + (nb === 1 ? '' : 's'), x, y);
    });
    window.addEventListener('mouseup', function () {
      if (!measuring) return;
      measuring = null;
      setTimeout(function () { measBox(null); }, 2600);
    });
  }

  // ── the drawing rail, and moving a drawing once it is placed ─────────────
  var RAIL_FAV = ['trend-line', 'horizontal-line', 'horizontal-ray', 'rectangle',
                  'fib-retracement', 'parallel-channel', 'long-position', 'short-position', 'range-vp', 'avwap', 'measure'];
  var RAIL_ICON = { 'trend-line': '\u2571', 'horizontal-line': '\u2500', 'horizontal-ray': '\u2192',
                    'vertical-line': '\u2502', 'rectangle': '\u25ad', 'fib-retracement': '\u2261',
                    'parallel-channel': '\u2225', 'measure': '\u2921', 'avwap': '\u2248',
                    'long-position': '\u21a5', 'short-position': '\u21a7', 'range-vp': '\u2263' };
  var dragging = null, styleBox = null;
  function idxOf(t) { var c = bars(); for (var i = 0; i < c.length; i++) if (c[i].time === t) return i; return -1; }
  function selected() { try { return DM.getSelectedDrawing(); } catch (e) { return null; } }
  function repaintDrawing(d) { try { if (d._requestUpdateFn) d._requestUpdateFn(); } catch (e) {} patSoon(); }

  var FAMILIES = [
    { id: 'line', label: 'Lines', cats: ['line'], icon: '\u2571' },
    { id: 'chan', label: 'Channels, Fibonacci, forks, Gann', cats: ['channel', 'fibonacci', 'pitchfork', 'gann'], icon: '\u2261' },
    { id: 'shape', label: 'Shapes and patterns', cats: ['shape'], extra: ['pat-hs', 'pat-xabcd', 'pat-tri'], icon: '\u25ad' },
    { id: 'pos', label: 'Positions and forecasts', cats: ['forecasting'], icon: '\u21a5' },
    { id: 'text', label: 'Text and notes', cats: ['annotation'], icon: 'T' },
    { id: 'meas', label: 'Measure and profiles', cats: ['measurement'], extra: ['measure', 'avwap', 'range-vp', 'avwap-clear', 'range-vp-clear'], icon: '\u2921' }];
  // chart_workspace (flag, /chart only): the rail is the groups alone, no favourites row that
  // repeats them; patterns get their own group; magnet, lock, hide and clear sit at the bottom
  function wsRail() { return !!window.__piWs; }
  var WS_FAMILIES = [
    { id: 'line', label: 'Lines', cats: ['line'], icon: '\u2571' },
    { id: 'chan', label: 'Channels and pitchforks', cats: ['channel', 'pitchfork'], icon: '\u2225' },
    { id: 'fib', label: 'Fibonacci and Gann', cats: ['fibonacci', 'gann'], icon: '\u2261' },
    { id: 'shape', label: 'Shapes', cats: ['shape'], icon: '\u25ad' },
    { id: 'pat', label: 'Patterns', cats: [], extra: ['pat-hs', 'pat-xabcd', 'pat-tri', 'pat-abcd', 'pat-cypher', 'pat-ew5', 'pat-ewabc'], icon: 'W' },
    { id: 'pos', label: 'Positions and forecasts', cats: ['forecasting'], icon: '\u21a5' },
    { id: 'text', label: 'Text and notes', cats: ['annotation'], extra: ['emoji'], icon: 'T' },
    { id: 'meas', label: 'Measure and profiles', cats: ['measurement'], extra: ['measure', 'avwap', 'range-vp', 'avwap-bands', 'avwap-clear', 'range-vp-clear'], icon: '\u2921' }];
  // the workspace keeps its own pins (none by default): the old list pinned eleven tools the groups already hold
  function favKey() { return wsRail() ? 'pi_ws_rail_favs' : 'pi_rail_favs'; }
  function railFavs() { try { var f = JSON.parse(localStorage.getItem(favKey()) || 'null'); return Array.isArray(f) ? f : (wsRail() ? [] : RAIL_FAV.slice()); } catch (e) { return wsRail() ? [] : RAIL_FAV.slice(); } }
  function setRailFavs(f) { try { localStorage.setItem(favKey(), JSON.stringify(f.slice(0, 12))); } catch (e) {} }
  var flyEl = null;
  function closeFly() { if (flyEl) flyEl.style.display = 'none'; }
  // which tool each family handed out last: click the icon to take it again,
  // click the chevron to open the whole family, the way TradingView does
  function famLast() { try { return JSON.parse(localStorage.getItem('pi_fam_last') || '{}') || {}; } catch (e) { return {}; } }
  function setFamLast(fam, tool) { var m = famLast(); m[fam] = tool; try { localStorage.setItem('pi_fam_last', JSON.stringify(m)); } catch (e) {} }
  function famOf(tool) {
    var d = toolDefs().filter(function (x) { return x.type === tool; })[0];
    var hit = FAMILIES.filter(function (f) { return (d && f.cats.indexOf(d.category) >= 0) || (f.extra || []).indexOf(tool) >= 0; })[0];
    return hit ? hit.id : null;
  }
  function openFly(fam, anchorBtn) {
    if (!flyEl) { flyEl = document.createElement('div'); flyEl.id = 'cp-fly';
      flyEl.className = 'bg-white border border-sepia-border rounded-lg shadow-lg p-1 text-xs';
      flyEl.style.cssText = 'position:absolute;z-index:12;width:15rem;max-height:22rem;overflow:auto;display:none';
      (document.getElementById('tv-rail') || H.el).appendChild(flyEl); }
    var tools = toolDefs().filter(function (t) { return fam.cats.indexOf(t.category) >= 0 && !NATIVE[t.type]; }).map(function (t) { return t.type; }).concat(fam.extra || []);
    var favs2 = railFavs();
    flyEl.innerHTML = '<div class="px-2 py-1 font-semibold text-ink-mute">' + fam.label + '</div>' + tools.map(function (t) { var def = toolDefs().filter(function (x) { return x.type === t; })[0]; if (!def) return '';
      var on = favs2.indexOf(t) >= 0; return '<div class="flex items-center gap-1 px-1"><button type="button" data-fly="' + t + '" class="flex-1 text-left px-2 py-1 rounded-lg hover:bg-sepia-hover">' + def.name + '</button>'
        + '<button type="button" data-flypin="' + t + '" title="' + (on ? 'Unpin from the rail' : 'Pin to the rail') + '" style="color:' + (on ? 'rgb(var(--pi-accent))' : 'rgb(var(--pi-border))') + '">\u2605</button></div>'; }).join('');
    var r = anchorBtn.getBoundingClientRect(), host = flyEl.parentNode.getBoundingClientRect();
    var tvEl = document.getElementById('tv'), onRight = tvEl && tvEl.classList.contains('rail-right') && window.innerWidth > 900;
    flyEl.style.left = (onRight ? r.left - tvEl.getBoundingClientRect().left - 246 : r.right - host.left + 6) + 'px'; flyEl.style.top = Math.max(0, r.top - host.top) + 'px'; flyEl.style.display = '';
    Array.prototype.forEach.call(flyEl.querySelectorAll('[data-fly]'), function (b) { b.addEventListener('click', function () { var t2 = this.getAttribute('data-fly'); setFamLast(fam.id, t2); setTool(t2); closeFly(); }); });
    Array.prototype.forEach.call(flyEl.querySelectorAll('[data-flypin]'), function (b) { b.addEventListener('click', function () { var t = this.getAttribute('data-flypin'), f = railFavs(), i = f.indexOf(t);
      if (i >= 0) f.splice(i, 1); else f.push(t); setRailFavs(f); buildRail(); openFly(fam, document.querySelector('#cp-rail [data-fam="' + fam.id + '"]') || anchorBtn); }); });
  }
  document.addEventListener('mousedown', function (ev) { if (flyEl && flyEl.style.display !== 'none' && !(ev.target.closest && (ev.target.closest('#cp-fly') || ev.target.closest('[data-fam]')))) closeFly(); }, true);
  // the draw-plus tools join their families once the flag is read off the page
  function plusRail() {
    if (!drawPlus()) return;
    if (wsRail()) return;   // the workspace groups list them already
    var more = { shape: ['pat-ew5', 'pat-ewabc', 'pat-abcd', 'pat-cypher'], meas: ['avwap-bands'], text: ['emoji'] };
    FAMILIES.forEach(function (f) { (more[f.id] || []).forEach(function (t) { f.extra = f.extra || []; if (f.extra.indexOf(t) < 0) f.extra.push(t); }); });
  }
  function buildRail() {
    if (!DM || !H.el) return;
    if (wsRail()) FAMILIES = WS_FAMILIES;
    plusRail();
    var old = document.getElementById('cp-rail'), parent = old ? old.parentNode : null; if (old) old.parentNode.removeChild(old);
    // inside the chart, under the readout: outside the card it clipped on a phone
    var rail = document.createElement('div');
    rail.id = 'cp-rail';
    rail.className = 'flex flex-col gap-1';
    // On the name page the chart is short and the rail is long: keep it inside the
    // chart and let it scroll, instead of spilling down the page.
    rail.style.cssText = 'position:absolute;left:6px;top:2.9rem;bottom:2.2rem;z-index:6;opacity:0.92;'
      + 'overflow-y:auto;overflow-x:hidden;scrollbar-width:none;-ms-overflow-style:none;padding-right:1px';
    if (!document.getElementById('cp-rail-css')) {
      var rst = document.createElement('style'); rst.id = 'cp-rail-css';
      rst.textContent = '#cp-rail::-webkit-scrollbar{width:0;height:0}'
        + '#tv-rail #cp-rail{position:static;bottom:auto;overflow:visible;opacity:1}'
        + '#cp-rail [data-fam]{position:relative}'
        + '#cp-rail [data-fam]::after{content:"";position:absolute;right:2px;bottom:2px;'
        + 'border-left:4px solid transparent;border-bottom:4px solid currentColor;opacity:.55}'
;
      document.head.appendChild(rst);
    }
    var html = '<button type="button" data-rail="" title="Cursor. Click a drawing to pick it up."'
      + ' class="px-1 py-1 rounded-lg border border-sepia-border text-ink-mute hover:text-ink" style="font-size:13px">\u2196</button>';
    railFavs().forEach(function (t) {
      if (!toolDefs().some(function (d) { return d.type === t; })) return;
      var name = (toolDefs().filter(function (d) { return d.type === t; })[0] || {}).name || t;
      html += '<button type="button" data-rail="' + t + '" title="' + name + '"'
        + ' class="px-1 py-1 rounded-lg border border-sepia-border text-ink-mute hover:text-ink" style="font-size:13px">'
        + (RAIL_ICON[t] || '\u25ab') + '</button>';
    });
    html += '<span class="cp-rail-sep" style="height:1px;background:#e7e1d8;margin:3px 2px"></span>';
    FAMILIES.forEach(function (f) { html += '<button type="button" data-fam="' + f.id + '" title="' + f.label + '"'
      + ' class="px-1 py-1 rounded-lg border border-sepia-border text-ink-mute hover:text-ink" style="font-size:13px">' + f.icon + '</button>'; });
    if (wsRail()) html += '<span class="cp-rail-grow" style="flex:1 1 auto;min-height:6px;min-width:6px"></span><span class="cp-rail-sep" style="height:1px;background:rgb(var(--pi-border));margin:3px 2px"></span>';
    else html += '<button type="button" id="cp-rail-more" title="Every drawing tool"'
      + ' class="px-1 py-1 rounded-lg border border-sepia-border text-ink-mute hover:text-ink" style="font-size:13px">\u22ef</button>';
    html += '<button type="button" id="cp-rail-magnet" title="Magnet: points land on the bar\'s open, high, low or close. Hold ' + (tvKeys() ? keyDisp('Mod').replace(/\+$/, '') : 'Shift') + ' for one click."'
      + ' class="px-1 py-1 rounded-lg border border-sepia-border text-ink-mute hover:text-ink" style="font-size:13px">\u29bf</button>';
    if (wsRail()) [['cp-rail-lock', 'Lock every drawing, click again to unlock', '\u26bf'], ['cp-rail-hide', 'Hide the drawings, click again to show them', '\u25ce'],
      ['cp-rail-clear', 'Remove every drawing on this name', '\u2715']].forEach(function (x) {
      html += '<button type="button" id="' + x[0] + '" title="' + x[1] + '" class="px-1 py-1 rounded-lg border border-sepia-border text-ink-mute hover:text-ink" style="font-size:.8125rem">' + x[2] + '</button>'; });
    html += '<button type="button" id="cp-rail-objs" title="Objects: every drawing on this name, show, lock or remove it"'
      + ' class="px-1 py-1 rounded-lg border border-sepia-border text-ink-mute hover:text-ink" style="font-size:13px">\u2630</button>';
    rail.innerHTML = html;
    (parent || H.el).appendChild(rail);
    Array.prototype.forEach.call(rail.querySelectorAll('[data-rail]'), function (b2) {
      b2.addEventListener('click', function () {
        var t2 = this.getAttribute('data-rail') || null;
        if (!t2 && !activeTool) { cursorMenu(this); return; }   // already on the pointer: offer the cursors
        setTool(t2);
      });
    });
    Array.prototype.forEach.call(rail.querySelectorAll('[data-fam]'), function (b2) {
      b2.addEventListener('click', function (ev) { var fam = FAMILIES.filter(function (f) { return f.id === b2.getAttribute('data-fam'); })[0]; if (!fam) return;
        if (flyEl && flyEl.style.display !== 'none' && flyEl.getAttribute('data-for') === fam.id) { closeFly(); return; }
        var last = famLast()[fam.id];
        // the chevron strip on the right opens the family; the icon takes the last tool back
        var onChevron = (ev.clientX - b2.getBoundingClientRect().left) > b2.offsetWidth - 9;
        if (last && !onChevron && toolDefs().some(function (d) { return d.type === last; })) { setTool(last); return; }
        openFly(fam, b2); flyEl.setAttribute('data-for', fam.id); });
    });
    markRail();
    try { document.dispatchEvent(new CustomEvent('cp-rail')); } catch (e) {}
    var more = document.getElementById('cp-rail-more');
    if (more) more.addEventListener('click', function () {
      var dd = document.getElementById('cp-draw'); if (dd) dd.open = !dd.open; });
    var mg = document.getElementById('cp-rail-magnet');
    if (mg) { pill(mg, magnetOn); mg.addEventListener('click', function () { setMagnet(!magnetOn); }); }
    var ob = document.getElementById('cp-rail-objs');
    if (ob) ob.addEventListener('click', function () { toggleObjs(); });
    var lk = document.getElementById('cp-rail-lock'), hd = document.getElementById('cp-rail-hide'), cl = document.getElementById('cp-rail-clear');
    function allLocked() { try { var a = DM.getAllDrawings(); return a.length > 0 && a.every(function (x) { return x._locked; }); } catch (e) { return false; } }
    if (lk) { pill(lk, allLocked()); lk.addEventListener('click', function () { var on = !allLocked();
      try { DM.getAllDrawings().forEach(function (x) { x._locked = on; }); } catch (e) {} saveDrawings(); pill(lk, on); }); }
    if (hd) { pill(hd, _hiddenLayer); hd.addEventListener('click', function () { drawLayerVisible(_hiddenLayer); pill(hd, _hiddenLayer); }); }
    if (cl) cl.addEventListener('click', function () { var n = 0; try { n = DM.getAllDrawings().length; } catch (e) {}
      if (!n || !window.confirm('Remove the ' + n + ' drawing' + (n > 1 ? 's' : '') + ' on this name?')) return;
      detachAll(); try { DM.clearAll(); } catch (e) {} saveDrawings(); setTool(null); });
  }
  var magnetOn = false; try { magnetOn = localStorage.getItem('pi_chart_magnet') === '1'; } catch (e) {}
  function setMagnet(on) { magnetOn = !!on; try { localStorage.setItem('pi_chart_magnet', on ? '1' : '0'); } catch (e) {}
    pill(document.getElementById('cp-rail-magnet'), magnetOn); }

  // ── the objects panel: every drawing on this name, with show, lock, remove ──
  var objsBox = null;
  function toolName(type, d) { if (d && d._style && d._style.pattern) return d._style.pattern; var f = toolDefs().filter(function (t) { return t.type === type; })[0]; return (f && f.name) || type; }
  function toolCat(type) { var f = toolDefs().filter(function (t) { return t.type === type; })[0]; return (f && f.category) || 'shape'; }
  function toggleObjs() {
    var dock = document.getElementById('dock-objs');
    if (dock) { try { document.dispatchEvent(new CustomEvent('pi-dock', { detail: { tab: 'objects' } })); } catch (e) {} renderObjs(); return; }
    if (!objsBox) {
      objsBox = document.createElement('div'); objsBox.id = 'cp-objs';
      objsBox.className = 'bg-white border border-sepia-border rounded-lg shadow-lg p-2 text-xs';
      objsBox.style.cssText = 'position:absolute;left:44px;top:2.9rem;z-index:7;width:17rem;max-height:20rem;overflow:auto;display:none';
      H.el.appendChild(objsBox);
    }
    objsBox.style.display = objsBox.style.display === 'none' ? '' : 'none';
    renderObjs();
  }
  function objStudies() {
    if (!window.__piObjsStudies) return '';
    var ks = liveKeys().filter(function (k) { return defOf(k); }); if (!ks.length) return '';
    return '<div class="flex items-center gap-1 px-1 mt-1 text-ink-mute uppercase tracking-wide" style="font-size:.7rem"><span class="flex-1">Indicators \u00b7 ' + ks.length + '</span></div>'
      + ks.map(function (k) { var hid = !!scOf(k).hidden;
        return '<div class="flex items-center gap-1 px-1 py-0.5 rounded-lg hover:bg-sepia-hover"><span class="flex-1 truncate' + (hid ? ' text-ink-mute' : '') + '">' + defOf(k).label + '</span>'
          + '<button type="button" data-seye="' + k + '" title="' + (hid ? 'Show' : 'Hide') + '">' + (hid ? '\u25cc' : '\u25c9') + '</button>'
          + '<button type="button" data-sset="' + k + '" title="Settings">\u2699</button>'
          + '<button type="button" data-sdel="' + k + '" class="text-bad" title="Remove">\u2715</button></div>'; }).join('');
  }
  function wireObjStudies(host) {
    if (!window.__piObjsStudies) return;
    var each = function (attr, fn) { Array.prototype.forEach.call(host.querySelectorAll('[' + attr + ']'), function (b) { b.addEventListener('click', function () { fn(this.getAttribute(attr)); }); }); };
    each('data-seye', function (k) { hideStudy(k, !scOf(k).hidden); renderObjs(); });
    each('data-sset', function (k) { openStudySettings(k); });
    each('data-sdel', function (k) { try { window.__cp.toggleStudy(k); } catch (e) {} renderObjs(); });
  }
  function renderObjs() {
    var dock = document.getElementById('dock-objs');
    if (!dock && (!objsBox || objsBox.style.display === 'none')) return;
    if (!DM) return;
    var host = dock || objsBox;
    var ds = []; try { ds = DM.getAllDrawings().filter(function (d) { return !d._auto; }); } catch (e) {}
    var stHtml = objStudies();
    if (!ds.length) { host.innerHTML = stHtml + '<div class="text-ink-mute px-1 py-1">No drawing on this name yet. Pick a tool on the rail, or press ' + (tvKeys() ? keyDisp('Alt+KeyT') : 'Alt+T') + ' for a trend line.</div>'; objsBox = host; wireObjStudies(host); return; }
    var FAMN = { line: 'Lines', channel: 'Channels', fibonacci: 'Fibonacci', pitchfork: 'Pitchforks', gann: 'Gann', shape: 'Shapes and patterns', forecasting: 'Positions and forecasts', measurement: 'Measures', annotation: 'Text and notes' };
    var groups = {}; ds.forEach(function (d) { var cat = toolCat(d.type); (groups[cat] = groups[cat] || []).push(d); });
    var clip = null; try { clip = JSON.parse(localStorage.getItem('pi_clip') || 'null'); } catch (e) {}
    host.innerHTML = '<div class="flex items-center gap-2 px-1 mb-1"><span class="font-semibold text-ink-mute">' + ds.length + ' object' + (ds.length > 1 ? 's' : '') + '</span>'
      + (clip ? '<button type="button" data-opaste="1" class="ml-auto text-accent" title="Paste the copied drawing here (\u2318V)">paste</button>' : '') + '</div>'
      + Object.keys(groups).map(function (cat) { return '<div class="flex items-center gap-1 px-1 mt-1 text-ink-mute uppercase tracking-wide" style="font-size:10px"><span class="flex-1">' + (FAMN[cat] || cat) + ' \u00b7 ' + groups[cat].length + '</span>'
          + '<button type="button" data-gl="' + cat + '" title="Lock the folder">\ud83d\udd12</button><button type="button" data-gh="' + cat + '" title="Hide or show the folder">\u25c9</button><button type="button" data-gd="' + cat + '" class="text-bad" title="Remove the folder">\u2715</button></div>'
        + groups[cat].map(function (d) {
        var a = d._orig || d._anchors || [];
        var px = a.map(function (x) { return (+x.price).toFixed(2); }).join(' \u00b7 ');
        return '<div class="flex items-center gap-1 px-1 py-0.5 rounded-lg hover:bg-sepia-hover" data-oid="' + d.id + '">'
          + '<span class="flex-1 truncate' + (d._hidden ? ' text-ink-mute' : '') + '" title="' + (a[0] ? a[0].time : '') + '">' + toolName(d.type, d)
          + ' <span class="text-ink-mute">' + px + '</span></span>'
          + '<button type="button" data-oeye="' + d.id + '" title="' + (d._hidden ? 'Show' : 'Hide') + '">' + (d._hidden ? '\u25cc' : '\u25c9') + '</button>'
          + '<button type="button" data-olock="' + d.id + '" title="' + (d._locked ? 'Unlock' : 'Lock in place') + '">' + (d._locked ? '\ud83d\udd12' : '\ud83d\udd13') + '</button>'
          + '<button type="button" data-ocopy="' + d.id + '" title="Copy (\u2318C)">\u2398</button>'
          + '<button type="button" data-odel="' + d.id + '" class="text-bad" title="Remove">\u2715</button></div>';
      }).join(''); }).join('');
    function byId(id) { return ds.filter(function (d) { return d.id === id; })[0]; }
    objsBox = host;
    if (stHtml) { host.insertAdjacentHTML('afterbegin', stHtml); wireObjStudies(host); }
    Array.prototype.forEach.call(objsBox.querySelectorAll('[data-ocopy]'), function (b) { b.addEventListener('click', function () { var d = byId(this.getAttribute('data-ocopy')); if (d) copyDrawing(d); }); });
    var pb = objsBox.querySelector('[data-opaste]'); if (pb) pb.addEventListener('click', function () { pasteDrawing(); });
    Array.prototype.forEach.call(objsBox.querySelectorAll('[data-gl]'), function (b) { b.addEventListener('click', function () { var cat = this.getAttribute('data-gl'), all = groups[cat].every(function (d) { return d._locked; }); groups[cat].forEach(function (d) { d._locked = !all; }); saveDrawings(); }); });
    Array.prototype.forEach.call(objsBox.querySelectorAll('[data-gh]'), function (b) { b.addEventListener('click', function () { var cat = this.getAttribute('data-gh'), all = groups[cat].every(function (d) { return d._hidden; }); groups[cat].forEach(function (d) { d._hidden = !all; if (d._hidden) detach(d); else attach(d); }); saveDrawings(); }); });
    Array.prototype.forEach.call(objsBox.querySelectorAll('[data-gd]'), function (b) { b.addEventListener('click', function () { var cat = this.getAttribute('data-gd'); groups[cat].forEach(function (d) { detach(d); try { DM.removeDrawing(d.id); } catch (e) {} }); saveDrawings(); }); });
    Array.prototype.forEach.call(objsBox.querySelectorAll('[data-oeye]'), function (b) {
      b.addEventListener('click', function () { var d = byId(this.getAttribute('data-oeye')); if (!d) return;
        d._hidden = !d._hidden; if (d._hidden) detach(d); else attach(d); saveDrawings(); }); });
    Array.prototype.forEach.call(objsBox.querySelectorAll('[data-olock]'), function (b) {
      b.addEventListener('click', function () { var d = byId(this.getAttribute('data-olock')); if (!d) return;
        d._locked = !d._locked; saveDrawings(); }); });
    Array.prototype.forEach.call(objsBox.querySelectorAll('[data-odel]'), function (b) {
      b.addEventListener('click', function () { var d = byId(this.getAttribute('data-odel')); if (!d) return;
        detach(d); try { DM.removeDrawing(d.id); } catch (e) {} saveDrawings(); }); });
  }

  // ── keyboard: the TradingView gestures, only while the chart has the hand ──
  var chartFocus = false;
  function chartHasHand() { try { return chartFocus || H.el.matches(':hover'); } catch (e) { return chartFocus; } }
  function gotoDate(s2) {
    var t = (s2 || '').trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) { hint('Date as YYYY-MM-DD'); setTimeout(function () { hint(''); }, 1800); return; }
    var c = H.candles(), tt = nearestBarTime(t), idx = -1;
    for (var i = 0; i < c.length; i++) if (c[i].time === tt) { idx = i; break; }
    if (idx < 0) return;
    try { chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, idx - 80), to: Math.min(c.length + 5, idx + 25) }); } catch (e) {}
  }
  // multimon.js (flag multi_monitor) tells the other chart windows and keeps a pop-out bare; absent = the url as is
  function piNav(u) { try { return window.piLink ? window.piLink.nav(u) : u; } catch (e) { return u; } }
  function boardList() { try { return JSON.parse(sessionStorage.getItem('pi_board_names') || '[]') || []; } catch (e) { return []; } }
  function flipBoard(dir) {
    var list = boardList(); if (!list.length) { hint('Open a board first, then Space walks its names'); setTimeout(function () { hint(''); }, 2000); return; }
    var tk = ((document.getElementById('chart-snap') || {}).dataset || {}).ticker, i = list.indexOf(tk);
    var j = i < 0 ? 0 : (i + dir + list.length) % list.length;
    hint('board ' + (j + 1) + '/' + list.length + '  ' + list[j]); location.href = piNav((tvKeys() && location.pathname.indexOf('/chart/') === 0 ? '/chart/' : '/name/') + encodeURIComponent(list[j]));
  }
  function flipWatch(dir) {
    var list = window.__piWatch || []; if (!list.length) { hint('Your watchlist is empty'); setTimeout(function () { hint(''); }, 1500); return; }
    var tk = ((document.getElementById('chart-snap') || {}).dataset || {}).ticker, i = list.indexOf(tk);
    var j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    hint((dir > 0 ? '\u2193 ' : '\u2191 ') + list[j] + '  ' + (j + 1) + '/' + list.length);
    location.href = piNav((window.__piFixes2 && location.pathname.indexOf('/chart/') === 0 ? '/chart/' : '/name/') + encodeURIComponent(list[j]));   // the workspace stays the workspace
  }
  function quickView(v) {
    var c = bars(), n = c.length; if (!n) return;
    var last = c[n - 1].time, from;
    if (v === 'ALL') from = 0;
    else if (v === 'YTD') { for (from = n - 1; from > 0 && c[from - 1].time.slice(0, 4) === last.slice(0, 4); from--) {} }
    else { var days = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252 }[v] || 63; from = Math.max(0, n - days); }
    try { chart.timeScale().setVisibleLogicalRange({ from: from - 1, to: n + 3 }); } catch (e) {}
  }
  function setScale(name) {
    var M = LWC.PriceScaleMode, m = { normal: M.Normal, log: M.Logarithmic, percent: M.Percentage, indexed: M.IndexedTo100 }[name];
    if (m == null) return; try { chart.priceScale('right').applyOptions({ mode: m }); } catch (e) {}
  }
  var inverted = false;
  function invertScale() { inverted = !inverted; try { chart.priceScale('right').applyOptions({ invertScale: inverted }); } catch (e) {} }
  // The price axis is where the hand goes for scale, so it carries its own three
  // buttons and its own menu. Same for the time axis.
  var scaleName = 'normal', axisBox = null;
  function setScale2(name) { scaleName = name; setScale(name); markAxis(); saveState(); }
  function markAxis() {
    var b = document.getElementById('cp-axis'); if (!b) return;
    Array.prototype.forEach.call(b.querySelectorAll('[data-sc]'), function (x) {
      x.classList.toggle('cp-axis-on', x.getAttribute('data-sc') === scaleName); });
  }
  function buildAxisButtons() {
    if (document.getElementById('cp-axis')) return;
    var box = document.createElement('div'); box.id = 'cp-axis';
    box.style.cssText = 'position:absolute;right:6px;bottom:22px;z-index:6;display:flex;gap:2px;'
      + 'font-size:10px;background:transparent';
    box.innerHTML = ['normal', 'log', 'percent'].map(function (n) {
      var lbl = n === 'normal' ? 'auto' : n === 'log' ? 'log' : '%';
      var ttl = n === 'normal' ? 'Auto scale' : n === 'log' ? 'Logarithmic scale' : 'Percent scale';
      return '<button type="button" data-sc="' + n + '" title="' + ttl + '"'
        + ' class="px-1 rounded border border-sepia-border bg-white text-ink-mute hover:text-ink">' + lbl + '</button>'; }).join('');
    H.el.appendChild(box);
    Array.prototype.forEach.call(box.querySelectorAll('[data-sc]'), function (b2) {
      b2.addEventListener('click', function () { setScale2(this.getAttribute('data-sc')); }); });
    if (!document.getElementById('cp-axis-css')) {
      var st2 = document.createElement('style'); st2.id = 'cp-axis-css';
      st2.textContent = '#cp-axis .cp-axis-on{background:rgb(var(--pi-accent));border-color:rgb(var(--pi-accent));color:#fff}';
      document.head.appendChild(st2);
    }
    markAxis();
  }
  function axisMenu(ev, kind) {
    ev.preventDefault();
    if (!axisBox) { axisBox = document.createElement('div'); axisBox.id = 'cp-axismenu';
      axisBox.className = 'bg-white border border-sepia-border rounded-lg shadow-lg text-xs';
      axisBox.style.cssText = 'position:fixed;z-index:80;display:none;min-width:11rem;padding:4px';
      document.body.appendChild(axisBox);
      document.addEventListener('mousedown', function (e2) {
        if (axisBox && !(e2.target.closest && e2.target.closest('#cp-axismenu'))) axisBox.style.display = 'none'; });
    }
    var items = kind === 'price'
      ? [['Alert at this price', function () { var b2 = H.el.getBoundingClientRect(); var pz = null;
            try { pz = H.cs.coordinateToPrice(ev.clientY - b2.top); } catch (e) {}
            if (pz > 0) armAlert(Math.round(pz * 100) / 100); }],
         ['Auto scale', function () { setScale2('normal'); }], ['Logarithmic', function () { setScale2('log'); }],
         ['Percent', function () { setScale2('percent'); }], ['Indexed to 100', function () { setScale2('indexed'); }],
         ['Flip the axis', invertScale]]
      : [['Go to a date', function () { gotoAsk(); }],
         ['Back to the last bar', function () { try { chart.timeScale().scrollToRealTime(); } catch (e) {} }],
         ['Fit everything', function () { try { chart.timeScale().fitContent(); } catch (e) {} }]];
    axisBox.innerHTML = items.map(function (it, i) {
      return '<button type="button" data-am="' + i + '" class="block w-full text-left px-2 py-1 rounded hover:bg-sepia-hover">' + it[0] + '</button>'; }).join('');
    Array.prototype.forEach.call(axisBox.querySelectorAll('[data-am]'), function (b2) {
      b2.addEventListener('click', function () { items[+this.getAttribute('data-am')][1](); axisBox.style.display = 'none'; }); });
    axisBox.style.display = 'block';
    axisBox.style.left = Math.min(ev.clientX, window.innerWidth - axisBox.offsetWidth - 8) + 'px';
    axisBox.style.top = Math.min(ev.clientY, window.innerHeight - axisBox.offsetHeight - 8) + 'px';
  }
  function initAxes() {
    buildAxisButtons();
    // the axes live inside the chart canvas: we read where the click landed
    H.el.addEventListener('contextmenu', function (ev) {
      var b = H.el.getBoundingClientRect(), x = ev.clientX - b.left, y = ev.clientY - b.top;
      var axisW = 0; try { axisW = chart.priceScale('right').width(); } catch (e) {}
      var timeH = 26;
      if (x > b.width - axisW - 2) { axisMenu(ev, 'price'); ev.stopPropagation(); }
      else if (y > b.height - timeH) { axisMenu(ev, 'time'); ev.stopPropagation(); }
    }, true);
  }

  var redoStack = [];
  function redoDrawing() {
    if (window.__piUndoFull) { snapStep(1); return; }
    var r = redoStack.pop(); if (!r) return;
    try { var reg = window.LightweightChartsDrawing.getToolRegistry();
      var d = reg.createDrawing(r.type, 'u' + Date.now(), r.anchors, r.style || {});
      if (d) { DM.addDrawing(d); attach(d); undoStack.push(d.id); saveDrawings(); } } catch (e) {}
  }
  function undoDrawing() {
    if (window.__piUndoFull) { snapStep(-1); return; }
    while (undoStack.length) { var id = undoStack.pop(), d = null;
      try { d = DM.getAllDrawings().filter(function (x) { return x.id === id; })[0]; } catch (e) {}
      if (d) { redoStack.push({ type: d.type, anchors: JSON.parse(JSON.stringify(d._orig || d._anchors)), style: d._style || {} });
        detach(d); try { DM.removeDrawing(d.id); } catch (e) {} saveDrawings(); return; } }
  }
  var keysBox = null;
  function showKeys() {
    if (keysBox && keysBox.style.display !== 'none') { keysBox.style.display = 'none'; return; }
    if (!keysBox) { keysBox = document.createElement('div'); keysBox.id = 'cp-keys';
      keysBox.className = 'bg-white border border-sepia-border rounded-lg shadow-lg p-3 text-xs';
      keysBox.style.cssText = 'position:absolute;right:8px;top:2.9rem;z-index:9;width:' + (tvKeys() ? '23rem;max-width:calc(100% - 16px);max-height:calc(100% - 4rem);overflow:auto' : '20rem');
      keysBox.innerHTML = '<div class="font-semibold mb-1">' + (tvKeys() ? 'Keyboard shortcuts' : 'Keyboard, while the chart has the hand') + '</div>'
        + (tvKeys() ? tvSheet() : HOTKEYS.map(function (h) { return '<div class="flex gap-2"><span class="w-16 font-mono text-ink">' + h[0] + '</span><span class="text-ink-mute">' + h[1] + '</span></div>'; }).join(''))
        + '<div class="text-ink-mute mt-2">Right-click the chart for the quick menu. Esc closes this.</div>';
      H.el.appendChild(keysBox); }
    keysBox.style.display = '';
  }
  var ctxBox = null;
  function hideCtx() { if (ctxBox) ctxBox.style.display = 'none'; }
  // Right-click an indicator, in its legend row or in its own pane, and everything
  // that belongs to it is there: the same list TradingView puts under a study.
  function studyAlert(k) {
    var d = defOf(k), g = cfgOf(k), tk = ((document.getElementById('chart-snap') || {}).dataset || {}).ticker;
    var expr = { rsi: 'rsi(close,' + (g.p || 14) + ') > 70', sma: 'close > sma(close,' + (g.p || 50) + ')',
                 ema: 'close > ema(close,' + (g.p || 21) + ')' }[baseKey(k)];
    if (!expr || !tk) { hint('This one has no formula to watch yet'); setTimeout(function () { hint(''); }, 2200); return; }
    postForm('/alerts/create', [['ticker', tk], ['level', '0'], ['kind', 'formula'],
                                ['anchors', JSON.stringify({ expr: expr })], ['back', location.pathname]]);
  }
  function hideStudy(k, on) {
    scOf(k).hidden = !!on;
    (studySeries[k] || []).forEach(function (sr) { try { sr.applyOptions({ visible: !on }); } catch (e) {} });
    saveState(); try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {}
  }
  function duplicateStudy(k) {
    var nk = nextCopy(k);
    studyCfg[nk] = JSON.parse(JSON.stringify(studyCfg[k] || {}));
    studyState[nk] = true; drawStudy(nk); fitHeight(); saveState();
    setTimeout(function () { openStudySettings(nk); }, 60);
  }
  function moveStudy(k, dir) {
    var i = studyPane[k]; if (i == null) return;
    var ps = chart.panes(), j = i + dir;
    if (j < 1 || j >= ps.length) return;
    try { chart.swapPanes(i, j); } catch (e) { return; }
    Object.keys(studyPane).forEach(function (x) {
      if (studyPane[x] === i) studyPane[x] = j; else if (studyPane[x] === j) studyPane[x] = i; });
    try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {}
  }
  function pinStudy(k, side) {
    (studySeries[k] || []).forEach(function (sr) { try { sr.applyOptions({ priceScaleId: side }); } catch (e) {} });
    scOf(k).scale = side; saveState();
  }
  // The pane answers where the mouse is: a small bar at its top right, like TradingView.
  var paneBar = null, paneBarFor = -1, paneMax = null;
  function studyInPane(i) {
    return Object.keys(studyPane).filter(function (x) { return studyPane[x] === i && studyState[x]; })[0] || null;
  }
  function maximizePane(i) {
    var ps = chart.panes(); paneMax = (paneMax === i) ? null : i;
    ps.forEach(function (p2, n) {
      try { p2.setStretchFactor(paneMax == null ? (n === 0 ? Math.max(3, ps.length + 1) : 1) : (n === paneMax ? 12 : 0.4)); } catch (e) {}
    });
    try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {}
  }
  function buildPaneBar() {
    if (paneBar) return paneBar;
    paneBar = document.createElement('div'); paneBar.id = 'cp-panebar';
    paneBar.style.cssText = 'position:absolute;z-index:7;display:none;gap:2px;'
      + 'background:var(--panel,#fff);border:1px solid rgb(var(--pi-border));border-radius:6px;padding:2px;box-shadow:0 2px 8px rgba(0,0,0,.12)';
    paneBar.innerHTML = [['up', '\u2191', 'Move the pane up'], ['down', '\u2193', 'Move the pane down'],
                         ['max', '\u2922', 'Full height, click again to share'], ['del', '\u2715', 'Close this pane']]
      .map(function (b) { return '<button type="button" data-pb="' + b[0] + '" title="' + b[2] + '"'
        + ' style="width:20px;height:20px;line-height:1;font-size:12px;border-radius:4px;color:rgb(var(--pi-ink-mute))">' + b[1] + '</button>'; }).join('');
    H.el.appendChild(paneBar);
    Array.prototype.forEach.call(paneBar.querySelectorAll('[data-pb]'), function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var i = paneBarFor, k = studyInPane(i); if (i < 1) return;
        var what = this.getAttribute('data-pb');
        if (what === 'max') { maximizePane(i); return; }
        if (!k) return;
        if (what === 'up') moveStudy(k, -1);
        else if (what === 'down') moveStudy(k, 1);
        else { studyState[k] = false; drawStudy(k); if (baseKey(k) !== k) delete studyState[k];
               var cb = document.getElementById('cp-s-' + k); if (cb) cb.checked = false; fitHeight(); saveState(); }
        hidePaneBar();
      });
      b.addEventListener('mouseenter', function () { this.style.background = 'rgb(var(--pi-card))'; });
      b.addEventListener('mouseleave', function () { this.style.background = ''; });
    });
    return paneBar;
  }
  function hidePaneBar() { if (paneBar) { paneBar.style.display = 'none'; paneBarFor = -1; } }
  function paneAt(y) {
    var acc = 0, hit = -1, tops = [];
    try { chart.panes().forEach(function (p2, i) { var h = p2.getHeight(); tops.push(acc); if (y >= acc && y < acc + h) hit = i; acc += h; }); } catch (e) {}
    return { i: hit, top: tops[hit] || 0 };
  }
  function initPaneBar() {
    var hovK = null, hovT = 0;
    H.el.addEventListener('mousemove', function (ev) {
      // a study under the mouse lights up, throttled to the frame
      var now = Date.now();
      if (now - hovT > 40 && !activeTool) { hovT = now; var hk = null; try { hk = studyHit(ev); } catch (e) {}
        if (hk !== hovK) { var prev = hovK; hovK = hk;
          [prev, hovK].forEach(function (k) { if (!k || k === pickedStudy) return; var sc2 = studyCfg[k] || {};
            (studySeries[k] || []).forEach(function (sr) { try { sr.applyOptions({ lineWidth: (sc2.width || 1) + (k === hovK ? 1 : 0) }); } catch (e) {} }); });
          H.el.style.cursor = hovK ? 'pointer' : ''; } }
      var bb = H.el.getBoundingClientRect(), y = ev.clientY - bb.top;
      var hit = paneAt(y);
      if (hit.i < 1) { hidePaneBar(); return; }
      var bar = buildPaneBar(); paneBarFor = hit.i;
      var axisW = 0; try { axisW = chart.priceScale('right').width(); } catch (e) {}
      bar.style.display = 'flex';
      bar.style.right = (axisW + 6) + 'px';
      bar.style.top = (hit.top + 4) + 'px';
    });
    H.el.addEventListener('mouseleave', hidePaneBar);
  }

  // Click a study line and it comes forward, with its own points showing, so you
  // can see exactly what you picked before you act on it.
  var pickedStudy = null, pickMarks = {};
  // A picked study reads the TradingView way: the line a notch thicker and a
  // handful of dots along the visible stretch, not a bead on every bar.
  function paintPick() {
    Object.keys(studySeries).forEach(function (k) {
      var on = k === pickedStudy, sc = studyCfg[k] || {};
      (studySeries[k] || []).forEach(function (sr, j) {
        try { sr.applyOptions({ lineWidth: (sc.width || 1) + (on ? 1 : 0), pointMarkersVisible: false }); } catch (e) {}
        var id = k + ':' + j;
        if (!on) { if (pickMarks[id]) { try { pickMarks[id].setMarkers([]); } catch (e) {} } return; }
        var marks = [];
        try {
          var d = sr.data(), vr = chart.timeScale().getVisibleLogicalRange();
          var a = Math.max(0, Math.floor(vr ? vr.from : 0)), z = Math.min(d.length - 1, Math.ceil(vr ? vr.to : d.length - 1));
          var n = 9, step = Math.max(1, Math.floor((z - a) / n)), col = (sr.options() || {}).color || PI_CHART.theme().text;
          for (var i = a + Math.floor(step / 2); i <= z; i += step) if (d[i] && d[i].value != null) marks.push({ time: d[i].time, position: 'inBar', shape: 'circle', color: col, size: 0.9 });
        } catch (e) {}
        try { if (!pickMarks[id]) pickMarks[id] = LWC.createSeriesMarkers(sr, marks); else pickMarks[id].setMarkers(marks); } catch (e) {}
      });
    });
    try { H.volPick(pickedStudy === 'volume'); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {}
  }
  function pickStudy(k) { pickedStudy = (pickedStudy === k) ? null : k; paintPick(); }
  function studyHit(ev) {
    var bb = H.el.getBoundingClientRect(), x = ev.clientX - bb.left, y = ev.clientY - bb.top;
    var hit = paneAt(y); if (hit.i < 0) return null;
    var ts = chart.timeScale(), best = null, bestD = 10;
    Object.keys(studySeries).forEach(function (k) {
      if (!studyState[k] || (studyCfg[k] || {}).hidden) return;   // gone or hidden: nothing to touch
      if (studyPane[k] !== (hit.i || null) && !(hit.i === 0 && studyPane[k] == null)) return;
      (studySeries[k] || []).forEach(function (sr) {
        var d; try { d = sr.data(); } catch (e) { return; }
        var vr = ts.getVisibleLogicalRange(), i0 = vr ? Math.max(0, Math.floor(vr.from) - 1) : 0, i1 = vr ? Math.min(d.length, Math.ceil(vr.to) + 1) : d.length;
        for (var i = i0; i < i1; i++) {
          var px = ts.timeToCoordinate(d[i].time); if (px == null || Math.abs(px - x) > 7) continue;
          var py; try { py = sr.priceToCoordinate(d[i].value); } catch (e) { py = null; }
          if (py == null) continue;
          // a series answers in ITS pane's coordinates, so the cursor moves into that pane first
          var dist = Math.abs(py - (y - hit.top)); if (dist < bestD) { bestD = dist; best = k; }
        }
      });
    });
    return best;
  }
  function initStudyPick() {
    // double-click on a line: its settings, the way TradingView opens them
    H.el.addEventListener('dblclick', function (ev) {
      if (activeTool) return;
      if (ev.target && ev.target.closest && ev.target.closest('[data-base-act]')) return;   // a base label opens its own menu
      var k = studyHit(ev); if (!k) return;
      ev.preventDefault(); ev.stopPropagation(); pickedStudy = k; paintPick(); openStudySettings(k);
    }, true);
    H.el.addEventListener('click', function (ev) {
      if (replayPick) { ev.stopPropagation(); replayHere(ev); return; }
      if (activeTool) return;                       // a tool is armed: the click places it
      if (ev.target && ev.target.closest && ev.target.closest('#cp-panebar,#cp-axis,#cp-style,#cp-rail,[data-base-act]')) return;   // [data-base-act]: the base label of chart_feats3, its own click handler runs after this capture
      var k = studyHit(ev);
      if (!k && window.__piVolPane) { try { var bb2 = H.el.getBoundingClientRect(); if (paneAt(ev.clientY - bb2.top).i === 1) k = 'volume'; } catch (e) {} }
      if (k) { pickStudy(k); ev.stopPropagation(); } else if (pickedStudy) { pickedStudy = null; paintPick(); }
    }, true);
  }

  // An alert is a level, so it belongs on the price: a dashed line with a bell,
  // and you drag it to move it. TradingView reads the same way.
  var alertLines = [], alertDrag = null;
  function alertList() { try { return ((H.ours && H.ours()) || {}).alerts || []; } catch (e) { return []; } }
  function drawAlertLines() {
    alertLines.forEach(function (h) { try { H.cs.removePriceLine(h.line); } catch (e) {} });
    alertLines = [];
    if (typeof LOOK !== 'undefined' && LOOK.alerts === false) { paintAlertHandles(); return; }
    alertList().forEach(function (a) {
      try {
        var line = H.cs.createPriceLine({ price: +a.level, color: a.paused ? PI_CHART.theme().mute : PI_CHART.theme().warn,
          lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' });
        alertLines.push({ id: a.id, level: +a.level, line: line, paused: !!a.paused });
      } catch (e) {}
    });
    paintAlertHandles();
  }
  function paintAlertHandles() {
    var host = document.getElementById('cp-alerts');
    if (!host) { host = document.createElement('div'); host.id = 'cp-alerts';
      host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:6';
      H.el.appendChild(host); }
    host.innerHTML = '';
    var axisW = 0; try { axisW = chart.priceScale('right').width(); } catch (e) {}
    alertLines.forEach(function (h) {
      var y = null; try { y = H.cs.priceToCoordinate(h.level); } catch (e) {}
      if (y == null) return;
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('data-alert', h.id);
      b.title = 'Your alert at ' + h.level.toFixed(2) + '. Drag it to move the level.';
      b.textContent = '\uD83D\uDD14';                 // a bell, so nobody has to guess
      b.style.cssText = 'position:absolute;pointer-events:auto;cursor:ns-resize;right:' + (axisW + 10) + 'px;'
        + 'top:' + Math.round(y - 9) + 'px;width:18px;height:18px;line-height:16px;font-size:11px;'
        + 'border-radius:4px;border:1px solid ' + (h.paused ? 'rgb(var(--pi-ink-mute))' : 'rgb(var(--pi-warn))') + ';background:var(--panel,#fff);'
        + 'color:' + (h.paused ? 'rgb(var(--pi-ink-mute))' : 'rgb(var(--pi-warn))');
      host.appendChild(b);
    });
  }
  function initAlertDrag() {
    var host = null;
    H.el.addEventListener('mousedown', function (ev) {
      var b = ev.target && ev.target.closest && ev.target.closest('[data-alert]');
      if (!b) return;
      ev.preventDefault(); ev.stopPropagation();
      var id = +b.getAttribute('data-alert');
      alertDrag = { id: id, y0: ev.clientY, moved: false, el: b };
    }, true);
    document.addEventListener('mousemove', function (ev) {
      if (!alertDrag) return;
      if (Math.abs(ev.clientY - alertDrag.y0) > 2) alertDrag.moved = true;
      var bb = H.el.getBoundingClientRect();
      alertDrag.el.style.top = Math.round(ev.clientY - bb.top - 9) + 'px';
    });
    document.addEventListener('mouseup', function (ev) {
      if (!alertDrag) return;
      var drag = alertDrag; alertDrag = null;
      var bb = H.el.getBoundingClientRect(), y = ev.clientY - bb.top;
      if (!drag.moved) { hint('Open the alerts panel to remove it'); setTimeout(function () { hint(''); }, 1800); drawAlertLines(); return; }
      var price = null; try { price = H.cs.coordinateToPrice(y); } catch (e) {}
      if (price == null || !(price > 0)) { drawAlertLines(); return; }
      var lv = Math.round(price * 100) / 100;
      fetch('/alerts/move', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ id: drag.id, level: lv }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok) { alertList().forEach(function (a) { if (a.id === drag.id) a.level = lv; });
            hint('Alert moved to ' + lv.toFixed(2)); setTimeout(function () { hint(''); }, 1600); }
          drawAlertLines();
        }).catch(function () { drawAlertLines(); });
    });
    try { chart.timeScale().subscribeVisibleLogicalRangeChange(paintAlertHandles); } catch (e) {}
    try {
      if (window.ResizeObserver) {
        var alertRoPending = false;
        new ResizeObserver(function () {
          if (alertRoPending) return;
          alertRoPending = true;
          requestAnimationFrame(function () { alertRoPending = false; paintAlertHandles(); });
        }).observe(H.el);
      }
    } catch (e) {}
  }

  // The price line has its own menu, the way TradingView hangs one off the symbol:
  // everything you can do to the name from here, and nothing we cannot honour.
  var priceHidden = false, priceSide = 'right';
  function lastClose() { var c = bars(); return c.length ? c[c.length - 1].close : null; }
  function dockTo(tab) { try { document.dispatchEvent(new CustomEvent('pi-dock', { detail: { tab: tab } })); } catch (e) {} }
  function symbolMenu(ev) {
    ev.preventDefault(); ev.stopPropagation();
    var tk = tickerNow(), last = lastClose();
    var items = [
      ['\u23F0', 'Alert on ' + tk + (last ? ' at ' + last.toFixed(2) : ''), '', function () { if (last) armAlert(Math.round(last * 100) / 100); }],
      ['\u2795', 'Add an indicator', '', function () { openIndicators(); }],
      ['\u25A4', 'Add one of our readings', '', function () { indCat = 'Our data'; openIndicators(); }],
      ['-'],
      ['\u2139', 'What this company does', '', function () { dockTo('facts'); }],
      ['\u2630', 'The news on it', '', function () { dockTo('news'); }],
      ['\u270E', 'Write a note on it', '', function () { dockTo('note'); }],
      ['\u2606', 'Follow this name', '', function () {
          postForm('/watch', [['ticker', tk], ['back', location.pathname]]); }],
      ['-'],
      ['\u29C9', 'Copy the price', '', function () {
          if (last == null) return;
          try { navigator.clipboard.writeText(last.toFixed(2)); hint('Price copied'); setTimeout(function () { hint(''); }, 1400); } catch (e) {} }],
      ['\u2913', 'Paste a drawing', '\u2318V', function () { pasteDrawing(0); }],
      ['-'],
      ['\u2194', 'Pin the price to the ' + (priceSide === 'right' ? 'left' : 'right') + ' scale, now ' + priceSide, '', function () {
          priceSide = priceSide === 'right' ? 'left' : 'right';
          try { H.cs.applyOptions({ priceScaleId: priceSide }); } catch (e) {} }],
      ['\uD83D\uDC41', (priceHidden ? 'Show the price' : 'Hide the price, keep the studies'), '', function () {
          priceHidden = !priceHidden; try { H.cs.applyOptions({ visible: !priceHidden }); } catch (e) {} }],
      ['\u2699', 'Chart settings', '', function () { openSettingsDialog(); }]
    ];
    var box = document.getElementById('cp-symmenu');
    if (!box) { box = document.createElement('div'); box.id = 'cp-symmenu';
      box.className = 'bg-white border border-sepia-border rounded-lg shadow-lg text-xs';
      box.style.cssText = 'position:fixed;z-index:85;display:none;min-width:15rem;padding:4px';
      document.body.appendChild(box);
      document.addEventListener('mousedown', function (e2) {
        if (box && !(e2.target.closest && e2.target.closest('#cp-symmenu'))) box.style.display = 'none'; });
    }
    box.innerHTML = items.map(function (it, i) {
      if (it[0] === '-') return '<div style="height:1px;background:rgb(var(--pi-border));margin:4px 2px"></div>';
      return '<button type="button" data-sy="' + i + '" class="flex w-full items-center gap-2 text-left px-2 py-1 rounded hover:bg-sepia-hover">'
        + '<span style="width:14px;opacity:.6">' + it[0] + '</span><span class="flex-1">' + it[1] + '</span>'
        + (it[2] ? '<span class="text-ink-mute" style="font-size:11px">' + it[2] + '</span>' : '') + '</button>'; }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-sy]'), function (b2) {
      b2.addEventListener('click', function () { items[+this.getAttribute('data-sy')][3](); box.style.display = 'none'; }); });
    box.style.display = 'block';
    box.style.left = Math.min(ev.clientX, window.innerWidth - box.offsetWidth - 8) + 'px';
    box.style.top = Math.min(ev.clientY, window.innerHeight - box.offsetHeight - 8) + 'px';
  }
  function initSymbolMenu() {
    var ro = document.getElementById('lw-readout');
    if (ro) ro.addEventListener('contextmenu', symbolMenu);
    // a dots button next to the readout, so nobody has to guess the right click
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'cp-symbtn'; btn.title = 'Everything you can do with this name';
    btn.textContent = '\u22EF';
    btn.style.cssText = 'position:absolute;z-index:7;padding:0 5px;border-radius:4px;line-height:16px;'
      + 'font-size:12px;color:var(--mute,rgb(var(--pi-ink-mute)));background:transparent;pointer-events:auto';
    btn.addEventListener('click', function (ev) { symbolMenu(ev); });
    H.el.appendChild(btn);
    function place() {
      var r = document.getElementById('lw-readout');
      if (!r) { btn.style.display = 'none'; return; }
      btn.style.display = r.style.display === 'none' ? 'none' : '';
      btn.style.left = Math.round(r.offsetLeft + r.offsetWidth + 4) + 'px';
      btn.style.top = Math.round(r.offsetTop + 2) + 'px';
    }
    place();
    try {
      if (window.ResizeObserver && ro) {
        var symRoPending = false;
        new ResizeObserver(function () {
          if (symRoPending) return;
          symRoPending = true;
          requestAnimationFrame(function () { symRoPending = false; place(); });
        }).observe(ro);
      }
    } catch (e) {}
    setInterval(place, 1200);
  }

  var TF_ORDER = ['1D', '1W', '1M'], TF_NAMES = { '1D': 'Daily', '1W': 'Weekly', '1M': 'Monthly' };
  function setStudyTfs(k, keep) {
    var sc = scOf(k); sc.tfs = {};
    TF_ORDER.forEach(function (t) { if (keep.indexOf(t) < 0) sc.tfs[t] = false; });
    saveState(); drawStudy(k); fitHeight();
  }
  // the study sits on the price or in its own pane; this moves it between the two
  function studyToPane(k, own) {
    var d = defOf(k); if (!d) return;
    scOf(k).ownPane = !!own; saveState();
    studyState[k] = false; drawStudy(k); studyState[k] = true; drawStudy(k); fitHeight();
  }
  function studyMenu(ev, k) {
    if (!defOf(k)) return;
    ev.preventDefault(); ev.stopPropagation();
    var sc = scOf(k), pane = studyPane[k] != null, side = sc.scale === 'left' ? 'left' : 'right', cur = H.tf();
    var ci = TF_ORDER.indexOf(cur); if (ci < 0) ci = 0;
    var ps = []; try { ps = chart.panes(); } catch (e) {}
    var items = [
      { l: 'Alert on ' + defOf(k).label, i: 'alert', k: tvKeys() ? keyDisp('Alt+KeyA') : 'Alt+A', f: function () { studyAlert(k); } },
      { l: 'Add an indicator on this chart…', i: 'ind', k: '/', f: function () { openIndicators(); } },
      { l: (favs().indexOf('i:' + baseKey(k)) >= 0 ? 'Remove from favourites' : 'Add to favourites'), f: function () { toggleFav('i:' + baseKey(k)); } },
      null,
      { l: 'Interval visibility', i: 'interval', sub: [
        { l: 'Current interval and above (' + TF_NAMES[cur] + ' and up)', f: function () { setStudyTfs(k, TF_ORDER.slice(ci)); } },
        { l: 'Current interval and below', f: function () { setStudyTfs(k, TF_ORDER.slice(0, ci + 1)); } },
        { l: 'Current interval only', f: function () { setStudyTfs(k, [cur]); } },
        { l: 'All intervals', f: function () { setStudyTfs(k, TF_ORDER.slice()); } },
        null,
        { l: 'Pick them one by one…', f: function () { openStudySettings(k); setTab = 'vis'; renderSet(); } }
      ] },
      { l: 'Move to', i: 'layers', sub: pane ? [
        { l: 'Pane above', dim: studyPane[k] <= 1 || (studyPane[k] === 2 && !!window.__piVolPane), f: function () { moveStudy(k, -1); } },
        { l: 'Pane below', dim: studyPane[k] >= ps.length - 1, f: function () { moveStudy(k, 1); } },
        { l: 'On the price', f: function () { studyToPane(k, false); } }
      ] : [
        { l: 'Its own pane below', f: function () { studyToPane(k, true); } }
      ] },
      { l: 'Visual order', i: 'layers', sub: [
        { l: 'Bring to front', f: function () { drawStudy(k); paintPick(); } },
        { l: 'Send to back', f: function () { liveKeys().forEach(function (x) { if (x !== k && (studyPane[x] || null) === (studyPane[k] || null)) drawStudy(x); }); paintPick(); } }
      ] },
      { l: 'Pin to scale', i: 'goto', sub: [
        { l: 'Right scale' + (side === 'right' ? ' ✓' : ''), f: function () { pinStudy(k, 'right'); } },
        { l: 'Left scale' + (side === 'left' ? ' ✓' : ''), f: function () { pinStudy(k, 'left'); } }
      ] }
    ];
    if (pane) items.push({ l: paneMax === studyPane[k] ? 'Share the height again' : 'Full height', i: 'full', f: function () { maximizePane(studyPane[k]); } });
    items.push(null,
      { l: 'About this study', i: 'facts', f: function () { openStudySettings(k); setTab = 'inputs'; renderSet(); } },
      null,
      { l: 'Duplicate', i: 'cmp', f: function () { duplicateStudy(k); } },
      { l: sc.hidden ? 'Show' : 'Hide', i: 'eye', f: function () { hideStudy(k, !sc.hidden); } },
      { l: 'Remove', i: 'x', k: 'Delete', f: function () { studyState[k] = false; drawStudy(k); if (baseKey(k) !== k) delete studyState[k];
          var cb = document.getElementById('cp-s-' + k); if (cb) cb.checked = false; fitHeight(); saveState(); } },
      null,
      { l: 'Objects on this chart', i: 'list', f: function () { try { toggleObjs(); } catch (e) {} } },
      { l: 'Settings…', i: 'gear', f: function () { openStudySettings(k); } });
    var old = document.getElementById('cp-studymenu'); if (old) old.style.display = 'none';
    showCtx(ev, items);
  }
  // the legend rows live in the shell, so the menu is offered on the document
  function initStudyMenu() {
    document.addEventListener('contextmenu', function (ev) {
      var row = ev.target && ev.target.closest && ev.target.closest('[data-row]');
      if (row) { var rk = row.getAttribute('data-row'); if (rk.indexOf('ln:') === 0 || rk.indexOf('cmp:') === 0) return; studyMenu(ev, rk); return; }
      // inside the chart: which pane did the click land in?
      if (!(ev.target && ev.target.closest && ev.target.closest('#lwchart'))) return;
      var bb = H.el.getBoundingClientRect(), y = ev.clientY - bb.top, acc = 0, hit = -1;
      try { chart.panes().forEach(function (p2, i) { var h = p2.getHeight(); if (y >= acc && y < acc + h) hit = i; acc += h; }); } catch (e) {}
      if (hit < 1) return;   // the price pane keeps the chart's own menu
      var k = Object.keys(studyPane).filter(function (x) { return studyPane[x] === hit && studyState[x]; })[0];
      if (k) { studyMenu(ev, k); return; }
      if (hit === 1 && window.__piVolPane) { ev.preventDefault(); ev.stopPropagation(); volMenu(ev); }
    }, true);
  }

  function ctxCss() {
    if (document.getElementById('cp-ctx-css')) return;
    var st = document.createElement('style'); st.id = 'cp-ctx-css';
    st.textContent = '#cp-ctx{position:fixed;z-index:90;min-width:17rem;padding:4px;background:rgb(var(--pi-card));border:1px solid rgb(var(--pi-border));border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.16);font:13px/1.3 -apple-system,"Inter","Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:rgb(var(--pi-ink))}'
      + '#cp-ctx .ci{display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;border:0;background:transparent;border-radius:6px;text-align:left;font:inherit;font-weight:400;color:inherit;cursor:pointer;white-space:nowrap} #cp-ctx .ci:hover{background:rgb(var(--pi-ink) / .06)}'
      + '#cp-ctx .ic{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;color:rgb(var(--pi-ink-mute));flex:none} #cp-ctx .ic svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}'
      + '#cp-ctx .lb{flex:1;font-weight:400} #cp-ctx .ks{color:rgb(var(--pi-ink-mute));font-size:11.5px;margin-left:14px;font-variant-numeric:tabular-nums} #cp-ctx .sp{height:1px;background:rgb(var(--pi-border));margin:4px 6px}'
      + '#cp-ctx .ci{position:relative} #cp-ctx .ar{color:rgb(var(--pi-ink-mute));margin-left:10px;font-size:15px;line-height:1} #cp-ctx .ci.dim{color:#9598a1;cursor:default}'
      + '#cp-ctx .sub{display:none;position:absolute;left:calc(100% - 4px);top:-5px;min-width:14rem;padding:4px;background:rgb(var(--pi-card));border:1px solid rgb(var(--pi-border));border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.16);z-index:2} #cp-ctx .ci.has:hover > .sub{display:block} #cp-ctx .sub.flip{left:auto;right:calc(100% - 4px)} html.dark #cp-ctx .sub{background:rgb(var(--pi-card));border-color:rgb(var(--pi-border))}'
      + 'html.dark #cp-ctx{background:rgb(var(--pi-card));border-color:rgb(var(--pi-border));color:rgb(var(--pi-ink))} html.dark #cp-ctx .ci:hover{background:rgb(var(--pi-ink) / .08)} html.dark #cp-ctx .sp{background:rgb(var(--pi-border))}';
    document.head.appendChild(st);
  }
  function showCtx(ev, items) {
    items = (items || []).filter(function (x) { return x !== false; });   // an entry a dark flag leaves out
    ctxCss();
    var I = window.piShellIcons || {};
    if (!ctxBox) { ctxBox = document.createElement('div'); ctxBox.id = 'cp-ctx'; document.body.appendChild(ctxBox); }
    var acts = [];
    function rows(list) {
      return list.map(function (it) {
        if (!it) return '<div class="sp"></div>';
        acts.push(it.f || null);
        var n = acts.length - 1;
        var sub = it.sub ? '<span class="ar">\u203A</span><div class="sub">' + rows(it.sub) + '</div>' : '';
        return '<div class="ci' + (it.sub ? ' has' : '') + (it.dim ? ' dim' : '') + '" data-ci="' + n + '"><span class="ic">' + (it.i && I[it.i] ? I[it.i] : '') + '</span><span class="lb">' + it.l + '</span>' + (it.k ? '<span class="ks">' + it.k + '</span>' : '') + sub + '</div>';
      }).join('');
    }
    ctxBox.innerHTML = rows(items);
    Array.prototype.forEach.call(ctxBox.querySelectorAll('[data-ci]'), function (b) {
      b.addEventListener('click', function (ev2) { ev2.stopPropagation(); var f = acts[+this.getAttribute('data-ci')]; if (!f) return; hideCtx(); try { f(); } catch (e) {} }); });
    ctxBox.style.display = '';
    var w = ctxBox.offsetWidth || 280, h = ctxBox.offsetHeight || 300;
    var x = Math.max(4, Math.min(ev.clientX, window.innerWidth - w - 8)), y = Math.max(4, Math.min(ev.clientY, window.innerHeight - h - 8));
    ctxBox.style.left = x + 'px'; ctxBox.style.top = y + 'px';
    // a submenu opens to the right, or to the left when the screen ends there
    Array.prototype.forEach.call(ctxBox.querySelectorAll('.ci.has'), function (row) {
      row.addEventListener('mouseenter', function () { var sb = row.querySelector('.sub'); if (!sb) return; sb.classList.remove('flip');
        var r = row.getBoundingClientRect(); if (r.right + 240 > window.innerWidth) sb.classList.add('flip');
        var sr = sb.getBoundingClientRect(); if (r.top + sr.height > window.innerHeight - 8) sb.style.top = (window.innerHeight - 8 - sr.height - r.top) + 'px'; else sb.style.top = ''; });
    });
  }
  function volMenu(ev) {
    function sz(v) { return { l: 'Pane height: ' + v, f: function () { LOOK.volSize = v; applyLook(); } }; }
    showCtx(ev, [
      { l: 'Volume settings\u2026', i: 'gear', f: function () { openSettingsDialog('volume'); } },
      null,
      sz('small'), sz('normal'), sz('large'),
      null,
      { l: 'Hide the volume', i: 'eye', f: function () { LOOK.vol = false; applyLook(); } },
      { l: 'Add an indicator\u2026', i: 'ind', k: '/', f: function () { openIndicators(); } }
    ]);
  }
  function symbolInfo(ev) {
    var old = document.getElementById('cp-syminfo'); if (old) old.remove();
    var facts = document.querySelector('#ws-dock [data-pane="facts"] dl');
    var sym = document.getElementById('tv-sym'), title = sym ? sym.textContent.replace(/\s+/g, ' ').trim() : ((document.getElementById('chart-snap') || {}).dataset || {}).ticker || '';
    var box = document.createElement('div'); box.id = 'cp-syminfo';
    box.style.cssText = 'position:fixed;z-index:92;width:19rem;background:rgb(var(--pi-card));border:1px solid rgb(var(--pi-border));border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:12px 14px;font:13px/1.5 -apple-system,"Inter","Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:rgb(var(--pi-ink))';
    if (document.documentElement.classList.contains('dark')) box.style.cssText += ';background:rgb(var(--pi-card));border-color:rgb(var(--pi-border));color:rgb(var(--pi-ink))';
    box.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><b style="font-size:14px;flex:1">' + title + '</b><button type="button" data-x style="border:0;background:transparent;color:rgb(var(--pi-ink-mute));cursor:pointer;font-size:16px">\u2715</button></div>'
      + (facts ? '<dl style="display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-variant-numeric:tabular-nums">' + facts.innerHTML + '</dl>' : '<p style="color:rgb(var(--pi-ink-mute))">Nothing more on this name yet.</p>')
      + '<div style="margin-top:8px;display:flex;gap:10px"><a href="/name/' + encodeURIComponent(((document.getElementById('chart-snap') || {}).dataset || {}).ticker || '') + '" style="color:rgb(var(--pi-accent))">Full page \u2192</a><button type="button" data-dock style="border:0;background:transparent;color:rgb(var(--pi-accent));cursor:pointer;font:inherit">Key facts panel</button></div>';
    document.body.appendChild(box);
    box.style.left = Math.max(4, Math.min(ev.clientX, window.innerWidth - box.offsetWidth - 8)) + 'px';
    box.style.top = Math.max(4, Math.min(ev.clientY, window.innerHeight - box.offsetHeight - 8)) + 'px';
    Array.prototype.forEach.call(box.querySelectorAll('dd'), function (d) { d.style.textAlign = 'right'; d.style.fontWeight = '600'; });
    Array.prototype.forEach.call(box.querySelectorAll('dt'), function (d) { d.style.color = 'rgb(var(--pi-ink-mute))'; });
    box.querySelector('[data-x]').addEventListener('click', function () { box.remove(); });
    box.querySelector('[data-dock]').addEventListener('click', function () { box.remove(); dockTo('facts'); });
    setTimeout(function () { document.addEventListener('mousedown', function h(e2) { if (!box.contains(e2.target)) { box.remove(); document.removeEventListener('mousedown', h, true); } }, true); }, 0);
  }
  var lastCross = null;
  function initContextMenu() {
    try { chart.subscribeCrosshairMove(function (p) { if (p && p.point) { var pr = null; try { pr = H.cs.coordinateToPrice(p.point.y); } catch (e) {} lastCross = { time: p.time, price: pr }; } }); } catch (e) {}
    // the crosshair follows the mouse and leaves with it, the way a terminal's does
    H.el.addEventListener('mouseleave', function () { try { chart.clearCrosshairPosition(); } catch (e) {} });
    if (window.__piLongPress) {
      var lpT = null, lp0 = null, lpOff = function () { if (lpT) { clearTimeout(lpT); lpT = null; } };
      H.el.addEventListener('touchstart', function (ev) {
        lpOff(); if (ev.touches.length !== 1 || activeTool) return;
        var t = ev.touches[0], tg = ev.target; lp0 = { x: t.clientX, y: t.clientY };
        lpT = setTimeout(function () { lpT = null;
          if (dragging && dragging.moved) return;
          if (dragging) { dragging = null; try { chart.applyOptions({ handleScroll: true, handleScale: true }); } catch (e) {} }
          try { tg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: lp0.x, clientY: lp0.y })); } catch (e) {} }, 550);
      }, { passive: true });
      H.el.addEventListener('touchmove', function (ev) { var t = ev.touches[0]; if (lp0 && t && (Math.abs(t.clientX - lp0.x) > 10 || Math.abs(t.clientY - lp0.y) > 10)) lpOff(); }, { passive: true });
      H.el.addEventListener('touchend', lpOff); H.el.addEventListener('touchcancel', lpOff);
    }
    H.el.addEventListener('contextmenu', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('#cp-rail,#cp-style,#cp-objs,#cp-keys,#cp-ctx')) return;
      ev.preventDefault();
      var pt = pointAt(ev); if (!pt) return;
      var bb = H.el.getBoundingClientRect();
      // a study under the cursor, or the one you picked, gets its own menu, even on the price pane
      var sk = null; try { sk = studyHit(ev) || (pickedStudy && pickedStudy !== 'volume' && defOf(pickedStudy) ? pickedStudy : null); } catch (e) {}
      if (sk) { if (pickedStudy !== sk) { pickedStudy = sk; paintPick(); } studyMenu(ev, sk); return; }
      var c = bars(), idx = -1; for (var i = 0; i < c.length; i++) if (c[i].time === pt.time) idx = i;
      var tk = ((document.getElementById('chart-snap') || {}).dataset || {}).ticker || '';
      var mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
      // on a drawing: the drawing's own menu
      var hit = null; try { hit = DM && DM.hitTest && DM.hitTest({ x: ev.clientX - bb.left, y: ev.clientY - bb.top }); } catch (e) {}
      var d = null; if (hit) { try { DM.selectDrawing(hit.id || hit); d = selected(); } catch (e) {} }
      if (d) {
        showCtx(ev, [
          { l: 'Settings…', i: 'gear', f: function () { showStyle(d); } },
          { l: 'Clone', i: 'cmp', k: mod + 'D', f: function () { duplicateDrawing(d); } },
          { l: 'Copy', k: mod + 'C', f: function () { copyDrawing(d); } },
          null,
          { l: d._locked ? 'Unlock' : 'Lock', i: 'layers', f: function () { d._locked = !d._locked; saveDrawings(); } },
          { l: 'Hide', i: 'eye', f: function () { d._hidden = true; detach(d); saveDrawings(); } },
          null,
          { l: 'Remove', i: 'x', k: 'Delete', f: function () { if (d._locked) return; detach(d); try { DM.removeDrawing(d.id); } catch (e) {} saveDrawings(); hideStyle(); } }
        ]);
        return;
      }
      showCtx(ev, [
        { l: 'Alert at ' + pt.price.toFixed(2), i: 'alert', k: 'Alt+A', f: function () { armAlert(pt.price); } },
        { l: 'Horizontal line here', i: 'horiz', k: tvKeys() ? keyDisp('Alt+KeyH') : 'Alt+H', f: function () { try { var reg = window.LightweightChartsDrawing.getToolRegistry();
            var d2 = reg.createDrawing('horizontal-line', 'c' + Date.now(), [{ time: pt.time, price: pt.price }], {}); if (d2) { DM.addDrawing(d2); attach(d2); undoStack.push(d2.id); saveDrawings(); } } catch (e) {} } },
        { l: 'Add an indicator…', i: 'ind', k: '/', f: function () { openIndicators(); } },
        { l: 'Measure from here', i: 'ruler', k: tvKeys() ? keyDisp('Shift') + 'drag' : 'Alt+Shift+M', f: function () { setTool('measure'); } },
        null,
        { l: 'Symbol info', i: 'facts', f: function () { symbolInfo(ev); } },
        { l: 'Add a note on ' + tk, i: 'note', f: function () { dockTo('note'); } },
        { l: 'Replay from ' + pt.time, i: 'replay', f: function () { if (idx >= 20) startReplayAt(idx); else { hint('Pick a later bar to replay from'); setTimeout(function () { hint(''); }, 1500); } } },
        null,
        { l: 'Copy the price ' + pt.price.toFixed(2), f: function () { try { navigator.clipboard.writeText(pt.price.toFixed(2)); } catch (e) {} } },
        { l: 'Paste the copied drawing', k: mod + 'V', f: function () { pasteDrawing(); } },
        { l: 'Share a snapshot (public link)', i: 'camera', f: function () { shareSnapshot(); } },
        null,
        { l: 'Reset the view', i: 'full', f: function () { try { chart.timeScale().fitContent(); } catch (e) {} } },
        { l: _hiddenLayer ? 'Show the drawings' : 'Hide the drawings', i: 'eye', f: function () { drawLayerVisible(_hiddenLayer); } },
        { l: 'Lock every drawing', i: 'layers', f: function () { try { DM.getAllDrawings().forEach(function (x) { x._locked = true; }); } catch (e) {} saveDrawings(); } },
        { l: 'Unlock every drawing', f: function () { try { DM.getAllDrawings().forEach(function (x) { x._locked = false; }); } catch (e) {} saveDrawings(); } },
        { l: 'Objects list', i: 'list', f: function () { toggleObjs(); } },
        tvTools() ? { l: allStudiesHidden() ? 'Show every indicator' : 'Hide every indicator', i: 'eye', f: function () { hideEveryStudy(!allStudiesHidden()); } } : false,
        tvTools() ? { l: dwOn ? 'Close the data window' : 'Data window', i: 'list', k: tvKeys() ? keyDisp('Alt+KeyD') : 'Alt+Shift+D', f: function () { toggleDataWindow(); } } : false,
        null,
        { l: 'Add ' + tk + ' to my watchlist', i: 'board', f: function () { postForm('/watch', [['ticker', tk], ['back', location.pathname]]); } },
        { l: 'Settings…', i: 'gear', f: function () { openSettingsDialog(); } }
      ]);
    });
    document.addEventListener('mousedown', function (ev) { if (ctxBox && !(ev.target && ev.target.closest && ev.target.closest('#cp-ctx'))) hideCtx(); }, true);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { hideCtx(); if (keysBox) keysBox.style.display = 'none'; } });
  }
  // a snapshot anyone can open: the PNG goes to our side, the link comes back
  function shareSnapshot() {
    var tk = ((document.getElementById('chart-snap') || {}).dataset || {}).ticker; if (!tk) return;
    var png; try { png = chart.takeScreenshot().toDataURL('image/png'); } catch (e) { return; }
    hint('Making the link\u2026');
    fetch('/snap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: tk, png: png }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok) { hint('Could not make the link'); setTimeout(function () { hint(''); }, 2000); return; }
        try { navigator.clipboard.writeText(j.url); } catch (e) {}
        hint('Link copied: ' + j.url); setTimeout(function () { hint(''); }, 6000);
        try { window.__lastSnap = j.url; } catch (e) {}
      }).catch(function () { hint('Could not make the link'); setTimeout(function () { hint(''); }, 2000); });
  }
  var HOTKEYS = [['Alt+H', 'Horizontal line at the cursor'], ['A-Z', 'Any letter opens the name search, Enter opens it'], ['Alt+T', 'Trend line'], ['Alt+V', 'Vertical line'], ['Alt+Shift+F', 'Fibonacci'],
                 ['Alt+R', 'Reset the view'], ['Alt+Shift+M', 'Measure'], ['Alt+Shift+D', 'Data window'], ['Alt+G', 'Go to a date'], ['Alt+A', 'Alert at the cursor price'], ['Alt+I', 'Indicators'], ['Alt+D W M', 'Daily, weekly, monthly'],
                 ['Alt+L', 'Log scale'], ['Alt+F', 'Full screen'], ['Shift', 'Magnet for one click'], ['\u2191 \u2193', 'Previous / next name on your watchlist'],
                 ['Space', 'Next name on the board you came from (Shift: previous)'], ['\u21e7\u2318Z', 'Redo'], ['?', 'This sheet'],
                 ['\u2318C \u2318V \u2318D', 'Copy, paste, duplicate the selected drawing'], ['\u2318Z', 'Undo the last drawing'], ['Esc', 'Drop the tool'], ['Delete', 'Remove the selected drawing'], ['/', 'Command palette']];
  // ── chart_fixes2: the keys TradingView users reach for ──
  // Alt+H puts a horizontal line at the cursor price (the last close when the mouse is off the chart)
  function hlineNow() {
    if (!DM) return;
    try {
      var c = bars(); if (!c.length) return;
      var hov = false; try { hov = H.el.matches(':hover'); } catch (e) {}
      var pr = hov && lastCross && lastCross.price > 0 ? lastCross.price : c[c.length - 1].close;
      var tm = hov && lastCross && lastCross.time ? lastCross.time : c[c.length - 1].time;
      var dflt = toolDefaults()['horizontal-line'] || {};
      var d = window.LightweightChartsDrawing.getToolRegistry().createDrawing('horizontal-line', 'h' + Date.now(),
        [{ time: nearestBarTime(tm), price: Math.round(pr * 100) / 100 }], dflt);
      if (d) { if (Object.keys(dflt).length) d._style = JSON.parse(JSON.stringify(dflt));
        DM.addDrawing(d); attach(d); undoStack.push(d.id); saveDrawings(); try { DM.selectDrawing(d.id); showStyle(d); } catch (e) {} }
    } catch (e) {}
  }
  // Esc: drop the tool (initDrawings does it), and close what is open on the chart
  function escapeAll() {
    closeSym(); closeInt(); hideCtx(); if (keysBox) keysBox.style.display = 'none';
    try { if (!activeTool) { DM.deselectAll(); hideStyle(); } } catch (e) {}
    if (pickedStudy) { pickedStudy = null; try { paintPick(); } catch (e) {} }
    Array.prototype.forEach.call(document.querySelectorAll('details[open].menu, #layer-menu[open], #ma-menu[open]'), function (d) { d.removeAttribute('open'); });
  }
  // Type a name, Enter opens it: suggestions come from the header's own /search/suggest
  var symBox = null, symIn = null, symList = null, symRows = [], symRowsQ = '', symSel = -1, symSeq = 0, symT = null;
  function closeSym() { if (symBox) symBox.style.display = 'none'; symRows = []; symSel = -1; }
  function symGo(t) { t = String(t || '').trim(); if (!t) return; closeSym(); location.href = piNav('/chart/' + encodeURIComponent(t.toUpperCase().replace(/\s+/g, ' '))); }
  function symPaint() {
    symList.innerHTML = symRows.map(function (r, i) {
      return '<div data-i="' + i + '" style="display:flex;gap:8px;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:.75rem;'
        + (i === symSel ? 'background:rgb(var(--pi-accent) / .12)' : '') + '"><b style="min-width:3.2rem">' + r.t + '</b><span style="color:rgb(var(--pi-ink-mute));overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (r.co || '') + '</span></div>';
    }).join('');
  }
  function symAsk() {
    var q = symIn.value.trim(); clearTimeout(symT);
    if (!q) { symRows = []; symPaint(); return; }
    symT = setTimeout(function () {
      var my = ++symSeq, mine = q;
      fetch('/search/suggest?q=' + encodeURIComponent(q) + '&limit=8', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
        if (my !== symSeq) return;
        symRows = (rows || []).filter(function (x) { return x.ticker; }).map(function (x) { return { t: x.kind === 'crypto' && x.id ? x.id : x.ticker, co: x.company || x.name || '' }; });
        symRowsQ = mine; symSel = symRows.length ? 0 : -1; symPaint();
      }).catch(function () {});
    }, 110);
  }
  function openSym(seed) {
    if (!symBox) {
      symBox = document.createElement('div'); symBox.id = 'cp-sym';
      symBox.style.cssText = 'position:absolute;left:50%;top:48px;transform:translateX(-50%);z-index:12;width:min(21rem,calc(100% - 16px));padding:6px;'
        + 'background:rgb(var(--pi-card));border:1px solid rgb(var(--pi-border));border-radius:10px;box-shadow:0 8px 24px rgb(var(--pi-ink) / .16)';
      symBox.innerHTML = '<input id="cp-sym-in" type="text" autocomplete="off" spellcheck="false" maxlength="40" placeholder="Name or ticker, Enter to open" '
        + 'style="width:100%;padding:5px 8px;font-size:.8rem;border:1px solid rgb(var(--pi-border));border-radius:8px;background:transparent;color:rgb(var(--pi-ink));outline:none"><div id="cp-sym-list" style="margin-top:4px"></div>';
      H.el.appendChild(symBox);
      symIn = symBox.querySelector('#cp-sym-in'); symList = symBox.querySelector('#cp-sym-list');
      symIn.addEventListener('input', symAsk);
      symIn.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); closeSym(); return; }
        if (e.key === 'Enter') { e.preventDefault(); var typed = symIn.value.trim(); symGo(symRows[symSel] && symRowsQ === typed ? symRows[symSel].t : typed); return; }   // rows of an older query never win over what is typed
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (symRows.length) { symRowsQ = symIn.value.trim(); symSel = (symSel + (e.key === 'ArrowDown' ? 1 : -1) + symRows.length) % symRows.length; symPaint(); } }
      });
      symIn.addEventListener('blur', function () { setTimeout(closeSym, 160); });
      symList.addEventListener('mousedown', function (e) { var r = e.target.closest && e.target.closest('[data-i]'); if (r && symRows[+r.getAttribute('data-i')]) { e.preventDefault(); symGo(symRows[+r.getAttribute('data-i')].t); } });
    }
    symBox.style.display = ''; symIn.value = seed || ''; symRows = []; symSel = -1; symPaint();
    symIn.focus(); try { symIn.setSelectionRange(symIn.value.length, symIn.value.length); } catch (e) {}
    symAsk();
  }
  // ── chart_tv_keys: TradingView's own keys, in one table. The sheet (?), the hover tips and the palette read it. ──
  // A row: c = the combo (Mod = Cmd or Ctrl; e.code after it, or ch:x for a typed character), l = what it does,
  // f = the action (return false to leave the key to the browser), hand = only while the chart has the hand,
  // tool = the rail tool the tip belongs to, el = the button ids the tip belongs to. A row with d is told, not bound.
  function tvKeys() { return !!window.__piTvKeys; }
  function typingIn(e) {
    var t = e && e.target, a = document.activeElement, re = /^(INPUT|TEXTAREA|SELECT)$/;
    return !!((t && (re.test(t.tagName || '') || t.isContentEditable)) || (a && (re.test(a.tagName || '') || a.isContentEditable)));
  }
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
  var KEY_NAMES = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Slash: '/' };
  function keyDisp(c) {   // 'Mod+Alt+KeyH' reads ⌘⌥H on a Mac, Ctrl+Alt+H elsewhere
    var p = c.split('+'), last = p.pop();
    if ({ Mod: 1, Alt: 1, Shift: 1 }[last]) { p.push(last); last = ''; }
    last = KEY_NAMES[last] || last.replace(/^ch:/, '').replace(/^Key|^Digit/, '');
    var m = p.map(function (x) { return (IS_MAC ? { Mod: '⌘', Alt: '⌥', Shift: '⇧' } : { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift' })[x]; });
    return IS_MAC ? m.join('') + last : m.concat([last]).join('+');
  }
  function flash(m, ms) { hint(m); setTimeout(function () { if (hintEl && hintEl.textContent === m) hint(''); }, ms || 1800); }   // never wipes a later message
  function tsScroll(n) { try { var ts = chart.timeScale(); ts.scrollToPosition(ts.scrollPosition() + n, false); } catch (e) {} }
  function tsPage(dir) { try { var r = chart.timeScale().getVisibleLogicalRange(); if (r) tsScroll(dir * Math.max(5, Math.round((r.to - r.from) / 2))); } catch (e) {} }
  function tsZoom(k) {   // the right edge stays where it is, like the wheel on the last bar
    try { var ts = chart.timeScale(), r = ts.getVisibleLogicalRange(); if (!r) return;
      var w = (r.to - r.from) * k; if (w < 8) return;
      ts.setVisibleLogicalRange({ from: r.to - w, to: r.to }); } catch (e) {}
  }
  function copyImage() {
    try { chart.takeScreenshot().toBlob(function (b) {
      if (!b || !window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) { flash('This browser cannot copy an image', 2400); return; }
      navigator.clipboard.write([new window.ClipboardItem({ 'image/png': b })]).then(function () { flash('Chart image copied'); }, function () { flash('Could not copy the image', 2400); });
    }, 'image/png'); } catch (e) { flash('Could not copy the image', 2400); }
  }
  function clickEl(id) { var b = document.getElementById(id); if (!b) return false; b.click(); }
  function tkNow() { return ((document.getElementById('chart-snap') || {}).dataset || {}).ticker || ''; }
  function gotoAsk() {
    if (!window.__piGotoBox) { var d2 = window.prompt('Go to a date (YYYY-MM-DD)'); if (d2) gotoDate(d2); return; }
    var c = H.candles(); if (!c.length) return;
    if (!gotoUi) gotoUi = miniBox('cp-gotobox', 'id="cp-goto-in" type="date" aria-label="Go to a date"', 'Go to a date, then Enter', function (v) { if (v) gotoDate(v); });
    gotoUi.inp.min = String(c[0].time).slice(0, 10); gotoUi.inp.max = String(c[c.length - 1].time).slice(0, 10);
    gotoUi.open('');
  }
  function alertNow() { var lp = lastCross && lastCross.price; if (lp > 0) armAlert(Math.round(lp * 100) / 100); else { var c2 = bars(); if (c2.length) armAlert(c2[c2.length - 1].close); } }
  // Type an interval the way TradingView takes it: 1D, 1W, 1M, then ours (2D 3D 2W 3M 6M 12M), minutes where the name has them
  // one small box over the chart: a field, a line of help, Enter runs it, Esc or a click elsewhere closes it
  function miniBox(id, attrs, note, onEnter) {
    var box = document.createElement('div'); box.id = id;
    box.style.cssText = 'position:absolute;left:50%;top:48px;transform:translateX(-50%);z-index:12;width:min(17rem,calc(100% - 16px));padding:6px;display:none;'
      + 'background:rgb(var(--pi-card));border:1px solid rgb(var(--pi-border));border-radius:10px;box-shadow:0 8px 24px rgb(var(--pi-ink) / .16)';
    box.innerHTML = '<input ' + attrs + ' autocomplete="off" spellcheck="false" '
      + 'style="width:100%;padding:5px 8px;font-size:.8rem;border:1px solid rgb(var(--pi-border));border-radius:8px;background:transparent;color:rgb(var(--pi-ink));outline:none">'
      + '<div style="margin-top:4px;padding:0 2px;font-size:.7rem;color:rgb(var(--pi-ink-mute))">' + note + '</div>';
    H.el.appendChild(box); var inp = box.querySelector('input');
    var ui = { box: box, inp: inp, close: function () { box.style.display = 'none'; },
      open: function (seed) { box.style.display = ''; inp.value = seed || ''; inp.focus(); try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {} } };
    inp.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); ui.close(); return; }
      if (e.key === 'Enter') { e.preventDefault(); var v = inp.value; ui.close(); onEnter(v); }
    });
    inp.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== inp) ui.close(); }, 160); });   // a late blur from the last use must not close the box just reopened
    return ui;
  }
  var intUi = null, gotoUi = null;
  function closeInt() { if (intUi) intUi.close(); if (gotoUi) gotoUi.close(); }
  function intGo(s) {
    s = String(s || '').toUpperCase().replace(/\s+/g, ''); if (!s) return false;
    var base = { D: 'tf-d', '1D': 'tf-d', W: 'tf-w', '1W': 'tf-w', M: 'tf-m', '1M': 'tf-m' }[s];
    if (base) { if (interval !== 'D' || intraTf) setInterval2('D'); clickEl(base); return true; }
    var k = { '3M': 'Q', Q: 'Q', '1Q': 'Q', '1Y': '12M', Y: '12M' }[s] || s;
    if (k !== 'D' && INTERVALS.some(function (x) { return x[0] === k; })) { setInterval2(k); return true; }
    var im = { '1': '1min', '5': '5min', '15': '15min', '60': '1H', '1H': '1H', '240': '4H', '4H': '4H' }[s];
    if (im) { if (intraHave().indexOf(im) >= 0) setIntraday(im); else flash('No intraday bars on this name', 2200); return true; }
    return false;
  }
  function openInt(seed) {
    if (!intUi) intUi = miniBox('cp-intbox', 'id="cp-int-in" type="text" maxlength="6" aria-label="Interval"', 'Interval, then Enter: 1D 1W 1M 2D 3D 2W 3M 6M 12M',
      function (v) { if (!intGo(v)) flash('No such interval: ' + v.slice(0, 6), 2200); });
    intUi.open(seed);
  }
  var hiloEls = null, hiloRaf = 0;
  function hiloSoon() { if (!window.__piHiLo || hiloRaf) return; hiloRaf = requestAnimationFrame(drawHiLo); }
  function drawHiLo() {
    hiloRaf = 0; if (!window.__piHiLo) return;
    if (!hiloEls) hiloEls = [0, 1].map(function () { var e = document.createElement('div'); e.className = 'cp-hilo';
      e.style.cssText = 'position:absolute;z-index:3;pointer-events:none;font-size:.7rem;line-height:1;white-space:nowrap;transform:translateX(-50%);color:rgb(var(--pi-ink-mute));display:none';
      H.el.appendChild(e); return e; });
    var hide = function () { hiloEls[0].style.display = hiloEls[1].style.display = 'none'; };
    if (/renko|kagi|break|pnf|range/.test(mode)) { hide(); return; }   // rebuilt prices sit on their own times
    try {
      var r = chart.timeScale().getVisibleLogicalRange(), c = bars(); if (!r || c.length < 3) { hide(); return; }
      var a = Math.max(0, Math.ceil(r.from)), b = Math.min(c.length - 1, Math.floor(r.to)); if (b - a < 2) { hide(); return; }
      var hi = a, lo = a;
      for (var i = a; i <= b; i++) { if (c[i].high > c[hi].high) hi = i; if (c[i].low < c[lo].low) lo = i; }
      [[hiloEls[0], c[hi].time, c[hi].high, -13], [hiloEls[1], c[lo].time, c[lo].low, 4]].forEach(function (x) {
        var px = chart.timeScale().timeToCoordinate(x[1]), py = H.cs.priceToCoordinate(x[2]);
        if (px == null || py == null) { x[0].style.display = 'none'; return; }
        x[0].textContent = (+x[2]).toFixed(2); x[0].style.left = Math.max(22, px) + 'px'; x[0].style.top = (py + x[3]) + 'px'; x[0].style.display = '';
      });
    } catch (e) { hide(); }
  }
  function initHiLo() {
    if (!window.__piHiLo) return;
    try { chart.timeScale().subscribeVisibleLogicalRangeChange(hiloSoon); } catch (e) {}
    H.el.addEventListener('wheel', hiloSoon, { passive: true });
    H.el.addEventListener('mousemove', function (ev) { if (ev.buttons) hiloSoon(); });
    window.addEventListener('mouseup', hiloSoon); window.addEventListener('resize', hiloSoon);
    setTimeout(hiloSoon, 400);
  }
  function tool(t) { return function () { setTool(t); }; }
  var KEYMAP = [
    { h: 'Chart' },
    { c: 'ch:/', l: 'Indicators', f: function () { openIndicators(); }, el: ['tv-ind'] },
    { d: (IS_MAC ? '⌘' : 'Ctrl+') + 'J', l: 'Command palette' },
    { d: (IS_MAC ? '⌘' : 'Ctrl+') + 'K', l: 'Search the app' },
    { d: 'A-Z', l: 'Type a name, Enter opens its chart' },
    { d: '0-9', l: 'Type an interval, Enter sets it: 1D, 1W, 1M, 2W, 3M' },
    { c: 'ArrowLeft', l: 'One bar back', hand: 1, f: function () { tsScroll(-1); } },
    { c: 'ArrowRight', l: 'One bar forward', hand: 1, f: function () { tsScroll(1); } },
    { c: 'Mod+ArrowLeft', l: 'Half a screen back', hand: 1, f: function () { tsPage(-1); } },
    { c: 'Mod+ArrowRight', l: 'Half a screen forward', hand: 1, f: function () { tsPage(1); } },
    { c: 'Mod+ArrowUp', l: 'Zoom in', hand: 1, f: function () { tsZoom(0.8); } },
    { c: 'Mod+ArrowDown', l: 'Zoom out', hand: 1, f: function () { tsZoom(1.25); } },
    { c: 'Alt+Shift+ArrowRight', l: 'Back to the last bar', f: function () { try { chart.timeScale().scrollToRealTime(); } catch (e) {} } },
    { c: 'Alt+KeyG', l: 'Go to a date', f: gotoAsk, el: ['tv-goto', 'cp-goto'] },
    { c: 'Alt+KeyR', l: 'Reset the view', f: function () { try { chart.timeScale().fitContent(); } catch (e) {} } },
    { c: 'Alt+KeyL', l: 'Log scale', f: function () { return clickEl('tf-log'); }, el: ['tf-log', 'cp-scale-log'] },
    { c: 'Alt+KeyP', l: 'Percent scale', f: function () { setScale2(scaleName === 'percent' ? 'normal' : 'percent'); } },
    { c: 'Alt+KeyI', l: 'Flip the price axis', f: function () { invertScale(); } },
    { c: 'Alt+KeyD', l: 'Data window', f: function () { if (!tvTools()) return false; toggleDataWindow(); } },
    { c: 'Alt+Enter', l: 'Full screen', f: function () { return clickEl('tf-full'); }, el: ['tf-full'] },
    { c: 'Mod+KeyS', l: 'Save the chart', f: function () { if (clickEl('ws-save') === false) { try { pushSettings(); flash('Saved'); } catch (e) { return false; } } }, el: ['ws-save'] },
    { c: 'Alt+KeyS', l: 'Copy a public link to the chart image', f: function () { shareSnapshot(); } },
    { c: 'Mod+Alt+KeyS', l: 'Download the chart image', f: function () { return clickEl('chart-snap'); }, el: ['chart-snap'] },
    { c: 'Mod+Shift+KeyS', l: 'Copy the chart image', f: copyImage },
    { c: 'Mod+KeyZ', l: 'Undo the last drawing', hand: 1, f: function () { undoDrawing(); } },
    { c: 'Mod+KeyY', l: 'Redo', hand: 1, f: function () { redoDrawing(); } },
    { c: 'Mod+Shift+KeyZ', f: function () { redoDrawing(); }, hand: 1 },
    { c: 'ch:?', l: 'This sheet', f: function () { showKeys(); } },
    { c: 'Mod+Slash', f: function () { showKeys(); } },
    { h: 'Watchlist and alerts' },
    { c: 'ArrowDown', l: 'Next name on your watchlist', hand: 1, f: function () { (window.PI_WATCH_STEP || flipWatch)(1); } },
    { c: 'ArrowUp', l: 'Previous name on your watchlist', hand: 1, f: function () { (window.PI_WATCH_STEP || flipWatch)(-1); } },
    { c: 'Space', l: 'Next name on the board you came from', hand: 1, f: function () { flipBoard(1); } },
    { c: 'Shift+Space', l: 'Previous name on that board', hand: 1, f: function () { flipBoard(-1); } },
    { c: 'Alt+KeyW', l: 'Add this name to your watchlist', f: function () { var tk = tkNow(); if (!tk) return false; postForm('/watch', [['ticker', tk], ['back', location.pathname]]); } },
    { c: 'Alt+KeyA', l: 'Alert at the cursor price', f: alertNow },
    { h: 'Drawings' },
    { c: 'Alt+KeyT', l: 'Trend line', tool: 'trend-line', f: tool('trend-line') },
    { c: 'Alt+KeyH', l: 'Horizontal line at the cursor', tool: 'horizontal-line', f: function () { hlineNow(); } },
    { c: 'Alt+KeyJ', l: 'Horizontal ray', tool: 'horizontal-ray', f: tool('horizontal-ray') },
    { c: 'Alt+KeyV', l: 'Vertical line', tool: 'vertical-line', f: tool('vertical-line') },
    { c: 'Alt+KeyC', l: 'Cross line', tool: 'cross-line', f: tool('cross-line') },
    { c: 'Alt+KeyF', l: 'Fibonacci retracement', tool: 'fib-retracement', f: tool('fib-retracement') },
    { c: 'Alt+Shift+KeyR', l: 'Rectangle', tool: 'rectangle', f: tool('rectangle') },
    { c: 'Alt+KeyN', l: 'Text note', tool: 'text', f: tool('text') },
    { d: keyDisp('Shift') + (IS_MAC ? ' drag' : 'drag'), l: 'Measure a move', tool: 'measure' },
    { d: keyDisp('Mod').replace(/\+$/, '') + ' held', l: 'Magnet for one click' },
    { c: 'Mod+Alt+KeyH', l: 'Hide or show every drawing', f: function () { drawLayerVisible(_hiddenLayer); }, el: ['cp-rail-hide'] },
    { c: 'Mod+KeyC', l: 'Copy the selected drawing', hand: 1, f: function () { var s = selected(); if (!s) return false; copyDrawing(s); } },
    { c: 'Mod+KeyV', l: 'Paste it, on any name', hand: 1, f: function () { pasteDrawing(); } },
    { c: 'Mod+KeyD', l: 'Duplicate the selected drawing', hand: 1, f: function () { var s = selected(); if (!s) return false; duplicateDrawing(s); } },
    { d: 'Delete', l: 'Remove the selected drawing' },
    { d: 'Esc', l: 'Drop the tool, close what is open' },
    { h: 'Replay' },
    { c: 'Shift+ArrowDown', l: 'Start the replay, then play or pause', hand: 1, f: function () { if (replay) playPause(); else startReplay(); }, el: ['cp-replay'] },
    { c: 'Shift+ArrowRight', l: 'One bar forward in the replay', hand: 1, f: function () { if (!replay) return false; step(1); } }
  ];
  function tvTip(el) {
    var r = el.getAttribute('data-rail') || el.getAttribute('data-fly') || '', id = el.id || '';
    for (var i = 0; i < KEYMAP.length; i++) { var m = KEYMAP[i];
      if ((r && m.tool === r) || (id && m.el && m.el.indexOf(id) >= 0)) return m.d || keyDisp(m.c); }
    return '';
  }
  function tvSheet() {
    return KEYMAP.map(function (m) {
      if (m.h) return '<div class="font-semibold text-ink mt-2">' + m.h + '</div>';
      if (!m.l) return '';
      return '<div class="flex gap-2"><span class="font-mono text-ink" style="flex:0 0 5.5rem">' + (m.d || keyDisp(m.c)) + '</span><span class="text-ink-mute" style="font-weight:400">' + m.l + '</span></div>';
    }).join('');
  }
  function tvKeyDown(e) {
    var combo = ((e.metaKey || e.ctrlKey) ? 'Mod+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + e.code;
    var plain = !e.metaKey && !e.ctrlKey && !e.altKey, ch = plain ? 'ch:' + e.key : '';
    var top = window === window.top && location.pathname.indexOf('/chart/') === 0, hand = chartHasHand();
    for (var i = 0; i < KEYMAP.length; i++) { var m = KEYMAP[i];
      if (!m.c || (m.c !== combo && m.c !== ch)) continue;
      if (!(hand || (top && !m.hand))) return;
      if (m.f(e) !== false) e.preventDefault();
      return; }
    if (e.key === 'Escape') { escapeAll(); return; }
    if (!plain || !(hand || top)) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); openInt(e.key); return; }
    var lt = /^[a-z]$/i.test(e.key) ? e.key : '';
    if (lt && window === window.top) { e.preventDefault(); openSym(lt.toUpperCase()); }
  }
  function initHotkeys() {
    if (!window.PI_WATCH_STEP) window.PI_WATCH_STEP = flipWatch;   // the watchlist panel can call it, or replace it
    H.el.addEventListener('mousedown', function () { chartFocus = true; }, true);
    document.addEventListener('mousedown', function (ev) { if (!(ev.target && ev.target.closest && ev.target.closest('#lwchart'))) chartFocus = false; }, true);
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
      var ae = document.activeElement, atag = (ae && ae.tagName) || '';
      if (atag === 'INPUT' || atag === 'TEXTAREA' || atag === 'SELECT' || (ae && ae.isContentEditable)) return;
      var k2 = window.__piFixes2 || window.__piWs;   // the workspace gets the new keys even if chart_fixes2 is off for the reader
      var pal = document.getElementById('cp-pal'); if (pal && pal.style.display !== 'none' && pal.offsetParent) return;
      if (tvKeys()) { tvKeyDown(e); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyZ') { if (chartHasHand()) { e.preventDefault(); redoDrawing(); } return; }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyC' && chartHasHand()) { var sd = selected(); if (sd) { e.preventDefault(); copyDrawing(sd); } return; }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyV' && chartHasHand()) { e.preventDefault(); pasteDrawing(); return; }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyD' && chartHasHand()) { var sd2 = selected(); if (sd2) { e.preventDefault(); duplicateDrawing(sd2); } return; }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyZ') { if (chartHasHand()) { e.preventDefault(); undoDrawing(); } return; }
      if (e.key === '?' && chartHasHand()) { e.preventDefault(); showKeys(); return; }
      if (e.key === 'Escape' && window.__piFixes2) { escapeAll(); }
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        if (e.code === 'KeyH' && window.__piFixes2 && chartHasHand()) { e.preventDefault(); hlineNow(); return; }
        // chart keys (Alt, read by e.code: on a Mac Alt+letter types a special character in e.key): Alt+D W M = Daily, Weekly, Monthly,
        // Alt+L = log, Alt+F = full screen. Fibonacci, Measure and the Data window move to Alt+Shift+F / M / D.
        var altTf = { KeyD: 'tf-d', KeyW: 'tf-w', KeyM: 'tf-m', KeyL: 'tf-log', KeyF: 'tf-full' };
        if (k2 && altTf[e.code] && !e.shiftKey && (chartHasHand() || (window === window.top && location.pathname.indexOf('/chart/') === 0))) {
          e.preventDefault(); var tb = document.getElementById(altTf[e.code]); if (tb) tb.click(); return; }
        var map = { KeyH: 'horizontal-line', KeyT: 'trend-line', KeyV: 'vertical-line', KeyF: 'fib-retracement', KeyM: 'measure' };
        if (map[e.code] && (!k2 || !altTf[e.code] || e.shiftKey)) { e.preventDefault(); setTool(map[e.code]); return; }
        if (e.code === 'KeyG') { e.preventDefault(); gotoAsk(); return; }
        if (e.code === 'KeyA') { e.preventDefault(); var lp = lastCross && lastCross.price; if (lp > 0) armAlert(Math.round(lp * 100) / 100); else { var c2 = bars(); if (c2.length) armAlert(c2[c2.length - 1].close); } return; }
        if (e.code === 'KeyI') { e.preventDefault(); openIndicators(); return; }
        if (e.code === 'KeyR') { e.preventDefault(); try { chart.timeScale().fitContent(); } catch (e2) {} return; }
        if (e.code === 'KeyD' && (!k2 || e.shiftKey) && tvTools()) { e.preventDefault(); toggleDataWindow(); return; }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // chart_fixes2 / chart_workspace: any letter, upper or lower case, opens the name search with that letter typed (TradingView);
      // the interval, log and full-screen keys moved to Alt+letter (above)
      var lt = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : (/^Key[A-Z]$/.test(e.code || '') ? e.code.charAt(3).toLowerCase() : '');
      if (k2 && window === window.top && lt && (chartHasHand() || location.pathname.indexOf('/chart/') === 0)) { e.preventDefault(); openSym(lt.toUpperCase()); return; }
      if (!chartHasHand()) return;
      var tf = k2 ? null : { d: 'tf-d', w: 'tf-w', m: 'tf-m', l: 'tf-log', f: 'tf-full' }[lt];   // without the flags the old one-letter keys stay
      if (tf) { e.preventDefault(); var b = document.getElementById(tf); if (b) b.click(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); (window.PI_WATCH_STEP || flipWatch)(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); (window.PI_WATCH_STEP || flipWatch)(-1); return; }
      if (e.code === 'Space') { e.preventDefault(); flipBoard(e.shiftKey ? -1 : 1); return; }
    });
  }
  var CURSORS = [['cross', 'Cross', 'crosshair'], ['dot', 'Dot', 'cell'], ['arrow', 'Arrow', 'default'], ['eraser', 'Eraser', 'not-allowed']];
  var cursorMode = 'cross';
  try { cursorMode = localStorage.getItem('pi_cursor') || 'cross'; } catch (e) {}
  function cursorCss() { var c = CURSORS.filter(function (x) { return x[0] === cursorMode; })[0]; return c ? c[2] : 'crosshair'; }
  function setCursor(m) {
    cursorMode = m; try { localStorage.setItem('pi_cursor', m); } catch (e) {}
    if (H.el) H.el.style.cursor = activeTool ? 'crosshair' : cursorCss();
    hint(m === 'eraser' ? 'Eraser: click a drawing to remove it' : '');
  }
  function cursorMenu(anchorBtn) {
    var box = document.getElementById('cp-cursor');
    if (!box) { box = document.createElement('div'); box.id = 'cp-cursor';
      box.className = 'bg-white border border-sepia-border rounded-lg shadow-lg p-1 text-xs';
      box.style.cssText = 'position:fixed;z-index:80;display:none;min-width:8rem';
      document.body.appendChild(box);
      document.addEventListener('mousedown', function (e2) {
        if (box && !(e2.target.closest && (e2.target.closest('#cp-cursor') || e2.target.closest('[data-rail=""]')))) box.style.display = 'none'; });
    }
    box.innerHTML = CURSORS.map(function (c) {
      return '<button type="button" data-cur="' + c[0] + '" class="block w-full text-left px-2 py-1 rounded hover:bg-sepia-hover'
        + (c[0] === cursorMode ? ' bg-accent text-white' : '') + '">' + c[1] + '</button>'; }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-cur]'), function (b2) {
      b2.addEventListener('click', function () { setCursor(this.getAttribute('data-cur')); box.style.display = 'none'; }); });
    var r = anchorBtn.getBoundingClientRect();
    box.style.display = 'block'; box.style.left = (r.right + 8) + 'px';
    box.style.top = Math.min(r.top, window.innerHeight - box.offsetHeight - 8) + 'px';
  }
  function markRail() {
    var fam = activeTool ? famOf(activeTool) : null;
    Array.prototype.forEach.call(document.querySelectorAll('#cp-rail [data-rail]'), function (b2) {
      var on = (b2.getAttribute('data-rail') || null) === activeTool;
      b2.className = 'px-1 py-1 rounded-lg border '
        + (on ? 'border-accent bg-accent text-white' : 'border-sepia-border text-ink-mute hover:text-ink');
    });
    // the family the armed tool came from lights up too, so a tool taken from a
    // submenu still shows where it lives
    Array.prototype.forEach.call(document.querySelectorAll('#cp-rail [data-fam]'), function (b2) {
      var on = fam && b2.getAttribute('data-fam') === fam;
      b2.className = 'px-1 py-1 rounded-lg border '
        + (on ? 'border-accent bg-accent text-white' : 'border-sepia-border text-ink-mute hover:text-ink');
    });
  }

  // pick a drawing up and move it: the anchors travel in price and in bars, so
  // the shape keeps its meaning instead of sliding in pixels
  function initDrag() {
    var el = H.el;
    var onDown = function (ev) {
      // the style box lives inside the chart, so its own clicks must not read as
      // a click on the canvas, which would deselect and hide it mid-gesture
      if (ev.target && ev.target.closest && ev.target.closest('#cp-style,#cp-rail')) return;
      if (activeTool || !DM) return;
      var bb = el.getBoundingClientRect(), pt = { x: ev.clientX - bb.left, y: ev.clientY - bb.top };
      var hit = null; try { hit = DM.hitTest && DM.hitTest(pt); } catch (e) {}
      if (!hit) { try { DM.deselectAll(); } catch (e) {} hideStyle(); return; }
      try { DM.selectDrawing(hit.id || hit); } catch (e) {}
      var d = selected(); if (!d) return;
      if (d._locked) { showStyle(d); return; }
      var start = pointAt(ev); if (!start) return;
      var ai = null;   // chart_draw_anchors: the hand on one point moves that point, the hand on the body moves the whole drawing
      if (window.__piAnchors && (d._anchors || []).length > 1) { try { ai = DM.hitTestAnchor(pt); } catch (e) { ai = null; } }
      dragging = { d: d, x0: pt.x, y0: pt.y, p0: start.price, i0: idxOf(start.time),
                   anchors: JSON.parse(JSON.stringify(d._anchors)), moved: false, ai: ai == null ? -1 : ai };
      try { chart.applyOptions({ handleScroll: false, handleScale: false }); } catch (e) {}
      ev.preventDefault();
    };
    el.addEventListener('mousedown', onDown, true);
    el.addEventListener('touchstart', function (ev) { if (ev.touches.length !== 1) return; var t = ev.touches[0];
      onDown({ clientX: t.clientX, clientY: t.clientY, target: ev.target, preventDefault: function () { ev.preventDefault(); } }); }, { passive: false });
    var onMove = function (ev) {
      if (!dragging) return;
      var now = pointAt(ev); if (!now) return;
      var di = idxOf(now.time) - dragging.i0, dp = now.price - dragging.p0;
      if (!di && Math.abs(dp) < 1e-9) return;
      dragging.moved = true;
      if (dragging.ai >= 0) {
        dragging.d._anchors = dragging.anchors.map(function (a2, n) { return n === dragging.ai ? { time: now.time, price: +(+now.price).toFixed(4) } : a2; });
        repaintDrawing(dragging.d); return;
      }
      var c = bars();
      dragging.d._anchors = dragging.anchors.map(function (a2) {
        var j = idxOf(a2.time) + di;
        j = Math.max(0, Math.min(c.length - 1, j));
        return { time: c[j].time, price: +(a2.price + dp).toFixed(4) };
      });
      repaintDrawing(dragging.d);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', function (ev) { if (!dragging || ev.touches.length !== 1) return; var t = ev.touches[0]; onMove({ clientX: t.clientX, clientY: t.clientY }); ev.preventDefault(); }, { passive: false });
    var onUp = function () {
      if (!dragging) return;
      try { chart.applyOptions({ handleScroll: true, handleScale: true }); } catch (e) {}
      if (dragging.moved) { dragging.d._orig = JSON.parse(JSON.stringify(dragging.d._anchors)); if (dragging.d._auto) keepAuto(dragging.d); else saveDrawings(); }
      var d = dragging.d; dragging = null;
      showStyle(d);
    };
    window.addEventListener('mouseup', onUp); window.addEventListener('touchend', onUp);
    if (!document.getElementById('cp-touch-css')) { var st = document.createElement('style'); st.id = 'cp-touch-css';
      st.textContent = '@media (max-width:640px){#cp-rail button{font-size:17px!important;padding:7px 9px!important}#cp-rail{gap:6px!important}#cp-style button{padding:6px 8px}}';
      document.head.appendChild(st); }
  }

  // restyle or remove whatever is selected
  var STYLE_COLORS = ['#1a1a1a', '#8b5cf6', '#2a7a2a', '#b34a1f', '#b7791f', '#0891b2'];   // the member's own picks for a drawing
  function hideStyle() { styleFor = null; if (styleBox) styleBox.style.display = 'none'; }
  // The bar belongs to the drawing, so it sits just above its highest anchor and
  // follows the chart. Pinned in a corner it read like a page control, not a handle.
  var styleFor = null;
  function placeStyle(d) {
    if (!styleBox || !d) return;
    var pts = d._orig || d._anchors || []; if (!pts.length) { styleBox.style.right = '8px'; styleBox.style.bottom = '8px'; styleBox.style.left = ''; styleBox.style.top = ''; return; }
    var ts = chart.timeScale(), xs = [], ys = [];
    pts.forEach(function (a) {
      try { var x = ts.timeToCoordinate(a.time), y = H.cs.priceToCoordinate(+a.price);
        if (x != null) xs.push(x); if (y != null) ys.push(y); } catch (e) {}
    });
    if (!xs.length || !ys.length) return;
    var w = styleBox.offsetWidth || 260, h = styleBox.offsetHeight || 30;
    var cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2 - w / 2;
    var top = Math.min.apply(null, ys) - h - 10;
    if (top < 4) top = Math.max.apply(null, ys) + 12;
    cx = Math.max(6, Math.min(cx, H.el.clientWidth - w - 60));
    top = Math.max(4, Math.min(top, H.el.clientHeight - h - 8));
    styleBox.style.right = ''; styleBox.style.bottom = '';
    styleBox.style.left = Math.round(cx) + 'px'; styleBox.style.top = Math.round(top) + 'px';
  }
  function trackStyle() {
    if (!styleFor || !styleBox || styleBox.style.display === 'none') return;
    placeStyle(styleFor);
  }

  function showStyle(d) {
    styleFor = d;
    if (!d) return;
    if (!styleBox) {
      styleBox = document.createElement('div');
      styleBox.id = 'cp-style';
      styleBox.className = 'bg-white border border-sepia-border rounded-lg shadow-lg p-2 text-xs';
      styleBox.style.cssText = 'position:absolute;right:8px;bottom:8px;z-index:7;display:none';
      H.el.appendChild(styleBox);
    }
    styleBox.innerHTML = (d._auto ? '<div class="flex items-center gap-2 mb-1"><span class="text-ink-mute">Auto ' + (d._autoNote || 'line') + '</span>'
          + '<button type="button" data-keep="1" class="px-1.5 rounded bg-accent text-white" title="Make it one of your drawings: saved with this name, yours to move">Keep as mine</button></div>' : '')
      + '<div class="flex items-center gap-1">'
      + STYLE_COLORS.map(function (c2) {
          return '<button type="button" data-col="' + c2 + '" title="Colour" style="width:14px;height:14px;'
            + 'border-radius:3px;background:' + c2 + '"></button>'; }).join('')
      + '<button type="button" data-w="1" class="px-1 rounded hover:bg-sepia-hover" title="Thin line">thin</button>'
      + '<button type="button" data-w="3" class="px-1 rounded hover:bg-sepia-hover" title="Thick line">thick</button>'
      + '<button type="button" data-ls="0" class="px-1 rounded hover:bg-sepia-hover" title="Solid line">\u2014</button>'
      + '<button type="button" data-ls="2" class="px-1 rounded hover:bg-sepia-hover" title="Dashed line">\u254c</button>'
      + (wantsText(d.type) ? '<button type="button" data-text="1" class="px-1 rounded hover:bg-sepia-hover" title="Write on it">text</button>'
          + '<select data-font class="border border-sepia-border rounded bg-white" title="Font size" style="padding:0 2px">'
          + [10, 12, 14, 18, 24].map(function (fz) { return '<option value="' + fz + '"' + (((d._style || {}).fontSize || 12) === fz ? ' selected' : '') + '>' + fz + '</option>'; }).join('')
          + '</select>' : '')
      + (EXTENDABLE.indexOf(d.type) >= 0
          ? '<button type="button" data-ext="left" class="px-1 rounded hover:bg-sepia-hover" title="Extend to the left">\u21e4</button>'
            + '<button type="button" data-ext="right" class="px-1 rounded hover:bg-sepia-hover" title="Extend to the right">\u21e5</button>' : '')
      + '<button type="button" data-fill="1" class="px-1 rounded hover:bg-sepia-hover" title="Fill it with the same colour, lightly">fill</button>'
      + '<button type="button" data-def="1" class="px-1 rounded hover:bg-sepia-hover" title="Keep this look for this tool">default</button>'
      + (tvMore() ? tplPicker(d) : '')
      + '<button type="button" data-copy="1" class="px-1 rounded hover:bg-sepia-hover" title="Copy (\u2318C)">copy</button>'
      + '<button type="button" data-dup="1" class="px-1 rounded hover:bg-sepia-hover" title="Duplicate (\u2318D)">dup</button>'
      + '<button type="button" data-del="1" class="px-1 rounded hover:bg-sepia-hover text-bad">delete</button>'
      + (alertLevel(d) != null ? '<button type="button" data-alert="1" class="px-1 rounded hover:bg-sepia-hover text-accent font-medium">'
          + 'alert at ' + alertLevel(d).toFixed(2) + '</button>' : '')
      + (lineLevel(d) != null ? '<button type="button" data-lalert="1" class="px-1 rounded hover:bg-sepia-hover text-accent font-medium"'
          + ' title="Email me the day the close crosses this line">alert on cross</button>' : '')
      + (rectEdges(d) ? ['above', 'below'].map(function (s2) { return '<button type="button" data-ralert="' + s2 + '" class="px-1 rounded hover:bg-sepia-hover text-accent font-medium"'
          + ' title="Email me the day the close goes ' + s2 + ' this box">alert ' + s2 + ' ' + rectEdges(d)[s2].toFixed(2) + '</button>'; }).join('') : '')
      + (positionInfo(d) ? '<button type="button" data-log="1" class="px-1 rounded hover:bg-sepia-hover text-accent font-medium"'
          + (d.type === 'short-position' ? ' disabled title="The journal is long only"' : ' title="Entry and stop go to your journal, the target in the note"')
          + '>log this trade</button>' : '') + '</div>'
      + (positionInfo(d) ? '<div class="text-ink-mute mt-1" style="font-family:JetBrains Mono,monospace">' + positionText(d) + '</div>' : '');
    styleBox.style.display = '';
    Array.prototype.forEach.call(styleBox.querySelectorAll('[data-col]'), function (b2) {
      b2.addEventListener('click', function () { restyle(d, { lineColor: this.getAttribute('data-col') }); });
    });
    Array.prototype.forEach.call(styleBox.querySelectorAll('[data-w]'), function (b2) {
      b2.addEventListener('click', function () { restyle(d, { lineWidth: +this.getAttribute('data-w') }); });
    });
    Array.prototype.forEach.call(styleBox.querySelectorAll('[data-ls]'), function (b2) {
      b2.addEventListener('click', function () { restyle(d, { lineStyle: +this.getAttribute('data-ls') }); });
    });
    var tb = styleBox.querySelector('[data-text]'); if (tb) tb.addEventListener('click', function () { editText(d); });
    var fb = styleBox.querySelector('[data-font]'); if (fb) fb.addEventListener('change', function () { restyle(d, { fontSize: +this.value }); });
    Array.prototype.forEach.call(styleBox.querySelectorAll('[data-ext]'), function (b2) {
      b2.addEventListener('click', function () { var side = this.getAttribute('data-ext');
        var cur = (d._style || {}), on = !(side === 'left' ? cur.extendLeft : cur.extendRight);
        restyle(d, side === 'left' ? { extendLeft: on } : { extendRight: on }); });
    });
    var flb = styleBox.querySelector('[data-fill]');
    if (flb) flb.addEventListener('click', function () {
      var col = (d._style || {}).lineColor || PI_CHART.theme().text;
      var on = !(d._style || {}).fillColor;
      restyle(d, { fillColor: on ? col + '22' : 'transparent', backgroundColor: on ? col + '22' : 'transparent' }); });
    var tps = styleBox.querySelector('[data-tpl]'); if (tps) tps.addEventListener('change', function () {
      var v = this.value; this.value = '';
      if (v === '+') { var nm = (window.prompt('Name this look') || '').trim().slice(0, 30); if (nm) saveToolTpl(d, nm); showStyle(d); return; }
      if (v.indexOf('-:') === 0) { dropToolTpl(d.type, v.slice(2)); showStyle(d); return; }
      var st = (toolTpls()[d.type] || {})[v]; if (st) { restyle(d, JSON.parse(JSON.stringify(st))); showStyle(d); } });
    var dfb = styleBox.querySelector('[data-def]');
    if (dfb) dfb.addEventListener('click', function () { setToolDefault(d); });
    placeStyle(d);
    var kpb = styleBox.querySelector('[data-keep]'); if (kpb) kpb.addEventListener('click', function () { keepAuto(d); showStyle(d); });
    var cpb = styleBox.querySelector('[data-copy]'); if (cpb) cpb.addEventListener('click', function () { copyDrawing(d); });
    var dpb = styleBox.querySelector('[data-dup]'); if (dpb) dpb.addEventListener('click', function () { duplicateDrawing(d); });
    var al = styleBox.querySelector('[data-alert]');
    if (al) al.addEventListener('click', function () { armAlert(alertLevel(d)); });
    var lg = styleBox.querySelector('[data-log]');
    if (lg) lg.addEventListener('click', function () { logTrade(d); });
    var la = styleBox.querySelector('[data-lalert]');
    if (la) la.addEventListener('click', function () { armLineAlert(d); });
    Array.prototype.forEach.call(styleBox.querySelectorAll('[data-ralert]'), function (b) { b.addEventListener('click', function () {
      var s2 = this.getAttribute('data-ralert'), ed = rectEdges(d), tk = tkNow(); if (!ed || !tk) return;
      postForm('/alerts/create', [['ticker', tk], ['level', ed[s2].toFixed(2)], ['kind', s2], ['back', location.pathname]]); }); });
    var del = styleBox.querySelector('[data-del]');
    if (del) del.addEventListener('click', function () {
      detach(d); try { DM.removeDrawing(d.id); } catch (e) {} saveDrawings(); hideStyle(); });
  }
  // a horizontal line is a level the reader cares about: one click arms the
  // same email alert the page offers below the chart, at that exact price
  function alertLevel(d) {
    if (!d || (d.type !== 'horizontal-line' && d.type !== 'horizontal-ray')) return null;
    var a = d._anchors && d._anchors[0]; var p = a && +a.price;
    return p > 0 ? p : null;
  }
  // the position tool: entry, stop, target from its three anchors (the library
  // draws the boxes and R:R; we read the same numbers to log the trade)
  function positionInfo(d) {
    if (!d || (d.type !== 'long-position' && d.type !== 'short-position')) return null;
    try { var i = d.getPositionInfo(); return i && i.entry ? i : null; } catch (e) { return null; }
  }
  function positionText(d) {
    var i = positionInfo(d); if (!i) return '';
    return 'Entry ' + i.entry.toFixed(2) + ' \u00b7 Stop ' + i.stopLoss.toFixed(2) + ' (' + i.riskPercent.toFixed(1) + '%)'
      + ' \u00b7 Target ' + i.takeProfit.toFixed(2) + ' (' + i.rewardPercent.toFixed(1) + '%) \u00b7 R:R 1:' + i.riskRewardRatio.toFixed(1);
  }
  function logTrade(d) {
    var i = positionInfo(d); if (!i || d.type !== 'long-position') return;
    var snap = document.getElementById('chart-snap'), tk = snap && snap.dataset.ticker; if (!tk) return;
    if (!(i.stopLoss < i.entry)) { hint('The stop has to sit under the entry'); setTimeout(function () { hint(''); }, 1800); return; }
    var f = document.createElement('form'); f.method = 'post'; f.action = '/journal/add'; f.style.display = 'none';
    [['ticker', tk], ['entry', i.entry.toFixed(2)], ['stop', i.stopLoss.toFixed(2)], ['shares', ''],
     ['note', 'Target ' + i.takeProfit.toFixed(2) + ', R:R 1:' + i.riskRewardRatio.toFixed(1) + ', planned on the chart'],
     ['setup', ''], ['emotion', '']].forEach(function (kv) {
      var el2 = document.createElement('input'); el2.type = 'hidden'; el2.name = kv[0]; el2.value = kv[1]; f.appendChild(el2); });
    document.body.appendChild(f); f.submit();
  }
  // a sloped line is a level that moves one step per session: the server
  // gets the two anchors and works out where the line sits each night
  function rectEdges(d) {   // chart_rect_alert: the top and the bottom of a box, each one a level to watch
    if (!window.__piRectAlert || !d || d.type !== 'rectangle') return null;
    var a = d._orig || d._anchors; if (!a || a.length < 2) return null;
    var hi = Math.max(+a[0].price, +a[1].price), lo = Math.min(+a[0].price, +a[1].price);
    return hi > lo && lo > 0 ? { above: hi, below: lo } : null;
  }
  function lineLevel(d) {
    if (!d || ['trend-line', 'ray', 'extended-line'].indexOf(d.type) < 0) return null;
    var a = d._orig || d._anchors; if (!a || a.length !== 2) return null;
    var c = H.candles(), i0 = -1, i1 = -1;
    for (var i = 0; i < c.length; i++) { if (c[i].time <= a[0].time) i0 = i; if (c[i].time <= a[1].time) i1 = i; }
    if (i0 < 0 || i1 < 0 || i0 === i1) return null;
    var slope = (a[1].price - a[0].price) / (i1 - i0);
    return +(a[0].price + slope * (c.length - 1 - i0)).toFixed(2);
  }
  function postForm(action, fields) {
    var f = document.createElement('form'); f.method = 'post'; f.action = action; f.style.display = 'none';
    fields.forEach(function (kv) { var i = document.createElement('input'); i.type = 'hidden'; i.name = kv[0]; i.value = kv[1]; f.appendChild(i); });
    document.body.appendChild(f); f.submit();
  }
  function armLineAlert(d) {
    var lvl = lineLevel(d); if (lvl == null) return;
    var snap = document.getElementById('chart-snap'), tk = snap && snap.dataset.ticker; if (!tk) return;
    var a = (d._orig || d._anchors).map(function (x) { return { time: x.time, price: +(+x.price).toFixed(4) }; });
    postForm('/alerts/create', [['ticker', tk], ['level', lvl.toFixed(2)], ['kind', 'line'], ['anchors', JSON.stringify(a)], ['back', location.pathname]]);
  }
  // presets fill the alert form under the chart; the reader still presses Set
  function presetAlert(kind, level, cond) {
    var forms = Array.prototype.filter.call(document.querySelectorAll('form[action="/alerts/create"]'), function (f) { return f.querySelector('select[name=kind]'); });
    var f = forms[0]; if (!f) return;
    f.querySelector('select[name=kind]').value = kind;
    f.querySelector('input[name=level]').value = level != null ? level.toFixed(2) : '';
    var cs = f.querySelector('select[name=condition]'); if (cs) cs.value = cond || '';
    var det = f.closest('details'); if (det) det.open = true;
    try { f.scrollIntoView({ block: 'center' }); f.querySelector('input[name=level]').focus(); } catch (e) {}
  }
  function armAlert(level) {
    var snap = document.getElementById('chart-snap'), tk = snap && snap.dataset.ticker; if (!tk) return;
    var c = H.candles(), last = c.length ? c[c.length - 1].close : null;
    var f = document.createElement('form'); f.method = 'post'; f.action = '/alerts/create'; f.style.display = 'none';
    [['ticker', tk], ['level', level.toFixed(2)], ['kind', last != null && level < last ? 'below' : 'above'],
     ['back', location.pathname]].forEach(function (kv) {
      var i = document.createElement('input'); i.type = 'hidden'; i.name = kv[0]; i.value = kv[1]; f.appendChild(i); });
    document.body.appendChild(f); f.submit();
  }
  function restyle(d, patch) {
    try {
      d._style = d._style || {};
      Object.keys(patch).forEach(function (k) { d._style[k] = patch[k]; });
      if (d._options) Object.keys(patch).forEach(function (k) { d._options[k] = patch[k]; });
      var setter = Object.keys(d).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(d)))
        .filter(function (n) { return /^set[A-Z].*Options$/.test(n); })[0];
      if (setter && typeof d[setter] === 'function') d[setter](patch);
      repaintDrawing(d);
    } catch (e) {}
    if (d && d._auto) keepAuto(d); else saveDrawings();
  }

  function buildDrawMenu() {
    var L = window.LightweightChartsDrawing;
    var defs = L.TOOL_DEFINITIONS;
    var list = Array.isArray(defs) ? defs : Object.values(defs || {});
    var host = document.getElementById('cp-draw-list'); if (!host) return;
    var byCat = {};
    list.forEach(function (t) { (byCat[t.category] = byCat[t.category] || []).push(t); });
    var html = '<button type="button" id="cp-draw-cur" data-dt="" class="block w-full text-left px-2 py-1 rounded-lg hover:bg-sepia-hover mb-1">Cursor</button>';
    Object.keys(byCat).forEach(function (c) {
      html += '<p class="text-ink-mute uppercase tracking-wide mt-2 mb-1" style="font-size:10px">'
            + (CAT_LABEL[c] || c) + '</p>';
      byCat[c].forEach(function (t) {
        html += '<button type="button" data-dt="' + t.type + '" class="block w-full text-left px-2 py-1 rounded-lg hover:bg-sepia-hover">'
              + t.name + '</button>';
      });
    });
    html += '<div class="border-t border-sepia-border mt-2 pt-2">'
          + '<button type="button" id="cp-draw-clear" class="block w-full text-left px-2 py-1 rounded-lg hover:bg-sepia-hover text-bad">Clear every drawing</button></div>';
    host.innerHTML = html;
    Array.prototype.forEach.call(host.querySelectorAll('[data-dt]'), function (b) {
      b.addEventListener('click', function () {
        setTool(this.getAttribute('data-dt') || null);
        var dd = document.getElementById('cp-draw'); if (dd) dd.removeAttribute('open');
      });
    });
    var cl = document.getElementById('cp-draw-clear');
    if (cl) cl.addEventListener('click', function () {
      detachAll(); try { DM.clearAll(); } catch (e) {}
      saveDrawings(); setTool(null);
      var dd = document.getElementById('cp-draw'); if (dd) dd.removeAttribute('open');
    });
    setTool(null);
  }
  function drawLayerVisible(on) {
    if (!DM) return;
    var el = H.el; if (!el) return;
    // the library paints into the chart panes; hiding is a matter of dropping the
    // active tool and letting the rebuilt price own the surface
    if (!on) { setTool(null); detachAll(); } else attachAll();
    _hiddenLayer = !on; drawRvp();
    var dd = document.getElementById('cp-draw');
    if (dd) dd.style.display = on ? '' : 'none';
  }
  // ── templates: a named set of studies, moving averages and style ─────────
  // The house sets carry the rules the traders published, nothing invented.
  var HOUSE = {
    minervini: { label: 'Minervini trend template',
      note: 'The 50, 150 and 200 day averages stacked, price above them all.',
      mas: [{ on: true, p: 50, t: 'SMA' }, { on: true, p: 150, t: 'SMA' }, { on: true, p: 200, t: 'SMA' }],
      studies: { ours_rs: true, vola: true, vcp: true }, mode: 'candles' },
    qullamaggie: { label: 'Qullamaggie momentum',
      note: 'The 10 and 20 day averages for the ride, the 50 for the line in the sand.',
      mas: [{ on: true, p: 10, t: 'EMA' }, { on: true, p: 20, t: 'EMA' }, { on: true, p: 50, t: 'SMA' }],
      studies: { vola: true, ours_rs: true }, mode: 'candles' },
    weinstein: { label: 'Weinstein stage analysis',
      note: 'The 30 week average and relative strength, the two lines the book is built on.',
      mas: [{ on: true, p: 150, t: 'SMA' }, { on: false, p: 200, t: 'SMA' }, { on: false, p: 21, t: 'EMA' }],
      studies: { ours_rs: true, vola: true }, mode: 'candles' },
    stockbee: { label: 'Stockbee momentum burst',
      note: 'Range expansion against the recent norm, with volume behind it.',
      mas: [{ on: true, p: 20, t: 'SMA' }, { on: false, p: 50, t: 'SMA' }, { on: false, p: 200, t: 'SMA' }],
      studies: { vola: true, atr: true, roc: true }, mode: 'candles' },
    oneil: { label: "O'Neil, the CANSLIM chart",
      note: 'The 50 and 200 day lines, relative strength, volume against its norm, the bases with their pivot.',
      mas: [{ on: true, p: 50, t: 'SMA' }, { on: true, p: 200, t: 'SMA' }, { on: false, p: 21, t: 'EMA' }],
      studies: { oneil: true, ours_rs: true, vola: true }, mode: 'candles' },
    darvas: { label: 'Darvas, the boxes',
      note: 'The boxes as he drew them, with volume to confirm the break.',
      mas: [{ on: false, p: 50, t: 'SMA' }, { on: false, p: 200, t: 'SMA' }, { on: false, p: 21, t: 'EMA' }],
      studies: { darvas: true, vola: true }, mode: 'candles' },
    livermore: { label: 'Livermore, the pivotal points',
      note: 'The points that matter, nothing else on the chart.',
      mas: [{ on: false, p: 50, t: 'SMA' }, { on: false, p: 200, t: 'SMA' }, { on: false, p: 21, t: 'EMA' }],
      studies: { livermore: true }, mode: 'bars' },
    nison: { label: 'Nison, the candle patterns',
      note: 'The one, two and three bar patterns of the book, each with what followed on this name.',
      mas: [{ on: true, p: 20, t: 'EMA' }, { on: false, p: 50, t: 'SMA' }, { on: false, p: 200, t: 'SMA' }],
      studies: { candles: true, vola: true }, mode: 'candles' },
    options: { label: 'The options desk',
      note: 'What the option book is doing behind the price.',
      mas: [{ on: false, p: 50, t: 'SMA' }, { on: false, p: 200, t: 'SMA' }, { on: false, p: 21, t: 'EMA' }],
      studies: { ours_prem: true, ours_gex: true, ours_oi: true }, mode: 'candles' },
    clean: { label: 'Clean slate', note: 'Price and volume, nothing else.',
      mas: [{ on: false, p: 100, t: 'HMA' }, { on: false, p: 200, t: 'HMA' }, { on: false, p: 21, t: 'EMA' }],
      studies: {}, mode: 'candles' }
  };
  function myTemplates() {
    try { return JSON.parse(localStorage.getItem('pi_chart_templates') || '{}') || {}; } catch (e) { return {}; }
  }
  function applyTemplate(t) {
    if (!t) return;
    liveKeys().forEach(function (k) { if (baseKey(k) !== k) { studyState[k] = false; drawStudy(k); delete studyState[k]; } });
    Object.keys(STUDIES).forEach(function (k) { studyState[k] = !!(t.studies || {})[k]; });
    if (t.cfg) studyCfg = JSON.parse(JSON.stringify(t.cfg));
    if (t.mode && TYPES[t.mode]) mode = t.mode;
    if (t.mas && H.setMAs) H.setMAs(t.mas);
    Object.keys(STUDIES).forEach(function (k) {
      var cb = document.getElementById('cp-s-' + k); if (cb) cb.checked = !!studyState[k]; });
    // drawStudy's second argument is a depth guard: never hand it forEach's index
    Object.keys(STUDIES).forEach(function (k) { drawStudy(k); }); liveKeys().forEach(function (k) { drawStudy(k); });
    fitHeight(); applyType(); markType(); saveState();
  }
  function saveTemplate(name) {
    if (!name) return;
    var all = myTemplates();
    all[name] = { label: name, studies: JSON.parse(JSON.stringify(studyState)),
                  cfg: JSON.parse(JSON.stringify(studyCfg)), mode: mode,
                  tf: tfNow(),   // daily, weekly, monthly and intraday keep their own set
                  mas: (H.getMAs && H.getMAs()) || null };
    try { localStorage.setItem('pi_chart_templates', JSON.stringify(all)); } catch (e) {}
    pushSettings(); buildTemplateMenu();
  }
  // A set of indicators belongs to a timeframe: what you read on the daily is not
  // what you read on the weekly. A template remembers the one it was saved on, and
  // the chart puts it back when you return to that timeframe. Three fit on the bar.
  function tfNow() {
    try { if (typeof intraTf !== 'undefined' && intraTf) return intraTf; } catch (e) {}
    try { return H.tf() || '1D'; } catch (e) { return '1D'; }
  }
  function tfName(t) {
    return t === '1W' ? 'weekly' : t === '1M' ? 'monthly' : t === '1D' ? 'daily' : t;
  }
  function autoMap() {
    try { return JSON.parse(localStorage.getItem('pi_chart_tpl_auto') || '{}') || {}; } catch (e) { return {}; }
  }
  function setAuto(tf, ref) {
    var m = autoMap();
    if (ref) m[tf] = ref; else delete m[tf];
    try { localStorage.setItem('pi_chart_tpl_auto', JSON.stringify(m)); } catch (e) {}
    pushSettings(); buildTemplateMenu();
  }
  function pins() {
    try { var a = JSON.parse(localStorage.getItem('pi_chart_tpl_pins') || '[]'); return a.slice(0, 3); }
    catch (e) { return []; }
  }
  function togglePin(ref) {
    var a = pins(), i = a.indexOf(ref);
    if (i >= 0) a.splice(i, 1); else { a.push(ref); if (a.length > 3) a.shift(); }
    try { localStorage.setItem('pi_chart_tpl_pins', JSON.stringify(a)); } catch (e) {}
    pushSettings(); buildPins(); buildTemplateMenu();
  }
  function tplByRef(ref) {
    if (!ref) return null;
    return ref.charAt(0) === 'h' ? HOUSE[ref.slice(2)] : myTemplates()[ref.slice(2)];
  }
  function tplLabel(ref) { var t = tplByRef(ref); return (t && t.label) || ref.slice(2); }
  function pinBtn(ref) {
    var on = pins().indexOf(ref) >= 0;
    return '<button type="button" data-tplpin="' + ref + '" class="px-2 py-1 rounded-lg hover:bg-sepia-hover" '
         + 'title="' + (on ? 'Unpin from the bar' : 'Pin to the bar') + '" style="opacity:' + (on ? '1' : '.35') + '">\u2691</button>';
  }
  function buildPins() {
    var host = document.getElementById('cp-pins'); if (!host) return;
    var a = pins();
    host.innerHTML = a.map(function (ref) {
      return '<button type="button" data-pin="' + ref + '" class="' + MENU_BTN
               + '" title="Apply this set">' + tplLabel(ref) + '</button>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('[data-pin]'), function (b) {
      b.addEventListener('click', function () { applyTemplate(tplByRef(this.getAttribute('data-pin'))); });
    });
  }
  var lastAutoTf = null;
  function applyAutoForTf(tf) {
    if (tf === lastAutoTf) return;
    lastAutoTf = tf;
    var ref = autoMap()[tf];
    if (ref) { var t = tplByRef(ref); if (t) applyTemplate(t); }
  }

  function buildTemplateMenu() {
    var host = document.getElementById('cp-tpl-list'); if (!host) return;
    var mine = myTemplates(), html = '';
    html += '<p class="text-ink-mute uppercase tracking-wide mb-1" style="font-size:10px">House sets</p>';
    Object.keys(HOUSE).forEach(function (k) {
      html += '<div class="flex items-start gap-1"><button type="button" data-tpl="h:' + k + '" class="block flex-1 text-left px-2 py-1 rounded-lg hover:bg-sepia-hover">'
           + HOUSE[k].label + '<span class="block text-ink-mute" style="font-size:10px">' + HOUSE[k].note + '</span></button>'
           + pinBtn('h:' + k) + '</div>';
    });
    var names = Object.keys(mine);
    if (names.length) {
      html += '<p class="text-ink-mute uppercase tracking-wide mt-2 mb-1" style="font-size:10px">Yours</p>';
      names.forEach(function (n) {
        var mtf = (mine[n] || {}).tf;
        html += '<div class="flex items-center gap-1"><button type="button" data-tpl="m:' + n
             + '" class="block flex-1 text-left px-2 py-1 rounded-lg hover:bg-sepia-hover">' + n
             + (mtf ? '<span class="text-ink-mute" style="font-size:10px"> \u00b7 ' + tfName(mtf) + '</span>' : '') + '</button>'
             + pinBtn('m:' + n)
             + '<button type="button" data-tpldel="' + n + '" class="px-2 py-1 rounded-lg hover:bg-sepia-hover text-ink-mute" title="Delete">&times;</button></div>';
      });
    }
    var curTf = tfNow(), auto = autoMap()[curTf] || '';
    html += '<div class="border-t border-sepia-border mt-2 pt-2">'
         + '<p class="text-ink-mute mb-1" style="font-size:10px">Open the ' + tfName(curTf) + ' with</p>'
         + '<select id="cp-tpl-auto" class="w-full px-2 py-1 rounded-lg border border-sepia-border bg-white">'
         + '<option value="">nothing, leave it as it is</option>'
         + Object.keys(HOUSE).map(function (k) { return '<option value="h:' + k + '"' + (auto === 'h:' + k ? ' selected' : '') + '>' + HOUSE[k].label + '</option>'; }).join('')
         + names.map(function (n) { return '<option value="m:' + n + '"' + (auto === 'm:' + n ? ' selected' : '') + '>' + n + '</option>'; }).join('')
         + '</select></div>'
         + '<div class="border-t border-sepia-border mt-2 pt-2">'
         + '<button type="button" id="cp-tpl-save" class="block w-full text-left px-2 py-1 rounded-lg hover:bg-sepia-hover">Save what is on the chart&hellip;</button></div>';
    host.innerHTML = html;
    Array.prototype.forEach.call(host.querySelectorAll('[data-tpl]'), function (btn) {
      btn.addEventListener('click', function () {
        var v = this.getAttribute('data-tpl');
        applyTemplate(v.charAt(0) === 'h' ? HOUSE[v.slice(2)] : myTemplates()[v.slice(2)]);
        var dd = document.getElementById('cp-tpl'); if (dd) dd.removeAttribute('open');
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-tpldel]'), function (btn) {
      btn.addEventListener('click', function () {
        var all = myTemplates(); delete all[this.getAttribute('data-tpldel')];
        try { localStorage.setItem('pi_chart_templates', JSON.stringify(all)); } catch (e) {}
        buildTemplateMenu();
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-tplpin]'), function (btn) {
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); togglePin(this.getAttribute('data-tplpin')); });
    });
    var au = document.getElementById('cp-tpl-auto');
    if (au) au.addEventListener('change', function () { setAuto(tfNow(), this.value); });
    var sv = document.getElementById('cp-tpl-save');
    if (sv) sv.addEventListener('click', function () {
      var n = window.prompt('Name this set of indicators'); if (n) saveTemplate(n.slice(0, 40));
      var dd = document.getElementById('cp-tpl'); if (dd) dd.removeAttribute('open');
    });
  }

  // ── compare: another name on the same chart ──────────────────────────────
  // Rebased to this name's first visible close, so the two lines start together
  // and the gap between them is the whole point.
  var cmpSeries = {}, cmpData = {}, cmpList = [];
  var CMP_COLS = [C.b, C.c, C.a, C.d];
  function cmpKey() { return 'pi_cmp_' + ((document.getElementById('chart-snap') || {}).dataset || {}).ticker; }
  function saveCmp() { try { localStorage.setItem(cmpKey(), JSON.stringify(cmpList)); } catch (e) {} pushSettings(); }
  function drawCmp() {
    Object.keys(cmpSeries).forEach(function (t) {
      try { chart.removeSeries(cmpSeries[t]); } catch (e) {} });
    cmpSeries = {};
    Object.keys(cmpPanes).forEach(function (t) { try { var ps = chart.panes(); if (ps[cmpPanes[t]] && !ps[cmpPanes[t]].getSeries().length) chart.removePane(cmpPanes[t]); } catch (e) {} });
    cmpPanes = {};
    drawMac();
    var c = bars(); if (!c.length) return;
    if (cmpMode === 'pane') {
      // each compared name gets its own pane, drawn as candles on its own prices
      cmpList.forEach(function (t, n) {
        var raw = cmpData[t]; if (!raw || !raw.length) return;
        var have = {}; c.forEach(function (b) { have[b.time] = 1; });
        var data = raw.filter(function (x) { return have[x.time] && x.open != null; }).map(function (x) { return { time: x.time, open: x.open, high: x.high, low: x.low, close: x.close }; });
        if (data.length < 10) return;
        try { chart.addPane(); var idx = chart.panes().length - 1; cmpPanes[t] = idx;
          var sr = chart.addSeries(LWC.CandlestickSeries, Object.assign(PI_CHART.candles(), { priceLineVisible: false }), idx);
          sr.setData(data); cmpSeries[t] = sr; chart.panes()[idx].setHeight(140);
          if (!window.__piShell) LWC.createTextWatermark(chart.panes()[idx], { horzAlign: 'left', vertAlign: 'top', lines: [{ text: '  ' + t, color: TR('mute', 0.85), fontSize: 11 }] }); } catch (e) {}
      });
      try { chart.panes().forEach(function (pn, pi) { chart.priceScale('left', pi).applyOptions({ visible: false, invertScale: false }); }); } catch (e) {}
      renderCmpChips(); try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {} return;
    }
    var base = c[0].close;
    cmpList.forEach(function (t, n) {
      var raw = cmpData[t]; if (!raw || !raw.length) return;
      var by = {}; raw.forEach(function (x) { by[x.time] = x.close; });
      var b0 = null, out = [];
      for (var i = 0; i < c.length; i++) {
        var v = by[c[i].time];
        if (v == null) continue;
        if (b0 === null) b0 = v;
        out.push({ time: c[i].time, value: +(base * v / b0).toFixed(2) });
      }
      if (out.length < 10) return;
      if (cmpLeft) out = out.map(function (x) { return { time: x.time, value: +(by[x.time]).toFixed(2) }; });
      var sr = chart.addSeries(LWC.LineSeries, { color: CMP_COLS[n % CMP_COLS.length], lineWidth: 2,
        lineStyle: 2, priceLineVisible: false, lastValueVisible: cmpLeft, priceScaleId: cmpLeft ? 'left' : 'right', visible: !LNHID['cmp:' + t] }, 0);
      sr.setData(out); cmpSeries[t] = sr;
    });
    // the left axis is set on every pane: lit on the price pane alone, the library fails to paint the others
    var lv = cmpLeft && Object.keys(cmpSeries).length > 0;
    try { chart.panes().forEach(function (pn, pi) { chart.priceScale('left', pi).applyOptions(pi ? { visible: lv } : { visible: lv, invertScale: lv && cmpMode === 'leftinv' }); }); } catch (e) {}
    renderCmpChips();
    try { liveKeys().forEach(function (k) { if (defOf(k) === STUDIES.corr && STUDIES.corr) drawStudy(k); }); } catch (e) {}   // the correlation follows Compare
  }
  function addCompare(t) {
    t = (t || '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
    if (!t || cmpList.indexOf(t) >= 0 || cmpList.length >= 4) return;
    fetch('/api/mini-candles?n=600&t=' + encodeURIComponent(t))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j[t] || !j[t].length) { cmpNote('No history for ' + t); return; }
        cmpData[t] = j[t]; cmpList.push(t); saveCmp(); drawCmp(); cmpNote('');
      }).catch(function () { cmpNote('Could not load ' + t); });
  }
  function dropCompare(t) {
    cmpList = cmpList.filter(function (x) { return x !== t; });
    saveCmp(); drawCmp();
  }
  function cmpNote(m) { var e = document.getElementById('cp-cmp-note'); if (e) e.textContent = m || ''; }
  var cmpLeft = false; try { cmpLeft = localStorage.getItem('pi_cmp_left') === '1'; } catch (e) {}
  var cmpMode = 'overlay'; try { cmpMode = localStorage.getItem('pi_cmp_mode') || (cmpLeft ? 'left' : 'overlay'); } catch (e) {}
  var cmpPanes = {};
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'cp-cmp-mode') { cmpMode = e.target.value; cmpLeft = cmpMode === 'left' || cmpMode === 'leftinv'; try { localStorage.setItem('pi_cmp_mode', cmpMode); localStorage.setItem('pi_cmp_left', cmpLeft ? '1' : '0'); } catch (e2) {} drawCmp(); } });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'cp-cmp-left') { cmpLeft = !!e.target.checked; try { localStorage.setItem('pi_cmp_left', cmpLeft ? '1' : '0'); } catch (e2) {} drawCmp(); } });
  function renderCmpChips() {
    var host = document.getElementById('cp-cmp-chips'); if (!host) return;
    host.innerHTML = cmpList.map(function (t, n) {
      return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-sepia-border">'
        + '<span style="width:8px;height:8px;border-radius:2px;background:' + CMP_COLS[n % CMP_COLS.length] + '"></span>'
        + t + '<button type="button" data-cmpx="' + t + '" class="text-ink-mute hover:text-ink">&times;</button></span>';
    }).join(' ');
    Array.prototype.forEach.call(host.querySelectorAll('[data-cmpx]'), function (b2) {
      b2.addEventListener('click', function () { dropCompare(this.getAttribute('data-cmpx')); });
    });
  }
  // ── macro lines (FRED): each in its own pane, on its own units ───────────
  // One list for every chart: a rate or a spread is context for any name.
  var macList = [], macData = {}, macSeries = {}, macNames = {};
  try { macList = JSON.parse(localStorage.getItem('pi_cmp_macro') || '[]') || []; } catch (e) {}
  function saveMac() { try { localStorage.setItem('pi_cmp_macro', JSON.stringify(macList)); } catch (e) {} }
  function drawMac() {
    Object.keys(macSeries).forEach(function (k) { try { chart.removeSeries(macSeries[k]); } catch (e) {} });
    macSeries = {};
    try { var ps = chart.panes(); for (var p = ps.length - 1; p > 0; p--) if (!ps[p].getSeries().length) chart.removePane(p); } catch (e) {}
    var c = bars(); if (!c.length) return;
    macList.forEach(function (k, n) {
      var raw = macData[k]; if (!raw || !raw.length) return;
      // monthly and weekly prints hold until the next one
      var out = [], j = 0, last = null;
      for (var i = 0; i < c.length; i++) {
        while (j < raw.length && raw[j].t <= c[i].time) { last = raw[j].v; j++; }
        if (last != null) out.push({ time: c[i].time, value: last });
      }
      if (out.length < 5) return;
      try { chart.addPane(); var idx = chart.panes().length - 1;
        var sr = chart.addSeries(LWC.LineSeries, { color: CMP_COLS[(n + 2) % CMP_COLS.length], lineWidth: 2, priceLineVisible: false }, idx);
        sr.setData(out); macSeries[k] = sr;
        LWC.createTextWatermark(chart.panes()[idx], { horzAlign: 'left', vertAlign: 'top', lines: [{ text: '  ' + (macNames[k] || k), color: TR('mute', 0.85), fontSize: 11 }] }); } catch (e) {}
    });
    fitHeight();   // stretch factors: every pane keeps a readable share, the price the most
    renderMacChips();
  }
  function renderMacChips() {
    var host = document.getElementById('cp-mac-chips'); if (!host) return;
    host.innerHTML = macList.map(function (k) {
      return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-sepia-border">' + (macNames[k] || k)
        + '<button type="button" data-macx="' + k + '" class="text-ink-mute hover:text-ink">&times;</button></span>'; }).join(' ');
    Array.prototype.forEach.call(host.querySelectorAll('[data-macx]'), function (b2) {
      b2.addEventListener('click', function () { var k = this.getAttribute('data-macx');
        macList = macList.filter(function (x) { return x !== k; }); saveMac(); drawMac(); });
    });
  }
  function addMac(k, quiet) {
    if (!k || (!quiet && macList.indexOf(k) >= 0) || macList.length >= 3 && !quiet) return;
    fetch('/api/macro-series?id=' + encodeURIComponent(k)).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.points || !j.points.length) { cmpNote('No data for this series'); return; }
      macData[k] = j.points; macNames[k] = j.name;
      if (macList.indexOf(k) < 0) { macList.push(k); saveMac(); }
      drawMac();
    }).catch(function () {});
  }
  function loadMac() {
    var sel = document.getElementById('cp-mac-sel');
    if (sel) fetch('/api/macro-series').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      (j && j.series || []).forEach(function (s) { var o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); });
    }).catch(function () {});
    if (sel) sel.addEventListener('change', function () { addMac(this.value); this.value = ''; });
    macList.slice().forEach(function (k) { addMac(k, true); });
  }
  function loadCmp() {
    var saved = [];
    var raw0 = null; try { raw0 = localStorage.getItem(cmpKey()); saved = JSON.parse(raw0 || '[]') || []; } catch (e) {}
    // dark f5021_afficher_force_marche_sur_graphique: the S&P sits on the chart by default,
    // rebased, so the reader sees at a glance if the name moves with the market or against it.
    // A reader who drops it keeps it dropped (the key then holds []). Since the chart opens
    // bare (24/10/2026), only a member who saved chart settings before gets it by default.
    var tk0 = ((document.getElementById('chart-snap') || {}).dataset || {}).ticker;
    if (window.__piMktLine && !(H.mktLineOn && !H.mktLineOn()) && raw0 === null && tk0 && tk0 !== 'SPY') saved = ['SPY'];
    if (!saved.length) { renderCmpChips(); return; }
    fetch('/api/mini-candles?n=600&t=' + encodeURIComponent(saved.join(',')))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        saved.forEach(function (t) { if (j[t] && j[t].length) { cmpData[t] = j[t]; cmpList.push(t); } });
        drawCmp();
      }).catch(function () {});
  }
  function buildCompare() {
    var host = document.getElementById('cp-cmp-list'); if (!host) return;
    host.innerHTML = '<p class="text-ink-mute mb-1">Put another name on this chart. Both lines start together, '
      + 'so the space between them is the performance gap.</p>'
      + '<div class="flex items-center gap-1 mb-2"><input id="cp-cmp-in" placeholder="Ticker"'
      + ' class="border border-sepia-border rounded-lg bg-white px-2 py-1" style="width:6rem">'
      + '<button type="button" id="cp-cmp-add" class="px-2 py-1 rounded-lg bg-accent text-white font-semibold">Add</button></div>'
      + '<div id="cp-cmp-chips" class="flex flex-wrap gap-1"></div>'
      + '<label class="flex items-center gap-1 text-ink-mute mt-1"><span>Draw it</span><select id="cp-cmp-mode" class="border border-sepia-border rounded-lg bg-white px-1">'
      + '<option value="overlay"' + (cmpMode === 'overlay' ? ' selected' : '') + '>on the price, rebased</option><option value="left"' + (cmpMode === 'left' ? ' selected' : '') + '>on its own scale, left</option>'
      + (window.__piKerbSet ? '<option value="leftinv"' + (cmpMode === 'leftinv' ? ' selected' : '') + '>on its own scale, left, upside down</option>' : '')
      + '<option value="pane"' + (cmpMode === 'pane' ? ' selected' : '') + '>in its own pane, as candles</option></select></label>'
      + '<p id="cp-cmp-note" class="text-ink-mute mt-1"></p>'
      + '<p class="text-ink-mute mt-2 mb-1">Or a macro line in its own pane: rates, spreads, the Fed, jobs, prices.</p>'
      + '<select id="cp-mac-sel" class="border border-sepia-border rounded-lg bg-white px-1 py-1" style="max-width:100%"><option value="">Add a macro line\u2026</option></select>'
      + '<div id="cp-mac-chips" class="flex flex-wrap gap-1 mt-1"></div>';
    var inp = document.getElementById('cp-cmp-in'), add = document.getElementById('cp-cmp-add');
    function go() { if (inp) { addCompare(inp.value); inp.value = ''; } }
    if (add) add.addEventListener('click', go);
    if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    loadCmp(); loadMac();
  }

  // ── quick styling, top right ─────────────────────────────────────────────
  var LOOK = { grid: true, gridv: false, lastLine: true, spacing: 6, pal: 'house', pv: 3, patterns: false,
               bg: 'auto', up: '', dn: '', wick: true, border: true, badges: false, legend: true, font: 11, cross: 'dashed',
               watermark: true, alerts: true, vol: true, volSize: 'normal', volAlpha: 0.38, lv: 2, status: { ohlc: true, vol: true, chg: true, cr: true, ind: true } };
  if (window.__piShell) { LOOK.grid = false; LOOK.gridv = false; LOOK.badges = true; }
  // 'house' follows the app (pi-chart.js, --pi-good / --pi-bad, light and dark); the others are the member's own picks
  var PALETTES = { tv: ['#089981', '#f23645'], house: ['', ''], mono: ['#3a362e', '#9a9384'],
                   classic: ['#26a69a', '#ef5350'], bold: ['#0f9d58', '#db4437'] };
  function housePal() { try { var t = PI_CHART.theme(); return [t.good, t.bad]; } catch (e) { return ['', '']; } }
  function hex6(c) { var r = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); if (!r) return c || '#000000'; return '#' + [r[1], r[2], r[3]].map(function (n) { return ('0' + (+n).toString(16)).slice(-2); }).join(''); }
  function palOf(k) { return k === 'house' || !PALETTES[k] ? housePal() : PALETTES[k]; }
  var SHELL_BG = { white: ['#ffffff', '#787b86', '#e0e3eb'], cream: ['#f9f5ee', '#6b6660', '#e7e1d8'], dark: ['#131722', '#787b86', '#2a2e39'] };
  function isDarkApp() { return document.documentElement.classList.contains('dark'); }
  function applyLook() {
    var p2 = palOf(LOOK.pal), up = LOOK.up || p2[0], dn = LOOK.dn || p2[1];
    function rgba(hex, a) { var r = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(hex || ''); if (r) return 'rgba(' + r[1] + ',' + r[2] + ',' + r[3] + ',' + a + ')'; var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); return m ? 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')' : null; }
    try { H.look({ grid: LOOK.grid, gridv: LOOK.gridv, lastLine: LOOK.lastLine, up: up, dn: dn, spacing: LOOK.spacing, upv: rgba(up, +LOOK.volAlpha || 0.38), dnv: rgba(dn, +LOOK.volAlpha || 0.38) }); } catch (e) {}
    try { H.volVisible(LOOK.vol !== false && !studyState.vol_plus); } catch (e) {}
    try { if (typeof fitHeight === 'function' && H && H.chart) fitHeight(); } catch (e) {}
    try { H.cs.applyOptions({ wickVisible: LOOK.wick !== false, borderVisible: LOOK.border !== false }); } catch (e) {}
    try { H.patterns(LOOK.patterns); } catch (e) {}
    // the surface: follow the app, or a fixed white, cream or dark chart
    try { var key = LOOK.bg === 'auto' ? 'auto' : LOOK.bg, t = key === 'auto' ? (function () { var th = PI_CHART.theme(); return [th.card, th.mute, th.border, th.grid]; })() : (key && SHELL_BG[key]);
      if (t) chart.applyOptions({ layout: { background: { color: t[0] }, textColor: t[1], fontSize: +LOOK.font || 11, panes: { separatorColor: t[2] } },
        grid: { vertLines: { color: LOOK.gridv ? (t[3] || t[2]) : 'rgba(0,0,0,0)' }, horzLines: { color: LOOK.grid ? (t[3] || t[2]) : 'rgba(0,0,0,0)' } },
        rightPriceScale: { borderColor: t[2] }, timeScale: { borderColor: t[2] } });
      else chart.applyOptions({ layout: { fontSize: +LOOK.font || 11 } });
      var cl = LOOK.cross === 'hidden' ? 0 : 1, st = LOOK.cross === 'solid' ? 0 : 2;
      var dk = key === 'dark', cc, cb; if (key === 'auto') { var th2 = PI_CHART.theme(); cc = th2.border; cb = th2.accent; } else { cc = dk ? '#758696' : '#9598a1'; cb = dk ? '#4c525e' : '#131722'; }
      chart.applyOptions({ crosshair: { vertLine: { visible: !!cl, style: st, color: cc, labelBackgroundColor: cb }, horzLine: { visible: !!cl, style: st, color: cc, labelBackgroundColor: cb } } });
      try { H.watermark(LOOK.watermark !== false); } catch (e) {}
      window.__piStatus = LOOK.status || {}; try { H.readout(null); } catch (e) {}
      try { drawAlertLines(); } catch (e) {}
    } catch (e) {}
    var was = !!window.__piAxisBadges; window.__piAxisBadges = !!LOOK.badges;
    if (was !== !!LOOK.badges) { try { H.clip(replay ? replay.i : null); } catch (e) {} }
    try { H.hideReadout(LOOK.legend === false); } catch (e) {}
    try { localStorage.setItem('pi_chart_look', JSON.stringify(LOOK)); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('cp-look')); } catch (e) {}
    pushSettings();
  }
  try { new MutationObserver(function () { if (H) applyLook(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }); } catch (e) {}
  function loadLook() {
    try { var j = JSON.parse(localStorage.getItem('pi_chart_look') || 'null');
      if (j) Object.keys(LOOK).forEach(function (k) { if (j[k] == null) return; if (j.lv !== 2 && (k === 'grid' || k === 'gridv' || k === 'bg' || k === 'lv')) return; if (j.pv !== 3 && (k === 'pal' || k === 'up' || k === 'dn' || k === 'bg')) return; if (k === 'status' && typeof j[k] === 'object') { Object.keys(j[k]).forEach(function (q) { LOOK.status[q] = j[k][q]; }); } else LOOK[k] = j[k]; }); } catch (e) {}
  }
  function buildLook() {
    loadLook();
    var b = document.getElementById('cp-look');
    if (b && !b._wired) { b._wired = true; b.addEventListener('click', function (ev) { ev.preventDefault(); openSettingsDialog(); }); }
    applyLook();
  }
  // ── the settings dialog, laid out the way TradingView lays out its own:
  // sections on the left, the rows of one section on the right, Cancel puts
  // everything back, OK keeps it. Every change applies as you make it.
  var SET_TABS = [['symbol', 'Symbol'], ['status', 'Status line'], ['scales', 'Scales and lines'], ['canvas', 'Canvas'], ['volume', 'Volume'], ['events', 'Events'], ['alerts', 'Alerts']];
  var cfgEl = null, cfgTab = 'symbol', cfgSnap = null;
  function cfgCss() {
    if (document.getElementById('cp-set-css')) return;
    var st = document.createElement('style'); st.id = 'cp-set-css';
    st.textContent = '#cp-settings{position:fixed;inset:0;z-index:95;display:flex;align-items:center;justify-content:center;background:rgb(var(--pi-ink) / .35);font:13px/1.4 -apple-system,"Inter","Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:rgb(var(--pi-ink))}'
      + '#cp-settings .box{width:min(760px,94vw);height:min(560px,88vh);background:rgb(var(--pi-card));border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.28);display:grid;grid-template-columns:200px 1fr;grid-template-rows:48px 1fr 56px;grid-template-areas:"hd hd" "nav body" "ft ft";overflow:hidden}'
      + '#cp-settings .hd{grid-area:hd;display:flex;align-items:center;padding:0 16px;font-weight:600;font-size:15px;border-bottom:1px solid rgb(var(--pi-border))}'
      + '#cp-settings .hd button{margin-left:auto;border:0;background:transparent;font-size:18px;color:rgb(var(--pi-ink-mute));cursor:pointer;width:28px;height:28px;border-radius:6px} #cp-settings .hd button:hover{background:rgb(var(--pi-ink) / .06);color:rgb(var(--pi-ink))}'
      + '#cp-settings .nav{grid-area:nav;border-right:1px solid rgb(var(--pi-border));padding:10px 8px;display:flex;flex-direction:column;gap:2px}'
      + '#cp-settings .nav button{text-align:left;border:0;background:transparent;padding:8px 12px;border-radius:8px;font:inherit;color:rgb(var(--pi-ink));cursor:pointer} #cp-settings .nav button:hover{background:rgb(var(--pi-ink) / .06)} #cp-settings .nav button.on{background:rgba(19,23,34,.08);font-weight:600}'
      + '#cp-settings .body{grid-area:body;overflow:auto;padding:14px 22px}'
      + '#cp-settings h4{margin:14px 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:rgb(var(--pi-ink-mute));font-weight:600} #cp-settings h4:first-child{margin-top:2px}'
      + '#cp-settings .row{display:flex;align-items:center;gap:10px;min-height:36px;font-weight:400} #cp-settings .row .lb{flex:1;font-weight:400} #cp-settings .row select,#cp-settings .row input[type=number]{height:30px;border:1px solid rgb(var(--pi-border));border-radius:6px;padding:0 8px;background:rgb(var(--pi-card));color:rgb(var(--pi-ink));font:inherit;min-width:160px}'
      + '#cp-settings .row input[type=checkbox]{width:16px;height:16px;accent-color:rgb(var(--pi-accent))} #cp-settings .row input[type=color]{width:34px;height:26px;padding:0;border:1px solid rgb(var(--pi-border));border-radius:6px;background:rgb(var(--pi-card))} #cp-settings .row input[type=range]{width:160px;accent-color:rgb(var(--pi-accent))}'
      + '#cp-settings .row .lnk{border:0;background:transparent;color:rgb(var(--pi-accent));cursor:pointer;font:inherit} #cp-settings .pal{display:inline-flex;align-items:center;gap:6px;border:1px solid rgb(var(--pi-border));border-radius:6px;padding:4px 8px;background:rgb(var(--pi-card));cursor:pointer;font:inherit;text-transform:capitalize} #cp-settings .pal.on{border-color:rgb(var(--pi-accent));box-shadow:0 0 0 1px rgb(var(--pi-accent))} #cp-settings .pal i{width:10px;height:10px;border-radius:2px;display:inline-block}'
      + '#cp-settings .ft{grid-area:ft;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 16px;border-top:1px solid rgb(var(--pi-border))}'
      + '#cp-settings .ft button{height:34px;padding:0 18px;border-radius:8px;border:1px solid rgb(var(--pi-border));background:rgb(var(--pi-card));font:inherit;font-weight:600;cursor:pointer;color:rgb(var(--pi-ink))} #cp-settings .ft .ok{background:rgb(var(--pi-accent));color:#fff;border-color:rgb(var(--pi-accent))} #cp-settings .ft .ok:hover{background:rgb(var(--pi-border))}'
      + '#cp-settings .hint{color:rgb(var(--pi-ink-mute));font-size:12px;margin:2px 0 6px}'
      + 'html.dark #cp-settings{color:rgb(var(--pi-ink))} html.dark #cp-settings .box,html.dark #cp-settings .row select,html.dark #cp-settings .row input,html.dark #cp-settings .pal,html.dark #cp-settings .ft button{background:rgb(var(--pi-card));color:rgb(var(--pi-ink));border-color:rgb(var(--pi-border))} html.dark #cp-settings .hd,html.dark #cp-settings .nav,html.dark #cp-settings .ft{border-color:rgb(var(--pi-border))} html.dark #cp-settings .nav button{color:rgb(var(--pi-ink))} html.dark #cp-settings .nav button.on,html.dark #cp-settings .nav button:hover{background:rgb(var(--pi-ink) / .08)} html.dark #cp-settings .ft .ok{background:rgb(var(--pi-accent));border-color:rgb(var(--pi-accent))}';
    document.head.appendChild(st);
  }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function cfgRows(tab) {
    var st = LOOK.status || {}, p3 = palOf(LOOK.pal);
    function chk(id, label, on) { return '<label class="row"><span class="lb">' + label + '</span><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '></label>'; }
    function sel(id, label, opts, val) { return '<label class="row"><span class="lb">' + label + '</span><select id="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>'; }
    if (tab === 'symbol') return '<h4>Candles</h4>'
      + '<div class="row"><span class="lb">Up / down colours</span><input type="color" id="lk-up" value="' + hex6(LOOK.up || p3[0]) + '"><input type="color" id="lk-dn" value="' + hex6(LOOK.dn || p3[1]) + '"><button type="button" class="lnk" id="lk-reset">Back to the palette</button></div>'
      + '<div class="row"><span class="lb">Palette</span>' + Object.keys(PALETTES).map(function (k) { return '<button type="button" class="pal' + (LOOK.pal === k ? ' on' : '') + '" data-pal="' + k + '"><i style="background:' + palOf(k)[0] + '"></i><i style="background:' + palOf(k)[1] + '"></i>' + k + '</button>'; }).join('') + '</div>'
      + chk('lk-wick', 'Wicks', LOOK.wick !== false) + chk('lk-border', 'Body borders', LOOK.border !== false)
      + '<div class="row"><span class="lb">Bar width</span><input type="range" id="lk-sp" min="2" max="18" step="1" value="' + LOOK.spacing + '"></div>'
      + '<h4>On the price</h4>' + chk('lk-last', 'Last price line and label', LOOK.lastLine !== false) + chk('lk-pat', 'Name the bar shapes (hammer, engulfing…)', !!LOOK.patterns);
    if (tab === 'status') return '<h4>Status line, top left</h4><p class="hint">What the line above the chart reads for the bar under the cursor.</p>'
      + chk('lk-st-ohlc', 'Open, high, low, close', st.ohlc !== false) + chk('lk-st-vol', 'Volume and dollar volume', st.vol !== false)
      + chk('lk-st-chg', 'Change on the day', st.chg !== false) + chk('lk-st-cr', 'Closing range', st.cr !== false)
      + chk('lk-st-ind', 'Second line: averages, desk score, stage, RS rating', st.ind !== false)
      + '<h4>Indicators</h4>' + chk('lk-legend', 'Legend rows with their last value', LOOK.legend !== false);
    if (tab === 'scales') return '<h4>Price scale</h4>'
      + sel('lk-scale', 'Scale', [['normal', 'Auto'], ['log', 'Logarithmic'], ['percent', 'Percent'], ['indexed', 'Indexed to 100']], scaleName)
      + chk('lk-badges', 'Level badges on the price axis (support, walls, alerts)', !!LOOK.badges)
      + '<h4>Lines</h4>' + sel('lk-cross', 'Crosshair', [['dashed', 'Dashed'], ['solid', 'Solid'], ['hidden', 'Hidden']], LOOK.cross)
      + chk('lk-grid', 'Horizontal grid lines', !!LOOK.grid) + chk('lk-gridv', 'Vertical grid lines', !!LOOK.gridv);
    if (tab === 'canvas') return '<h4>Background</h4>'
      + sel('lk-bg', 'Surface', [['auto', 'Follow the app'], ['white', 'White'], ['cream', 'Cream'], ['dark', 'Dark']], LOOK.bg)
      + sel('lk-font', 'Text size', [[10, '10'], [11, '11'], [12, '12'], [13, '13']], LOOK.font || 11)
      + '<h4>Watermark</h4>' + chk('lk-wm', 'Name and industry behind the price', LOOK.watermark !== false)
      + (window.__cpFloatBar ? '<h4>Drawing</h4>' + chk('lk-fbar', 'Floating drawing bar', window.__cpFloatBar.on()) : '');
    if (tab === 'volume') return '<h4>Volume pane</h4><p class="hint">Its own pane under the price. Drag the separator to resize it, or pick a size here.</p>'
      + chk('lk-vol', 'Show the volume', LOOK.vol !== false)
      + sel('lk-volsize', 'Pane height', [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']], LOOK.volSize || 'normal')
      + sel('lk-volalpha', 'Bar opacity', [[0.25, 'Light'], [0.38, 'Normal'], [0.6, 'Strong'], [1, 'Solid']], LOOK.volAlpha || 0.38)
      + '<p class="hint">Bars take the candle colours: up sessions in the up colour, down sessions in the down colour.</p>';
    if (tab === 'events') { var mk = false; try { mk = !!H.marksOn(); } catch (e) {}
      return '<h4>On the bars</h4><p class="hint">Earnings, the sessions our screens flagged, insider buys and sells, record volume.</p>'
      + chk('lk-marks', 'Events on the price', mk) + chk('lk-news', 'News on the bars (N on the session a headline landed)', !!studyState.newsm); }
    if (tab === 'alerts') return '<h4>Price alerts</h4><p class="hint">Alerts you set from the axis or the right click show as dashed lines you can drag.</p>'
      + chk('lk-alerts', 'Show the alert lines', LOOK.alerts !== false)
      + '<div class="row"><span class="lb">Manage them in the side panel</span><button type="button" class="lnk" id="lk-alerts-dock">Open the alerts panel</button></div>';
    return '';
  }
  function cfgWire(body) {
    function on(id, ev, fn) { var e = body.querySelector('#' + id); if (e) e.addEventListener(ev, fn); }
    function bind(id, key) { on(id, 'change', function () { LOOK[key] = this.checked; applyLook(); }); }
    bind('lk-grid', 'grid'); bind('lk-gridv', 'gridv'); bind('lk-last', 'lastLine'); bind('lk-pat', 'patterns'); bind('lk-badges', 'badges'); bind('lk-wick', 'wick'); bind('lk-border', 'border'); bind('lk-legend', 'legend'); bind('lk-wm', 'watermark'); bind('lk-alerts', 'alerts');
    [['lk-bg', 'bg'], ['lk-cross', 'cross']].forEach(function (x) { on(x[0], 'change', function () { LOOK[x[1]] = this.value; applyLook(); }); });
    on('lk-font', 'change', function () { LOOK.font = +this.value; applyLook(); });
    on('lk-up', 'change', function () { LOOK.up = this.value; applyLook(); }); on('lk-dn', 'change', function () { LOOK.dn = this.value; applyLook(); });
    on('lk-reset', 'click', function () { LOOK.up = ''; LOOK.dn = ''; applyLook(); cfgRender(); });
    on('lk-sp', 'input', function () { LOOK.spacing = +this.value; applyLook(); });
    Array.prototype.forEach.call(body.querySelectorAll('[data-pal]'), function (b2) { b2.addEventListener('click', function () { LOOK.pal = this.getAttribute('data-pal'); LOOK.up = ''; LOOK.dn = ''; applyLook(); cfgRender(); }); });
    ['ohlc', 'vol', 'chg', 'cr', 'ind'].forEach(function (q) { on('lk-st-' + q, 'change', function () { LOOK.status = LOOK.status || {}; LOOK.status[q] = this.checked; applyLook(); }); });
    on('lk-scale', 'change', function () { setScale2(this.value); });
    bind('lk-vol', 'vol'); on('lk-volsize', 'change', function () { LOOK.volSize = this.value; applyLook(); }); on('lk-volalpha', 'change', function () { LOOK.volAlpha = +this.value; applyLook(); });
    on('lk-marks', 'change', function () { var b2 = document.getElementById('tf-marks'); if (b2) b2.click(); });
    on('lk-news', 'change', function () { window.__cp.toggleStudy('newsm'); });
    on('lk-fbar', 'change', function () { if (window.__cpFloatBar) window.__cpFloatBar.set(this.checked); });
    on('lk-alerts-dock', 'click', function () { closeSettings(false); dockTo('alerts'); });
  }
  function cfgRender() {
    if (!cfgEl) return;
    Array.prototype.forEach.call(cfgEl.querySelectorAll('.nav button'), function (b2) { b2.className = b2.getAttribute('data-tab') === cfgTab ? 'on' : ''; });
    var body = cfgEl.querySelector('.body'); body.innerHTML = cfgRows(cfgTab); cfgWire(body);
  }
  function closeSettings(revert) {
    if (!cfgEl) return;
    if (revert && cfgSnap) { try { var j = JSON.parse(cfgSnap); Object.keys(j).forEach(function (k) { LOOK[k] = j[k]; }); } catch (e) {} applyLook(); }
    cfgEl.remove(); cfgEl = null; cfgSnap = null;
  }
  function openSettingsDialog(tab) {
    cfgCss(); if (cfgEl) closeSettings(false);
    if (tab) cfgTab = tab;
    cfgSnap = JSON.stringify(LOOK);
    cfgEl = document.createElement('div'); cfgEl.id = 'cp-settings';
    cfgEl.innerHTML = '<div class="box" role="dialog" aria-label="Chart settings"><div class="hd">Chart settings<button type="button" data-x title="Close">✕</button></div>'
      + '<div class="nav">' + SET_TABS.map(function (t) { return '<button type="button" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>'
      + '<div class="body"></div><div class="ft"><button type="button" data-cancel>Cancel</button><button type="button" class="ok" data-ok>OK</button></div></div>';
    document.body.appendChild(cfgEl);
    Array.prototype.forEach.call(cfgEl.querySelectorAll('.nav button'), function (b2) { b2.addEventListener('click', function () { cfgTab = this.getAttribute('data-tab'); cfgRender(); }); });
    cfgEl.querySelector('[data-x]').addEventListener('click', function () { closeSettings(true); });
    cfgEl.querySelector('[data-cancel]').addEventListener('click', function () { closeSettings(true); });
    cfgEl.querySelector('[data-ok]').addEventListener('click', function () { closeSettings(false); });
    cfgEl.addEventListener('mousedown', function (ev) { if (ev.target === cfgEl) closeSettings(true); });
    cfgRender();
  }
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && cfgEl) closeSettings(true); });

  // ── command palette ──────────────────────────────────────────────────────
  // One box for everything the chart can do. Favourites float to the top, so the
  // three things you actually use are always the first three lines.
  var palEl = null, palIn = null, palList = null, palRows = [], palSel = 0, palTab = 'All';
  var PAL_TABS = ['All', 'Indicators', 'Templates', 'Drawings', 'Chart types', 'Layers', 'Timeframes', 'Actions'];
  function favs() { try { return JSON.parse(localStorage.getItem('pi_chart_favs') || '[]') || []; } catch (e) { return []; } }
  function toggleFav(id) {
    var f = favs(), i = f.indexOf(id);
    if (i >= 0) f.splice(i, 1); else f.push(id);
    try { localStorage.setItem('pi_chart_favs', JSON.stringify(f)); } catch (e) {}
    pushSettings(); renderPal();
  }
  function palEntries() {
    var out = [];
    Object.keys(STUDIES).forEach(function (k) {
      out.push({ id: 'i:' + k, tab: 'Indicators', label: STUDIES[k].label,
        hint: studyState[k] ? 'on' : '', run: function () {
          studyState[k] = !studyState[k];
          var cb = document.getElementById('cp-s-' + k); if (cb) cb.checked = studyState[k];
          drawStudy(k); fitHeight(); saveState(); } });
    });
    Object.keys(HOUSE).forEach(function (k) {
      out.push({ id: 't:' + k, tab: 'Templates', label: HOUSE[k].label, hint: HOUSE[k].note,
        run: function () { applyTemplate(HOUSE[k]); } });
    });
    var mine = myTemplates();
    Object.keys(mine).forEach(function (n) {
      out.push({ id: 'tm:' + n, tab: 'Templates', label: n, hint: 'yours',
        run: function () { applyTemplate(mine[n]); } });
    });
    Object.keys(TYPES).forEach(function (k) {
      out.push({ id: 'y:' + k, tab: 'Chart types', label: TYPES[k].label,
        hint: mode === k ? 'current' : '', run: function () { mode = k; applyType(); markType(); saveState(); } });
    });
    toolDefs().forEach(function (d) {
      out.push({ id: 'd:' + d.type, tab: 'Drawings', label: d.name,
        hint: d.requiredAnchors + ' clicks', run: function () { setTool(d.type); } });
    });
    [['tf-levels', 'Support and resistance'], ['tf-marks', 'Events on the price'],
     ['tf-zones', 'Value zones'], ['tf-walls', 'Dealer walls'], ['tf-mmap', 'Money map'], ['tf-spy', 'The S&P, rebased']]
      .forEach(function (r) {
        if (!document.getElementById(r[0]) || document.getElementById(r[0]).disabled) return;
        out.push({ id: 'l:' + r[0], tab: 'Layers', label: r[1],
          hint: document.getElementById(r[0]).className.indexOf('bg-accent') >= 0 ? 'on' : '',
          run: function () { document.getElementById(r[0]).click(); } });
      });
    [['tf-d', 'Daily'], ['tf-w', 'Weekly'], ['tf-m', 'Monthly']].forEach(function (r) {
      out.push({ id: 'f:' + r[0], tab: 'Timeframes', label: r[1],
        run: function () { var b2 = document.getElementById(r[0]); if (b2) b2.click(); } });
    });
    out.push({ id: 'a:replay', tab: 'Actions', label: replay ? 'Leave replay' : 'Bar replay',
      run: function () { if (replay) stopReplay(); else startReplay(); } });
    out.push({ id: 'a:log', tab: 'Actions', label: 'Logarithmic scale',
      run: function () { var b2 = document.getElementById('tf-log'); if (b2) b2.click(); } });
    out.push({ id: 'a:full', tab: 'Actions', label: 'Full screen',
      run: function () { var b2 = document.getElementById('tf-full'); if (b2) b2.click(); } });
    out.push({ id: 'a:csv', tab: 'Actions', label: 'Export the chart data (CSV)', run: exportCsv });
    out.push({ id: 'a:tpo', tab: 'Indicators', label: tpoOn ? 'TPO / market profile: off' : 'TPO / market profile: on (intraday)', run: function () { setSessionLayer('tpo', !tpoOn); } });
    out.push({ id: 'a:svp', tab: 'Indicators', label: svpOn ? 'Volume profile per session: off' : 'Volume profile per session: on (intraday)', run: function () { setSessionLayer('svp', !svpOn); } });
    out.push({ id: 'a:png', tab: 'Actions', label: 'Save the chart as an image',
      run: function () { var b2 = document.getElementById('chart-snap'); if (b2) b2.click(); } });
    out.push({ id: 'a:clean', tab: 'Actions', label: 'Clean slate, clear every study',
      run: function () { applyTemplate(HOUSE.clean); } });
    out.push({ id: 'a:save', tab: 'Actions', label: 'Save this set as a template',
      run: function () { var n = window.prompt('Name this set of indicators'); if (n) saveTemplate(n.slice(0, 40)); } });
    (function () {
      var c = H.candles(); if (!c.length) return;
      var cl = c.map(function (x) { return x.close; }), hi20 = hhv(c, 20, 'high'), m50 = sma(cl, 50), last = cl[cl.length - 1];
      var h = hi20[hi20.length - 1], m = m50[m50.length - 1];
      if (h) out.push({ id: 'al:hi20', tab: 'Actions', label: 'Alert preset: breaks its 20-day high (' + h.toFixed(2) + ')',
        run: function () { presetAlert('above', h, ''); } });
      if (m) out.push({ id: 'al:ma50', tab: 'Actions', label: 'Alert preset: comes back to its 50-day (' + m.toFixed(2) + ')',
        run: function () { presetAlert(last >= m ? 'below' : 'above', m, ''); } });
      out.push({ id: 'al:rs', tab: 'Actions', label: 'Alert preset: my level, only if its RS rating is 90+',
        run: function () { presetAlert('above', last, 'rs90'); } });
      out.push({ id: 'al:flag', tab: 'Actions', label: 'Alert preset: my level, only if a board flags it',
        run: function () { presetAlert('above', last, 'flagged'); } });
    })();
    out.push({ id: 'a:goto', tab: 'Actions', label: 'Go to a date', hint: 'Alt+G',
      run: function () { gotoAsk(); } });
    out.push({ id: 'a:next', tab: 'Actions', label: 'Next name on my watchlist', hint: '\u2193', run: function () { flipWatch(1); } });
    out.push({ id: 'a:board', tab: 'Actions', label: 'Next name on the board I came from', hint: 'Space', run: function () { flipBoard(1); } });
    out.push({ id: 'a:prev', tab: 'Actions', label: 'Previous name on my watchlist', hint: '\u2191', run: function () { flipWatch(-1); } });
    out.push({ id: 'a:magnet', tab: 'Actions', label: magnetOn ? 'Magnet off' : 'Magnet on', hint: tvKeys() ? keyDisp('Mod').replace(/\+$/, '') : 'Shift',
      run: function () { setMagnet(!magnetOn); } });
    out.push({ id: 'a:objs', tab: 'Actions', label: 'Objects: every drawing on this name', run: function () { toggleObjs(); } });
    out.push({ id: 'a:undo', tab: 'Actions', label: 'Undo the last drawing', hint: '\u2318Z', run: function () { undoDrawing(); } });
    out.push({ id: 'a:redo', tab: 'Actions', label: 'Redo the last undone drawing', hint: '\u21e7\u2318Z', run: function () { redoDrawing(); } });
    out.push({ id: 'a:keys', tab: 'Actions', label: 'Keyboard shortcuts', hint: '?', run: function () { showKeys(); } });
    out.push({ id: 'a:ind', tab: 'Indicators', label: 'Open the indicators dialog: search, categories, favourites', run: function () { openIndicators(); } });
    out.push({ id: 'a:rvpf', tab: 'Indicators', label: rvpFollow ? 'Volume profile of the visible range: off' : 'Volume profile of the visible range: on',
      run: function () { setRvpFollow(!rvpFollow); } });
    out.push({ id: 'a:snap', tab: 'Actions', label: 'Share a snapshot: a public link to this chart as an image', run: function () { shareSnapshot(); } });
    [['normal', 'Scale: normal'], ['log', 'Scale: logarithmic'], ['percent', 'Scale: percent from the first bar'], ['indexed', 'Scale: indexed to 100']].forEach(function (x) {
      out.push({ id: 'sc:' + x[0], tab: 'Actions', label: x[1], run: function () { setScale(x[0]); } }); });
    out.push({ id: 'sc:invert', tab: 'Actions', label: 'Invert the price scale', run: function () { invertScale(); } });
    INTERVALS.forEach(function (x) { out.push({ id: 'iv:' + x[0], tab: 'Timeframes', label: x[0] === 'D' ? 'Back to daily, weekly, monthly' : 'Bars of ' + x[1] + ' (' + x[0] + ')', run: function () { setInterval2(x[0]); } }); });
    if (tvKeys()) KEYMAP.forEach(function (r) { if (r.l) out.push({ id: 'k:' + (r.c || r.d), tab: 'Actions', label: 'Shortcut: ' + r.l, hint: r.d || keyDisp(r.c), run: function () { if (r.f) r.f(); } }); });
    else HOTKEYS.forEach(function (h) { out.push({ id: 'k:' + h[0], tab: 'Actions', label: 'Shortcut: ' + h[1], hint: h[0], run: function () {} }); });
    return out;
  }
  function renderPal() {
    if (!palList) return;
    var q = (palIn.value || '').toLowerCase().trim(), f = favs();
    var all = palEntries().filter(function (e) {
      if (palTab !== 'All' && e.tab !== palTab) return false;
      return !q || e.label.toLowerCase().indexOf(q) >= 0 || e.tab.toLowerCase().indexOf(q) >= 0;
    });
    all.sort(function (a2, b2) {
      var fa = f.indexOf(a2.id) >= 0 ? 0 : 1, fb = f.indexOf(b2.id) >= 0 ? 0 : 1;
      return fa - fb;
    });
    palRows = all.slice(0, 60);
    if (palSel >= palRows.length) palSel = 0;
    palList.innerHTML = palRows.map(function (e, i) {
      return '<div data-pi="' + i + '" class="flex items-center gap-2 px-2 py-1 rounded-lg '
        + (i === palSel ? 'bg-accent text-white' : 'hover:bg-sepia-hover') + '">'
        + '<span class="flex-1">' + e.label + '</span>'
        + (e.hint ? '<span class="text-ink-mute" style="font-size:10px">' + e.hint + '</span>' : '')
        + '<button type="button" data-fav="' + e.id + '" title="Keep at the top">'
        + (f.indexOf(e.id) >= 0 ? '\u2605' : '\u2606') + '</button>'
        + '<span class="text-ink-mute" style="font-size:10px">' + e.tab + '</span></div>';
    }).join('') || '<p class="text-ink-mute px-2 py-2">Nothing matches.</p>';
    Array.prototype.forEach.call(palList.querySelectorAll('[data-pi]'), function (row) {
      row.addEventListener('mousedown', function (ev) {
        if (ev.target && ev.target.getAttribute('data-fav')) return;
        runPal(+this.getAttribute('data-pi')); });
    });
    Array.prototype.forEach.call(palList.querySelectorAll('[data-fav]'), function (b2) {
      b2.addEventListener('mousedown', function (ev) { ev.preventDefault(); ev.stopPropagation();
        toggleFav(this.getAttribute('data-fav')); });
    });
  }
  function runPal(i) { var e = palRows[i]; if (!e) return; closePal(); try { e.run(); } catch (err) {} }
  function openPal() {
    if (!palEl) return;
    palEl.style.display = 'flex'; palIn.value = ''; palSel = 0; renderPal();
    setTimeout(function () { palIn.focus(); }, 20);
  }
  function closePal() { if (palEl) palEl.style.display = 'none'; }
  function buildPalette() {
    palEl = document.createElement('div');
    palEl.id = 'cp-pal';
    palEl.style.cssText = 'position:fixed;inset:0;z-index:60;display:none;align-items:flex-start;'
      + 'justify-content:center;background:rgba(26,26,26,0.35);padding-top:12vh';
    palEl.innerHTML = '<div class="bg-white border border-sepia-border rounded-xl shadow-lg text-xs" style="width:34rem;max-width:92vw">'
      + '<input id="cp-pal-in" placeholder="Search indicators, templates, drawings, chart types, actions"'
      + ' class="w-full px-3 py-2 rounded-xl bg-white text-ink" style="outline:none;border:0;border-bottom:1px solid #d8cfbb">'
      + '<div id="cp-pal-tabs" class="flex flex-wrap gap-1 px-2 py-2"></div>'
      + '<div id="cp-pal-list" class="p-2" style="max-height:46vh;overflow:auto"></div></div>';
    document.body.appendChild(palEl);
    palIn = palEl.querySelector('#cp-pal-in');
    palList = palEl.querySelector('#cp-pal-list');
    var tabs = palEl.querySelector('#cp-pal-tabs');
    tabs.innerHTML = PAL_TABS.map(function (t) {
      return '<button type="button" data-pt="' + t + '" class="px-2 py-1 rounded-lg '
        + (t === palTab ? 'bg-accent text-white' : 'text-ink-mute hover:bg-sepia-hover') + '">' + t + '</button>';
    }).join('');
    Array.prototype.forEach.call(tabs.querySelectorAll('[data-pt]'), function (b2) {
      b2.addEventListener('click', function () {
        palTab = this.getAttribute('data-pt'); palSel = 0;
        Array.prototype.forEach.call(tabs.querySelectorAll('[data-pt]'), function (x) {
          x.className = 'px-2 py-1 rounded-lg ' + (x === b2 ? 'bg-accent text-white' : 'text-ink-mute hover:bg-sepia-hover'); });
        renderPal(); palIn.focus(); });
    });
    palEl.addEventListener('mousedown', function (e) { if (e.target === palEl) closePal(); });
    palIn.addEventListener('input', function () { palSel = 0; renderPal(); });
    palIn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { palSel = Math.min(palRows.length - 1, palSel + 1); renderPal(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { palSel = Math.max(0, palSel - 1); renderPal(); e.preventDefault(); }
      else if (e.key === 'Enter') { runPal(palSel); e.preventDefault(); }
      else if (e.key === 'Escape') { closePal(); }
    });
    document.addEventListener('keydown', function (e) {
      if (typingIn(e)) return;
      if (e.key === '/' && tvKeys()) return;   // chart_tv_keys: / opens Indicators, the palette keeps Cmd+J
      if (e.key === '/' || (e.key.toLowerCase() === 'j' && (e.metaKey || e.ctrlKey))) { openPal(); e.preventDefault(); }
    });
  }

  // ── toolbar ──────────────────────────────────────────────────────────────
  function pill(b, on) {
    if (!b) return;
    if (on) { b.classList.add('bg-accent', 'text-white'); b.classList.remove('text-ink-mute'); }
    else { b.classList.remove('bg-accent', 'text-white'); b.classList.add('text-ink-mute'); }
  }
  var MENU_BTN = 'inline-flex items-center px-2 py-1 rounded-lg border border-sepia-border text-xs text-ink-mute hover:text-ink cursor-pointer';
  var PANEL = 'absolute right-0 mt-2 z-20 rounded-xl border border-sepia-border bg-white shadow-lg p-3 text-xs';

  function buildToolbar() {
    var host = document.getElementById('ma-menu');
    if (!host || !host.parentNode) return;
    var frag = document.createElement('div');
    frag.className = 'flex flex-wrap items-center gap-2';
    frag.innerHTML =
      '<details id="cp-int" class="menu relative" title="Bars built from the daily ones: two or three days, two weeks, a quarter. The desk layers stay on daily, weekly and monthly.">' +
        '<summary id="cp-int-sum" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-sepia-border text-xs font-medium text-ink-mute hover:bg-sepia-hover list-none cursor-pointer">More</summary>' +
        '<div class="' + PANEL + '" style="width:12rem">'
          + (intraHave().length
              ? '<p class="text-ink-mute uppercase tracking-wide mb-1" style="font-size:10px">Intraday</p>'
                + INTRADAY.filter(function (x) { return intraHave().indexOf(x[0]) >= 0; }).map(function (x) {
                    return '<button type="button" data-intra="' + x[0] + '" class="block w-full text-left px-2 py-1 rounded-lg hover:bg-sepia-hover">' + x[1] + '</button>'; }).join('')
                + '<p class="text-ink-mute mb-1" style="font-size:10px">Intraday from the market feed, about 15 minutes late. Day and above is end of day.</p>'
                + '<p class="text-ink-mute uppercase tracking-wide mt-2 mb-1" style="font-size:10px">Day and above</p>'
              : '')
          + INTERVALS.map(function (x) {
          return '<button type="button" data-int="' + x[0] + '" class="block w-full text-left px-2 py-1 rounded-lg hover:bg-sepia-hover">' + (x[0] === 'D' ? 'Daily, weekly, monthly' : x[0] + ' \u00b7 ' + x[1]) + '</button>'; }).join('')
          + '<p class="text-ink-mute uppercase tracking-wide mt-2 mb-1" style="font-size:10px">View</p><div class="flex flex-wrap gap-1">'
          + ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'].map(function (v) { return '<button type="button" data-view="' + v + '" class="px-1.5 py-0.5 rounded-lg border border-sepia-border hover:bg-sepia-hover">' + v + '</button>'; }).join('') + '</div></div>' +
      '</details>' +
      '<details id="cp-studies" class="menu relative">' +
        '<summary class="' + MENU_BTN + '" title="Add a study. Bollinger draws over the price, the others get their own strip under it.">Studies ▾</summary>' +
        '<div class="' + PANEL + '" style="width:15rem" id="cp-studies-list"></div>' +
      '</details>' +
      '<span id="cp-pins" style="display:inline-flex;gap:2px"></span>' +
      '<details id="cp-tpl" class="menu relative">' +
        '<summary class="' + MENU_BTN + '" title="A named set of indicators, moving averages and style, applied in one click. The house sets follow rules their authors published.">Templates \u25be</summary>' +
        '<div class="' + PANEL + '" style="width:17rem;max-height:22rem;overflow:auto" id="cp-tpl-list"></div>' +
      '</details>' +
      '<details id="cp-types" class="menu relative">' +
        '<summary class="' + MENU_BTN + '" title="How the price itself is drawn. Renko, Kagi, Line break and Point &amp; Figure rebuild the price into steps, so one block is a move rather than a session.">Style ▾</summary>' +
        '<div class="' + PANEL + '" style="width:23rem;max-height:24rem;overflow:auto" id="cp-types-list"></div>' +
      '</details>' +
      '<details id="cp-draw" class="menu relative">' +
        '<summary class="' + MENU_BTN + '" title="Draw on the chart. Every line is anchored to a price and a date, and your drawings come back the next time you open this name.">Draw \u25be</summary>' +
        '<div class="' + PANEL + '" style="width:14rem;max-height:22rem;overflow:auto" id="cp-draw-list"></div>' +
      '</details>' +
      '<details id="cp-cmp" class="menu relative">' +
        '<summary class="' + MENU_BTN + '" title="Overlay another name, rebased so both start together.">Compare \u25be</summary>' +
        '<div class="' + PANEL + '" style="width:15rem" id="cp-cmp-list"></div>' +
      '</details>' +
      '<button type="button" id="cp-look" class="' + MENU_BTN + '" title="Chart settings: symbol, status line, scales, canvas, events, alerts.">\u2699</button>' +
      '<button id="cp-pal-btn" type="button" data-track="chart:palette" ' +
        'class="px-2 py-1 rounded-lg border border-sepia-border text-xs font-medium text-ink-mute hover:text-ink" ' +
        'title="Everything the chart can do, in one box. Press / to open it.">\u2318 /</button>' +
      '<button id="cp-replay" type="button" data-track="chart:replay" ' +
        'class="px-2 py-1 rounded-lg border border-sepia-border text-xs font-medium text-ink-mute hover:text-ink" ' +
        'title="Walk the chart forward one bar at a time, so you read it the way you would have lived it.">▶ Replay</button>';
    host.parentNode.insertBefore(frag, host);

    var sl = document.getElementById('cp-studies-list');
    var groups = {};
    Object.keys(STUDIES).forEach(function (k) { (groups[STUDIES[k].group] = groups[STUDIES[k].group] || []).push(k); });
    var html = '';
    Object.keys(groups).forEach(function (gr) {
      html += '<p class="text-ink-mute uppercase tracking-wide mt-2 mb-1" style="font-size:10px">' + gr + '</p>';
      groups[gr].forEach(function (k) {
        var d = STUDIES[k];
        if (d.formula != null) { var fi = d.formula;
          html += '<div class="mb-2"><label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="cp-s-' + k + '"><span class="flex-1">' + d.label + '</span></label>'
            + '<input type="text" id="cp-fx-' + fi + '" placeholder="sma(close,20)/sma(close,50)-1" spellcheck="false"'
            + ' class="w-full border border-sepia-border rounded-lg bg-white px-2 py-1 mt-1" style="font-family:JetBrains Mono,monospace;font-size:11px">'
            + '<label class="flex items-center gap-1 text-ink-mute mt-1"><input type="checkbox" id="cp-fxp-' + fi + '"> draw it on the price</label>'
            + '<div id="cp-fxerr-' + fi + '" class="text-bad" style="font-size:10px"></div>'
            + '<div id="cp-fxstat-' + fi + '" class="text-ink-mute" style="font-size:10px"></div>'
            + '<button type="button" data-fxalert="' + fi + '" class="text-accent mt-1" style="font-size:11px" title="The desk re-reads this formula every night on the fresh bars and emails you when it turns to yes">Email me on a fresh yes \u2192</button></div>';
          return; }
        html += '<div class="mb-1"><label class="flex items-center gap-2 cursor-pointer">'
             + '<input type="checkbox" id="cp-s-' + k + '"><span class="flex-1"' + (d.about ? ' title="' + d.about.replace(/"/g, '&quot;') + '"' : '') + '>' + d.label + '</span>'
             + '<button type="button" data-gear="' + k + '" class="text-ink-mute hover:text-ink" title="Settings and colour">&#9881;</button>'
             + '</label></div>';
      });
    });
    sl.innerHTML = '<button type="button" id="cp-ind-open" class="w-full text-left px-2 py-1.5 rounded-lg bg-accent text-white font-semibold mb-1" style="font-size:12px">Search the full list \u2192</button>' + html;
    var io = document.getElementById('cp-ind-open'); if (io) io.addEventListener('click', function () { var dd = document.getElementById('cp-studies'); if (dd) dd.removeAttribute('open'); openIndicators(); });
    Object.keys(STUDIES).forEach(function (k) {
      var cb = document.getElementById('cp-s-' + k);
      if (cb) cb.addEventListener('change', function () {
        if (STUDIES[k].formula != null) { formulas[STUDIES[k].formula].on = this.checked; fxApply(STUDIES[k].formula); return; }
        studyState[k] = this.checked; drawStudy(k); fitHeight(); saveState(); });
    });
    Array.prototype.forEach.call(sl.querySelectorAll('[data-fxalert]'), function (b) { b.addEventListener('click', function () {
      var i = +this.getAttribute('data-fxalert'), expr = (formulas[i].expr || '').trim(); if (!expr) { hint('Write the formula first'); setTimeout(function () { hint(''); }, 1500); return; }
      if (!/[<>]|\b(?:crossed|crossup|crossdown)\s*\(/i.test(expr)) { hint('An alert needs a yes/no formula, with > or <, or a crossup/crossdown'); setTimeout(function () { hint(''); }, 2500); return; }
      var tk = ((document.getElementById('chart-snap') || {}).dataset || {}).ticker; if (!tk) return;
      postForm('/alerts/create', [['ticker', tk], ['level', '0'], ['kind', 'formula'], ['anchors', JSON.stringify({ expr: expr })], ['back', location.pathname]]); }); });
    FX_SLOTS.forEach(function (i) {
      var inp = document.getElementById('cp-fx-' + i), pc = document.getElementById('cp-fxp-' + i);
      if (inp) { inp.addEventListener('change', function () { formulas[i].expr = this.value; if (this.value.trim()) { formulas[i].on = true; var cb2 = document.getElementById('cp-s-fx' + (i + 1)); if (cb2) cb2.checked = true; } fxApply(i); });
        inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); this.blur(); } }); }
      if (pc) pc.addEventListener('change', function () { formulas[i].price = this.checked; fxApply(i); });
    });
    var sl2 = document.getElementById('cp-studies-help'); if (!sl2 && sl) { sl2 = document.createElement('p'); sl2.id = 'cp-studies-help'; sl2.className = 'text-ink-mute mt-1'; sl2.style.fontSize = '10px';
      sl2.textContent = 'Formulas: open high low close volume spy · sma ema wma hma atr rsi stdev hhv llv roc ref abs max min · + - * / and > < for a yes/no bar.'; sl.appendChild(sl2); }
    Array.prototype.forEach.call(sl.querySelectorAll('[data-gear]'), function (g) {
      g.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation();
        var dd = document.getElementById('cp-studies'); if (dd) dd.removeAttribute('open');
        openStudySettings(this.getAttribute('data-gear')); });
    });
    var tl = document.getElementById('cp-types-list');
    tl.innerHTML = '<div class="grid gap-2" style="grid-template-columns:repeat(2,minmax(0,1fr))">'
      + Object.keys(TYPES).map(function (k) {
          return '<button type="button" id="cp-t-' + k + '" data-ty="' + k + '"'
            + ' class="text-left p-2 rounded-lg border border-sepia-border hover:bg-sepia-hover">'
            + '<svg viewBox="0 0 60 36" width="100%" height="34" style="display:block">' + sketch(k) + '</svg>'
            + '<span class="block font-semibold mt-1">' + TYPES[k].label + '</span>'
            + '<span class="block text-ink-mute" style="font-size:10px;line-height:1.35">' + TYPES[k].note + '</span>'
            + '</button>';
        }).join('') + '</div>';
    Array.prototype.forEach.call(tl.querySelectorAll('[data-ty]'), function (btn) {
      btn.addEventListener('click', function () {
        mode = this.getAttribute('data-ty'); applyType(); markType(); saveState();
        var dd = document.getElementById('cp-types'); if (dd) dd.removeAttribute('open');
      });
    });

    // replay transport, under the chart
    var wrap = document.getElementById('chart-wrap');
    if (wrap) {
      var bar = document.createElement('div');
      bar.id = 'cp-replay-bar';
      bar.className = 'flex flex-wrap items-center gap-2 mt-2 text-xs text-ink-mute';
      bar.style.display = 'none';
      bar.innerHTML =
        '<button id="cp-rw" type="button" class="px-2 py-1 rounded-lg border border-sepia-border hover:text-ink">◀◀</button>' +
        '<button id="cp-play" type="button" class="px-2 py-1 rounded-lg border border-sepia-border hover:text-ink">Play</button>' +
        '<button id="cp-ff" type="button" class="px-2 py-1 rounded-lg border border-sepia-border hover:text-ink">▶▶</button>' +
        '<button id="cp-wk" type="button" class="px-2 py-1 rounded-lg border border-sepia-border hover:text-ink" title="Five bars at once">+5</button>' +
        '<span id="cp-replay-at" class="nums"></span>' +
        '<span class="inline-flex rounded-lg border border-sepia-border overflow-hidden">' + [1, 2, 5, 10].map(function (x) {
          return '<button type="button" data-spd="' + x + '" class="px-1.5 py-1 ' + (x === 1 ? 'bg-accent text-white' : 'text-ink-mute hover:text-ink') + '">' + x + '\u00d7</button>'; }).join('') + '</span>' +
        '<span class="inline-flex rounded-lg border border-sepia-border overflow-hidden">' +
          '<button id="cp-buy" type="button" class="px-2 py-1 text-good font-semibold hover:bg-sepia-hover" title="Go long at this close">Buy</button>' +
          '<button id="cp-sell" type="button" class="px-2 py-1 text-bad font-semibold hover:bg-sepia-hover" title="Go short at this close">Sell</button>' +
          '<button id="cp-flat" type="button" class="px-2 py-1 hover:bg-sepia-hover" title="Close the position">Flat</button></span>' +
        (replaySim() ? '<label class="inline-flex items-center gap-1" title="Stop as a % from your entry, filled on the bar that touches it">Stop <input id="cp-sim-stop" type="number" min="0" step="0.5" placeholder="%" class="w-12 px-1 py-0.5 rounded border border-sepia-border bg-transparent nums"></label>' +
          '<label class="inline-flex items-center gap-1" title="Target as a % from your entry">Target <input id="cp-sim-target" type="number" min="0" step="0.5" placeholder="%" class="w-12 px-1 py-0.5 rounded border border-sepia-border bg-transparent nums"></label>' : '') +
        '<span id="cp-pnl" class="nums"></span>' +
        (replaySim() ? '<button id="cp-sim-save" type="button" class="px-2 py-1 rounded-lg border border-sepia-border hover:text-ink" title="Closed replay trades go to your journal, in an account named Replay">Save to journal</button>' : '') +
        '<button id="cp-exit" type="button" class="ml-auto px-2 py-1 rounded-lg border border-sepia-border hover:text-ink">Back to today</button>' +
        '<span id="cp-record" class="basis-full text-ink-mute"></span>' +
        (replaySim() ? '<span id="cp-sim-boards" class="basis-full text-ink"></span>' : '');
      wrap.parentNode.insertBefore(bar, wrap.nextSibling);
      var note = document.createElement('p');
      note.id = 'cp-note'; note.className = 'text-xs text-ink-mute mt-2'; note.style.display = 'none';
      wrap.parentNode.insertBefore(note, bar);
      document.getElementById('cp-rw').addEventListener('click', function () { step(-1); });
      document.getElementById('cp-ff').addEventListener('click', function () { step(1); });
      document.getElementById('cp-play').addEventListener('click', function () {
        playPause(); this.textContent = (replay && replay.timer) ? 'Pause' : 'Play'; });
      document.getElementById('cp-exit').addEventListener('click', stopReplay);
      document.getElementById('cp-wk').addEventListener('click', function () { step(5); });
      document.getElementById('cp-buy').addEventListener('click', function () { replayTrade(1); });
      document.getElementById('cp-sell').addEventListener('click', function () { replayTrade(-1); });
      document.getElementById('cp-flat').addEventListener('click', function () { replayTrade(0); });
      if (replaySim()) document.getElementById('cp-sim-save').addEventListener('click', simSave);
      Array.prototype.forEach.call(bar.querySelectorAll('[data-spd]'), function (b) { b.addEventListener('click', function () { setSpeed(+this.getAttribute('data-spd')); }); });
    }
    Array.prototype.forEach.call(document.querySelectorAll('#cp-int [data-int]'), function (b) {
      b.addEventListener('click', function () { setInterval2(this.getAttribute('data-int')); var dd = document.getElementById('cp-int'); if (dd) dd.removeAttribute('open'); }); });
    markInterval();
    document.getElementById('cp-replay').addEventListener('click', function () {
      if (replay) stopReplay(); else startReplay(); });
  }

  function markType() {
    Object.keys(TYPES).forEach(function (k) {
      var b = document.getElementById('cp-t-' + k);
      if (b) b.className = 'text-left p-2 rounded-lg border '
        + (k === mode ? 'border-accent bg-accent/5' : 'border-sepia-border hover:bg-sepia-hover');
    });
  }

  // ── settings that follow the account ─────────────────────────────────────
  // The browser stays the fast path so nothing ever waits on the network; the
  // server holds the copy that travels between devices.
  var syncTimer = null, syncReady = false, syncAllowed = true;
  function localBits() {
    function ls(k, d) { try { return JSON.parse(localStorage.getItem(k) || d); } catch (e) { return JSON.parse(d); } }
    return { pro: ls('pi_chart_pro', 'null'), mas: ls('pi_chart_mas', 'null'),
             layers: ls('pi_chart_layers', 'null'), templates: ls('pi_chart_templates', '{}'), tplauto: ls('pi_chart_tpl_auto', '{}'), tplpins: ls('pi_chart_tpl_pins', '[]'),
             favs: ls('pi_chart_favs', '[]'), look: ls('pi_chart_look', 'null'),
             layouts: ls('pi_layouts_named', '{}'), toolstyle: ls('pi_tool_style', '{}'), tooltpl: ls('pi_tool_tpl', '{}'),
             replaylog: ls('pi_replay_log', '[]'), rvpf: localStorage.getItem('pi_rvp_follow') || null,
             svp: localStorage.getItem('pi_svp') || null, tpo: localStorage.getItem('pi_tpo') || null,
             perTicker: (function () { var o = {}; try { for (var i = 0; i < localStorage.length; i++) { var kk = localStorage.key(i);
               if (/^pi_(cmp|rvp|avwap)_/.test(kk) && !/^pi_cmp_(left|mode)$/.test(kk) && kk !== 'pi_rvp_follow') o[kk] = localStorage.getItem(kk); } } catch (e) {} return o; })(),
             draw: (drawKey && localStorage.getItem(drawKey)) ? JSON.parse(localStorage.getItem(drawKey)) : null };
  }
  function pushSettings() {
    if (!syncReady || !syncAllowed) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      var body = localBits();
      // only the open ticker travels; the server merges it, null clears it
      var d = {}; if (drawKey) d[drawKey] = body.draw;
      delete body.draw; body.drawings = d;
      try {
        fetch('/api/chart-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body) }).catch(function () {});
      } catch (e) {}
    }, 1200);
  }
  function pullSettings(then) {
    try {
      fetch('/api/chart-settings').then(function (r) {
          // a visitor has no account to sync with; stop asking rather than
          // filling their console with refusals
          if (!r.ok) { syncAllowed = false; return null; }
          return r.json(); })
        .then(function (j) {
          if (j && typeof j === 'object') {
            function put(k, v) { if (v != null) try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
            // the account wins on a browser that has never seen this chart
            if (!localStorage.getItem('pi_chart_pro')) put('pi_chart_pro', j.pro);
            if (!localStorage.getItem('pi_chart_mas')) put('pi_chart_mas', j.mas);
            if (!localStorage.getItem('pi_chart_layers')) put('pi_chart_layers', j.layers);
            if (!localStorage.getItem('pi_chart_templates')) put('pi_chart_templates', j.templates);
            if (!localStorage.getItem('pi_chart_favs')) put('pi_chart_favs', j.favs);
            if (!localStorage.getItem('pi_chart_tpl_auto')) put('pi_chart_tpl_auto', j.tplauto);
            if (!localStorage.getItem('pi_chart_tpl_pins')) put('pi_chart_tpl_pins', j.tplpins);
            if (!localStorage.getItem('pi_chart_look')) put('pi_chart_look', j.look);
            if (!localStorage.getItem('pi_layouts_named')) put('pi_layouts_named', j.layouts);
            if (!localStorage.getItem('pi_tool_style')) put('pi_tool_style', j.toolstyle);
            if (!localStorage.getItem('pi_tool_tpl')) put('pi_tool_tpl', j.tooltpl);
            if (!localStorage.getItem('pi_replay_log')) put('pi_replay_log', j.replaylog);
            try { if (j.rvpf && !localStorage.getItem('pi_rvp_follow')) localStorage.setItem('pi_rvp_follow', j.rvpf); } catch (e) {}
            try { if (j.svp && !localStorage.getItem('pi_svp')) localStorage.setItem('pi_svp', j.svp);
                  if (j.tpo && !localStorage.getItem('pi_tpo')) localStorage.setItem('pi_tpo', j.tpo); } catch (e) {}
            if (j.perTicker && typeof j.perTicker === 'object') Object.keys(j.perTicker).forEach(function (kk) {
              try { if (/^pi_(cmp|rvp|avwap)_/.test(kk) && !localStorage.getItem(kk) && typeof j.perTicker[kk] === 'string') localStorage.setItem(kk, j.perTicker[kk]); } catch (e) {} });
            var dd = j.drawings || {};
            Object.keys(dd).forEach(function (k) { if (!localStorage.getItem(k)) put(k, dd[k]); });
          }
          syncReady = true; if (then) then();
        }).catch(function () { syncAllowed = false; syncReady = true; if (then) then(); });
    } catch (e) { syncAllowed = false; syncReady = true; if (then) then(); }
  }

  function saveState() {
    try { localStorage.setItem('pi_chart_pro', JSON.stringify({ m: mode, s: studyState, c: studyCfg, f: formulas, v: 2 }));
      pushSettings(); } catch (e) {}
  }
  function loadState() {
    try { var j = JSON.parse(localStorage.getItem('pi_chart_pro') || 'null');
      if (j) { if (TYPES[j.m]) mode = j.m; if (j.s) studyState = j.s; if (j.c) studyCfg = j.c;
        if (Array.isArray(j.f)) j.f.slice(0, 6).forEach(function (x, i) { formulas[i] = { on: !!x.on, expr: String(x.expr || ''), price: !!x.price }; }); } } catch (e) {}
    // the O'Neil base layer (dark base_patterns): the chart opens bare for everyone
    // (26/10/2026), a setting saved before v2 had it on by default and is dropped once,
    // and ?bases=1 (the board's chart link) always turns it on
    try { if (STUDIES.ours_bases) {
      if (/[?&]bases=1/.test(location.search)) studyState.ours_bases = true;
      else if (!(j && j.v === 2)) studyState.ours_bases = false; } } catch (e) {}
    FX_SLOTS.forEach(function (i) { var f = formulas[i], def = STUDIES['fx' + (i + 1)]; def.pane = f.price ? 0 : 1;
      var inp = document.getElementById('cp-fx-' + i), pc = document.getElementById('cp-fxp-' + i);
      if (inp) inp.value = f.expr; if (pc) pc.checked = f.price; studyState['fx' + (i + 1)] = !!(f.on && f.expr.trim()); });
    liveKeys().forEach(function (k) { if (baseKey(k) !== k) drawStudy(k); });
    Object.keys(STUDIES).forEach(function (k) {
      var cb = document.getElementById('cp-s-' + k); if (cb) cb.checked = !!studyState[k];
      var g = cfgOf(k);
      Object.keys(g).forEach(function (x) {
        var inp = document.querySelector('[data-pk="' + k + '|' + x + '"]'); if (inp) inp.value = g[x]; });
      var pc2 = document.querySelector('[data-pc="' + k + '"]'); if (pc2 && (studyCfg[k] || {}).color) pc2.value = studyCfg[k].color;
    });
  }

  // ── the indicators dialog: search, categories, favourites, one line each ──
  var indBox = null, indCat = 'All', indQ = '';
  function indCats() { var g = {}; Object.keys(STUDIES).forEach(function (k) { g[STUDIES[k].group] = 1; });
    return ['Favorites', 'All'].concat(Object.keys(g)); }
  // Per-study settings, TradingView's three tabs: the numbers it reads, how it looks,
  // and the timeframes it shows on. Everything applies live and is remembered.
  var setBox = null, setKey = null, setTab = 'inputs';
  var LINE_STYLES = [['Solid', 0], ['Dotted', 1], ['Dashed', 2], ['Large dashes', 3]];
  function scOf(k) { studyCfg[k] = studyCfg[k] || {}; return studyCfg[k]; }
  function setField(k, f, v) { scOf(k)[f] = v; if (studyState[k]) drawStudy(k); saveState();
    try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {} }
  function openStudySettings(k) {
    if (!defOf(k)) return;
    setKey = k; setTab = 'inputs';
    if (!setBox) {
      setBox = document.createElement('div'); setBox.id = 'cp-set';
      setBox.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(19,23,34,0.35);display:flex;align-items:center;justify-content:center';
      setBox.innerHTML = '<div class="bg-white border border-sepia-border rounded-xl shadow-lg" style="width:420px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;overflow:hidden">'
        + '<div class="flex items-center gap-2 px-4 py-3" style="border-bottom:1px solid rgb(var(--pi-border))"><span id="cp-set-t" class="font-semibold" style="font-size:15px"></span>'
        + '<button type="button" id="cp-set-x" class="text-ink-mute hover:text-ink" style="margin-left:auto;font-size:18px;line-height:1">\u2715</button></div>'
        + '<div id="cp-set-tabs" class="flex gap-4 px-4" style="border-bottom:1px solid rgb(var(--pi-border))"></div>'
        + '<div id="cp-set-body" style="flex:1;overflow:auto;padding:14px 16px;font-size:13px"></div>'
        + '<div class="flex items-center gap-2 px-4 py-3" style="border-top:1px solid rgb(var(--pi-border))">'
        + '<button type="button" id="cp-set-def" class="px-2 py-1.5 rounded-lg hover:bg-sepia-hover text-ink-mute" style="font-size:12px">Back to defaults</button>'
        + '<button type="button" id="cp-set-ok" class="px-3 py-1.5 rounded-lg bg-accent text-white font-semibold" style="margin-left:auto;font-size:12px">Done</button></div></div>';
      document.body.appendChild(setBox);
      setBox.addEventListener('mousedown', function (e) { if (e.target === setBox) closeStudySettings(); });
      setBox.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') closeStudySettings(); });
      document.getElementById('cp-set-x').addEventListener('click', closeStudySettings);
      document.getElementById('cp-set-ok').addEventListener('click', closeStudySettings);
      document.getElementById('cp-set-def').addEventListener('click', function () {
        studyCfg[setKey] = {}; if (studyState[setKey]) drawStudy(setKey); saveState(); renderSet();
        try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {} });
    }
    setBox.style.display = 'flex'; renderSet();
  }
  function closeStudySettings() { if (setBox) setBox.style.display = 'none'; }
  function renderSet() {
    if (!setBox || !setKey) return;
    var k = setKey, def = defOf(k), sc = scOf(k), cfg = cfgOf(k);
    document.getElementById('cp-set-t').textContent = def.label;
    var tabs = document.getElementById('cp-set-tabs');
    tabs.innerHTML = [['inputs', 'Inputs'], ['style', 'Style'], ['vis', 'Visibility']].map(function (t) {
      return '<button type="button" data-st="' + t[0] + '" class="py-2" style="font-size:13px;border-bottom:2px solid ' + (setTab === t[0] ? 'rgb(var(--pi-accent))' : 'transparent') + ';font-weight:' + (setTab === t[0] ? '600' : '400') + '">' + t[1] + '</button>'; }).join('');
    Array.prototype.forEach.call(tabs.querySelectorAll('[data-st]'), function (b) {
      b.addEventListener('click', function () { setTab = this.getAttribute('data-st'); renderSet(); }); });
    var body = document.getElementById('cp-set-body'), h = '';
    function rowHtml(label, ctl) { return '<label class="flex items-center gap-3 mb-3"><span class="flex-1 text-ink-mute">' + label + '</span>' + ctl + '</label>'; }
    if (setTab === 'inputs') {
      var ps = def.params || [];
      h = ps.length ? ps.map(function (x) {
        return rowHtml(x.label, '<input type="number" data-pk="' + k + '|' + x.k + '" value="' + cfg[x.k] + '" step="' + (x.step || 1) + '" class="border border-sepia-border rounded-lg bg-white" style="width:5.5rem;padding:2px 6px">'); }).join('')
        : '<p class="text-ink-mute">This one reads the bars as they are, nothing to set.</p>';
      if (def.about) h += '<p class="text-ink-mute" style="font-size:12px;margin-top:6px">' + def.about + '</p>';
      if (tvMore() && !def.daily && def.group !== 'Our data' && !sc.src) {
        h += rowHtml('Timeframe', '<select data-htf class="border border-sepia-border rounded-lg bg-white" style="padding:2px 6px">'
          + [['', 'Same as the chart'], ['W', 'Weekly'], ['M', 'Monthly']].map(function (o) { return '<option value="' + o[0] + '"' + ((sc.htf || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>');
        h += '<p class="text-ink-mute" style="font-size:12px;margin-top:-4px">Read it on weekly or monthly bars and step the values onto the daily chart. The week or month in progress moves until it closes. Daily chart only.</p>';
      }
      // Source: the price, or another study on the chart (indicator on indicator)
      var others = liveKeys().filter(function (x) { var dx = defOf(x); if (x === k || !dx || dx.group === 'Our data') return false;
        for (var y = x, n = 0; y && n < 5; n++) { if (y === k) return false; y = (studyCfg[y] || {}).src; } return true; });
      if (def.group !== 'Volume' && def.group !== 'Our data' && others.length) {
        h += rowHtml('Source', '<select data-src class="border border-sepia-border rounded-lg bg-white" style="padding:2px 6px;max-width:12rem">'
          + '<option value="">Price (close)</option>'
          + others.map(function (x) { var lbl = defOf(x).label + (x.indexOf('#') > 0 ? ' ' + x.split('#')[1] : '');
              return '<option value="' + x + '"' + (sc.src === x ? ' selected' : '') + '>' + lbl + '</option>'; }).join('') + '</select>');
        h += '<p class="text-ink-mute" style="font-size:12px;margin-top:-4px">Pick another study to run this one on its line, for example the RSI of OBV or an average of the RSI.</p>';
      }
    } else if (setTab === 'style') {
      h += rowHtml('Colour', '<input type="color" data-pc="' + k + '" value="' + (sc.color || '#8b5cf6') + '" style="width:2.6rem;height:1.6rem;padding:0;border:1px solid #e7e1d8;border-radius:4px">');
      h += rowHtml('Thickness', '<select data-sw class="border border-sepia-border rounded-lg bg-white" style="padding:2px 6px">'
        + [1, 2, 3, 4].map(function (w) { return '<option value="' + w + '"' + ((sc.width || 1) === w ? ' selected' : '') + '>' + w + ' px</option>'; }).join('') + '</select>');
      h += rowHtml('Line', '<select data-sl class="border border-sepia-border rounded-lg bg-white" style="padding:2px 6px">'
        + LINE_STYLES.map(function (o) { return '<option value="' + o[1] + '"' + ((sc.style || 0) === o[1] ? ' selected' : '') + '>' + o[0] + '</option>'; }).join('') + '</select>');
      h += rowHtml('Decimals', '<select data-sp class="border border-sepia-border rounded-lg bg-white" style="padding:2px 6px">'
        + [0, 1, 2, 3, 4].map(function (d2) { return '<option value="' + d2 + '"' + ((sc.prec == null ? 2 : sc.prec) === d2 ? ' selected' : '') + '>' + d2 + '</option>'; }).join('') + '</select>');
      h += '<label class="flex items-center gap-2 mb-2"><input type="checkbox" data-sa' + (sc.axis ? ' checked' : '') + '><span>Its last value on the price scale</span></label>';
      h += '<label class="flex items-center gap-2"><input type="checkbox" data-ss' + (sc.status === false ? '' : ' checked') + '><span>Its value in the legend</span></label>';
    } else {
      h = '<p class="text-ink-mute mb-2">Show it on</p>'
        + ['1D', '1W', '1M'].map(function (t) { var nm = { '1D': 'Daily', '1W': 'Weekly', '1M': 'Monthly' }[t];
            var on = !(sc.tfs && sc.tfs[t] === false);
            return '<label class="flex items-center gap-2 mb-2"><input type="checkbox" data-sv="' + t + '"' + (on ? ' checked' : '') + '><span>' + nm + '</span></label>'; }).join('')
        + '<p class="text-ink-mute" style="font-size:12px">Off means the study stays in your list and simply does not draw on that timeframe.</p>';
    }
    body.innerHTML = h;
    Array.prototype.forEach.call(body.querySelectorAll('[data-pk]'), function (inp) {
      inp.addEventListener('change', function () { var pp = this.getAttribute('data-pk').split('|'), v = parseFloat(this.value);
        if (!isFinite(v)) return; scOf(pp[0])[pp[1]] = v; if (studyState[pp[0]]) drawStudy(pp[0]); saveState();
        try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {} });
      inp.addEventListener('keydown', function (e) { e.stopPropagation(); }); });
    var htfSel = body.querySelector('[data-htf]'); if (htfSel) htfSel.addEventListener('change', function () {
      var v = this.value; if (v) scOf(k).htf = v; else delete scOf(k).htf;
      if (studyState[k]) drawStudy(k); saveState();
      try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {} });
    var srs = body.querySelector('[data-src]'); if (srs) srs.addEventListener('change', function () {
      var v = this.value; if (v) scOf(k).src = v; else delete scOf(k).src;
      if (studyState[k]) drawStudy(k); saveState();
      try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {} });
    var pc = body.querySelector('[data-pc]'); if (pc) pc.addEventListener('input', function () { setField(k, 'color', this.value); });
    var sw = body.querySelector('[data-sw]'); if (sw) sw.addEventListener('change', function () { setField(k, 'width', +this.value); });
    var sl3 = body.querySelector('[data-sl]'); if (sl3) sl3.addEventListener('change', function () { setField(k, 'style', +this.value); });
    var sp = body.querySelector('[data-sp]'); if (sp) sp.addEventListener('change', function () { setField(k, 'prec', +this.value); });
    var sa = body.querySelector('[data-sa]'); if (sa) sa.addEventListener('change', function () { setField(k, 'axis', this.checked); });
    var ss = body.querySelector('[data-ss]'); if (ss) ss.addEventListener('change', function () { setField(k, 'status', this.checked); });
    Array.prototype.forEach.call(body.querySelectorAll('[data-sv]'), function (cb) {
      cb.addEventListener('change', function () { var t = this.getAttribute('data-sv'); var sc2 = scOf(k);
        sc2.tfs = sc2.tfs || {}; sc2.tfs[t] = this.checked; if (studyState[k]) drawStudy(k); saveState();
        try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {} }); });
  }

  function openIndicators() {
    if (!indBox) {
      indBox = document.createElement('div'); indBox.id = 'cp-ind';
      indBox.style.cssText = 'position:fixed;inset:0;z-index:60;background:rgba(19,23,34,0.35);display:flex;align-items:center;justify-content:center';
      indBox.innerHTML = '<div class="bg-white border border-sepia-border rounded-xl shadow-lg" style="width:760px;max-width:96vw;height:540px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden">'
        + '<div class="flex items-center gap-2 px-4 py-3" style="border-bottom:1px solid rgb(var(--pi-border))"><span class="font-semibold" style="font-size:15px">Indicators, readings and formulas</span><span style="margin-left:auto"></span><button type="button" id="cp-ind-x" class="px-2 py-1 rounded-lg hover:bg-sepia-hover">\u2715</button></div>'
        + '<div class="px-4 py-2" style="border-bottom:1px solid rgb(var(--pi-border))"><input id="cp-ind-q" placeholder="Search" class="w-full px-3 py-2 rounded-lg border border-sepia-border bg-white" style="font-size:13px"></div>'
        + '<div class="flex" style="flex:1;min-height:0"><div id="cp-ind-cats" style="width:180px;border-right:1px solid rgb(var(--pi-border));overflow:auto;padding:8px"></div><div id="cp-ind-list" style="flex:1;overflow:auto;padding:6px 8px"></div></div></div>';
      document.body.appendChild(indBox);
      indBox.addEventListener('mousedown', function (e) { if (e.target === indBox) closeIndicators(); });
      document.getElementById('cp-ind-x').addEventListener('click', closeIndicators);
      document.getElementById('cp-ind-q').addEventListener('input', function () { indQ = this.value.toLowerCase().trim(); renderInd(); });
      document.getElementById('cp-ind-q').addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') closeIndicators(); });
    }
    indBox.style.display = 'flex'; renderInd(); setTimeout(function () { try { document.getElementById('cp-ind-q').focus(); } catch (e) {} }, 30);
  }
  function closeIndicators() { if (indBox) indBox.style.display = 'none'; }
  function renderInd() {
    // dark feature: the pocket-pivot reading exists only when the page sent it (flag live or admin)
    try { var oe = (H.ours && H.ours() || {}).extra; if (!(oe && oe.pp) && STUDIES.ours_pocket) delete STUDIES.ours_pocket; } catch (e) {}
    // dark rs_new_high: the circles on the RS line come with their reading
    try { if ((H.ours && H.ours() || {}).rsnh && STUDIES.ours_rs) STUDIES.ours_rs.about = 'A circle marks each day the line sets a 52-week high. A dark circle means the price is still under its own 52-week high: relative strength leading the price. A place to look, not a call.'; } catch (e) {}
    try { var ob = (H.ours && H.ours() || {}).extra; if (!(ob && ob.bases) && STUDIES.ours_bases) delete STUDIES.ours_bases; } catch (e) {}
    // dark chart_tv_lot2: each of our layers exists only when the page sent its rows
    try { var ol = (H.ours && H.ours() || {}).extra || {};
      if (!ol.fq) { delete STUDIES.ours_eps; delete STUDIES.ours_rev; }
      if (!ol.sv) delete STUDIES.ours_sv;
      if (!ol.seas) delete STUDIES.ours_seas;
      if (!ol.fqx) { delete STUDIES.ours_pe; delete STUDIES.ours_margin; delete STUDIES.ours_cfo; delete STUDIES.ours_shares; }
      if (!ol.macro) delete STUDIES.ours_macro;
      else if (STUDIES.ours_seas) STUDIES.ours_seas.about = 'Purple: this year so far, in % from the last close of last year. Dashed: the average path of the last ' + ol.seas.years + ' years on this name, session by session. The year closed higher in ' + ol.seas.up + ' of them, by ' + ol.seas.end + '% on average. History, never a forecast.'; } catch (e) {}
    // dark chart_surge: the market days and the ants exist only when the page says the flag is on
    if (!window.__piSurge) { delete STUDIES.ftd; delete STUDIES.ants; }
    // dark chart_dv_ind: base pivots, RS line with periods, unusual volume, ATR stretch, RMV pivots, short-term patterns
    if (!window.__piDvInd) ['base_pivots', 'rs_line_box', 'vol_plus', 'atr_ext_marks', 'rmv_pivots', 'tech_patterns'].forEach(function (k) { delete STUDIES[k]; });
    if (!window.__piSessionVwap) delete STUDIES.vwap_session;
    var cats = document.getElementById('cp-ind-cats'), list = document.getElementById('cp-ind-list'); if (!cats || !list) return;
    var f = favs();
    cats.innerHTML = indCats().map(function (c2) { var n = c2 === 'All' ? Object.keys(STUDIES).length : c2 === 'Favorites' ? f.filter(function (id) { return id.indexOf('i:') === 0; }).length : Object.keys(STUDIES).filter(function (k) { return STUDIES[k].group === c2; }).length;
      return '<button type="button" data-ic="' + c2 + '" class="block w-full text-left px-2 py-1.5 rounded-lg ' + (c2 === indCat ? 'bg-accent text-white' : 'hover:bg-sepia-hover') + '" style="font-size:13px">' + c2 + ' <span style="opacity:.6;font-size:11px">' + n + '</span></button>'; }).join('');
    Array.prototype.forEach.call(cats.querySelectorAll('[data-ic]'), function (b) { b.addEventListener('click', function () { indCat = this.getAttribute('data-ic'); renderInd(); }); });
    var keys = Object.keys(STUDIES).filter(function (k) { var d = STUDIES[k];
      if (indCat === 'Favorites' && f.indexOf('i:' + k) < 0) return false;
      if (indCat !== 'All' && indCat !== 'Favorites' && d.group !== indCat) return false;
      if (indQ && (d.label + ' ' + (d.about || '') + ' ' + d.group).toLowerCase().indexOf(indQ) < 0) return false; return true; });
    list.innerHTML = keys.length ? keys.map(function (k) { var d = STUDIES[k], on = !!studyState[k], fav = f.indexOf('i:' + k) >= 0;
      return '<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-sepia-hover" data-ik="' + k + '" style="cursor:pointer">'
        + '<button type="button" data-if="' + k + '" title="Keep at the top" style="color:' + (fav ? 'rgb(var(--pi-accent))' : 'rgb(var(--pi-border))') + ';font-size:15px">\u2605</button>'
        + '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">' + d.label + '</div>' + (d.about ? '<div class="text-ink-mute truncate" style="font-size:11.5px">' + d.about + '</div>' : '') + '</div>'
        + '<span class="text-ink-mute" style="font-size:11px">' + d.group + '</span>'
        + '<span data-io="' + k + '" class="px-2 py-0.5 rounded-lg" style="font-size:11px;' + (on ? 'background:rgb(var(--pi-accent) / .12);color:rgb(var(--pi-accent))' : 'border:1px solid rgb(var(--pi-border));color:rgb(var(--pi-ink-mute))') + '">' + (on ? 'On' : 'Add') + '</span></div>'; }).join('')
      : '<div class="text-ink-mute px-2 py-4">Nothing matches. Try another word, or write it as a formula.</div>';
    Array.prototype.forEach.call(list.querySelectorAll('[data-ik]'), function (row) { row.addEventListener('click', function (e) { if (e.target.closest('[data-if]')) return; window.__cp.toggleStudy(this.getAttribute('data-ik')); renderInd(); }); });
    Array.prototype.forEach.call(list.querySelectorAll('[data-if]'), function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); toggleFav('i:' + this.getAttribute('data-if')); renderInd(); }); });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && indBox && indBox.style.display !== 'none') closeIndicators(); });

  // Marks described in words (dark chart_marks): /api/marks reads the sentence with a
  // fixed vocabulary and returns the daily bars where it holds; drawn as markers on
  // the price, the same way studies draw theirs. Daily view only.
  var markMk = null, markOn = null, markTimes = [], MARK_KEY = 'pi_mark_recent';
  function markRecent() { try { var a = JSON.parse(localStorage.getItem(MARK_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function markRemember(q) { try { var a = markRecent().filter(function (x) { return x !== q; }); a.unshift(q); localStorage.setItem(MARK_KEY, JSON.stringify(a.slice(0, 5))); } catch (e) {} }
  function markFillRecent() { var dl = document.getElementById('cp-mark-recent'); if (!dl) return;
    dl.innerHTML = ''; markRecent().forEach(function (q) { var o = document.createElement('option'); o.value = q; dl.appendChild(o); }); }
  function drawMarks() {
    if (!markTimes) return 0;   // applyType can run before this block has set its vars
    var marks = [], ty = TYPES[mode] || {};
    // the arrows sit on the series on screen: the candles, or the line, bars or area drawn in their place
    var tgt = baseSeries && !ty.transform ? baseSeries : H.cs;
    if (markTimes.length && !intraBars && interval === 'D' && H.tf && H.tf() === '1D' && !ty.transform) {
      var have = {}; (H.candles() || []).forEach(function (b) { have[b.time] = 1; });
      markTimes.forEach(function (t) { if (have[t]) marks.push({ time: t, position: 'belowBar', shape: 'arrowUp', color: C.a, size: 1 }); });
    }
    if (markMk && markOn !== tgt) { try { markMk.detach(); } catch (e) {} markMk = null; }
    try { if (!markMk) { if (marks.length) { markMk = LWC.createSeriesMarkers(tgt, marks); markOn = tgt; } } else markMk.setMarkers(marks); } catch (e) {}
    return marks.length;
  }
  function markShow(j, q) {
    var out = document.getElementById('cp-mark-out'), clr = document.getElementById('cp-mark-clear'); if (!out) return;
    var html = (j.understood || []).map(function (u) { return '<span class="px-2 py-0.5 rounded-full bg-accent/10 text-accent font-semibold">' + esc(u) + '</span>'; }).join('');
    if ((j.unknown || []).length) html += '<span class="text-bad">Not understood, left out: ' + j.unknown.map(function (u) { return '\u201c' + esc(u) + '\u201d'; }).join(', ') + '</span>';
    if ((j.understood || []).length) {
      var n = drawMarks(), all = (j.times || []).length;
      html += '<span class="text-ink-mute">' + all + ' bar' + (all === 1 ? '' : 's') + ' match' + (all === 1 ? 'es' : '') + (all && n < all ? ', ' + n + ' on this chart' : '') + (H.tf && H.tf() !== '1D' ? ' (switch to Daily to see them)' : '') + '</span>';
    } else if (q) html += '<span class="text-ink-mute">Try: inside day, 3 tight closes above the 21 EMA, volume 2x its 50-day average.</span>';
    out.innerHTML = html; if (clr) clr.style.display = q ? '' : 'none';
  }
  function runMarks(q) {
    q = (q || '').trim(); var tk = tickerNow();
    if (!q || !tk) { markTimes = []; drawMarks(); markShow({}, ''); return; }
    fetch('/api/marks?t=' + encodeURIComponent(tk) + '&q=' + encodeURIComponent(q))
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { markTimes = j.times || []; markShow(j, q); if ((j.understood || []).length) { markRemember(q); markFillRecent(); } })
      .catch(function () { markTimes = []; drawMarks(); });
  }
  function initMarks() {
    var f = document.getElementById('cp-mark-form'); if (!f) return;
    var inp = document.getElementById('cp-mark-in'), clr = document.getElementById('cp-mark-clear');
    markFillRecent();
    f.addEventListener('submit', function (e) { e.preventDefault(); runMarks(inp.value); });
    if (clr) clr.addEventListener('click', function () { inp.value = ''; runMarks(''); });
    H.onChange(function () { drawMarks(); });
  }

  // dark chart_tv_lot1: the TradingView data window (every reading under the cursor in one box)
  // and one switch that hides or shows every indicator at once
  function tvTools() { var b = document.getElementById('chart-snap'); return !!(b && b.dataset && b.dataset.tvTools === '1'); }
  var dwBox = null, dwOn = false, dwAt = null;
  function dwKey(t) { if (t == null) return null; if (typeof t === 'object' && t.year) return t.year + '-' + ('0' + t.month).slice(-2) + '-' + ('0' + t.day).slice(-2); return t; }
  function dwNum(v) { if (v == null || isNaN(v)) return '\u2013'; v = +v; var a = Math.abs(v);
    return a >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e4 ? v.toFixed(0) : a >= 1 ? v.toFixed(2) : v.toFixed(4); }
  function dwPaint() {
    if (!dwBox || !dwOn) return;
    var c = bars(), i = c.length - 1;
    if (dwAt != null) for (var j = c.length - 1; j >= 0; j--) { if (c[j].time === dwAt) { i = j; break; } }
    var b = c[i]; if (!b) { dwBox.innerHTML = ''; return; }
    var p = i > 0 ? c[i - 1].close : null, chg = p ? (b.close / p - 1) * 100 : null, vv = null;
    try { var vs = H.vol ? H.vol() : []; for (var q = vs.length - 1; q >= 0; q--) if (vs[q].time === b.time) { vv = vs[q].value; break; } } catch (e) {}
    var when = typeof b.time === 'number' ? new Date(b.time * 1000).toISOString().slice(0, 16).replace('T', ' ') : String(b.time);
    var row = function (l, v, col) { return '<div class="flex justify-between gap-3"><span class="text-ink-mute">' + esc(l) + '</span><span class="nums"' + (col ? ' style="color:' + col + '"' : '') + '>' + v + '</span></div>'; };
    var html = '<div class="flex items-center justify-between mb-1"><span class="font-semibold text-ink">Data window</span><button type="button" id="cp-dw-x" class="text-ink-mute hover:text-ink" title="Close (Alt+Shift+D)">\u00d7</button></div>'
      + row('Date', esc(when)) + row('Open', dwNum(b.open)) + row('High', dwNum(b.high)) + row('Low', dwNum(b.low)) + row('Close', dwNum(b.close))
      + row('Change', chg == null ? '\u2013' : (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%', chg == null ? '' : chg >= 0 ? C.up : C.dn) + row('Volume', dwNum(vv));
    var st = []; try { st = window.__cp.studies(b.time) || []; } catch (e) {}
    st = st.filter(function (x) { return !x.hidden; });
    if (st.length) html += '<div style="border-top:1px solid rgb(var(--pi-border));margin:4px 0"></div>' + st.map(function (x) { return row(x.label, dwNum(x.last), x.color); }).join('');
    dwBox.innerHTML = html;
    var xb = document.getElementById('cp-dw-x'); if (xb) xb.addEventListener('click', function () { toggleDataWindow(false); });
  }
  function toggleDataWindow(on) {
    dwOn = on == null ? !dwOn : !!on;
    try { localStorage.setItem('pi_dw', dwOn ? '1' : '0'); } catch (e) {}
    if (!dwBox) { dwBox = document.createElement('div'); dwBox.id = 'cp-dw';
      dwBox.className = 'bg-white border border-sepia-border rounded-lg shadow-lg text-[11px]';
      dwBox.style.cssText = 'position:absolute;top:34px;right:72px;z-index:8;width:220px;max-height:70%;overflow:auto;padding:6px 8px';
      H.el.appendChild(dwBox); }
    dwBox.style.display = dwOn ? '' : 'none'; dwPaint();
  }
  function allStudiesHidden() { var k = liveKeys(); return k.length > 0 && k.every(function (x) { return !!(studyCfg[x] || {}).hidden; }); }
  function hideEveryStudy(on) { liveKeys().forEach(function (k) { hideStudy(k, on); }); }
  function initDataWindow() {
    if (!tvTools()) return;
    try { chart.subscribeCrosshairMove(function (p) { dwAt = p && p.time != null ? dwKey(p.time) : null; dwPaint(); }); } catch (e) {}
    try { H.onChange(function () { dwAt = null; dwPaint(); }); } catch (e) {}
    try { if (localStorage.getItem('pi_dw') === '1') toggleDataWindow(true); } catch (e) {}
  }

  // dark chart_tv_lot3: a member's rule replayed on this name, its trades marked on the candles
  var stratMk = null, stratTrades = [];
  function drawStrat() {
    var m = [];
    if (stratTrades.length && !intraBars && interval === 'D' && H.tf && H.tf() === '1D') {
      var have = {}; (H.candles() || []).forEach(function (b) { have[b.time] = 1; });
      stratTrades.forEach(function (t) {
        if (have[t.entry_date]) m.push({ time: t.entry_date, position: 'belowBar', shape: 'arrowUp', color: C.b, text: 'In' });
        if (t.exit_date && have[t.exit_date]) m.push({ time: t.exit_date, position: 'aboveBar', shape: 'arrowDown', color: t.pct >= 0 ? C.up : C.dn,
          text: (t.pct >= 0 ? '+' : '') + t.pct.toFixed(1) + '%' }); });
      m.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    }
    try { if (!stratMk) { if (m.length) stratMk = LWC.createSeriesMarkers(H.cs, m); } else stratMk.setMarkers(m); } catch (e) {}
    return m.length;
  }
  function stratShow(j) {
    var out = document.getElementById('cp-strat-out'), clr = document.getElementById('cp-strat-clear'); if (!out) return;
    if (!j) { out.innerHTML = ''; if (clr) clr.style.display = 'none'; return; }
    if (j.error) { out.innerHTML = '<span class="text-bad">' + esc(j.error) + '</span>'; if (clr) clr.style.display = ''; return; }
    var pc = function (v) { return v == null ? '\u2013' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; };
    var shown = drawStrat();
    out.innerHTML = '<span class="px-2 py-0.5 rounded-full bg-accent/10 text-accent font-semibold">' + j.n_trades + ' trade' + (j.n_trades === 1 ? '' : 's') + '</span>'
      + '<span>won ' + (j.win_rate_pct == null ? '\u2013' : j.win_rate_pct.toFixed(0) + '%') + '</span>'
      + '<span>total <b style="color:' + ((j.total_return_pct || 0) >= 0 ? C.up : C.dn) + '">' + pc(j.total_return_pct) + '</b></span>'
      + '<span class="text-ink-mute">holding it: ' + pc(j.buy_hold_return_pct) + ' \u00b7 worst drop -' + (j.max_drawdown_pct || 0).toFixed(1) + '%' + (j.since ? ' \u00b7 since ' + esc(j.since) : '') + '</span>'
      + (j.n_trades && shown === 0 ? '<span class="text-ink-mute">(older than this chart, or switch to Daily)</span>' : '')
      + '<span class="text-ink-mute">Past bars, not a forecast.</span>';
    if (clr) clr.style.display = '';
  }
  function runStrat() {
    var tk = tickerNow(), v = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; };
    var q = { t: tk, entry: v('cp-strat-entry'), exit: v('cp-strat-exit'), stop: v('cp-strat-stop'), target: v('cp-strat-target') };
    var bz = v('cp-strat-bars'); if (bz) q.bars = bz;
    var on = v('cp-strat-on');
    stratList(null);
    if (!q.entry) { stratTrades = []; drawStrat(); stratShow(null); return; }
    if (on) { runStratList(on, q); return; }
    var out = document.getElementById('cp-strat-out'); if (out) out.innerHTML = '<span class="text-ink-mute">Testing\u2026</span>';
    fetch('/api/strategy?' + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&'))
      .then(function (r) { return r.ok ? r.json() : { error: 'The test did not run.' }; })
      .then(function (j) { stratTrades = (j && j.trades) || []; stratShow(j); })
      .catch(function () { stratTrades = []; drawStrat(); stratShow({ error: 'The test did not run.' }); });
  }
  // dark chart_tv_lot5: the same rule on every name of a list, one line per name
  function stratList(j) {
    var box = document.getElementById('cp-strat-list'); if (!box) return;
    if (!j) { box.style.display = 'none'; box.innerHTML = ''; return; }
    var pc = function (v) { return v == null ? '\u2013' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; };
    var col = function (v) { return 'color:' + ((v || 0) >= 0 ? C.up : C.dn); };
    var a = j.agg, h = '<div class="mb-1"><b>' + esc(j.label) + '</b>: ' + a.names + ' names, ' + a.trades + ' closed trades, won '
      + (a.win == null ? '\u2013' : a.win.toFixed(0) + '%') + ', average trade <b style="' + col(a.avg) + '">' + pc(a.avg) + '</b>, median ' + pc(a.median)
      + ', the rule beat holding on ' + a.beat_hold + ' of ' + a.names + '.' + (j.capped ? ' First 40 names only.' : '') + ' <span class="text-ink-mute">Past bars, not a forecast.</span></div>'
      + '<div style="max-height:14rem;overflow:auto"><table class="w-full text-xs nums"><thead><tr class="text-ink-mute text-left"><th class="pr-2">Name</th><th class="pr-2">Trades</th><th class="pr-2">Won</th><th class="pr-2">Rule</th><th class="pr-2">Holding</th><th class="pr-2">Worst drop</th><th>Since</th></tr></thead><tbody>';
    j.rows.forEach(function (r) {
      h += '<tr class="border-t border-sepia-border"><td class="pr-2"><a class="font-semibold hover:text-accent" href="/chart/' + encodeURIComponent(r.ticker) + '">' + esc(r.ticker) + '</a></td><td class="pr-2">' + r.n + '</td><td class="pr-2">'
        + (r.win == null ? '\u2013' : r.win.toFixed(0) + '%') + '</td><td class="pr-2" style="' + col(r.ret) + '">' + pc(r.ret) + '</td><td class="pr-2">' + pc(r.hold)
        + '</td><td class="pr-2">-' + (r.dd || 0).toFixed(1) + '%</td><td class="text-ink-mute">' + esc(r.since || '') + '</td></tr>';
    });
    box.innerHTML = h + '</tbody></table></div>'; box.style.display = '';
  }
  function runStratList(on, q) {
    var out = document.getElementById('cp-strat-out'), clr = document.getElementById('cp-strat-clear');
    if (out) out.innerHTML = '<span class="text-ink-mute">Testing the list\u2026</span>';
    stratTrades = []; drawStrat();
    var p = { src: on, entry: q.entry, exit: q.exit, stop: q.stop, target: q.target, bars: q.bars || '' };
    fetch('/api/strategy/list?' + Object.keys(p).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&'))
      .then(function (r) { return r.ok ? r.json() : { error: 'The test did not run.' }; })
      .then(function (j) {
        if (clr) clr.style.display = '';
        if (!j || j.error) { if (out) out.innerHTML = '<span class="text-bad">' + esc((j && j.error) || 'The test did not run.') + '</span>'; return; }
        if (out) out.innerHTML = ''; stratList(j);
      })
      .catch(function () { if (out) out.innerHTML = '<span class="text-bad">The test did not run.</span>'; });
  }
  function initStrategy() {
    var f = document.getElementById('cp-strat-form'); if (!f) return;
    f.addEventListener('submit', function (e) { e.preventDefault(); runStrat(); });
    var clr = document.getElementById('cp-strat-clear');
    if (clr) clr.addEventListener('click', function () { ['cp-strat-entry', 'cp-strat-exit', 'cp-strat-stop', 'cp-strat-target'].forEach(function (id) { var e = document.getElementById(id); if (e) e.value = ''; });
      stratTrades = []; drawStrat(); stratShow(null); stratList(null); });
    Array.prototype.forEach.call(f.querySelectorAll('input'), function (i) { i.addEventListener('keydown', function (e) { e.stopPropagation(); }); });
    H.onChange(function () { drawStrat(); });
  }

  // ── the chart in plain words (dark chart_ai) ─────────────────────────────
  // The server picks settings inside the catalogue this page sends (app/chart_ask.py);
  // here each one is set the way a click would set it, so the choice is saved like a click.
  function askLayerBtns() { return Array.prototype.filter.call(document.querySelectorAll('#layer-menu .chart-pill[id^="tf-"]'), function (b) { return !b.disabled; }); }
  function setLayer(id, on) { var b = document.getElementById('tf-' + id); if (b && !b.disabled && b.classList.contains('bg-accent') !== !!on) b.click(); }
  function setStudy(k, on, ps) {
    if (!STUDIES[k]) return;
    if (ps && Object.keys(ps).length) { var sc = studyCfg[k] = studyCfg[k] || {}; Object.keys(ps).forEach(function (p) { sc[p] = ps[p]; }); }
    studyState[k] = !!on; var cb = document.getElementById('cp-s-' + k); if (cb) cb.checked = !!on; drawStudy(k);
  }
  function setRange(r) {
    var c = bars(), n = c.length; if (!n || typeof c[n - 1].time !== 'string') return;
    if (r === 'ALL' || r === 'YTD') { quickView(r); return; }
    var mo = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24, '5Y': 60, '10Y': 120 }[r]; if (!mo) return;
    var d = new Date(c[n - 1].time + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - mo);
    var cut = d.toISOString().slice(0, 10), from = 0; while (from < n - 1 && c[from].time < cut) from++;
    try { chart.timeScale().setVisibleLogicalRange({ from: from - 1, to: n + 3 }); } catch (e) {}
  }
  // the dates asked: the window opens on them, older history is fetched first when the chart does not reach back
  function setDates(f, t, again) {
    var c = bars(), n = c.length; if (!n || typeof c[n - 1].time !== 'string') return;
    if (f < c[0].time && !again) { loadDeep(6, function () { setDates(f, t, true); }); return; }
    if ((t && t < c[0].time) || f > c[n - 1].time) {   // nothing of the window is in our history
      var out = document.getElementById('cp-ask-out'); if (out) out.textContent = 'This chart runs from ' + c[0].time + ' to ' + c[n - 1].time + '.'; return; }
    var a = 0; while (a < n - 1 && c[a].time < f) a++;
    var b = n - 1; if (t) { b = a; while (b < n - 1 && c[b + 1].time <= t) b++; }
    try { chart.timeScale().setVisibleLogicalRange({ from: a - 1, to: t ? b + 1 : n + 3 }); } catch (e) {}
  }
  function setTfKey(t) {
    if (INTRADAY.some(function (x) { return x[0] === t; })) { setIntraday(t); return; }
    if (intraTf) setIntraday(null);
    var main = { d: '1D', w: '1W', m: '1M' }[t], b = document.getElementById('tf-' + (main ? t : 'd'));
    if (main) { if (b && !(interval === 'D' && H.tf() === main)) b.click(); return; }
    if (H.tf() !== '1D' && b) b.click();
    setInterval2(t);
  }
  function askSnap() {
    var lay = {}; askLayerBtns().forEach(function (b) { lay[b.id.slice(3)] = b.classList.contains('bg-accent'); });
    var tf = intraTf || (interval !== 'D' ? interval : ({ '1W': 'w', '1M': 'm' }[H.tf()] || 'd'));
    return { tf: tf, scale: scaleName, studies: JSON.parse(JSON.stringify(studyState)), cfg: JSON.parse(JSON.stringify(studyCfg)),
             layers: lay, vol: LOOK.vol !== false, mas: H.getMAs ? H.getMAs() : null, cmp: cmpList.slice(), mode: mode,
             look: { grid: LOOK.grid, legend: LOOK.legend, watermark: LOOK.watermark, pal: LOOK.pal },
             dark: document.documentElement.classList.contains('dark'), lay: window.__piLayout ? window.__piLayout.cur() : null,
             view: (function () { try { return chart.timeScale().getVisibleLogicalRange(); } catch (e) { return null; } })() };
  }
  function askRestore(s) {
    setTfKey(s.tf);
    studyCfg = s.cfg;
    Object.keys(studyState).concat(Object.keys(s.studies)).forEach(function (k) {
      if (!defOf(k)) return; studyState[k] = !!s.studies[k]; var cb = document.getElementById('cp-s-' + k); if (cb) cb.checked = !!studyState[k]; drawStudy(k); });
    Object.keys(s.layers).forEach(function (id) { setLayer(id, s.layers[id]); });
    if ((LOOK.vol !== false) !== s.vol) window.__cp.look({ vol: s.vol });
    if (s.mas && H.setMAs) H.setMAs(s.mas);
    if (s.cmp.join() !== cmpList.join()) { cmpList = s.cmp.slice(); saveCmp(); drawCmp(); }
    if (s.mode !== mode && TYPES[s.mode]) { mode = s.mode; applyType(); markType(); }
    if ((s.lines || []).length && DM) { try { DM.getAllDrawings().forEach(function (d) { if (s.lines.indexOf(d.id) >= 0) { detach(d); DM.removeDrawing(d.id); } }); saveDrawings(); } catch (e) {} }
    askUnerase(s.gone || []);
    if (s.mark) { var mi = document.getElementById('cp-mark-in'); if (mi) mi.value = ''; runMarks(''); }
    if (s.rule) { var rc = document.getElementById('cp-strat-clear'); if (rc) rc.click(); }
    if (s.replay && replay) stopReplay();
    if (s.lay && s.layMoved) window.__piLayout.set(s.lay.id, s.lay.names, []);
    if (s.dark !== document.documentElement.classList.contains('dark') && window.toggleTheme) window.toggleTheme();
    window.__cp.look(s.look);
    setScale2(s.scale); fitHeight(); saveState();
    setTimeout(function () { try { if (s.view) chart.timeScale().setVisibleLogicalRange(s.view); } catch (e) {} }, 120);
  }
  // horizontal lines at the asked prices, kept like drawn ones; their ids go back for Undo
  function askLines(ps) {
    var ids = [], c = (H.candles && H.candles()) || [], t = c.length ? c[c.length - 1].time : null;
    if (!DM || t == null || !window.LightweightChartsDrawing) return ids;
    try { var reg = window.LightweightChartsDrawing.getToolRegistry();
      ps.forEach(function (p, i) { var d = reg.createDrawing('horizontal-line', 'a' + Date.now() + '_' + i, [{ time: t, price: p }], {});
        if (d) { DM.addDrawing(d); attach(d); undoStack.push(d.id); ids.push(d.id); } });
      if (ids.length) saveDrawings(); } catch (e) {}
    return ids;
  }
  // lines read from the price's swings: the Auto layer's own reading (/api/auto-ta), drawn as the member's
  // drawings so they are saved and theirs to move; the ids join `ids` (the Undo list) when the answer lands
  function askDraw(kinds, ids) {
    var t = tickerNow(), c = (H.candles && H.candles()) || [], last = c.length ? c[c.length - 1].time : null;
    if (!t || !DM || last == null || !window.LightweightChartsDrawing) return;
    fetch('/api/auto-ta?t=' + encodeURIComponent(t)).then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) {
      var reg = window.LightweightChartsDrawing.getToolRegistry(), th = PI_CHART.theme(), n0 = ids.length;
      var col = { res: th.bad, sup: th.good }, want = function (k) { return kinds.indexOf(k) >= 0; };
      function put(type, anchors, style, extra) {
        if (!reg.has(type)) return;
        var d = reg.createDrawing(type, 'a' + Date.now() + '_' + ids.length, anchors, style, extra || {}); if (!d) return;
        d._style = style; d._orig = JSON.parse(JSON.stringify(anchors));
        DM.addDrawing(d); attach(d); undoStack.push(d.id); ids.push(d.id);
      }
      (j.lines || []).forEach(function (l) {
        if (!(want('trend') || want(l.side === 'res' ? 'trend_res' : 'trend_sup'))) return;
        put('trend-line', [l.a, l.b], { lineColor: col[l.side], lineWidth: l.touches >= 4 ? 2 : 1, lineDash: [], showLabels: false, extendRight: true }, { extendRight: true });
      });
      if (want('levels')) (j.levels || []).forEach(function (l) {
        put('horizontal-ray', [l.a], { lineColor: col[l.side], lineWidth: 1, lineDash: [5, 4], showLabels: false });
      });
      if (want('fib') && j.fib) put('fib-retracement', [{ time: last, price: j.fib.b.price }, j.fib.a],
        { lineColor: th.s2, lineWidth: 1, lineDash: [], showLabels: true, labelColor: th.s2 }, { showPrices: true, showPercentages: true });
      if (ids.length > n0) { resnapDrawings(); saveDrawings(); }
      else { var out = document.getElementById('cp-ask-out'); if (out) out.textContent += ' (no such line on this name right now)'; }
    }).catch(function () {});
  }
  // the member's own drawings on this name, removed; kept as {type, anchors, style} so Undo puts them back
  function askErase() {
    var gone = []; if (!DM) return gone;
    try { DM.getAllDrawings().filter(function (d) { return !d._auto; }).forEach(function (d) {
      gone.push({ type: d.type, anchors: d._orig || d._anchors, style: d._style || {}, hidden: !!d._hidden, locked: !!d._locked });
      detach(d); DM.removeDrawing(d.id); }); saveDrawings(); } catch (e) {}
    return gone;
  }
  function askUnerase(rows) {
    if (!DM || !rows.length) return;
    try { var reg = window.LightweightChartsDrawing.getToolRegistry();
      rows.forEach(function (r, i) { if (!reg.has(r.type)) return;
        var d = reg.createDrawing(r.type, 'b' + i + '_' + Date.now(), r.anchors, r.style || {}, wantsText(r.type) ? r.style : undefined); if (!d) return;
        d._style = r.style; d._locked = r.locked; d._hidden = r.hidden; DM.addDrawing(d); if (!d._hidden) attach(d); });
      resnapDrawings(); saveDrawings(); } catch (e) {}
  }
  function askMark(q) {
    var f = document.getElementById('cp-mark-form'), inp = document.getElementById('cp-mark-in'); if (!f || !inp) return false;
    f.style.display = ''; var b = document.querySelector('[data-tool-row="cp-mark-form"]'); if (b) b.classList.add('text-ink');
    inp.value = q; runMarks(q); return true;
  }
  function askRule(r) {
    var f = document.getElementById('cp-strat-form'); if (!f) return false;
    f.style.display = ''; var b = document.querySelector('[data-tool-row="cp-strat-form"]'); if (b) b.classList.add('text-ink');
    [['entry', r.entry], ['exit', r.exit], ['stop', r.stop], ['target', r.target]].forEach(function (kv) {
      var e = document.getElementById('cp-strat-' + kv[0]); if (e) e.value = kv[1] != null ? kv[1] : ''; });
    runStrat(); return true;
  }
  function askReplay(d) {
    var c = bars(), i = 0; while (i < c.length - 1 && typeof c[i].time === 'string' && c[i].time < d) i++;
    if (c.length < 30) return false; startReplayAt(i); return true;
  }
  function askApply(c) {
    if (c.bare) {
      applyTemplate(HOUSE.clean);
      askLayerBtns().forEach(function (b) { setLayer(b.id.slice(3), false); });
      if (LOOK.vol === false) window.__cp.look({ vol: true });
      setScale2('normal');
      cmpList.slice().forEach(dropCompare);
    }
    if (c.setup && HOUSE[c.setup]) applyTemplate(HOUSE[c.setup]);
    else if (/^my_\d+$/.test(c.setup || '')) { var mt = myTemplates(); applyTemplate(mt[Object.keys(mt)[+c.setup.slice(3)]]); }
    if (c.tf) setTfKey(c.tf);
    if (c.type && TYPES[c.type] && c.type !== mode) { mode = c.type; applyType(); markType(); }
    if (c.scale) setScale2(c.scale);
    (c.off || []).forEach(function (k) { setStudy(k, false); });
    Object.keys(c.on || {}).forEach(function (k) { setStudy(k, true, c.on[k]); });
    Object.keys(c.layers || {}).forEach(function (id) { setLayer(id, c.layers[id]); });
    if (c.vol != null && (LOOK.vol !== false) !== c.vol) window.__cp.look({ vol: c.vol });
    if (c.mas && H.setMAs) H.setMAs([0, 1, 2].map(function (i) { var m = c.mas[i], d = (H.getMAs() || [])[i] || { p: 50, t: 'SMA' };
      return m ? { on: true, p: m.p, t: m.t } : { on: false, p: d.p, t: d.t }; }));
    if (c.cmp && !c.cmp.length) cmpList.slice().forEach(dropCompare);
    (c.cmp || []).forEach(function (t) { if (t !== tickerNow().toUpperCase()) addCompare(t); });
    if (c.look) window.__cp.look(c.look);
    if (c.theme && (c.theme === 'dark') !== document.documentElement.classList.contains('dark') && window.toggleTheme) window.toggleTheme();
    fitHeight(); saveState();
    if (c.range) setTimeout(function () { setRange(c.range); }, 120);
    if (c.dates) setTimeout(function () { setDates(c.dates.from, c.dates.to); }, 160);
    var gone = c.erase ? askErase() : [];
    var made = { lines: c.lines ? askLines(c.lines) : [], gone: gone, mark: !!(c.mark && askMark(c.mark)), rule: !!(c.rule && askRule(c.rule)),
                 replay: !!(c.replay && askReplay(c.replay)), layMoved: false };
    if (c.draw) askDraw(c.draw, made.lines);
    if (c.read) { var rb = document.getElementById('tv-read'); if (rb) rb.click(); }
    if (c.layout && window.__piLayout) { window.__piLayout.set(c.layout.id, c.layout.names, c.layout.tfs); made.layMoved = true; }
    // last: these two leave the page (the alert form posts and comes back; another stock opens its own chart)
    if (c.ticker) setTimeout(function () { location.href = piNav((window.__piShell ? '/chart/' : '/name/') + encodeURIComponent(c.ticker)); }, 400);
    else if (c.alert) setTimeout(function () { armAlert(c.alert); }, 400);
    return made;
  }
  function initAsk() {
    var f = document.getElementById('cp-ask-form'); if (!f) return;
    var inp = document.getElementById('cp-ask-in'), out = document.getElementById('cp-ask-out'), undo = document.getElementById('cp-ask-undo'), prev = null;
    inp.addEventListener('keydown', function (e) { e.stopPropagation(); });   // the chart's hotkeys stay out of the box
    out.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-ask]'); if (!b) return;
      inp.value = b.getAttribute('data-ask'); f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); });
    undo.addEventListener('click', function () { if (!prev) return; askRestore(prev); prev = null; undo.style.display = 'none'; out.textContent = 'Back to how it was.'; });
    f.addEventListener('submit', function (e) {
      e.preventDefault(); var q = inp.value.trim(); if (!q) return;
      out.textContent = 'Reading…';
      var studies = Object.keys(STUDIES).filter(function (k) { return !/^fx\d$/.test(k); }).map(function (k) { var d = STUDIES[k];
        return { k: k, label: d.label, params: (d.params || []).map(function (p) { return { k: p.k, label: p.label }; }) }; });
      var layers = {}; askLayerBtns().forEach(function (b) { layers[b.id.slice(3)] = b.textContent.trim(); });
      var setups = {}; Object.keys(HOUSE).forEach(function (k) { if (k !== 'clean') setups[k] = HOUSE[k].label; });
      var types = {}; Object.keys(TYPES).forEach(function (k) { types[k] = TYPES[k].label; });
      Object.keys(myTemplates()).slice(0, 20).forEach(function (nm, i) { setups['my_' + i] = nm + ' (my own template)'; });
      var caps = { mark: !!document.getElementById('cp-mark-form'), rule: !!document.getElementById('cp-strat-form'),
                   read: !!document.getElementById('tv-read'), replay: !!document.getElementById('cp-replay'),
                   intra: intraHave(), layouts: window.__piLayout ? window.__piLayout.list() : null };
      fetch('/api/chart-ask', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: q, t: tickerNow(), studies: studies, layers: layers, setups: setups, types: types, caps: caps }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || j.error || !j.cfg) { out.textContent = (j && j.error) || 'That did not go through.'; return; }
          if (!Object.keys(j.cfg).length) { out.textContent = 'Nothing on the chart matches that. Try: weekly, 2 years, RSI, hide volume.'; return; }
          prev = askSnap(); var made = askApply(j.cfg); Object.keys(made).forEach(function (k) { prev[k] = made[k]; });
          undo.style.display = ''; out.textContent = j.said;
        })
        .catch(function () { out.textContent = 'That did not go through.'; });
    });
  }

  // ── legend rows for the lines that are not studies (chart_fixes2): the moving averages, the S&P
  // line, the anchored VWAPs and the compared names, each with its eye, gear and cross ──
  function lnVal(sr, at) {
    var d; try { d = sr.data(); } catch (e) { return null; }
    if (!d.length) return null;
    if (at == null) return d[d.length - 1].value;
    for (var i = d.length - 1; i >= 0; i--) { if (d[i].time === at) return d[i].value; if (d[i].time < at) break; }
    return null;
  }
  function lnCol(sr, d) { try { return sr.options().color || d; } catch (e) { return d; } }
  function lineSeriesOf(k) {
    var L = H.lines ? H.lines() : null, m;
    if (k.indexOf('ln:ma:') === 0) return L && L.ma[+k.slice(6)] ? [L.ma[+k.slice(6)]] : [];
    if (k === 'ln:spy') return L ? [L.spy] : [];
    if (k.indexOf('ln:av:') === 0) return avwapMeta.filter(function (a) { return a.k === k; }).map(function (a) { return a.sr; });
    if (k.indexOf('cmp:') === 0) return cmpSeries[k.slice(4)] ? [cmpSeries[k.slice(4)]] : [];
    return [];
  }
  function lineRows(at) {
    if (!window.__piFixes2) return [];
    var out = [], L = H.lines ? H.lines() : null;
    if (L) {
      L.cfg.forEach(function (cf, i) {
        if (!cf || !cf.on || !L.ma[i].data().length) return;
        var k = 'ln:ma:' + i;
        out.push({ k: k, label: cf.t + ' ' + cf.p, last: lnVal(L.ma[i], at), color: lnCol(L.ma[i], C.m), pane: 0, hidden: !!LNHID[k] });
      });
      if (L.spy.data().length) out.push({ k: 'ln:spy', label: 'S&P 500, rebased to this name', last: lnVal(L.spy, at), color: lnCol(L.spy, C.m), pane: 0, hidden: !!LNHID['ln:spy'] });
    }
    avwapMeta.forEach(function (a) { out.push({ k: a.k, label: a.label, last: lnVal(a.sr, at), color: a.color, pane: 0, hidden: !!LNHID[a.k] }); });
    if (cmpMode !== 'pane') cmpList.forEach(function (t, n) {
      var sr = cmpSeries[t]; if (!sr) return;
      var raw = cmpData[t] || [], last = null;
      for (var i = raw.length - 1; i >= 0; i--) { if (at == null || raw[i].time === at) { last = raw[i].close; break; } if (raw[i].time < at) break; }
      out.push({ k: 'cmp:' + t, label: (t === 'SPY' ? 'S&P 500 (SPY)' : t) + ', compared', last: last, color: CMP_COLS[n % CMP_COLS.length], pane: 0, hidden: !!LNHID['cmp:' + t] });
    });
    return out;
  }
  function hideLine(k) {
    LNHID[k] = !LNHID[k];
    lineSeriesOf(k).forEach(function (sr) { try { sr.applyOptions({ visible: !LNHID[k] }); } catch (e) {} });
    declutterAxis(); try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {}
  }
  function removeLine(k) {
    var L = H.lines ? H.lines() : null, b;
    if (k.indexOf('ln:ma:') === 0 && L) { var m = H.getMAs(); m[+k.slice(6)].on = false; H.setMAs(m); }
    else if (k === 'ln:spy') { b = document.getElementById('tf-spy'); if (b && b.classList.contains('bg-accent')) b.click(); }
    else if (k === 'ln:av:earnings' || k === 'ln:av:high52') { b = document.getElementById('tf-av'); if (b && b.classList.contains('bg-accent')) b.click(); }
    else if (k.indexOf('ln:av:') === 0) { var at = k.slice(6), i = -1; avwapAnchors.forEach(function (t, n) { if (String(t).slice(0, 10) === at) i = n; });
      if (i >= 0) { avwapAnchors.splice(i, 1); drawAvwaps(); saveAvwap(); } }
    LNHID[k] = false; try { document.dispatchEvent(new CustomEvent('cp-studies')); } catch (e) {}
  }

  function boot2() {
    H = window.__piChart; if (!H) return;
    LWC = H.LWC; chart = H.chart;
    if (!tvMore()) delete TYPES.rangebars;   // dark chart_tv_lot4
    var vcb = document.getElementById('chart-snap');
    if (!(vcb && vcb.dataset && vcb.dataset.volCandles === '1' && window.__cpVolCandles && chart.addCustomSeries)) delete TYPES.volcandles;   // dark vol_candles
    if (!(vcb && vcb.dataset && vcb.dataset.raindrop === '1' && window.__cpRaindrop && chart.addCustomSeries)) delete TYPES.raindrop;   // dark f5104_ajouter_graphique_raindrop_menu_style
    // dark weekly_mas: the stepped weekly averages exist only when the page sent their rows
    try { if (H.tf() === '1D' && !(H.ours && H.ours() || {}).wkma) { delete STUDIES.wk_ma10; delete STUDIES.wk_ma30; } } catch (e) {}
    window.__cp = {
      indicators: openIndicators, fit: fitHeight, pick: function (k) { if (k.indexOf('ln:') === 0 || k.indexOf('cmp:') === 0) return; pickStudy(k); },
      hide: function (k) { if (k.indexOf('ln:') === 0 || k.indexOf('cmp:') === 0) { hideLine(k); return; } hideStudy(k, !(scOf(k).hidden)); },
      view: quickView, gotoDate: gotoDate, gotoAsk: gotoAsk, interval: setInterval2, share: shareSnapshot, undo: undoDrawing, redo: redoDrawing,
      replay: function () { if (replay) stopReplay(); else startReplay(); }, setTool: setTool, objects: toggleObjs, keys: showKeys,
      keymap: function () { return KEYMAP.filter(function (r) { return r.c; }).map(function (r) { return { c: r.c, l: r.l, k: keyDisp(r.c) }; }); },   // chart_tv_keys: the table, for the checks
      state: function () { var r = null; try { r = chart.timeScale().getVisibleLogicalRange(); } catch (e) {} return { tool: activeTool, scale: scaleName, inverted: inverted, interval: interval, replay: !!replay, playing: !!(replay && replay.timer), hidden: _hiddenLayer, sel: (function () { try { var s = selected(); return s ? s._anchors : null; } catch (e) { return null; } })(), undo: snapUndo.length, draws: snapPrev, from: r && r.from, to: r && r.to, pos: (function () { try { return chart.timeScale().scrollPosition(); } catch (e) { return null; } })(), n: (function () { try { return DM.getAllDrawings().length; } catch (e) { return -1; } })() }; },
      palette: function () { try { openPal(); } catch (e) {} },
      drawBar: function () { var nm = {}; toolDefs().forEach(function (d) { nm[d.type] = d.name; });   // chart-floatbar.js: the rail's pins, icons and names
        return { favs: railFavs(), icon: RAIL_ICON, name: nm, active: activeTool, setTool: setTool }; },
      run: function (id) { var e = palEntries().filter(function (x) { return x.id === id; })[0]; if (e) e.run(); },
      favs: function () { return favs().map(function (id) { var e = palEntries().filter(function (x) { return x.id === id; })[0]; return e ? { id: id, label: e.label } : null; }).filter(Boolean); },
      studies: function (at) { return liveKeys().filter(function (k) {
        if (!defOf(k)) return false;
        var sc = studyCfg[k] || {}; return !(sc.tfs && sc.tfs[H.tf()] === false);   // hidden on this timeframe, hidden from the legend
      }).map(function (k) {
        // `at` is the bar the cursor sits on: the legend reads that bar, not the last one
        var ss = studySeries[k] || [], d = ss.length ? ss[ss.length - 1].data() : [];
        var last = d.length ? d[d.length - 1].value : null;
        if (at != null && d.length) { var hit = null; for (var qi = d.length - 1; qi >= 0; qi--) { if (d[qi].time === at) { hit = d[qi]; break; } if (d[qi].time < at) break; }
          last = hit ? hit.value : null; }
        var tag = (defOf(k) || {}).lgTag ? (defOf(k) || {}).lgTag(cfgOf(k)) : ((defOf(k) || {}).params || []).map(function (x) { return cfgOf(k)[x.k]; }).join(' ');
        var col = (studyCfg[k] || {}).color; if (!col) { try { col = ss[0].options().color || ''; } catch (e) { col = ''; } }
        if ((studyCfg[k] || {}).status === false) last = null;
        var dd = defOf(k) || {};
        var words = ''; if (dd.words) { try { words = dd.words((H.ours && H.ours()) || {}) || ''; } catch (e) {} }
        if (words) last = null;
        if (last != null && dd.lgFmt) last = dd.lgFmt(last);
        var lgName = (words && dd.lgName) || dd.lgShort || dd.label;
        var htfTag = (studyCfg[k] || {}).htf && tvMore() ? ({ W: ' \u00b7 weekly', M: ' \u00b7 monthly' })[(studyCfg[k] || {}).htf] || '' : '';
        return { k: k, label: lgName + (tag ? ' ' + tag : '') + (baseKey(k) !== k ? ' \u00b7 ' + k.split('#')[1] : '') + htfTag + (words ? ' \u00b7 ' + words : ''),
                 last: last, color: col, pane: dd.pane, paneIdx: studyPane[k], hidden: !!(studyCfg[k] || {}).hidden }; })
        .concat(lineRows(at))
        .concat(Object.keys(cmpPanes).map(function (t) { var d = cmpData[t] || [], last = d.length ? d[d.length - 1].close : null;
          if (at != null && d.length) { var h2 = null; for (var ci = d.length - 1; ci >= 0; ci--) { if (d[ci].time === at) { h2 = d[ci]; break; } if (d[ci].time < at) break; } last = h2 ? h2.close : null; }
          return { k: 'cmp:' + t, label: t + ', compared', last: last, color: C.m, pane: 1, paneIdx: cmpPanes[t] }; })); },
      openSettings: function (k) { if (String(k).indexOf('ln:ma:') === 0) { var mm = document.getElementById('ma-menu'); if (mm) mm.setAttribute('open', ''); else openIndicators(); return; }
        if (String(k).indexOf('ln:') === 0) { openIndicators(); return; }
        if (String(k).indexOf('cmp:') === 0) { var cm = document.getElementById('cp-cmp'); if (cm) { cm.setAttribute('open', ''); var ci = document.getElementById('cp-cmp-in'); if (ci) ci.focus(); } return; } openStudySettings(k); },
      setTf: function (t) { var m = { '1D': 'd', '1W': 'w', '1M': 'm', D: 'd', W: 'w', M: 'm' };
        var b = document.getElementById('tf-' + (m[t] || t)); if (b) b.click(); },
      toggleStudy: function (k) { if (k.indexOf('ln:') === 0) { removeLine(k); return; } if (k.indexOf('cmp:') === 0) { dropCompare(k.slice(4)); return; } studyState[k] = !studyState[k]; var cb = document.getElementById('cp-s-' + k); if (cb) cb.checked = !!studyState[k]; drawStudy(k); fitHeight(); saveState(); },
      push: function () { try { pushSettings(); } catch (e) {} },
      picked: function () { return pickedStudy; },
      look: function (patch) { Object.keys(patch || {}).forEach(function (k) { LOOK[k] = patch[k]; }); applyLook(); try { buildLook(); } catch (e) {} },
      LOOK: function () { return JSON.parse(JSON.stringify(LOOK)); },
      lastBar: function () { var c = bars(); return c[c.length - 1] || null; },
      // the hooks the Auto layer (chart-autota.js) draws through
      auto: { dm: function () { return DM; }, attach: attach, detach: detach, keep: keepAuto,
              snap: nearestBarTime, hint: hint, pill: pill, MENU_BTN: MENU_BTN, interval: function () { return intraTf || interval; } }
    };
    buildToolbar(); loadState(); markType();
    // name.html read the moving averages before the account copy landed, so
    // hand them over again now that it has
    try { var m = JSON.parse(localStorage.getItem('pi_chart_mas') || 'null');
      if (m && H.setMAs) H.setMAs(m); } catch (e) {}
    initTips(); initAxes(); initStudyMenu(); initPaneBar(); initStudyPick();
    drawAlertLines(); initAlertDrag(); initSymbolMenu();
    if (initDrawings()) { buildDrawMenu(); buildRail(); initDrag(); initExtraTools(); initHotkeys(); initHiLo(); if (window.__piObjsStudies) document.addEventListener('cp-studies', function () { renderObjs(); }); initContextMenu(); loadAvwap(); loadRvp(); drawRvp(); overlaysSoon(); setTimeout(restorePlan, 400); }
    buildTemplateMenu(); buildPins();
    try { initMarks(); } catch (e) {}
    try { initDataWindow(); } catch (e) {}
    try { initStrategy(); } catch (e) {}
    try { initAsk(); } catch (e) {}
    try { if (H.onChange) H.onChange(applyAutoForTf); } catch (e) {}
    lastAutoTf = tfNow();   // the set already on screen stays, no surprise reset
    buildLook();
    buildCompare();
    buildPalette();
    var pb = document.getElementById('cp-pal-btn'); if (pb) pb.addEventListener('click', openPal);
    applyType(); redrawStudies();
    H.onChange(function () { interval = 'D'; markInterval(); if (replay) stopReplay(); applyType(); redrawStudies(); applyLook(); drawAvwaps(); drawCmp(); resnapDrawings(); drawRvp(); });
    document.addEventListener('pi-auto-avwap', function () { drawAvwaps(); });
    try { [['tf-vpvr', rvpFollow], ['tf-svp', svpOn], ['tf-tpo', tpoOn]].forEach(function (x) { var bt = document.getElementById(x[0]); if (bt) pill(bt, x[1]); }); } catch (e) {}
    try { chart.timeScale().subscribeVisibleLogicalRangeChange(function () { drawStudyLabels(); patSoon(); declutterAxis(); }); } catch (e) {}
    try { ['wheel', 'mouseup', 'touchend'].forEach(function (ev) { H.el.addEventListener(ev, function () { setTimeout(patSoon, 80); setTimeout(declutterAxis, 100); }, { passive: true }); });   // a vertical rescale moves the points
      window.addEventListener('resize', function () { setTimeout(patSoon, 80); setTimeout(declutterAxis, 100); }); } catch (e) {}
    try { chart.timeScale().subscribeVisibleLogicalRangeChange(function (r) { drawRvp(); maybeLoadOlder(r); }); window.addEventListener('resize', function () { setTimeout(drawRvp, 60); }); } catch (e) {}
    try { window.__cpReady = true; document.dispatchEvent(new CustomEvent('pi-cp-ready')); } catch (e) {}
  }
  function start() {
    // the drawing key needs the ticker, which is on the page, not the network
    var tk = (document.getElementById('chart-snap') || {}).dataset;
    drawKey = 'pi_draw_' + ((tk && tk.ticker) || 'x');
    pullSettings(boot2);
  }

  if (window.__piChart) start();
  else document.addEventListener('pi-chart-ready', start);
})();
