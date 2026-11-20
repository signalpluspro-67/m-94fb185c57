/* The indicator library of app/indicators.py, for the chart's formula engine
   (chart-pro.js FX). Same names, same arguments, same maths, arrays of
   numbers with null where a value is undefined. tests/test_indicators.py runs
   every function here and in Python on the same bars and compares them. */
(function (root) {
  'use strict';
  function nn(x) { return x == null || x !== x; }
  function full(n) { var o = new Array(n); for (var i = 0; i < n; i++) o[i] = null; return o; }
  function map2(a, b, f) { var o = full(a.length); for (var i = 0; i < a.length; i++) if (!nn(a[i]) && !nn(b[i])) { var r = f(a[i], b[i]); o[i] = (r == null || r !== r || !isFinite(r)) ? null : r; } return o; }
  function map1(a, f) { var o = full(a.length); for (var i = 0; i < a.length; i++) if (!nn(a[i])) { var r = f(a[i]); o[i] = (r == null || r !== r || !isFinite(r)) ? null : r; } return o; }
  function konst(n, v) { var o = new Array(n); for (var i = 0; i < n; i++) o[i] = v; return o; }
  function shift(a, p) { var o = full(a.length); for (var i = p; i < a.length; i++) o[i] = nn(a[i - p]) ? null : a[i - p]; return o; }
  function win(a, p, fn) { var o = full(a.length); for (var i = p - 1; i < a.length; i++) { var w = a.slice(i - p + 1, i + 1), bad = false;
      for (var j = 0; j < w.length; j++) if (nn(w[j])) { bad = true; break; } if (!bad) { var r = fn(w); o[i] = (r == null || r !== r || !isFinite(r)) ? null : r; } } return o; }
  function sum(w) { var s = 0; for (var i = 0; i < w.length; i++) s += w[i]; return s; }
  function sma(a, p) { return win(a, p, function (w) { return sum(w) / p; }); }
  function std(a, p) { return win(a, p, function (w) { var m = sum(w) / w.length, s = 0; for (var i = 0; i < w.length; i++) s += (w[i] - m) * (w[i] - m); return Math.sqrt(s / w.length); }); }
  function hhv(a, p) { return win(a, p, function (w) { return Math.max.apply(null, w); }); }
  function llv(a, p) { return win(a, p, function (w) { return Math.min.apply(null, w); }); }
  function wsum(a, p) { return win(a, p, sum); }
  function ema(a, p) { var o = full(a.length), k = 2 / (p + 1), e = null, s = 0, c = 0;
    for (var i = 0; i < a.length; i++) { var x = a[i];
      if (!nn(x)) { if (e == null) { s += x; c++; if (c === p) e = s / p; } else e = x * k + e * (1 - k); }
      o[i] = e; } return o; }
  function rma(a, p) { return ema(a, 2 * p - 1); }
  function rsi(a, p) { var o = full(a.length), cnt = 0, g = 0, l = 0, ag = null, al = null;
    for (var t = 1; t < a.length; t++) { if (nn(a[t]) || nn(a[t - 1])) continue; var d = a[t] - a[t - 1], up = Math.max(d, 0), dn = Math.max(-d, 0); cnt++;
      if (cnt <= p) { g += up; l += dn; } if (cnt === p) { ag = g / p; al = l / p; } else if (cnt > p) { ag = (ag * (p - 1) + up) / p; al = (al * (p - 1) + dn) / p; }
      if (cnt >= p) o[t] = 100 - 100 / (1 + (al !== 0 ? ag / al : 99)); } return o; }
  function div(a, b) { return map2(a, b, function (x, y) { return y === 0 ? null : x / y; }); }
  function add(a, b) { return map2(a, b, function (x, y) { return x + y; }); }
  function sub(a, b) { return map2(a, b, function (x, y) { return x - y; }); }
  function mul(a, k) { return map1(a, function (x) { return x * k; }); }
  function tr(B) { var o = full(B.c.length); for (var i = 0; i < B.c.length; i++) { var h = B.h[i], l = B.l[i], pc = i ? B.c[i - 1] : null;
      if (nn(h) || nn(l)) continue; o[i] = nn(pc) ? h - l : Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); } return o; }

  // ── one series in
  function dema(B, s, p) { var e = ema(s, p); return sub(mul(e, 2), ema(e, p)); }
  function tema(B, s, p) { var e1 = ema(s, p), e2 = ema(e1, p); return add(sub(mul(e1, 3), mul(e2, 3)), ema(e2, p)); }
  function kama(B, s, p, fast, slow) { var o = full(s.length), fc = 2 / (fast + 1), sc = 2 / (slow + 1), k = null;
    for (var t = p; t < s.length; t++) { if (nn(s[t])) { o[t] = k; continue; } var chg = nn(s[t - p]) ? NaN : Math.abs(s[t] - s[t - p]), vol = 0;
      for (var j = t - p + 1; j <= t; j++) if (!nn(s[j]) && !nn(s[j - 1])) vol += Math.abs(s[j] - s[j - 1]);
      var er = vol > 0 ? chg / vol : 0; if (er !== er) er = NaN; var a = Math.pow(er * (fc - sc) + sc, 2);
      if (k == null) k = s[t]; else k = k + a * (s[t] - k); o[t] = (k !== k) ? null : k; } return o; }
  function lsma(B, s, p) { var xm = (p - 1) / 2, xx = 0; for (var i = 0; i < p; i++) xx += (i - xm) * (i - xm);
    return win(s, p, function (w) { var ym = sum(w) / p, c = 0; for (var i = 0; i < p; i++) c += (w[i] - ym) * (i - xm); return ym + c / xx * (p - 1 - xm); }); }
  function trix(B, s, p) { var e = ema(ema(ema(s, p), p), p); return map1(div(e, shift(e, 1)), function (x) { return (x - 1) * 100; }); }
  function cmo(B, s, p) { var d = sub(s, shift(s, 1)), up = wsum(d.map(function (x) { return x == null ? null : (x > 0 ? x : 0); }), p),
      dn = wsum(d.map(function (x) { return x == null ? null : (x < 0 ? -x : 0); }), p); return mul(div(sub(up, dn), add(up, dn)), 100); }
  function tsi(B, s, r, sm) { var m = sub(s, shift(s, 1)); return mul(div(ema(ema(m, r), sm), ema(ema(map1(m, Math.abs), r), sm)), 100); }
  function ppo(B, s, f, sl) { return mul(div(sub(ema(s, f), ema(s, sl)), ema(s, sl)), 100); }
  function macd(B, s, f, sl) { return sub(ema(s, f), ema(s, sl)); }
  function macds(B, s, f, sl, g) { return ema(macd(B, s, f, sl), g); }
  function macdh(B, s, f, sl, g) { var m = macd(B, s, f, sl); return sub(m, ema(m, g)); }
  function bbm(B, s, p) { return sma(s, p); }
  function bbu(B, s, p, k) { return add(sma(s, p), mul(std(s, p), k)); }
  function bbl(B, s, p, k) { return sub(sma(s, p), mul(std(s, p), k)); }
  function bbw(B, s, p, k) { return mul(div(mul(std(s, p), 2 * k), sma(s, p)), 100); }
  function bbp(B, s, p, k) { var lo = bbl(B, s, p, k), hi = bbu(B, s, p, k); return div(sub(s, lo), sub(hi, lo)); }
  function stochrsi(B, s, p) { var r = rsi(s, p); return mul(div(sub(r, llv(r, p)), sub(hhv(r, p), llv(r, p))), 100); }
  function zscore(B, s, p) { return div(sub(s, sma(s, p)), std(s, p)); }
  function highest(B, s, p) { return hhv(s, p); }
  function lowest(B, s, p) { return llv(s, p); }
  function sum_(B, s, p) { return wsum(s, p); }
  function change(B, s, p) { return sub(s, shift(s, p)); }
  function pct(B, s, p) { return map1(div(s, shift(s, p)), function (x) { return (x - 1) * 100; }); }

  // ── the bar's own prices
  function tp(B) { var o = full(B.c.length); for (var i = 0; i < o.length; i++) if (!nn(B.h[i]) && !nn(B.l[i]) && !nn(B.c[i])) o[i] = (B.h[i] + B.l[i] + B.c[i]) / 3; return o; }
  function prod(a, b) { return map2(a, b, function (x, y) { return x * y; }); }
  function vwma(B, p) { return div(wsum(prod(B.c, B.v), p), wsum(B.v, p)); }
  function vwap(B, p) { return div(wsum(prod(tp(B), B.v), p), wsum(B.v, p)); }
  function cci(B, p) { var t = tp(B), md = win(t, p, function (w) { var m = sum(w) / w.length, s = 0; for (var i = 0; i < w.length; i++) s += Math.abs(w[i] - m); return s / w.length; });
    return div(sub(t, sma(t, p)), mul(md, 0.015)); }
  function mfi(B, p) { var t = tp(B), mf = prod(t, B.v), d = sub(t, shift(t, 1)), pos = full(t.length), neg = full(t.length);
    for (var i = 0; i < t.length; i++) { if (nn(d[i]) || nn(mf[i])) continue; pos[i] = d[i] > 0 ? mf[i] : 0; neg[i] = d[i] < 0 ? mf[i] : 0; }
    var ps = wsum(pos, p); return mul(div(ps, add(ps, wsum(neg, p))), 100); }
  function willr(B, p) { var hh = hhv(B.h, p), ll = llv(B.l, p); return mul(div(sub(hh, B.c), sub(hh, ll)), -100); }
  function stochk(B, p, sm) { var hh = hhv(B.h, p), ll = llv(B.l, p); return sma(mul(div(sub(B.c, ll), sub(hh, ll)), 100), sm); }
  function stochd(B, p, sm, d) { return sma(stochk(B, p, sm), d); }
  function ao(B) { var m = map2(B.h, B.l, function (x, y) { return (x + y) / 2; }); return sub(sma(m, 5), sma(m, 34)); }
  function uo(B, p1, p2, p3) { var pc = shift(B.c, 1), bp = full(B.c.length), t = full(B.c.length);
    for (var i = 0; i < bp.length; i++) { if (nn(pc[i]) || nn(B.l[i]) || nn(B.h[i]) || nn(B.c[i])) continue; bp[i] = B.c[i] - Math.min(B.l[i], pc[i]); t[i] = Math.max(B.h[i], pc[i]) - Math.min(B.l[i], pc[i]); }
    var a1 = div(wsum(bp, p1), wsum(t, p1)), a2 = div(wsum(bp, p2), wsum(t, p2)), a3 = div(wsum(bp, p3), wsum(t, p3));
    return map2(map2(a1, a2, function (x, y) { return 4 * x + 2 * y; }), a3, function (x, y) { return 100 * (x + y) / 7; }); }
  function natr(B, p) { return mul(div(ema(tr(B), p), B.c), 100); }
  function chop(B, p) { var rng = sub(hhv(B.h, p), llv(B.l, p)); return map1(div(wsum(tr(B), p), rng), function (x) { return 100 * Math.log10(x) / Math.log10(p); }); }
  function cum(step, c) { var o = full(c.length), s = 0; for (var i = 0; i < c.length; i++) { s += nn(step[i]) ? 0 : step[i]; o[i] = nn(c[i]) ? null : s; } return o; }
  function obv(B) { var step = full(B.c.length); for (var i = 1; i < B.c.length; i++) if (!nn(B.c[i]) && !nn(B.c[i - 1])) step[i] = Math.sign(B.c[i] - B.c[i - 1]) * (nn(B.v[i]) ? 0 : B.v[i]); return cum(step, B.c); }
  function clv(B) { return div(map2(sub(B.c, B.l), sub(B.h, B.c), function (x, y) { return x - y; }), sub(B.h, B.l)); }
  function ad(B) { return cum(prod(clv(B), B.v), B.c); }
  function cmf(B, p) { var c = clv(B).map(function (x, i) { return nn(x) && !nn(B.c[i]) ? 0 : x; }); return div(wsum(prod(c, B.v), p), wsum(B.v, p)); }
  function vroc(B, p) { return map1(div(B.v, shift(B.v, p)), function (x) { return (x - 1) * 100; }); }
  function dm(B, p) { var n = B.c.length, pd = full(n), md = full(n);
    for (var i = 1; i < n; i++) { if (nn(B.h[i]) || nn(B.h[i - 1]) || nn(B.l[i]) || nn(B.l[i - 1])) continue; var up = B.h[i] - B.h[i - 1], dn = B.l[i - 1] - B.l[i];
      pd[i] = (up > dn && up > 0) ? up : 0; md[i] = (dn > up && dn > 0) ? dn : 0; }
    var a = rma(tr(B), p); return [mul(div(rma(pd, p), a), 100), mul(div(rma(md, p), a), 100)]; }
  function pdi(B, p) { return dm(B, p)[0]; }
  function mdi(B, p) { return dm(B, p)[1]; }
  function adx(B, p) { var d = dm(B, p); return rma(map2(d[0], d[1], function (x, y) { return x + y === 0 ? null : 100 * Math.abs(x - y) / (x + y); }), p); }
  function argm(w, big) { var k = 0; for (var i = 1; i < w.length; i++) if (big ? w[i] > w[k] : w[i] < w[k]) k = i; return k; }
  function aroonu(B, p) { return win(B.h, p + 1, function (w) { return 100 * argm(w, true) / p; }); }
  function aroond(B, p) { return win(B.l, p + 1, function (w) { return 100 * argm(w, false) / p; }); }
  function psar(B, step, mx) { var n = B.c.length, o = full(n), h = B.h, l = B.l, ok = [];
    for (var i = 0; i < n; i++) if (!nn(h[i]) && !nn(l[i])) ok.push(i); if (ok.length < 2) return o;
    var t0 = ok[0], up = true, af = step, sar = l[t0], ep = h[t0];
    for (var t = t0 + 1; t < n; t++) { if (nn(h[t]) || nn(l[t])) continue; sar = sar + af * (ep - sar);
      if (up) { sar = Math.min(sar, nn(l[t - 1]) ? sar : l[t - 1]); if (l[t] < sar) { up = false; sar = ep; ep = l[t]; af = step; } else if (h[t] > ep) { ep = h[t]; af = Math.min(af + step, mx); } }
      else { sar = Math.max(sar, nn(h[t - 1]) ? sar : h[t - 1]); if (h[t] > sar) { up = true; sar = ep; ep = h[t]; af = step; } else if (l[t] < ep) { ep = l[t]; af = Math.min(af + step, mx); } }
      o[t] = sar; } return o; }
  function supertrend(B, p, mult) { var n = B.c.length, a = rma(tr(B), p), o = full(n), fu = null, fl = null, up = true;
    for (var t = 0; t < n; t++) { if (nn(a[t]) || nn(B.h[t]) || nn(B.l[t])) continue; var mid = (B.h[t] + B.l[t]) / 2, ub = mid + mult * a[t], lb = mid - mult * a[t], pc = t ? B.c[t - 1] : null;
      fu = (fu == null || ub < fu || (!nn(pc) && pc > fu)) ? ub : fu; fl = (fl == null || lb > fl || (!nn(pc) && pc < fl)) ? lb : fl;
      if (up && B.c[t] < fl) up = false; else if (!up && B.c[t] > fu) up = true; o[t] = up ? fl : fu; } return o; }
  function kcm(B, p) { return ema(B.c, p); }
  function kcu(B, p, k) { return add(ema(B.c, p), mul(ema(tr(B), p), k)); }
  function kcl(B, p, k) { return sub(ema(B.c, p), mul(ema(tr(B), p), k)); }
  function dcu(B, p) { return hhv(B.h, p); }
  function dcl(B, p) { return llv(B.l, p); }
  function dcm(B, p) { return map2(hhv(B.h, p), llv(B.l, p), function (x, y) { return (x + y) / 2; }); }
  function senkoua(B, t, k) { return shift(map2(dcm(B, t), dcm(B, k), function (x, y) { return (x + y) / 2; }), k); }
  function senkoub(B, p, k) { return shift(dcm(B, p), k); }

  // ── conditions
  function crossup(B, x, y) { var d = sub(x, y), pd = shift(d, 1); return map2(d, pd, function (a, b) { return (a > 0 && b <= 0) ? 1 : 0; }); }
  function crossdown(B, x, y) { var d = sub(x, y), pd = shift(d, 1); return map2(d, pd, function (a, b) { return (a < 0 && b >= 0) ? 1 : 0; }); }
  function crossed(B, x, y) { return map2(crossup(B, x, y), crossdown(B, x, y), Math.max); }
  function barssince(B, c) { var o = full(c.length), last = null; for (var t = 0; t < c.length; t++) { if (!nn(c[t]) && c[t] > 0) last = t; o[t] = last == null ? null : t - last; } return o; }
  function count(B, c, p) { return wsum(c.map(function (x) { return nn(x) ? null : (x > 0 ? 1 : 0); }), p); }

  var SPECS = {
    dema: ['s', 1, [20], dema], tema: ['s', 1, [20], tema], kama: ['s', 1, [10, 2, 30], kama], lsma: ['s', 1, [25], lsma],
    trix: ['s', 1, [15], trix], cmo: ['s', 1, [14], cmo], tsi: ['s', 1, [25, 13], tsi], ppo: ['s', 1, [12, 26], ppo],
    macd: ['s', 1, [12, 26], macd], macds: ['s', 1, [12, 26, 9], macds], macdh: ['s', 1, [12, 26, 9], macdh],
    bbm: ['s', 1, [20], bbm], bbu: ['s', 1, [20, 2.0], bbu], bbl: ['s', 1, [20, 2.0], bbl], bbw: ['s', 1, [20, 2.0], bbw], bbp: ['s', 1, [20, 2.0], bbp],
    stochrsi: ['s', 1, [14], stochrsi], zscore: ['s', 1, [20], zscore], highest: ['s', 1, [20], highest], lowest: ['s', 1, [20], lowest],
    sum: ['s', 1, [20], sum_], change: ['s', 1, [1], change], pct: ['s', 1, [1], pct],
    vwma: ['b', 0, [20], vwma], vwap: ['b', 0, [20], vwap], cci: ['b', 0, [20], cci], mfi: ['b', 0, [14], mfi], willr: ['b', 0, [14], willr],
    stochk: ['b', 0, [14, 3], stochk], stochd: ['b', 0, [14, 3, 3], stochd], ao: ['b', 0, [], ao], uo: ['b', 0, [7, 14, 28], uo],
    natr: ['b', 0, [14], natr], chop: ['b', 0, [14], chop], obv: ['b', 0, [], obv], ad: ['b', 0, [], ad], cmf: ['b', 0, [20], cmf], vroc: ['b', 0, [14], vroc],
    adx: ['b', 0, [14], adx], pdi: ['b', 0, [14], pdi], mdi: ['b', 0, [14], mdi], aroonu: ['b', 0, [25], aroonu], aroond: ['b', 0, [25], aroond],
    psar: ['b', 0, [0.02, 0.2], psar], supertrend: ['b', 0, [10, 3.0], supertrend],
    kcm: ['b', 0, [20], kcm], kcu: ['b', 0, [20, 2.0], kcu], kcl: ['b', 0, [20, 2.0], kcl],
    dcu: ['b', 0, [20], dcu], dcl: ['b', 0, [20], dcl], dcm: ['b', 0, [20], dcm], tenkan: ['b', 0, [9], dcm], kijun: ['b', 0, [26], dcm],
    senkoua: ['b', 0, [9, 26], senkoua], senkoub: ['b', 0, [52, 26], senkoub],
    crossed: ['c', 2, [], crossed], crossup: ['c', 2, [], crossup], crossdown: ['c', 2, [], crossdown], barssince: ['c', 1, [], barssince], count: ['c', 1, [20], count]
  };
  // numbers that stay decimal (a band width, a step); every other number is a period, rounded
  var DECIMAL = { bbu: [1], bbl: [1], bbw: [1], bbp: [1], kcu: [1], kcl: [1], supertrend: [1], psar: [0, 1] };
  // args: evaluated arguments (arrays or numbers); B = {o,h,l,c,v} arrays; fail(msg) throws the caller's error
  function call(name, args, B, fail) {
    var sp = SPECS[name], kind = sp[0], nser = sp[1], defs = sp[2], fn = sp[3], a = args.slice(), sers = [], n = B.c.length;
    if (kind === 's') sers.push(a.length && Array.isArray(a[0]) ? a.shift() : B.c);
    else if (kind === 'c') { if (a.length < nser) fail(name + ' wants ' + nser + ' condition' + (nser > 1 ? 's' : ''));
      sers = a.slice(0, nser).map(function (x) { return Array.isArray(x) ? x : konst(n, x); }); a = a.slice(nser); }
    if (a.length > defs.length) fail(name + ' takes at most ' + (defs.length + (kind === 's' ? 1 : nser)) + ' arguments');
    var dec = DECIMAL[name] || [];
    var nums = defs.map(function (d, i) { var x = i < a.length ? a[i] : d; if (Array.isArray(x)) fail(name + ' wants a number');
      return dec.indexOf(i) >= 0 ? x : Math.max(1, Math.min(10000, Math.round(x))); });
    return fn.apply(null, [B].concat(sers, nums));
  }
  root.PIFX = { SPECS: SPECS, call: call, has: function (f) { return Object.prototype.hasOwnProperty.call(SPECS, f); } };
})(typeof window !== 'undefined' ? window : globalThis);
