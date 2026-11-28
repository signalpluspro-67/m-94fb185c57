/* PI_HEAT : jumeau JS de templates/_heat.html (même modes, mêmes paliers).
   « sens »   : bad à gauche, good à droite, centre transparent. Alpha 0.12 / 0.24 / 0.40 / 0.60.
   « niveau » : une seule teinte, le cyan series_2. Alpha 0.12 / 0.24 / 0.40 / 0.68.
              low = true : sous le premier seuil, contour cyan et chiffre en gras (rang, vol, RSI, put/call).
   Les couleurs sont lues dans les variables --pi-* : justes en clair et en sombre sans code de plus.
   Le chiffre reste en encre du thème et garde son signe + ou −.
   th : 4 seuils croissants, ou pour « sens » un nombre = valeur du dernier palier. */
(function () {
  'use strict';
  var SENS_A = [0.12, 0.24, 0.40, 0.60];
  var LEVEL_A = [0.12, 0.24, 0.40, 0.68];
  var LOW_MARK = 'box-shadow:inset 0 0 0 1px rgb(var(--pi-series-2) / 0.7);font-weight:700;';
  /* Cartes de marché (tuiles pleines, texte blanc) : jumeau de engine._tile_rgb. */
  var TILE = { center: [85, 85, 85], good: [42, 122, 42], bad: [179, 74, 31], steps: [0.5, 2.0] };

  function thresholds(th) {
    if (typeof th === 'number') return [th / 6, th / 3, th * 2 / 3, th];
    return th;
  }
  function tier(a, th) {
    var n = 0;
    for (var i = 0; i < th.length; i++) if (a > 0 && a >= th[i]) n = i + 1;
    return n;
  }
  function paint(kind, n, low) {
    var al = kind === 'series-2' ? LEVEL_A : SENS_A;
    return (n > 0 ? 'background:rgb(var(--pi-' + kind + ') / ' + al[n - 1] + ');' : (low ? LOW_MARK : '')) +
      'color:rgb(var(--pi-ink))';
  }
  /* mode « sens » : v signé. flip = le haut est mauvais. Rend le CSS d'une case. */
  function sens(v, th, flip) {
    if (v == null || isNaN(v)) return '';
    var x = flip ? -v : v;
    return paint(x >= 0 ? 'good' : 'bad', tier(Math.abs(x), thresholds(th)));
  }
  /* mode « niveau » : v positif, plus c'est haut plus c'est foncé. */
  function level(v, th, low) {
    if (v == null || isNaN(v)) return '';
    return paint('series-2', tier(v, thresholds(th)), low);
  }
  function fmt(x) { return String(+x.toFixed(2)); }
  function pastille(label, bg) {
    return '<span style="display:inline-flex;flex-direction:column;align-items:center;min-width:2.1rem">' +
      '<span style="display:block;width:100%;height:.7rem;border-radius:2px;border:1px solid rgb(var(--pi-border));' + bg + '"></span>' +
      '<span class="nums" style="font-size:10px;line-height:1.3;color:rgb(var(--pi-ink-mute));white-space:nowrap">' + label + '</span></span>';
  }
  /* Légende : rangée de pastilles avec les bornes. mode 'sens' ou 'niveau'. */
  function legend(mode, th, unit, flip, low) {
    var t = thresholds(th), u = unit || '', out = '', i;
    var wrap = '<div class="heat-legend" role="img" aria-label="Color scale" style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:2px;margin-top:.5rem">';
    if (mode === 'sens') {
      var lo = flip ? 'good' : 'bad', hi = flip ? 'bad' : 'good';
      for (i = 3; i >= 0; i--) out += pastille('−' + fmt(t[i]) + u, 'background:rgb(var(--pi-' + lo + ') / ' + SENS_A[i] + ')');
      out += pastille('0', '');
      for (i = 0; i < 4; i++) out += pastille('+' + fmt(t[i]) + u, 'background:rgb(var(--pi-' + hi + ') / ' + SENS_A[i] + ')');
    } else {
      out += pastille('&lt;' + fmt(t[0]) + u, low ? LOW_MARK : '');
      for (i = 0; i < 4; i++) out += pastille('≥' + fmt(t[i]) + u, 'background:rgb(var(--pi-series-2) / ' + LEVEL_A[i] + ')');
    }
    return wrap + out + '</div>';
  }
  /* Tuile pleine d'une carte de marché : move en %, cinq paliers, bouts exacts. */
  function tile(chg) {
    if (chg == null || isNaN(chg)) return 'rgb(' + TILE.center.join(',') + ')';
    var m = Math.min(3, Math.abs(chg));
    var k = m < TILE.steps[0] ? 0 : (m < TILE.steps[1] ? 0.5 : 1);
    var base = chg >= 0 ? TILE.good : TILE.bad;
    var c = [0, 1, 2].map(function (i) { return Math.round(TILE.center[i] + (base[i] - TILE.center[i]) * k); });
    return 'rgb(' + c.join(',') + ')';
  }
  window.PI_HEAT = { SENS_A: SENS_A, LEVEL_A: LEVEL_A, LOW_MARK: LOW_MARK, TILE: TILE, tier: tier, sens: sens, level: level, legend: legend, tile: tile };
})();
