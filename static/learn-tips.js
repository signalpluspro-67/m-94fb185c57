/* Hover definitions (flag learn_v2, 26/10): underline the first use of each glossary
   term inside <main>, show its definition on hover, focus or tap, with a link to the
   glossary entry and to the lesson that covers it. Data: /academy/glossary.json. */
(function(){
  var main = document.getElementById('main');
  if (!main || /^\/academy\/glossary/.test(location.pathname)) return;
  var SKIP = {A:1, INPUT:1, SELECT:1, TEXTAREA:1, CODE:1, PRE:1, SCRIPT:1, STYLE:1, SVG:1, LABEL:1, OPTION:1, SUMMARY:0};
  function esc(t){ return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  fetch('/academy/glossary.json', {credentials: 'same-origin'}).then(function(r){ return r.ok ? r.json() : null; })
  .then(function(d){
    if (!d || !d.terms || !d.terms.length) return;
    var byKey = {}, ci = [], cs = [];
    d.terms.forEach(function(t){ t.keys.forEach(function(k){
      var strict = t.cs || !/[a-z]/.test(k);   // acronyms and column names keep their case
      byKey[strict ? k : k.toLowerCase()] = t; (strict ? cs : ci).push(k);
    }); });
    function rx(list, flags){
      if (!list.length) return null;
      list.sort(function(a, b){ return b.length - a.length; });
      return new RegExp('(^|[^A-Za-z0-9])(' + list.map(esc).join('|') + ')(?![A-Za-z0-9])', 'g' + flags);
    }
    var reI = rx(ci, 'i'), reS = rx(cs, ''), used = {}, n = 0;
    function scan(root){
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode: function(node){
        if (!node.nodeValue || node.nodeValue.length < 3) return NodeFilter.FILTER_REJECT;
        for (var el = node.parentNode; el && el !== main.parentNode; el = el.parentNode){
          var nm = el.nodeName.toUpperCase();
          if (nm === 'A' && el.closest && el.closest('th')) continue;  // sortable column header
          if (SKIP[nm] || (el.hasAttribute && (el.hasAttribute('data-no-tip') || el.classList.contains('pi-tip'))))
            return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }});
      var nodes = [], node;
      while ((node = walker.nextNode()) && nodes.length < 6000) nodes.push(node);
      nodes.forEach(function(tn){
        if (n >= 60) return;
        var text = tn.nodeValue, best = null;
        [reI, reS].forEach(function(re){
          if (!re) return;
          re.lastIndex = 0;
          var m;
          while ((m = re.exec(text))){
            var word = m[2], t = byKey[word] || byKey[word.toLowerCase()];
            if (t && !used[t.slug]){ var at = m.index + m[1].length; if (!best || at < best.at) best = {at: at, word: word, t: t}; break; }
            re.lastIndex = m.index + m[0].length;
          }
        });
        if (!best) return;
        used[best.t.slug] = 1; n++;
        var after = tn.splitText(best.at); after.splitText(best.word.length);
        var span = document.createElement('span');
        span.className = 'pi-tip'; span.tabIndex = 0; span.setAttribute('data-tip', best.t.slug);
        span.setAttribute('role', 'button'); span.setAttribute('aria-label', best.word + ': definition');
        after.parentNode.replaceChild(span, after); span.appendChild(after);
      });
    }
    scan(main);
    // boards and tabs swapped in by htmx after load get the same pass
    document.body.addEventListener('htmx:afterSettle', function(e){
      var t = e.detail && e.detail.elt; if (t && main.contains(t)) scan(t);
    });
    var bySlug = {}; d.terms.forEach(function(t){ bySlug[t.slug] = t; });

    var pop = document.createElement('div');
    pop.className = 'pi-tip-pop'; pop.setAttribute('role', 'tooltip'); pop.hidden = true;
    document.body.appendChild(pop);
    var cur = null, hideT = null;
    function show(el){
      var t = bySlug[el.getAttribute('data-tip')]; if (!t) return;
      clearTimeout(hideT); cur = el;
      pop.innerHTML = '';
      var h = document.createElement('div'); h.className = 'pi-tip-h'; h.textContent = t.term;
      var p = document.createElement('p'); p.textContent = t.def;
      var links = document.createElement('div'); links.className = 'pi-tip-l';
      var g = document.createElement('a'); g.href = '/academy/glossary#' + t.slug; g.textContent = 'Glossary';
      links.appendChild(g);
      if (t.lesson){ var l = document.createElement('a'); l.href = t.lesson; l.textContent = 'Lesson: ' + t.lesson_title; links.appendChild(l); }
      pop.appendChild(h); pop.appendChild(p); pop.appendChild(links);
      pop.hidden = false;
      var r = el.getBoundingClientRect(), w = Math.min(320, window.innerWidth - 32);
      pop.style.width = w + 'px';
      var left = Math.max(16, Math.min(r.left, window.innerWidth - w - 16));
      var top = r.bottom + 6;
      if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 6);
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
    }
    function hide(){ hideT = setTimeout(function(){ pop.hidden = true; cur = null; }, 150); }
    main.addEventListener('mouseover', function(e){ var el = e.target.closest && e.target.closest('.pi-tip'); if (el) show(el); });
    main.addEventListener('mouseout', function(e){ if (e.target.closest && e.target.closest('.pi-tip')) hide(); });
    main.addEventListener('focusin', function(e){ if (e.target.classList && e.target.classList.contains('pi-tip')) show(e.target); });
    main.addEventListener('focusout', function(e){ if (e.target.classList && e.target.classList.contains('pi-tip')) hide(); });
    pop.addEventListener('mouseover', function(){ clearTimeout(hideT); });
    pop.addEventListener('mouseout', hide);
    // tap (touch) toggles, and keeps a row link under the term from firing. A mouse click
    // goes through, so a sortable column header still sorts.
    var touch = false;
    main.addEventListener('pointerdown', function(e){ touch = e.pointerType === 'touch' || e.pointerType === 'pen'; }, true);
    main.addEventListener('click', function(e){
      var el = e.target.closest && e.target.closest('.pi-tip'); if (!el || !touch || el.closest('a')) return;
      e.preventDefault(); e.stopPropagation();
      if (cur === el && !pop.hidden){ pop.hidden = true; cur = null; } else show(el);
    }, true);
    document.addEventListener('click', function(e){ if (!pop.hidden && !e.target.closest('.pi-tip') && !pop.contains(e.target)){ pop.hidden = true; cur = null; } });
    window.addEventListener('scroll', function(){ if (!pop.hidden){ pop.hidden = true; cur = null; } }, {passive: true});
  }).catch(function(){});
})();
