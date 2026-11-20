// chart-ehlers.js
// Extra cycle-analysis studies for the pi-companion chart page, contributed by John Ehlers
// in his Stocks & Commodities magazine (TASC) column. Each study below names its source
// article so anyone can look the original math up later.
//
//   eh_reflex, eh_trendflex   Reflex: A New Zero-Lag Indicator, TASC February 2020
//   eh_rocketrsi              RocketRSI, A Solid Propellant For Your Momentum, TASC May 2018
//   eh_dsma                   Predictive And Successful Indicators (Deviation-Scaled Moving
//                             Average), TASC July 2018
//   eh_recmed                 Recursive Median Filter, TASC March 2018
//   eh_mad                    The Moving Average Difference Indicator, TASC October/November 2021
//   eh_dmh                    Using The Hann Window For Directional Movement, TASC December 2021
//   eh_ifish                  Using The Fisher Transform (inverse Fisher of RSI), TASC 2004,
//                             revisited TASC February 2022
//   eh_revema                 Reverse Engineering EMA, TASC September 2017
//   eh_decycler               Simple Decycler, TASC September 2015
//   eh_roof                   The Roofing Filter, TASC January 2014
//   eh_domcycle               Autocorrelation periodogram (dominant cycle), from the book
//                             Cycle Analytics For Traders, 2013
//   eh_mama                   MESA Adaptive Moving Averages, TASC September 2001
//
// Written in plain ES5 (var, function) to match the host chart page.

