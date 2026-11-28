/* PI_CHART : un seul thème pour tous les graphiques de l'app (lightweight-charts v4 et v5,
   canvas et SVG maison). Aucune couleur en dur : tout vient des variables --pi-* posées sur
   <html> par pi-theme.css (clair sous :root, sombre sous html.dark). Les chiffres de repli ne
   servent que si la feuille n'est pas chargée.
   API :
     PI_CHART.theme()        -> {bg, card, text, mute, grid, border, accent, good, bad, warn, s2, s3, font, rgba(name,a)}
     PI_CHART.opts(extra)    -> options de graphique fusionnées (fond transparent, grille horizontale seule...)
     PI_CHART.candles()      -> options de série en bougies (good / bad)
     PI_CHART.volume(up)     -> couleur d'une barre de volume (good / bad à 0.40)
     PI_CHART.ma(n)          -> couleur d'une moyenne mobile (20 mute, 50 series_2, 200 series_3)
     PI_CHART.bench()        -> options de ligne benchmark (mute, tirets)
     PI_CHART.track(chart, fn) -> recolore le graphique quand le membre change de thème
     PI_CHART.bind(chart, series, fn) -> fn(theme) rend les options de la série, rappelée au changement de thème
     PI_CHART.create(el, extra, fn) -> createChart + opts + track
     PI_CHART.legend(el, items, o) -> légende HTML sous (ou au-dessus, o.where='before') du graphique posé dans el ;
                                      items = [{label, color, value}] : pastille de couleur ET libellé en texte,
                                      dernière valeur ; color = une couleur CSS telle que le graphique l'emploie
                                      (rgb(var(--pi-series-3))) ; o.fmt formate un nombre (2 décimales par défaut)
     PI_CHART.tip(chart, seriesList, o) -> date et valeur de chaque série sous le curseur (souris et toucher) ;
                                      seriesList = [série] ou [{series, label, color}] ; o.fmt (2 décimales par
                                      défaut), o.el (élément où écrire, créé dans le conteneur du graphique si absent) */
