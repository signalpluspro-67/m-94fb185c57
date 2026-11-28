// chart-raindrop.js
// "Raindrop" chart type for the pi-companion chart page (dark flag f5104_ajouter_graphique_raindrop_menu_style).
// Each session is drawn as a drop: a shape that is widest at the price where most of the volume
// traded and tapers to a point at the high and the low. Daily bars hold no volume-by-price, so the
// session volume is spread over the high-low range as a bell centred on the typical price, nudged
// toward the close. The width of the drop follows the session volume, like the volume candles.
//
// Written in plain ES5 to match the host chart page. chart-pro.js reads window.__cpRaindrop.

(function () {
  'use strict';

  // Share of the widest point at each of n levels from the low (index 0) to the high (n - 1).
  function profile(d, n) {
    var hi = d.high, lo = d.low, out = [], i;
    if (!(hi > lo) || n < 2) { for (i = 0; i < n; i++) out.push(1); return out; }
    var mid = (d.high + d.low + d.close * 2) / 4, sd = (hi - lo) / 4;
    for (i = 0; i < n; i++) {
      var p = lo + (hi - lo) * i / (n - 1);
      out.push(Math.exp(-0.5 * Math.pow((p - mid) / sd, 2)));
    }
    return out;
  }

  // Half width in pixels of the widest point, from the session volume against the biggest in view.
  function widthFor(vol, max, slot) {
    var r = (vol == null || !(max > 0)) ? 0.5 : Math.sqrt(Math.max(0, vol) / max);
    return Math.max(1, slot * (0.3 + 0.7 * r));
  }

  function view(up, down) {
    var state = null, LEVELS = 16;
    var renderer = {
      draw: function (target, priceConverter) {
        target.useBitmapCoordinateSpace(function (scope) {
          if (!state || !state.visibleRange) return;
          var ctx = scope.context, hr = scope.horizontalPixelRatio, vr = scope.verticalPixelRatio;
          var bars = state.bars, from = state.visibleRange.from, to = state.visibleRange.to, mx = 0, i, k;
          for (i = from; i <= to; i++) { var v = bars[i].originalData.volume; if (v > mx) mx = v; }
          for (i = from; i <= to; i++) {
            var d = bars[i].originalData;
            if (d.close == null) continue;
            var yH = priceConverter(d.high), yL = priceConverter(d.low);
            if (yH == null || yL == null) continue;
            var x = bars[i].x * hr, half = widthFor(d.volume, mx, state.barSpacing) * hr / 2;
            var pr = profile(d, LEVELS);
            ctx.beginPath();
            for (k = 0; k < LEVELS; k++) {      // right edge, low to high
              ctx.lineTo(x + half * pr[k], (yL + (yH - yL) * k / (LEVELS - 1)) * vr);
            }
            for (k = LEVELS - 1; k >= 0; k--) { // left edge, back down
              ctx.lineTo(x - half * pr[k], (yL + (yH - yL) * k / (LEVELS - 1)) * vr);
            }
            ctx.closePath();
            ctx.fillStyle = d.close >= d.open ? up : down;
            ctx.globalAlpha = 0.78;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        });
      }
    };
    return {
      priceValueBuilder: function (d) { return [d.high, d.low, d.close]; },
      isWhitespace: function (d) { return d.close == null; },
      renderer: function () { return renderer; },
      update: function (data) { state = data; },
      defaultOptions: function () { return {}; }
    };
  }

  if (typeof window !== 'undefined') window.__cpRaindrop = view;
  if (typeof module !== 'undefined' && module.exports) module.exports = { profile: profile, widthFor: widthFor };
})();