(function () {
  'use strict';

  // ── shared math helpers ──────────────────────────────────────────────────

  // Two-pole SuperSmoother: a gentle low-pass filter that follows price with very
  // little lag, described by Ehlers in most of the articles above.
  function superSmoother(arr, period) {
    var n = arr.length, out = new Array(n);
    var a1 = Math.exp(-1.414 * Math.PI / period);
    var b1 = 2 * a1 * Math.cos(1.414 * Math.PI / period);
    var c2 = b1, c3 = -a1 * a1, c1 = 1 - c2 - c3;
    for (var i = 0; i < n; i++) {
      if (arr[i] == null) { out[i] = null; continue; }
      if (i < 2 || arr[i - 1] == null || out[i - 1] == null || out[i - 2] == null) {
        out[i] = arr[i];
      } else {
        out[i] = c1 * (arr[i] + arr[i - 1]) / 2 + c2 * out[i - 1] + c3 * out[i - 2];
      }
    }
    return out;
  }

  // Two-pole roofing high-pass: strips out the slow drift, keeping only the faster wiggles.
  function highPass2(arr, period) {
    var n = arr.length, out = new Array(n);
    var angle = 0.707 * 2 * Math.PI / period;
    var cosA = Math.cos(angle); if (!cosA) cosA = 1e-10;
    var alpha1 = (cosA + Math.sin(angle) - 1) / cosA;
    var k1 = (1 - alpha1 / 2) * (1 - alpha1 / 2);
    var k2 = 2 * (1 - alpha1);
    var k3 = (1 - alpha1) * (1 - alpha1);
    for (var i = 0; i < n; i++) {
      if (arr[i] == null) { out[i] = null; continue; }
      if (i < 2 || arr[i - 1] == null || arr[i - 2] == null || out[i - 1] == null || out[i - 2] == null) {
        out[i] = 0;
      } else {
        out[i] = k1 * (arr[i] - 2 * arr[i - 1] + arr[i - 2]) + k2 * out[i - 1] - k3 * out[i - 2];
      }
    }
    return out;
  }

  // One-pole version of the same idea, used by the Simple Decycler below.
  function highPass1(arr, period) {
    var n = arr.length, out = new Array(n);
    var angle = 2 * Math.PI / period;
    var cosA = Math.cos(angle); if (!cosA) cosA = 1e-10;
    var alpha = (cosA + Math.sin(angle) - 1) / cosA;
    for (var i = 0; i < n; i++) {
      if (arr[i] == null) { out[i] = null; continue; }
      if (i < 1 || arr[i - 1] == null || out[i - 1] == null) {
        out[i] = 0;
      } else {
        out[i] = (1 - alpha / 2) * (arr[i] - arr[i - 1]) + (1 - alpha) * out[i - 1];
      }
    }
    return out;
  }

  // A plain exponential average driven directly by a smoothing amount rather than a length.
  function alphaEma(arr, alpha) {
    var n = arr.length, out = new Array(n), e = null;
    for (var i = 0; i < n; i++) {
      if (arr[i] == null) { out[i] = null; continue; }
      e = (e == null) ? arr[i] : alpha * arr[i] + (1 - alpha) * e;
      out[i] = e;
    }
    return out;
  }

  // A weighted average that leans on the newest bars more than the older ones.
  function simpleWMA(arr, p) {
    var n = arr.length, out = new Array(n);
    for (var i = 0; i < n; i++) {
      if (i < p - 1) { out[i] = null; continue; }
      var num = 0, den = 0, ok = true;
      for (var j = 0; j < p; j++) {
        var v = arr[i - j];
        if (v == null) { ok = false; break; }
        var w = p - j;
        num += w * v; den += w;
      }
      out[i] = ok ? num / den : null;
    }
    return out;
  }

  // Middle value of a small window of closes.
  function medianOf(vals) {
    var a = vals.slice().sort(function (x, y) { return x - y; });
    var n = a.length, mid = Math.floor(n / 2);
    return (n % 2) ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  // Classic Wilder RSI, used here as an input to the inverse Fisher transform.
  function wilderRSI(cl, p) {
    var n = cl.length, out = new Array(n);
    var ag = null, al = null, g = 0, l = 0;
    for (var i = 0; i < n; i++) {
      if (i === 0) { out[i] = null; continue; }
      var d = cl[i] - cl[i - 1];
      var up = d > 0 ? d : 0, dn = d < 0 ? -d : 0;
      if (i <= p) {
        g += up; l += dn;
        if (i === p) { ag = g / p; al = l / p; out[i] = 100 - 100 / (1 + (al ? ag / al : 99)); }
        else out[i] = null;
        continue;
      }
      ag = (ag * (p - 1) + up) / p;
      al = (al * (p - 1) + dn) / p;
      out[i] = 100 - 100 / (1 + (al ? ag / al : 99));
    }
    return out;
  }

  // Wilder's up-move and down-move per bar, the raw material behind +DI/-DI.
  function directionalMoves(c) {
    var n = c.length, plus = new Array(n), minus = new Array(n);
    for (var i = 0; i < n; i++) {
      if (i === 0) { plus[i] = 0; minus[i] = 0; continue; }
      var upMove = c[i].high - c[i - 1].high;
      var downMove = c[i - 1].low - c[i].low;
      plus[i] = (upMove > downMove && upMove > 0) ? upMove : 0;
      minus[i] = (downMove > upMove && downMove > 0) ? downMove : 0;
    }
    return { plus: plus, minus: minus };
  }

  // A weighted sum over the last p bars, the weights bell-shaped like a Hann window,
  // heaviest in the middle of the window and light at both ends.
  function hannSum(arr, i, p) {
    if (i - p + 1 < 0) return null;
    var num = 0, den = 0;
    for (var k = 1; k <= p; k++) {
      var w = 1 - Math.cos(2 * Math.PI * k / (p + 1));
      var idx = i - p + k;
      if (arr[idx] == null) return null;
      num += w * arr[idx];
      den += w;
    }
    return den > 0 ? num / den : 0;
  }

  // ── the studies ───────────────────────────────────────────────────────────

  window.__cpExtraStudies = {

    eh_reflex: function (H) {
      return {
        label: 'Reflex (Ehlers)',
        group: 'Ehlers cycles',
        pane: 1, height: 100,
        bands: [0],
        params: [{ k: 'p', label: 'Length', def: 20 }],
        about: 'It tracks how far the recent price path has bent away from a straight line, so a turn shows up early.',
        build: function (c, vol, g) {
          var cl = c.map(function (b) { return b.close; });
          var p = g.p, n = cl.length;
          var ss = superSmoother(cl, p);
          var out = new Array(n), ms = 0;
          for (var i = 0; i < n; i++) {
            var val = null;
            if (i >= p && ss[i] != null) {
              var ok = true;
              for (var k = 1; k <= p; k++) { if (ss[i - k] == null) { ok = false; break; } }
              if (ok) {
                var slope = (ss[i - p] - ss[i]) / p;
                var sum = 0;
                for (var k2 = 1; k2 <= p; k2++) sum += (ss[i] + k2 * slope - ss[i - k2]);
                sum = sum / p;
                ms = 0.04 * sum * sum + 0.96 * ms;
                val = ms > 0 ? sum / Math.sqrt(ms) : 0;
              }
            }
            out[i] = val;
          }
          return [{ data: H.line(c, out, 3), color: H.C.b, width: 1 }];
        }
      };
    },

    eh_trendflex: function (H) {
      return {
        label: 'Trendflex (Ehlers)',
        group: 'Ehlers cycles',
        pane: 1, height: 100,
        bands: [0],
        params: [{ k: 'p', label: 'Length', def: 20 }],
        about: 'It measures how far the recent smoothed price sits above or below its own average path, so a trend change shows up early.',
        build: function (c, vol, g) {
          var cl = c.map(function (b) { return b.close; });
          var p = g.p, n = cl.length;
          var ss = superSmoother(cl, p);
          var out = new Array(n), ms = 0;
          for (var i = 0; i < n; i++) {
            var val = null;
            if (i >= p && ss[i] != null) {
              var ok = true;
              for (var k = 1; k <= p; k++) { if (ss[i - k] == null) { ok = false; break; } }
              if (ok) {
                var sum = 0;
                for (var k2 = 1; k2 <= p; k2++) sum += (ss[i] - ss[i - k2]);
                sum = sum / p;
                ms = 0.04 * sum * sum + 0.96 * ms;
                val = ms > 0 ? sum / Math.sqrt(ms) : 0;
              }
            }
            out[i] = val;
          }
          return [{ data: H.line(c, out, 3), color: H.C.b, width: 1 }];
        }
      };
    },

    eh_rocketrsi: function (H) {
      return {
        label: 'RocketRSI (Ehlers)',
        group: 'Ehlers cycles',
        pane: 1, height: 100,
        bands: [-2, 2, 0],
        params: [{ k: 'p', label: 'RSI length', def: 10 }, { k: 'hp', label: 'High-pass length', def: 48 }],
        about: 'It is a faster, cleaner cousin of RSI that reaches overbought or oversold sooner and does not linger there as long.',
        build: function (c, vol, g) {
          var cl = c.map(function (b) { return b.close; });
          var p = g.p, n = cl.length;
          var hp = highPass2(cl, g.hp);
          var filt = superSmoother(hp, 10);
          var mom = new Array(n);
          for (var i = 0; i < n; i++) {
            var back = i - (p - 1);
            mom[i] = (filt[i] == null || back < 0 || filt[back] == null) ? null : filt[i] - filt[back];
          }
          var out = new Array(n);
          for (var i2 = 0; i2 < n; i2++) {
            if (i2 < p - 1) { out[i2] = null; continue; }
            var cu = 0, cd = 0, ok = true;
            for (var k = 0; k < p; k++) {
              var v = mom[i2 - k];
              if (v == null) { ok = false; break; }
              if (v > 0) cu += v; else cd += -v;
            }
            if (!ok) { out[i2] = null; continue; }
            var denom = cu + cd;
            var r = denom > 0 ? (cu - cd) / denom : 0;
            r = Math.max(-0.999, Math.min(0.999, r));
            out[i2] = 0.5 * Math.log((1 + r) / (1 - r));
          }
          return [{ data: H.line(c, out, 3), color: H.C.b, width: 1 }];
        }
      };
    },

    eh_dsma: function (H) {
      return {
        label: 'Deviation-Scaled Moving Average',
        group: 'Ehlers cycles',
        pane: 0,
        params: [{ k: 'p', label: 'Length', def: 40 }],
        about: 'It is a moving average that hugs the price closely when the market swings hard and flattens out when the market goes quiet.',
        build: function (c, vol, g) {
          var cl = c.map(function (b) { return b.close; });
          var p = g.p, n = cl.length;
          var zeros = new Array(n);
          for (var i = 0; i < n; i++) zeros[i] = (i >= 2) ? cl[i] - cl[i - 2] : null;
          var filt = superSmoother(zeros, p);
          var out = new Array(n), dsma = null;
          for (var i2 = 0; i2 < n; i2++) {
            if (filt[i2] == null || i2 < p - 1) { out[i2] = null; continue; }
            var sumsq = 0, cnt = 0, ok = true;
            for (var j = 0; j < p; j++) {
              var v = filt[i2 - j];
              if (v == null) { ok = false; break; }
              sumsq += v * v; cnt++;
            }
            if (!ok || cnt === 0) { out[i2] = null; continue; }
            var rms = Math.sqrt(sumsq / cnt);
            var scaled = rms > 0 ? filt[i2] / rms : 0;
            var alpha = Math.min(1, Math.abs(scaled) * 5 / p);
            dsma = (dsma == null) ? cl[i2] : alpha * cl[i2] + (1 - alpha) * dsma;
            out[i2] = dsma;
          }
          return [{ data: H.line(c, out), color: H.C.b, width: 2 }];
        }
      };
    },

    eh_recmed: function (H) {
      return {
        label: 'Recursive Median Filter',
        group: 'Ehlers cycles',
        pane: 0,
        params: [{ k: 'm', label: 'Median length', def: 5 }, { k: 'p', label: 'Smoothing length', def: 12 }],
        about: 'It follows the middle price of the last few bars instead of the average, so single wild bars cannot drag the line around.',
        build: function (c, vol, g) {
          var cl = c.map(function (b) { return b.close; });
          var m = g.m, p = g.p, n = cl.length;
          var med = new Array(n);
          for (var i = 0; i < n; i++) {
            med[i] = (i < m - 1) ? null : medianOf(cl.slice(i - m + 1, i + 1));
          }
          var angle = 2 * Math.PI / p;
          var cosA = Math.cos(angle); if (!cosA) cosA = 1e-10;
          var alpha = (cosA + Math.sin(angle) - 1) / cosA;
          var out = new Array(n), rm = null;
          for (var i2 = 0; i2 < n; i2++) {
            if (med[i2] == null) { out[i2] = null; continue; }
            rm = (rm == null) ? med[i2] : alpha * med[i2] + (1 - alpha) * rm;
            out[i2] = rm;
          }
          return [{ data: H.line(c, out), color: H.C.b, width: 2 }];
        }
      };
    },

    eh_mad: function (H) {
      return {
        label: 'Moving Average Difference',
        group: 'Ehlers cycles',
        pane: 1, height: 90,
        bands: [0],
        params: [{ k: 's', label: 'Short length', def: 8 }, { k: 'l', label: 'Long length', def: 23 }],
        about: 'It shows how far a short average of the price has drifted away from a longer average, measured in percent.',
        build: function (c, vol, g) {
          var cl = c.map(function (b) { return b.close; });
          var s2 = H.sma(cl, g.s), l2 = H.sma(cl, g.l);
          var out = [];
          for (var i = 0; i < cl.length; i++) {
            out.push((s2[i] == null || l2[i] == null || !l2[i]) ? null : 100 * (s2[i] - l2[i]) / l2[i]);
          }
          return [{ data: H.line(c, out, 2), color: H.C.b, width: 1 }];
        }
      };
    },

    eh_dmh: function (H) {
      return {
        label: 'DMH (Directional Movement, Hann window)',
        group: 'Ehlers cycles',
        pane: 1, height: 90,
        bands: [0],
        params: [{ k: 'p', label: 'Length', def: 14 }],
        about: 'It compares recent up days against recent down days, weighting the middle of the window more than the edges, to show who is in control.',
        build: function (c, vol, g) {
          var p = g.p, n = c.length;
          var dm = directionalMoves(c);
          var out = new Array(n);
          for (var i = 0; i < n; i++) {
            var ph = hannSum(dm.plus, i, p);
            var mh = hannSum(dm.minus, i, p);
            if (ph == null || mh == null) { out[i] = null; continue; }
            var denom = ph + mh;
            out[i] = denom > 0 ? (ph - mh) / denom : 0;
          }
          return [{ data: H.line(c, out, 3), color: H.C.b, width: 1 }];
        }
      };
    },

    eh_ifish: function (H) {
      return {
        label: 'Inverse Fisher RSI',
        group: 'Ehlers cycles',
        pane: 1, height: 90,
        bands: [-0.5, 0.5],
        params: [{ k: 'p', label: 'RSI length', def: 14 }],
        about: 'It squeezes RSI into a tighter range between minus one and one, so the reader sees a clean flip between the two extremes instead of a slow crawl.',
        build: function (c, vol, g) {
          var cl = c.map(function (b) { return b.close; });
          var p = g.p, n = cl.length;
          var rsi = wilderRSI(cl, p);
          var x = new Array(n);
          for (var i = 0; i < n; i++) x[i] = rsi[i] == null ? null : 0.1 * (rsi[i] - 50);
          var xs = simpleWMA(x, 9);
          var out = new Array(n);
          for (var i2 = 0; i2 < n; i2++) {
            if (xs[i2] == null) { out[i2] = null; continue; }
            var e2x = Math.exp(2 * xs[i2]);
            out[i2] = (e2x - 1) / (e2x + 1);
          }
          return [{ data: H.line(c, out, 3), color: H.C.b, width: 1 }];
        }
      };
    },

    eh_revema: function (H) {
      return {
        label: 'Reverse EMA (Ehlers)',
        group: 'Ehlers cycles',
        pane: 1, height: 90,
        bands: [0],
        params: [{ k: 'alpha', label: 'Smoothing', def: 0.1, step: 0.01 }],
        about: 'An average run through eight stages that cancel the lag, so the line turns with the price instead of after it.',
        build: function (c, vol, g) {
          var cl = c.map(function (b) { return b.close; });
          var aa = g.alpha, cc = 1 - aa, n = cl.length;
          var em = new Array(n), st = [], k, i;
          for (k = 0; k < 8; k++) st.push(new Array(n));
          var out = new Array(n), e = cl[0];
          for (i = 0; i < n; i++) {
            e = i === 0 ? cl[0] : aa * cl[i] + cc * e;
            em[i] = e;
            var prev = em, pw = cc;
            for (k = 0; k < 8; k++) {
              st[k][i] = i === 0 ? 0 : pw * prev[i] + prev[i - 1];
              prev = st[k]; pw = pw * pw;
            }
            out[i] = i < 40 ? null : (em[i] - aa * st[7][i]);
          }
          return [{ data: H.line(c, out, 3), color: H.C.b, width: 1 }];
        }
      };
    },
    eh_decycler: function (H) {
      return {
        label: 'Simple Decycler',
        group: 'Ehlers cycles',
        pane: 0,
        params: [{ k: 'p', label: 'Length', def: 125 }, { k: 'band', label: 'Band percent', def: 0.5, step: 0.1 }],
        about: 'It strips the short choppy wiggles out of the price and leaves the slow underlying path, with a thin comfort zone drawn around it.',
        build: function (c, vol, g) {
          var cl = c.map(function (b) { return b.close; });
          var hp = highPass1(cl, g.p);
          var n = cl.length;
          var mid = new Array(n), up = new Array(n), dn = new Array(n);
          for (var i = 0; i < n; i++) {
            if (hp[i] == null) { mid[i] = null; up[i] = null; dn[i] = null; continue; }
            var d = cl[i] - hp[i];
            mid[i] = d;
            up[i] = d * (1 + g.band / 100);
            dn[i] = d * (1 - g.band / 100);
          }
          return [
            { data: H.line(c, up), color: H.C.d, width: 1 },
            { data: H.line(c, mid), color: H.C.b, width: 2 },
            { data: H.line(c, dn), color: H.C.d, width: 1 }
          ];
        }
      };
    },

    eh_roof: function (H) {
      return {
        label: 'Roofing Filter',
        group: 'Ehlers cycles',
        pane: 1, height: 90,
        bands: [0],
        params: [{ k: 'hpP', label: 'High-pass length', def: 48 }, { k: 'lpP', label: 'Smoothing length', def: 10 }],
        about: 'It clears away both the slow drift and the tiny jitter in the price, leaving only the cycle-sized moves in between.',
        build: function (c, vol, g) {
          var cl = c.map(function (b) { return b.close; });
          var hp = highPass2(cl, g.hpP);
          var filt = superSmoother(hp, g.lpP);
          return [{ data: H.line(c, filt, 3), color: H.C.b, width: 1 }];
        }
      };
    },

    eh_domcycle: function (H) {
      return {
        label: 'Dominant Cycle (autocorrelation)',
        group: 'Ehlers cycles',
        pane: 1, height: 90,
        params: [],
        about: 'It estimates how many bars the market has recently been taking to complete one full swing up and back down.',
        build: function (c, vol, g) {
          var cl = c.map(function (b) { return b.close; });
          var n = cl.length;
          var hp = highPass2(cl, 48);
          var filt = superSmoother(hp, 10);
          var maxLag = 48, minPeriod = 10, maxPeriod = 48;
          var powerState = new Array(maxPeriod + 1);
          for (var pp = 0; pp <= maxPeriod; pp++) powerState[pp] = 0;
          var out = new Array(n);
          for (var i = 0; i < n; i++) {
            if (filt[i] == null || i < maxLag + maxLag) { out[i] = null; continue; }
            var corr = new Array(maxLag + 1);
            for (var lag = 1; lag <= maxLag; lag++) {
              var M = Math.max(lag, 3);
              if (i - lag - M + 1 < 0) { corr[lag] = 0; continue; }
              var sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, cntok = true;
              for (var j = 0; j < M; j++) {
                var x = filt[i - j], y = filt[i - lag - j];
                if (x == null || y == null) { cntok = false; break; }
                sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
              }
              if (!cntok) { corr[lag] = 0; continue; }
              var mx = sx / M, my = sy / M;
              var covxy = sxy / M - mx * my;
              var varx = sxx / M - mx * mx;
              var vary = syy / M - my * my;
              var denom = Math.sqrt(Math.max(0, varx * vary));
              corr[lag] = denom > 0 ? Math.max(-1, Math.min(1, covxy / denom)) : 0;
            }
            var maxPow = 0;
            for (var per = minPeriod; per <= maxPeriod; per++) {
              var cosPart = 0, sinPart = 0;
              for (var lag2 = 1; lag2 <= maxLag; lag2++) {
                var ang = 2 * Math.PI * lag2 / per;
                cosPart += corr[lag2] * Math.cos(ang);
                sinPart += corr[lag2] * Math.sin(ang);
              }
              var pw = cosPart * cosPart + sinPart * sinPart;
              powerState[per] = 0.2 * pw + 0.8 * powerState[per];
              if (powerState[per] > maxPow) maxPow = powerState[per];
            }
            if (maxPow <= 0) { out[i] = null; continue; }
            var numAvg = 0, denAvg = 0;
            for (var per2 = minPeriod; per2 <= maxPeriod; per2++) {
              if (powerState[per2] >= 0.5 * maxPow) {
                numAvg += per2 * powerState[per2];
                denAvg += powerState[per2];
              }
            }
            out[i] = denAvg > 0 ? numAvg / denAvg : null;
          }
          return [{ data: H.line(c, out, 1), color: H.C.b, width: 1 }];
        }
      };
    },

    eh_mama: function (H) {
      return {
        label: 'MAMA / FAMA (MESA Adaptive Moving Average)',
        group: 'Ehlers cycles',
        pane: 0,
        params: [{ k: 'fast', label: 'Fast limit', def: 0.5, step: 0.05 }, { k: 'slow', label: 'Slow limit', def: 0.05, step: 0.01 }],
        about: 'It is a moving average that speeds up when the market is trending hard and slows down when the market is going sideways.',
        build: function (c, vol, g) {
          var n = c.length;
          var price = new Array(n);
          for (var i = 0; i < n; i++) price[i] = (c[i].high + c[i].low) / 2;
          var smooth = new Array(n), det = new Array(n), q1 = new Array(n), i1 = new Array(n);
          var ji = new Array(n), jq = new Array(n), i2a = new Array(n), q2a = new Array(n);
          var re = new Array(n), im = new Array(n), period = new Array(n), phase = new Array(n);
          var mama = new Array(n), fama = new Array(n);
          var fast = g.fast, slow = g.slow;
          for (var k = 0; k < n; k++) {
            if (k < 6) {
              smooth[k] = price[k]; det[k] = 0; q1[k] = 0; i1[k] = 0; ji[k] = 0; jq[k] = 0;
              i2a[k] = 0; q2a[k] = 0; re[k] = 0; im[k] = 0; period[k] = 15; phase[k] = 0;
              mama[k] = price[k]; fama[k] = price[k];
              continue;
            }
            smooth[k] = (4 * price[k] + 3 * price[k - 1] + 2 * price[k - 2] + price[k - 3]) / 10;
            var pf = 0.075 * period[k - 1] + 0.54;
            det[k] = (0.0962 * smooth[k] + 0.5769 * smooth[k - 2] - 0.5769 * smooth[k - 4] - 0.0962 * smooth[k - 6]) * pf;
            q1[k] = (0.0962 * det[k] + 0.5769 * det[k - 2] - 0.5769 * det[k - 4] - 0.0962 * det[k - 6]) * pf;
            i1[k] = det[k - 3];
            ji[k] = (0.0962 * i1[k] + 0.5769 * i1[k - 2] - 0.5769 * i1[k - 4] - 0.0962 * i1[k - 6]) * pf;
            jq[k] = (0.0962 * q1[k] + 0.5769 * q1[k - 2] - 0.5769 * q1[k - 4] - 0.0962 * q1[k - 6]) * pf;
            var i2v = i1[k] - jq[k];
            var q2v = q1[k] + ji[k];
            i2a[k] = 0.2 * i2v + 0.8 * i2a[k - 1];
            q2a[k] = 0.2 * q2v + 0.8 * q2a[k - 1];
            var reV = i2a[k] * i2a[k - 1] + q2a[k] * q2a[k - 1];
            var imV = i2a[k] * q2a[k - 1] - q2a[k] * i2a[k - 1];
            re[k] = 0.2 * reV + 0.8 * re[k - 1];
            im[k] = 0.2 * imV + 0.8 * im[k - 1];
            var per = period[k - 1];
            if (im[k] !== 0 && re[k] !== 0) per = 2 * Math.PI / Math.atan(im[k] / re[k]);
            if (per > 1.5 * period[k - 1]) per = 1.5 * period[k - 1];
            if (per < 0.67 * period[k - 1]) per = 0.67 * period[k - 1];
            if (per < 6) per = 6;
            if (per > 50) per = 50;
            period[k] = 0.2 * per + 0.8 * period[k - 1];
            var ph = phase[k - 1];
            if (Math.abs(i1[k]) > 0.0000001) {
              ph = Math.atan(q1[k] / i1[k]) * 180 / Math.PI;
              if (i1[k] < 0) ph += 180;
            }
            phase[k] = ph;
            var deltaPhase = phase[k - 1] - phase[k];
            if (deltaPhase < 1) deltaPhase = 1;
            var alpha = fast / deltaPhase;
            if (alpha < slow) alpha = slow;
            if (alpha > fast) alpha = fast;
            mama[k] = alpha * price[k] + (1 - alpha) * mama[k - 1];
            fama[k] = 0.5 * alpha * mama[k] + (1 - 0.5 * alpha) * fama[k - 1];
          }
          var outMama = new Array(n), outFama = new Array(n);
          for (var m = 0; m < n; m++) {
            outMama[m] = (m < 6) ? null : mama[m];
            outFama[m] = (m < 6) ? null : fama[m];
          }
          return [
            { data: H.line(c, outMama), color: H.C.b, width: 2 },
            { data: H.line(c, outFama), color: H.C.dn, width: 1 }
          ];
        }
      };
    }

  };
})();