(function () {
  'use strict';
  var FALLBACK = {   // canaux r g b, thème clair, seulement si --pi-* manque
    bg: [249, 245, 238], card: [255, 255, 255], ink: [26, 26, 26], 'ink-mute': [85, 85, 85],
    border: [216, 207, 187], grid: [236, 230, 216], hover: [239, 231, 214], accent: [139, 92, 246], good: [42, 122, 42],
    bad: [179, 74, 31], warn: [183, 121, 31], 'series-2': [8, 145, 178], 'series-3': [212, 163, 115]
  };
  var NAMES = { bg: 'bg', card: 'card', text: 'ink', mute: 'ink-mute', grid: 'grid', border: 'border', hover: 'hover',
    accent: 'accent', good: 'good', bad: 'bad', warn: 'warn', s2: 'series-2', s3: 'series-3' };
  var FONT_FALLBACK = '"JetBrains Mono","SF Mono",ui-monospace,monospace';

  function chan(cs, key) {
    var raw = '';
    try { raw = cs.getPropertyValue('--pi-' + key).trim(); } catch (e) {}
    var p = raw.split(/[\s,\/]+/).map(Number);
    if (p.length >= 3 && p.slice(0, 3).every(function (n) { return isFinite(n); })) return p.slice(0, 3);
    return FALLBACK[key];
  }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  var cache = null, cacheDark = null;
  function theme() {
    var dk = document.documentElement.classList.contains('dark');
    if (cache && cacheDark === dk) return cache;   // lu une fois par thème : les graphiques appellent theme() souvent
    var cs = getComputedStyle(document.documentElement), ch = {}, t = {}, found = true;
    Object.keys(NAMES).forEach(function (k) {
      var c = chan(cs, NAMES[k]); if (c === FALLBACK[NAMES[k]]) found = false;
      ch[k] = c; t[k] = rgb(c);
    });
    var f = '';
    try { f = cs.getPropertyValue('--pi-font-mono').trim(); } catch (e) {}
    t.font = f || FONT_FALLBACK;
    t.rgba = function (name, a) { return rgba(ch[name] || ch.text, a); };
    if (found) { cache = t; cacheDark = dk; }   // pas de cache tant que pi-theme.css n'est pas là
    return t;
  }

  function isV5() {
    var L = window.LightweightCharts;
    return !!(L && (L.createSeriesMarkers || L.CandlestickSeries));
  }

  function merge(a, b) {   // fusion profonde ; les tableaux et les non-objets du second l'emportent
    if (!b) return a;
    Object.keys(b).forEach(function (k) {
      var v = b[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) merge(a[k], v);
      else a[k] = v;
    });
    return a;
  }

  // la part "couleur" des options : c'est elle qu'on rappelle quand le thème change
  function colorOpts() {
    var t = theme();
    var o = {
      layout: { background: { color: 'transparent' }, textColor: t.mute, fontFamily: t.font },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      rightPriceScale: { borderColor: t.border },
      leftPriceScale: { borderColor: t.border },
      timeScale: { borderColor: t.border },
      crosshair: {
        vertLine: { color: t.border, labelBackgroundColor: t.accent },
        horzLine: { color: t.border, labelBackgroundColor: t.accent }
      }
    };
    if (isV5()) o.layout.panes = { separatorColor: t.border, separatorHoverColor: t.rgba('accent', 0.25) };
    return o;
  }

  function opts(extra) {
    var o = colorOpts();
    o.layout.fontSize = 11;
    o.grid.vertLines.visible = false;
    o.grid.horzLines.visible = true;
    o.crosshair.vertLine.width = 1; o.crosshair.vertLine.style = 2;
    o.crosshair.horzLine.width = 1; o.crosshair.horzLine.style = 2;
    return merge(o, extra);
  }

  function candles() {
    var t = theme();
    return { upColor: t.good, downColor: t.bad, wickUpColor: t.good, wickDownColor: t.bad,
             borderUpColor: t.good, borderDownColor: t.bad, borderVisible: false };
  }
  function volume(up) { var t = theme(); return t.rgba(up ? 'good' : 'bad', 0.4); }
  function ma(n) { var t = theme(); n = +n || 20; return n <= 20 ? t.mute : (n <= 50 ? t.s2 : t.s3); }
  function bench() { var t = theme(); return { color: t.mute, lineStyle: 2, lineWidth: 1 }; }

  var tracked = [], observer = null, lastDark = null;
  function isDark() { return document.documentElement.classList.contains('dark'); }
  function repaint() {
    var t = theme(), co = colorOpts();
    tracked = tracked.filter(function (it) {
      try {
        it.chart.applyOptions(co);
        it.binds.forEach(function (b) { try { b.s.applyOptions(b.fn(t)); } catch (e) {} });
        if (it.fn) { try { it.fn(t); } catch (e) {} }
        return true;
      } catch (e) { return false; }   // graphique détruit : on le retire
    });
  }
  function find(chart) {
    for (var i = 0; i < tracked.length; i++) if (tracked[i].chart === chart) return tracked[i];
    return null;
  }
  // bind(chart, series, fn) : fn(theme) rend les options de la série ; rappelée au changement de thème
  function bind(chart, series, fn) {
    if (!chart || !series || !fn) return series;
    var it = find(chart) || (track(chart), find(chart));
    if (it) it.binds.push({ s: series, fn: fn });
    return series;
  }
  function track(chart, fn) {
    if (!chart) return chart;
    var ex = find(chart);
    if (ex) { if (fn) ex.fn = fn; return chart; }
    tracked.push({ chart: chart, fn: fn || null, binds: [] });
    if (!observer && typeof MutationObserver !== 'undefined') {
      lastDark = isDark();
      observer = new MutationObserver(function () {
        var d = isDark();
        if (d === lastDark) return;
        lastDark = d; repaint();
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
    return chart;
  }
  function create(el, extra, fn) {
    var L = window.LightweightCharts;
    var chart = L.createChart(el, opts(extra));
    return track(chart, fn);
  }

  function numFmt(o) {
    if (o && typeof o.fmt === 'function') return o.fmt;
    var d = (o && o.digits != null) ? o.digits : 2;
    return function (v) { return Number(v).toFixed(d); };
  }
  function span(cls, text, css) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    if (css) s.style.cssText = css;
    if (text != null) s.textContent = text;
    return s;
  }
  // pastille ronde : la couleur seule ne dit jamais quelle série c'est, le libellé suit toujours
  function dot(color) {
    var d = span('', null, 'display:inline-block;width:.6rem;height:.6rem;border-radius:9999px;flex:none;vertical-align:baseline');
    d.style.background = color;
    d.setAttribute('aria-hidden', 'true');
    return d;
  }
  function legend(el, items, o) {
    if (!el || !el.parentNode) return null;
    o = o || {};
    var fmt = numFmt(o), box = el.__piLegend;
    if (!box) {
      box = document.createElement('div');
      box.className = 'text-xs text-ink-mute';
      box.setAttribute('role', 'list');
      box.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:.25rem 1rem;margin-top:.25rem';
      el.parentNode.insertBefore(box, o.where === 'before' ? el : el.nextSibling);
      if (o.where === 'before') box.style.margin = '0 0 .25rem';
      el.__piLegend = box;
    }
    while (box.firstChild) box.removeChild(box.firstChild);
    (items || []).forEach(function (it) {
      var row = span('', null, 'display:inline-flex;align-items:center;gap:.375rem');
      row.setAttribute('role', 'listitem');
      row.appendChild(dot(it.color));
      row.appendChild(span('', it.label));
      if (it.value != null && it.value !== '') {
        row.appendChild(span('nums text-ink font-semibold', typeof it.value === 'number' ? fmt(it.value) : String(it.value)));
      }
      box.appendChild(row);
    });
    return box;
  }

  function dayOf(t, withTime) {   // temps de lightweight-charts : 'AAAA-MM-JJ', {year,month,day} ou secondes UTC
    if (t == null) return '';
    if (typeof t === 'string') return t;
    if (typeof t === 'object') {
      return t.year + '-' + ('0' + t.month).slice(-2) + '-' + ('0' + t.day).slice(-2);
    }
    var iso = new Date(t * 1000).toISOString();
    return withTime ? iso.slice(0, 10) + ' ' + iso.slice(11, 16) : iso.slice(0, 10);
  }
  function tip(chart, list, o) {
    if (!chart || typeof chart.subscribeCrosshairMove !== 'function') return null;
    o = o || {};
    var fmt = numFmt(o), box = o.el || null, own = false;
    var series = (list || []).map(function (it) { return it && it.series ? it : { series: it }; });
    if (!box) {
      var host = o.parent || (typeof chart.chartElement === 'function' ? chart.chartElement().parentNode : null);
      if (!host) return null;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      box = document.createElement('div');
      // même style que la ligne OHLC de la fiche (_chart_card.html) : coin haut gauche, mono, carte à 90 %
      box.style.cssText = 'position:absolute;left:8px;top:6px;z-index:5;pointer-events:none;display:none;' +
        'font-size:.7rem;line-height:1.6;font-family:var(--pi-font-mono);color:rgb(var(--pi-ink));' +
        'background:rgb(var(--pi-card) / .9);border-radius:6px;padding:3px 8px;max-width:calc(100% - 70px)';
      box.className = 'nums';
      host.appendChild(box);
      own = true;
    }
    function show(on) { if (own) box.style.display = on ? '' : 'none'; }
    function onMove(p) {
      if (!p || p.time == null || !p.seriesData) {
        while (box.firstChild) box.removeChild(box.firstChild);
        show(false);
        return;
      }
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(span('', dayOf(p.time, o.time), 'font-weight:700'));
      series.forEach(function (it) {
        var d = p.seriesData.get(it.series);
        var v = d ? (d.value != null ? d.value : d.close) : null;
        if (v == null) return;
        box.appendChild(document.createTextNode(' '));
        if (it.color) { box.appendChild(dot(it.color)); box.appendChild(document.createTextNode(' ')); }
        if (it.label) box.appendChild(span('', it.label + ' ', 'color:rgb(var(--pi-ink-mute))'));
        box.appendChild(span('', fmt(v)));
      });
      show(true);
    }
    chart.subscribeCrosshairMove(onMove);
    return { el: box, destroy: function () {
      try { chart.unsubscribeCrosshairMove(onMove); } catch (e) {}
      if (own && box.parentNode) box.parentNode.removeChild(box);
    } };
  }

  window.PI_CHART = { theme: theme, opts: opts, candles: candles, volume: volume, ma: ma, bench: bench,
                      track: track, bind: bind, create: create, isDark: isDark, isV5: isV5, repaint: repaint,
                      legend: legend, tip: tip };
})();
