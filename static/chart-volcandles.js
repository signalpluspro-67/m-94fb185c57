// chart-volcandles.js
// "Volume candles" chart type for the pi-companion chart page (dark flag vol_candles).
// Each candle is as wide as the session's volume is heavy, so a day of big volume stands
// out in the price itself, with no panel below. Lightweight Charts has no variable-width
// candle, so this is a custom series: it draws the wick and the body on its own.
//
// Width of a candle = bar slot * (0.25 + 0.75 * sqrt(volume / biggest volume in view)).
// The square root keeps one huge day from squeezing every other candle into a hairline.
// A bar with no volume (index, a rebuilt interval without volume) is drawn at the middle width.
//
// Written in plain ES5 to match the host chart page. chart-pro.js reads window.__cpVolCandles.

(function () {
  'use strict';

  function widthFor(vol, max, slot) {
    var r = (vol == null || !(max > 0)) ? 0.5 : Math.sqrt(Math.max(0, vol) / max);
    return Math.max(1, slot * (0.25 + 0.75 * r));
  }

  function view(up, down) {
    var state = null;
    var renderer = {
      draw: function (target, priceConverter) {
        target.useBitmapCoordinateSpace(function (scope) {
          if (!state || !state.visibleRange) return;
          var ctx = scope.context, hr = scope.horizontalPixelRatio, vr = scope.verticalPixelRatio;
          var bars = state.bars, from = state.visibleRange.from, to = state.visibleRange.to, mx = 0, i;
          for (i = from; i <= to; i++) { var v = bars[i].originalData.volume; if (v > mx) mx = v; }
          var wickW = Math.max(1, Math.round(hr));
          for (i = from; i <= to; i++) {
            var d = bars[i].originalData;
            if (d.close == null) continue;
            var col = d.close >= d.open ? up : down;
            var x = Math.round(bars[i].x * hr);
            var yH = priceConverter(d.high), yL = priceConverter(d.low);
            var yO = priceConverter(d.open), yC = priceConverter(d.close);
            if (yH == null || yL == null || yO == null || yC == null) continue;
            var w = Math.max(wickW, Math.round(widthFor(d.volume, mx, state.barSpacing) * hr));
            var top = Math.round(Math.min(yO, yC) * vr), h = Math.max(1, Math.round(Math.abs(yC - yO) * vr));
            ctx.fillStyle = col;
            ctx.fillRect(x - Math.floor(wickW / 2), Math.round(yH * vr), wickW, Math.max(1, Math.round((yL - yH) * vr)));
            ctx.fillRect(x - Math.floor(w / 2), top, w, h);
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

  if (typeof window !== 'undefined') window.__cpVolCandles = view;
  if (typeof module !== 'undefined' && module.exports) module.exports = { widthFor: widthFor };
})();
