/* Grey NBER recession bands behind a Lightweight Charts series (a series primitive, drawn under the lines).
   The page sets window.PI_RECESSIONS = [[start, end], ...] only while the recession_bands flag is lit.
   piRecessions(series, times): times = the sorted YYYY-MM-DD dates of the chart; a band snaps to the bars inside it. */
(function () {
  function snap(times, bands) {
    var out = [];
    bands.forEach(function (b) {
      var i0 = -1, i1 = -1;
      for (var i = 0; i < times.length; i++) { if (times[i] >= b[0] && times[i] <= b[1]) { if (i0 < 0) i0 = i; i1 = i; } }
      if (i0 >= 0) out.push([times[i0], times[i1]]);
    });
    return out;
  }
  function Bands(spans) { this.spans = spans; }
  Bands.prototype.attached = function (p) { this.chart = p.chart; };
  Bands.prototype.updateAllViews = function () {};
  Bands.prototype.paneViews = function () {
    var self = this;
    return [{
      zOrder: function () { return 'bottom'; },
      renderer: function () {
        return { draw: function (target) {
          target.useBitmapCoordinateSpace(function (s) {
            var ts = self.chart.timeScale();
            s.context.fillStyle = PI_CHART.theme().rgba('mute', 0.18);
            self.spans.forEach(function (sp) {
              var a = ts.timeToCoordinate(sp[0]), b = ts.timeToCoordinate(sp[1]);
              if (a == null || b == null) return;
              var x0 = Math.max(0, Math.round(a * s.horizontalPixelRatio)), x1 = Math.min(s.bitmapSize.width, Math.round(b * s.horizontalPixelRatio));
              if (x1 > x0) s.context.fillRect(x0, 0, Math.max(x1 - x0, 2), s.bitmapSize.height);
            });
          });
        } };
      }
    }];
  };
  window.piRecessions = function (series, times) {
    if (!window.PI_RECESSIONS || !series || !series.attachPrimitive || !times || !times.length || typeof times[0] !== 'string' || times[0].length !== 10) return;
    var spans = snap(times, window.PI_RECESSIONS);
    if (spans.length) series.attachPrimitive(new Bands(spans));
  };
})();
