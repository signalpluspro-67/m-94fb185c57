/* Crypto flow visuals (dark flag crypto_flow): footprint, depth chart, DOM ladder,
   estimated liquidation heatmap, kimchi premium line. Vanilla canvas plus the vendored
   Lightweight Charts v5 (liquidation and kimchi charts). Data arrives as JSON in the page.
   Colors are read from the app's own tokens (probe elements wearing the app's utility
   classes), so light and dark both follow the rest of the app; the three venue tones come
   from crypto-flow.css. Everything redraws on resize and on a theme switch. */
(function () {
  'use strict';
  var CF = window.CryptoFlow = {};
  var MONO = '"JetBrains Mono","SF Mono",ui-monospace,monospace';
  var SANS = '-apple-system,"Helvetica Neue",Arial,sans-serif';
  var views = [];
  var NAMES = { binance: 'Binance', coinbase: 'Coinbase', okx: 'OKX' };

  // ── colors ────────────────────────────────────────────────────────────────
  var probes = null;
  function palette() {
    if (!probes) {
      var box = document.createElement('div');
      box.setAttribute('aria-hidden', 'true');
      box.className = 'cf';
      box.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
      box.innerHTML = '<i class="text-ink"></i><i class="text-ink-mute"></i><i class="text-good"></i>' +
        '<i class="text-bad"></i><i class="text-ink"></i><i class="text-warn"></i>' +   /* slot 4 = the marks (mid, mark, POC): the ink, violet is never a level or a datum */
        '<i class="bg-white border border-sepia-border" style="border-style:solid;border-width:1px"></i>' +
        '<i class="bg-sepia-hover"></i>';
      document.body.appendChild(box);
      probes = box;
    }
    var k = probes.children;
    function col(i) { return getComputedStyle(k[i]).color; }
    var card = getComputedStyle(k[6]);
    var root = getComputedStyle(probes);
    return {
      ink: col(0), mute: col(1), up: col(2), dn: col(3), accent: col(4), warn: col(5),
      card: card.backgroundColor, line: card.borderTopColor, hover: getComputedStyle(k[7]).backgroundColor,
      dark: document.documentElement.classList.contains('dark'),
      venue: {
        binance: root.getPropertyValue('--cf-v-binance').trim(),
        coinbase: root.getPropertyValue('--cf-v-coinbase').trim(),
        okx: root.getPropertyValue('--cf-v-okx').trim()
      }
    };
  }
  function rgba(c, a) {
    var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c);
    if (m) return 'rgba(' + Math.round(m[1]) + ',' + Math.round(m[2]) + ',' + Math.round(m[3]) + ',' + a + ')';
    var h = /^#([0-9a-f]{6})$/i.exec(c);
    if (h) { var n = parseInt(h[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
    return c;
  }

  // ── numbers ───────────────────────────────────────────────────────────────
  function q(v) {                       // compact coin quantity: 12.3k, 123, 1.23, 0.012
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e5) return Math.round(v / 1e3) + 'k';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(3);
    return a > 0 ? v.toFixed(4) : '0';
  }
  function sq(v) { return (v > 0 ? '+' : v < 0 ? '-' : '') + q(Math.abs(v)); }
  function px(p, nd) {
    return p.toLocaleString('en-US', { minimumFractionDigits: nd, maximumFractionDigits: nd });
  }
  function usd(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + Math.round(v);
  }
  function dec(p) { return p >= 1000 ? 0 : p >= 1 ? 2 : p >= 0.01 ? 4 : 6; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ── canvas plumbing ───────────────────────────────────────────────────────
  function fit(canvas, w, h) {
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }
  function txt(ctx, s, x, y, o) {
    o = o || {};
    ctx.font = (o.bold ? '700 ' : '') + (o.size || 10) + 'px ' + (o.sans ? SANS : MONO);
    ctx.fillStyle = o.color;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'middle';
    ctx.fillText(s, x, y);
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function tag(ctx, s, x, y, bg, fg, align) {   // small filled price tag
    ctx.font = '700 10px ' + MONO;
    var w = ctx.measureText(s).width + 10;
    var x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    rrect(ctx, x0, y - 9, w, 18, 4);
    ctx.fillStyle = bg;
    ctx.fill();
    txt(ctx, s, x0 + w / 2, y, { color: fg, bold: true, align: 'center' });
  }
  function view(host, fn) {
    var v = { host: host, draw: fn, w: -1 };
    views.push(v);
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (host.clientWidth !== v.w) run(v);
      }).observe(host);
    }
    run(v);
    return v;
  }
  function run(v) {
    v.w = v.host.clientWidth;
    if (v.w > 0) v.draw(palette(), v.w);
  }
  function redrawAll() { views.forEach(run); themeHooks.forEach(function (f) { f(); }); }
  var themeHooks = [];
  new MutationObserver(redrawAll).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawAll);

  function pointer(canvas, fn, leave) {       // mouse and touch -> CSS px inside the canvas
    function at(e) {
      var t = e.touches ? e.touches[0] : e, r = canvas.getBoundingClientRect();
      fn(t.clientX - r.left, t.clientY - r.top);
    }
    canvas.addEventListener('mousemove', at);
    canvas.addEventListener('click', at);
    canvas.addEventListener('touchstart', at, { passive: true });
    canvas.addEventListener('mouseleave', leave);
  }
  function readout(host) { return host.parentNode.querySelector('.cf-readout'); }
  function say(el, html) { if (el) el.innerHTML = html; }
  function dot(c) { return '<span style="color:' + c + '">&#9632;</span> '; }

  // ── 1. footprint ──────────────────────────────────────────────────────────
  CF.footprint = function (host, data) {
    var scroller = host.querySelector('.cf-fp-scroll');
    var cv = scroller.querySelector('canvas'), ax = host.querySelector('.cf-fp-axis');
    var out = readout(host);
    var bars = data.bars, step = data.step, nd = data.nd, n = bars.length;
    var G = null, hov = null, P = null;
    var dflt = 'Hover or tap a cell for its sell and buy volume. Columns scroll sideways; the price axis stays put.';

    function build(w) {
      // one price grid for every bar; merge neighbouring rows when the grid would be too tall
      var lo = Infinity, hi = -Infinity;
      bars.forEach(function (b) {
        lo = Math.min(lo, Math.floor(b.low / step), Math.round(b.rows[b.rows.length - 1].price / step));
        hi = Math.max(hi, Math.ceil(b.high / step), Math.round(b.rows[0].price / step));
      });
      var m = Math.max(1, Math.ceil((hi - lo + 1) / 44));
      var kmin = Math.round(lo / m), kmax = Math.round(hi / m), R = kmax - kmin + 1, tick = step * m;
      var maxAbs = 0, cells = bars.map(function (b) {
        var mp = {}, poc = null, best = -1;
        b.rows.forEach(function (r) {
          var k = Math.round(Math.round(r.price / step) / m), c = mp[k] || (mp[k] = { buy: 0, sell: 0 });
          c.buy += r.buy; c.sell += r.sell;
        });
        Object.keys(mp).forEach(function (k) {
          var c = mp[k]; c.d = c.buy - c.sell; c.t = c.buy + c.sell;
          maxAbs = Math.max(maxAbs, Math.abs(c.d));
          if (c.t > best) { best = c.t; poc = +k; }
        });
        return { m: mp, poc: poc };
      });
      var rowH = clamp(Math.round(540 / R), 14, 24), top = 10, bot = 58;
      var colW = clamp(Math.floor(w / n), 94, 150), W = Math.max(w, colW * n);
      return { m: m, kmin: kmin, kmax: kmax, R: R, tick: tick, maxAbs: maxAbs || 1, cells: cells,
               rowH: rowH, top: top, bot: bot, colW: colW, W: W, off: W - colW * n,
               H: top + R * rowH + bot };
    }
    function yOf(p) { return G.top + (G.kmax - p / G.tick) * G.rowH + G.rowH / 2; }

    function drawAll(pal, w) {
      P = pal;
      G = build(scroller.clientWidth || w);
      var ctx = fit(cv, G.W, G.H);
      var font = G.rowH < 16 ? 9 : 10;
      // faint row lines
      ctx.strokeStyle = rgba(P.line, 0.35); ctx.lineWidth = 1;
      for (var j = 0; j <= G.R; j++) {
        var yy = Math.round(G.top + j * G.rowH) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(G.W, yy); ctx.stroke();
      }
      bars.forEach(function (b, i) {
        var x0 = G.off + i * G.colW, c = G.cells[i], cx0 = x0 + 13, cw = G.colW - 16;
        // column rule
        ctx.strokeStyle = rgba(P.line, 0.8);
        ctx.beginPath(); ctx.moveTo(Math.round(x0) + 0.5, G.top - 6); ctx.lineTo(Math.round(x0) + 0.5, G.top + G.R * G.rowH + G.bot - 8); ctx.stroke();
        // cells
        for (var k = G.kmax; k >= G.kmin; k--) {
          var cell = c.m[k];
          if (!cell) continue;
          var y = G.top + (G.kmax - k) * G.rowH, a = 0.1 + 0.46 * Math.abs(cell.d) / G.maxAbs;
          var isH = hov && hov.i === i && hov.k === k;
          ctx.fillStyle = rgba(cell.d >= 0 ? P.up : P.dn, a.toFixed(3));
          ctx.fillRect(cx0, y + 1, cw, G.rowH - 1);
          var imb = cell.buy >= 3 * cell.sell ? 1 : (cell.sell >= 3 * cell.buy ? -1 : 0);
          if (imb) {                         // stacked-imbalance marker on the dominant side
            ctx.fillStyle = imb > 0 ? P.up : P.dn;
            ctx.fillRect(imb > 0 ? cx0 + cw - 2 : cx0, y + 1, 2, G.rowH - 1);
          }
          var mid = cx0 + cw / 2;
          txt(ctx, q(cell.sell), mid - 4, y + G.rowH / 2 + 0.5, { color: rgba(P.ink, imb < 0 ? 1 : 0.72), size: font, bold: imb < 0, align: 'right' });
          txt(ctx, 'x', mid, y + G.rowH / 2 + 0.5, { color: rgba(P.mute, 0.7), size: font - 1, align: 'center' });
          txt(ctx, q(cell.buy), mid + 4, y + G.rowH / 2 + 0.5, { color: rgba(P.ink, imb > 0 ? 1 : 0.72), size: font, bold: imb > 0, align: 'left' });
          if (k === c.poc) {                 // point of control
            ctx.strokeStyle = P.accent; ctx.lineWidth = 1.75;
            ctx.strokeRect(cx0 + 0.9, y + 1.9, cw - 1.8, G.rowH - 2.8);
            ctx.lineWidth = 1;
          }
          if (isH) { ctx.strokeStyle = P.ink; ctx.lineWidth = 1; ctx.strokeRect(cx0 + 0.5, y + 1.5, cw - 1, G.rowH - 2); }
        }
        // candle on the left edge
        var up = b.close >= b.open, cc = up ? P.up : P.dn, wx = x0 + 6.5;
        ctx.strokeStyle = cc; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(wx, yOf(b.high)); ctx.lineTo(wx, yOf(b.low)); ctx.stroke();
        var yo = yOf(b.open), yc = yOf(b.close);
        ctx.fillStyle = cc;
        ctx.fillRect(x0 + 3, Math.min(yo, yc), 7, Math.max(1.5, Math.abs(yo - yc)));
        // forming bar: dashed frame
        if (b.forming) {
          ctx.setLineDash([3, 3]); ctx.strokeStyle = rgba(P.accent, 0.8);
          ctx.strokeRect(x0 + 1.5, G.top - 5.5, G.colW - 3, G.R * G.rowH + 10);
          ctx.setLineDash([]);
        }
        // delta pill, then the time
        var yb = G.top + G.R * G.rowH + 17, dc = b.delta >= 0 ? P.up : P.dn, ds = sq(b.delta);
        ctx.font = '700 10.5px ' + MONO;
        var tw = ctx.measureText(ds).width + 12;
        rrect(ctx, x0 + G.colW / 2 - tw / 2 + 3, yb - 9, tw, 18, 9);
        ctx.fillStyle = rgba(dc, 0.16); ctx.fill();
        txt(ctx, ds, x0 + G.colW / 2 + 3, yb, { color: dc, bold: true, size: 10.5, align: 'center' });
        var hhmm = b.label.slice(-5), day = b.label.slice(0, 6);
        var newDay = i === 0 || day !== bars[i - 1].label.slice(0, 6);
        txt(ctx, hhmm + (b.forming ? ' ●' : ''), x0 + G.colW / 2 + 3, yb + 19, { color: b.forming ? P.accent : P.ink, size: 10, align: 'center', bold: b.forming });
        if (newDay) txt(ctx, day, x0 + G.colW / 2 + 3, yb + 31, { color: P.mute, size: 9, align: 'center' });
      });
      // pinned price axis
      cv.getContext('2d').font = '700 10px ' + MONO;
      var axW = Math.ceil(cv.getContext('2d').measureText(px(G.kmax * G.tick + G.tick, nd)).width) + 18;
      var actx = fit(ax, axW, G.H);
      actx.strokeStyle = rgba(P.line, 0.9); actx.beginPath(); actx.moveTo(0.5, 0); actx.lineTo(0.5, G.H); actx.stroke();
      var every = Math.max(1, Math.ceil(13 / G.rowH));
      for (var kk = G.kmax; kk >= G.kmin; kk--) {
        if ((G.kmax - kk) % every) continue;
        txt(actx, px(kk * G.tick, nd), 7, G.top + (G.kmax - kk) * G.rowH + G.rowH / 2, { color: P.mute, size: 10 });
      }
      var last = bars[n - 1];
      tag(actx, px(last.close, nd), 4, clamp(yOf(last.close), G.top, G.top + G.R * G.rowH), last.close >= last.open ? P.up : P.dn, '#fff');
    }
    var v = view(host, drawAll);
    function redraw() { drawAll(P, v.w); }
    pointer(cv, function (x, y) {
      if (!G) return;
      var i = Math.floor((x - G.off) / G.colW), k = G.kmax - Math.floor((y - G.top) / G.rowH);
      if (i < 0 || i >= n || k < G.kmin || k > G.kmax) return;
      var b = bars[i], cell = G.cells[i].m[k];
      hov = cell ? { i: i, k: k } : null;
      redraw();
      var head = '<b class="text-ink">' + b.label + ' UTC</b>' + (b.forming ? ' (forming)' : '') +
        ' &middot; O ' + px(b.open, nd) + ' H ' + px(b.high, nd) + ' L ' + px(b.low, nd) + ' C ' + px(b.close, nd) +
        ' &middot; delta <b style="color:' + (b.delta >= 0 ? P.up : P.dn) + '">' + sq(b.delta) + '</b>';
      say(out, cell ? head + '<br><span class="nums text-ink">' + px(k * G.tick, nd) + '</span> &middot; sell ' + q(cell.sell) +
        ' &middot; buy ' + q(cell.buy) + ' &middot; delta <b style="color:' + (cell.d >= 0 ? P.up : P.dn) + '">' + sq(cell.d) + '</b>' +
        (k === G.cells[i].poc ? ' &middot; <b style="color:' + P.accent + '">point of control</b>' : '') : head);
    }, function () { hov = null; if (P) redraw(); say(out, dflt); });
    say(out, dflt);
    scroller.scrollLeft = scroller.scrollWidth;      // newest bars first in view
  };

  // ── 2a. depth chart ───────────────────────────────────────────────────────
  CF.depth = function (host, bk) {
    var cv = host.querySelector('canvas'), out = readout(host), P = null, geo = null, hov = null;
    function stairs(bins, sign) {            // cumulative size, nearest bin first
      var c = 0;
      return bins.map(function (b) { c += b.size_total; return { near: sign < 0 ? b.hi : b.lo, far: sign < 0 ? b.lo : b.hi, c: c, b: b }; });
    }
    var bs = stairs(bk.bids, -1), as = stairs(bk.asks, 1);
    var xMin = Math.min.apply(null, bk.bids.map(function (b) { return b.lo; })), xMax = Math.max.apply(null, bk.asks.map(function (b) { return b.hi; }));
    var yMax = Math.max(bs[bs.length - 1].c, as[as.length - 1].c) * 1.08;
    function draw(pal, w) {
      P = pal;
      var ref = host.dataset.match && document.getElementById(host.dataset.match);
      var side = ref && Math.abs(ref.offsetTop - host.offsetTop) < 6 && +ref.dataset.h;
      var h = side || clamp(Math.round(w * 0.62), 260, 460);
      var ctx = fit(cv, w, h);
      var L = 8, Rr = 50, T = 14, B = 28, pw = w - L - Rr, ph = h - T - B;
      var X = function (p) { return L + (p - xMin) / (xMax - xMin) * pw; };
      var Y = function (c) { return T + ph - c / yMax * ph; };
      geo = { L: L, pw: pw, T: T, ph: ph, X: X, Y: Y };
      // grid + y labels (right)
      ctx.lineWidth = 1;
      for (var g = 0; g <= 4; g++) {
        var c = yMax * g / 4, y = Math.round(Y(c)) + 0.5;
        ctx.strokeStyle = rgba(P.line, g ? 0.5 : 0.9);
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
        txt(ctx, q(c), w - Rr + 7, y, { color: P.mute, size: 10 });
      }
      // x labels
      var xs = w < 460 ? [xMin, bk.mid, xMax] : [xMin, (xMin + bk.mid) / 2, bk.mid, (bk.mid + xMax) / 2, xMax];
      xs.forEach(function (p, i) {
        txt(ctx, px(p, bk.nd), clamp(X(p), L + 26, L + pw - 26), h - B + 14, { color: i === xs.indexOf(bk.mid) ? P.ink : P.mute, size: 10, align: 'center' });
      });
      function area(list, color, edge) {
        var path = new Path2D(), prev = 0;
        path.moveTo(X(bk.mid), Y(0));
        list.forEach(function (s) {
          path.lineTo(X(s.near), Y(prev)); path.lineTo(X(s.near), Y(s.c)); path.lineTo(X(s.far), Y(s.c)); prev = s.c;
        });
        path.lineTo(X(edge), Y(prev));
        var line = new Path2D(path);
        path.lineTo(X(edge), Y(0)); path.closePath();
        var gr = ctx.createLinearGradient(0, T, 0, T + ph);
        gr.addColorStop(0, rgba(color, 0.42)); gr.addColorStop(1, rgba(color, 0.05));
        ctx.fillStyle = gr; ctx.fill(path);
        ctx.strokeStyle = color; ctx.lineWidth = 1.75; ctx.lineJoin = 'round'; ctx.stroke(line);
      }
      area(bs, P.up, xMin);
      area(as, P.dn, xMax);
      // mid
      ctx.setLineDash([4, 4]); ctx.strokeStyle = P.mute; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(X(bk.mid)) + 0.5, T); ctx.lineTo(Math.round(X(bk.mid)) + 0.5, T + ph); ctx.stroke();
      ctx.setLineDash([]);
      tag(ctx, 'Mid ' + px(bk.mid, bk.nd), clamp(X(bk.mid), L + 56, L + pw - 56), T + 2, P.accent, '#fff', 'center');
      // end labels
      // in the empty V above the two curves, either side of the mid tag
      txt(ctx, 'Bids ' + q(bs[bs.length - 1].c), X(bk.mid) - 8, T + 30, { color: P.up, bold: true, size: 11, sans: true, align: 'right' });
      txt(ctx, 'Asks ' + q(as[as.length - 1].c), X(bk.mid) + 8, T + 30, { color: P.dn, bold: true, size: 11, sans: true });
      if (hov) {
        ctx.strokeStyle = P.ink; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(Math.round(hov.x) + 0.5, T); ctx.lineTo(Math.round(hov.x) + 0.5, T + ph); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = hov.color; ctx.beginPath(); ctx.arc(hov.x, Y(hov.c), 4, 0, 6.2832); ctx.fill();
      }
    }
    var v = view(host, draw);
    pointer(cv, function (x) {
      if (!geo) return;
      var p = xMin + (x - geo.L) / geo.pw * (xMax - xMin);
      if (p < xMin || p > xMax) return;
      var isBid = p <= bk.mid, list = isBid ? bs : as, c = 0, cum = 0;
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (isBid ? p <= s.near : p >= s.near) cum = s.c;
      }
      c = cum;
      hov = { x: geo.X(p), c: c, color: isBid ? P.up : P.dn };
      run(v);
      var tot = (isBid ? bs : as)[(isBid ? bs : as).length - 1].c;
      say(out, dot(hov.color) + '<span class="nums text-ink">' + px(p, bk.nd) + '</span> &middot; ' + (isBid ? 'bids' : 'asks') +
        ' resting from mid to here: <b class="text-ink nums">' + q(c) + ' ' + (host.dataset.sym || '') + '</b> (' + Math.round(c / tot * 100) + '% of that side)');
    }, function () { hov = null; if (P) run(v); say(out, dflt()); });
    function dflt() { return 'Hover or tap the chart: cumulative size resting between mid and that price.'; }
    say(out, dflt());
  };

  // ── 2b. liquidity ladder (DOM style, stacked by venue) ────────────────────
  CF.ladder = function (host, bk) {
    var cv = host.querySelector('canvas'), out = readout(host), P = null, hov = -1;
    var rows = bk.asks.slice().reverse().map(function (b) { return { b: b, ask: true }; })
      .concat([{ mid: true }])
      .concat(bk.bids.map(function (b) { return { b: b, ask: false }; }));
    var RH = 12, MID = 24, H = 8 + (rows.length - 1) * RH + MID + 8;
    host.dataset.h = H;
    var order = bk.venues;
    var big = bk.asks.concat(bk.bids).map(function (b) { return b.size_total; }).sort(function (a, b) { return b - a; });
    var wall = big[Math.min(4, big.length - 1)];            // the 5 biggest resting sizes get a label
    var ys = [];
    function draw(pal, w) {
      P = pal;
      var ctx = fit(cv, w, H);
      var PW = 66, x0 = PW + 6, areaW = Math.max(40, w - x0 - 50), y = 8;
      ys = [];
      rows.forEach(function (r, i) {
        var h = r.mid ? MID : RH;
        ys.push([y, y + h]);
        if (r.mid) {
          ctx.fillStyle = rgba(P.accent, 0.13); ctx.fillRect(0, y, w, h);
          ctx.fillStyle = P.accent; ctx.fillRect(0, y, w, 1); ctx.fillRect(0, y + h - 1, w, 1);
          txt(ctx, px(bk.mid, bk.nd), 6, y + h / 2, { color: P.accent, bold: true, size: 11 });
          txt(ctx, 'mid · spread ' + bk.spread_pct.toFixed(3) + '%', x0, y + h / 2, { color: P.ink, size: 10.5, sans: true });
        } else {
          var col = r.ask ? P.dn : P.up, b = r.b;
          if (i === hov) { ctx.fillStyle = rgba(P.ink, 0.1); ctx.fillRect(0, y, w, h); }
          else { ctx.fillStyle = rgba(col, 0.05); ctx.fillRect(0, y, w, h); }
          ctx.fillStyle = col; ctx.fillRect(0, y, 2, h);
          txt(ctx, px(b.price, bk.nd), PW, y + h / 2 + 0.5, { color: col, size: 10, align: 'right' });
          var bw = b.size_total / bk.max_size * areaW, xx = x0;
          order.forEach(function (vn) {
            var sw = b.by_venue[vn] / bk.max_size * areaW;
            if (sw <= 0) return;
            ctx.fillStyle = P.venue[vn]; ctx.fillRect(xx, y + 1.5, Math.max(sw, 0.8), h - 3); xx += sw;
          });
          if (b.size_total >= wall) txt(ctx, q(b.size_total), x0 + bw + 5, y + h / 2 + 0.5, { color: P.ink, bold: true, size: 10 });
        }
        y += h;
      });
    }
    var v = view(host, draw);
    var dflt = 'Hover or tap a row: size resting in that price band, by venue.';
    pointer(cv, function (x, yy) {
      var i = ys.findIndex(function (s) { return yy >= s[0] && yy < s[1]; });
      if (i < 0 || rows[i].mid) return;
      hov = i; run(v);
      var b = rows[i].b, ds = order.map(function (vn) {
        return dot(P.venue[vn]) + (NAMES[vn] || vn) + ' ' + q(b.by_venue[vn]);
      }).join(' &nbsp; ');
      say(out, '<span class="nums text-ink">' + px(b.lo, bk.nd) + ' to ' + px(b.hi, bk.nd) + '</span> &middot; ' + (rows[i].ask ? 'asks' : 'bids') +
        ' <b class="text-ink nums">' + q(b.size_total) + ' ' + (host.dataset.sym || '') + '</b><br>' + ds);
    }, function () { hov = -1; if (P) run(v); say(out, dflt); });
    say(out, dflt);
  };

  // ── Lightweight Charts helpers ────────────────────────────────────────────
  function lwcReady(cb) {
    var tries = 0;
    (function tick() {
      if (window.LightweightCharts) return cb(window.LightweightCharts);
      if (tries++ < 100) return setTimeout(tick, 80);
      cb(null);
    })();
  }
  function onceVisible(el, fn) {
    if (!window.IntersectionObserver) return fn();
    var io = new IntersectionObserver(function (e) { if (e[0].isIntersecting) { io.disconnect(); fn(); } }, { rootMargin: '300px' });
    io.observe(el);
  }
  function chartBase(P) {
    // one recipe for every chart (pi-chart.js): transparent surface, one horizontal hairline, the house mono
    return PI_CHART.opts({
      autoSize: true,
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 2 },
      localization: { locale: 'en-US' },
      // a finger dragging vertically scrolls the page; the wheel scrolls the page too
      handleScroll: { vertTouchDrag: false, mouseWheel: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true }
    });
  }
  function themeOpts(P) {
    return PI_CHART.opts();
  }

  // ── 3. estimated liquidation heatmap ──────────────────────────────────────
  CF.liq = function (host, d) {
    var main = host.querySelector('.cf-liq-main'), heat = main.querySelector('.cf-liq-heat'),
        chartEl = main.querySelector('.cf-liq-chart'), hist = host.querySelector('.cf-liq-hist'),
        out = readout(host.parentNode), P = null;
    var bins = d.bins, maxUsd = d.max_usd, mark = d.mark, SPAN = 0.1;   // the chart reaches 10% either side of mark
    var chart = null, series = null, sig = '', alive = false;
    var dflt = 'Move over the chart: the band under the pointer and its estimated size.';
    var HW = function () { return host.clientWidth < 520 ? 66 : 112; };

    function geo() {
      if (!chart) return null;
      var ph = Math.max(0, main.clientHeight - chart.timeScale().height()),
          pw = Math.max(0, chart.timeScale().width());
      return { pw: pw, ph: ph };
    }
    function band(b) {
      var y1 = series.priceToCoordinate(b.hi), y2 = series.priceToCoordinate(b.lo);
      return (y1 === null || y2 === null) ? null : [y1, y2];
    }
    function paint() {
      if (!P) return;
      var w = main.clientWidth, h = main.clientHeight, g = geo(), hw = HW();
      var hc = fit(heat, w, h), xc = fit(hist, hw, h);
      if (!g || !g.pw) return;
      // the heat: one horizontal band per bin across the pane, opacity by estimated size
      hc.save(); hc.beginPath(); hc.rect(0, 0, g.pw, g.ph); hc.clip();
      bins.forEach(function (b) {
        var yy = band(b); if (!yy) return;
        var yt = Math.min(yy[0], yy[1]), hh = Math.max(1.5, Math.abs(yy[1] - yy[0]) - 0.6);
        if (yt + hh < 0 || yt > g.ph) return;
        var col = b.side === 'long' ? P.dn : P.up, a = Math.max(0.05, 0.62 * b.usd / maxUsd);
        var gr = hc.createLinearGradient(0, 0, g.pw, 0);
        gr.addColorStop(0, rgba(col, (a * 0.45).toFixed(3))); gr.addColorStop(1, rgba(col, a.toFixed(3)));
        hc.fillStyle = gr; hc.fillRect(0, yt + 0.3, g.pw, hh);
      });
      hc.restore();
      // the side histogram, aligned to the same price scale
      xc.save(); xc.beginPath(); xc.rect(0, 0, hw, g.ph); xc.clip();
      xc.strokeStyle = rgba(P.line, 0.9); xc.beginPath(); xc.moveTo(0.5, 0); xc.lineTo(0.5, g.ph); xc.stroke();
      var barMax = hw - 40, labelled = bins.slice().sort(function (a, b) { return b.usd - a.usd; }).slice(0, 3);
      bins.forEach(function (b) {
        var yy = band(b); if (!yy) return;
        var yt = Math.min(yy[0], yy[1]), hh = Math.max(1.5, Math.abs(yy[1] - yy[0]) - 1.2);
        if (yt + hh < 0 || yt > g.ph) return;
        var col = b.side === 'long' ? P.dn : P.up, bw = Math.max(1.5, b.usd / maxUsd * barMax);
        xc.fillStyle = rgba(col, 0.88); xc.fillRect(3, yt + 0.6, bw, hh);
        if (labelled.indexOf(b) >= 0) txt(xc, usd(b.usd), 3 + bw + 4, yt + hh / 2 + 0.6, { color: P.ink, size: 10, bold: true });
      });
      var ym = series.priceToCoordinate(mark);
      if (ym !== null) { xc.setLineDash([3, 3]); xc.strokeStyle = P.accent; xc.beginPath(); xc.moveTo(0, ym + 0.5); xc.lineTo(hw, ym + 0.5); xc.stroke(); xc.setLineDash([]); }
      xc.restore();
      txt(xc, 'est. size', 6, g.ph + 12, { color: P.mute, size: 9, sans: true });
      txt(xc, 'per band', 6, g.ph + 24, { color: P.mute, size: 9, sans: true });
    }
    function signature() {
      if (!chart) return '';
      var g = geo();
      return [series.priceToCoordinate(mark * 0.9), series.priceToCoordinate(mark * 1.1), g.pw, g.ph, main.clientWidth, main.clientHeight, HW()].join('|');
    }
    function frame() {                      // the price scale has no change event: compare two reference prices per frame
      if (!alive) return;
      if (!document.hidden) { var s = signature(); if (s !== sig) { sig = s; paint(); } }
      requestAnimationFrame(frame);
    }
    view(main, function (pal) { P = pal; if (chart) { chart.applyOptions(themeOpts(P)); series.applyOptions(seriesColors(P)); sig = ''; paint(); } });
    function seriesColors(p) {
      return { upColor: p.up, downColor: p.dn, borderUpColor: p.up, borderDownColor: p.dn, wickUpColor: p.up, wickDownColor: p.dn };
    }
    onceVisible(host, function () {
      lwcReady(function (LW) {
        if (!LW) { chartEl.innerHTML = '<div class="text-ink-mute" style="padding:2.5rem 1rem;text-align:center;font-size:13px">Chart could not load.</div>'; return; }
        P = palette();
        var o = chartBase(P);
        o.rightPriceScale.scaleMargins = { top: 0.03, bottom: 0.03 };
        o.timeScale.fixLeftEdge = true;
        chart = LW.createChart(chartEl, o);
        var nd = d.nd;
        series = chart.addSeries(LW.CandlestickSeries, Object.assign(seriesColors(P), {
          priceLineVisible: false, lastValueVisible: true,
          priceFormat: { type: 'price', precision: nd, minMove: Math.pow(10, -nd) },
          autoscaleInfoProvider: function (orig) {   // room for the nearest bands around the candles
            var r = orig(); if (!r) return r;
            return { priceRange: { minValue: Math.min(r.priceRange.minValue, mark * (1 - SPAN)), maxValue: Math.max(r.priceRange.maxValue, mark * (1 + SPAN)) }, margins: r.margins };
          }
        }));
        series.setData(d.candles.map(function (c) { return { time: Math.floor(c.t / 1000), open: c.o, high: c.h, low: c.l, close: c.c }; }));
        series.createPriceLine({ price: mark, color: P.accent, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Mark' });
        chart.timeScale().fitContent();
        chart.timeScale().subscribeVisibleLogicalRangeChange(function () { sig = ''; });
        chart.subscribeCrosshairMove(function (p) {
          if (!p.point) { say(out, dflt); return; }
          var price = series.coordinateToPrice(p.point.y);
          var b = price === null ? null : bins.filter(function (x) { return price >= x.lo && price < x.hi; })[0];
          say(out, '<span class="nums text-ink">$' + px(price, nd) + '</span> &middot; ' + (b ?
            'band $' + px(b.lo, nd) + ' to $' + px(b.hi, nd) + ': <b class="nums" style="color:' + (b.side === 'long' ? P.dn : P.up) + '">~' + usd(b.usd) +
            ' estimated</b> ' + (b.side === 'long' ? 'of longs liquidated if price falls here' : 'of shorts liquidated if price rises here') :
            'no estimated liquidations in this band'));
        });
        themeHooks.push(function () { P = palette(); chart.applyOptions(themeOpts(P)); series.applyOptions(seriesColors(P)); sig = ''; });
        if (window.ResizeObserver) new ResizeObserver(function () { sig = ''; }).observe(main);
        alive = true; requestAnimationFrame(frame);
      });
    });
    say(out, dflt);
  };

  // ── 4. kimchi premium, 30 days ────────────────────────────────────────────
  CF.kimchi = function (host, d) {
    var chartEl = host, pts = d.points, out = readout(host.parentNode);
    var dflt = 'Move over the chart for each day.';
    onceVisible(host, function () {
      lwcReady(function (LW) {
        if (!LW) { chartEl.innerHTML = '<div class="text-ink-mute" style="padding:2.5rem 1rem;text-align:center;font-size:13px">Chart could not load.</div>'; return; }
        var P = palette(), opts = chartBase(P);
        opts.timeScale.timeVisible = false;
        opts.handleScroll = false; opts.handleScale = false;
        var chart = LW.createChart(chartEl, opts);
        function sOpts(p) {
          return { topLineColor: p.up, topFillColor1: rgba(p.up, 0.38), topFillColor2: rgba(p.up, 0.04),
                   bottomLineColor: p.dn, bottomFillColor1: rgba(p.dn, 0.04), bottomFillColor2: rgba(p.dn, 0.38) };
        }
        var s = chart.addSeries(LW.BaselineSeries, Object.assign(sOpts(P), {
          baseValue: { type: 'price', price: 0 }, lineWidth: 2, priceLineVisible: false,
          priceFormat: { type: 'custom', formatter: function (v) { return (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }, minMove: 0.01 }
        }));
        s.setData(pts.map(function (p) { return { time: p.date, value: p.premium_pct }; }));
        var zero = s.createPriceLine({ price: 0, color: P.mute, lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        var avg = s.createPriceLine({ price: d.avg, color: P.accent, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '30d avg' });
        chart.timeScale().fitContent();
        var byDate = {}; pts.forEach(function (p) { byDate[p.date] = p; });
        chart.subscribeCrosshairMove(function (p) {
          var r = p.time && byDate[p.time];
          if (!r) { say(out, dflt); return; }
          var c = r.premium_pct >= 0 ? P.up : P.dn;
          say(out, '<span class="nums text-ink">' + r.date + '</span> &middot; <b class="nums" style="color:' + c + '">' + (r.premium_pct > 0 ? '+' : '') + r.premium_pct.toFixed(2) + '%</b>' +
            ' &middot; Upbit KRW ' + px(r.upbit_krw, 0) + ' &middot; Binance $' + px(r.binance_usd, 0) + ' &middot; USD/KRW ' + px(r.usdkrw, 2));
        });
        themeHooks.push(function () { P = palette(); chart.applyOptions(themeOpts(P)); s.applyOptions(sOpts(P)); zero.applyOptions({ color: P.mute }); avg.applyOptions({ color: P.accent }); });
      });
    });
    say(out, dflt);
  };
})();
