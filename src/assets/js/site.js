// Elvira — page behaviour: scaling, animations, mobile menu, videos, slideshows, forms.
(function () {
  'use strict';

  var root = document.documentElement;

  // Opened straight from disk (double click): point internal links at the local files.
  if (location.protocol === 'file:') {
    document.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (/^[a-z]+:/i.test(href) || href.charAt(0) === '#') return;
      if (href.slice(-1) === '/') a.setAttribute('href', href + 'index.html');
    });
  }
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- scaling: the canvas always fills the window width ----------

  function activeLayout() {
    var all = document.querySelectorAll('.layout');
    for (var i = 0; i < all.length; i++) {
      if (getComputedStyle(all[i]).display !== 'none') return all[i];
    }
    return all[0];
  }

  var layout = null;
  var zoom = 1;

  function scale() {
    layout = activeLayout();
    if (!layout) return;
    var width = Number(layout.getAttribute('data-width'));
    var vw = root.clientWidth;
    if (width === 1024) vw = Math.min(Math.max(vw, 769), 3600);
    zoom = vw / width;
    root.style.setProperty('--z', String(zoom));
  }

  scale();
  window.addEventListener('resize', function () { scale(); onScroll(); });

  // ---------- animations that play once when the element comes into view ----------

  var loaders = document.querySelectorAll('[data-load]');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    loaders.forEach(function (el) { el.classList.add('played'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('played'); io.unobserve(e.target); }
      });
    }, { threshold: 0.01 });
    loaders.forEach(function (el) {
      if (el.getAttribute('data-load') === 'now') el.classList.add('played');
      else io.observe(el);
    });
  }

  // ---------- animations linked to scrolling ----------

  function ease(t) {
    // cubic-bezier(.42,0,.58,1) approximation
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  var scrollers = [];
  document.querySelectorAll('[data-scroll]').forEach(function (el) {
    try { scrollers.push({ el: el, cfg: JSON.parse(el.getAttribute('data-scroll')) }); } catch (e) { /* ignore */ }
  });

  function applyScroll(item) {
    var cfg = item.cfg;
    var y = window.scrollY / zoom;
    var vh = window.innerHeight / zoom;
    var pos = Math.max(0, cfg.y - vh);
    var tx = 0, ty = 0, s = null, r = null, a = null;
    for (var i = 0; i < cfg.steps.length; i++) {
      var st = cfg.steps[i];
      pos += st.o || 0;
      var p = st.d > 0 ? Math.min(1, Math.max(0, (y - pos) / st.d)) : 1;
      var k = ease(p);
      if (st.dx !== undefined) { tx += st.dx * k; ty += st.dy * k; }
      if (st.s) s = st.s[0] + (st.s[1] - st.s[0]) * k;
      if (st.r) r = st.r[0] + (st.r[1] - st.r[0]) * k;
      if (st.a) a = st.a[0] + (st.a[1] - st.a[0]) * k;
      pos += st.d;
    }
    var style = item.el.style;
    if (tx || ty) style.translate = tx.toFixed(2) + 'px ' + ty.toFixed(2) + 'px';
    if (s !== null) style.scale = s.toFixed(4);
    if (r !== null) style.rotate = r.toFixed(2) + 'deg';
    if (a !== null) style.opacity = a.toFixed(3);
  }

  var ticking = false;
  function onScroll() {
    if (ticking || reduceMotion) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      for (var i = 0; i < scrollers.length; i++) {
        if (layout && layout.contains(scrollers[i].el)) applyScroll(scrollers[i]);
      }
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- mobile menu ----------

  function closeMenus() {
    document.querySelectorAll('.menu-btn[aria-expanded="true"]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
      var tip = document.getElementById(btn.getAttribute('aria-controls'));
      if (tip) tip.hidden = true;
    });
    document.body.style.overflow = '';
  }

  document.querySelectorAll('.menu-btn').forEach(function (btn) {
    var tip = document.getElementById(btn.getAttribute('aria-controls'));
    if (!tip) return;
    // The menu overlay must cover the whole window, so it lives directly in <body>.
    btn.closest('.layout').appendChild(tip);
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      closeMenus();
      if (!open) {
        btn.setAttribute('aria-expanded', 'true');
        tip.hidden = false;
        document.body.style.overflow = 'hidden';
        var first = tip.querySelector('a');
        if (first) first.focus({ preventScroll: true });
      }
    });
    tip.addEventListener('click', function (e) {
      if (e.target === tip || e.target.closest('.menu-close') || e.target.closest('[data-close-menu]')) closeMenus();
    });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenus(); });

  // ---------- videos with a cover image ----------

  document.querySelectorAll('.video-poster').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var frame = document.createElement('iframe');
      frame.src = btn.getAttribute('data-src');
      frame.title = btn.getAttribute('data-title') || 'Video';
      frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      frame.allowFullscreen = true;
      btn.replaceWith(frame);
    });
  });

  // ---------- slideshows ----------

  document.querySelectorAll('.slideshow').forEach(function (show) {
    var track = show.querySelector('.track');
    var slides = show.querySelectorAll('.slide');
    var index = 0;
    show.style.setProperty('--speed', (show.getAttribute('data-speed') || '0.5') + 's');
    function go(i) {
      index = (i + slides.length) % slides.length;
      track.style.transform = 'translateX(' + (-100 * index) + '%)';
      slides.forEach(function (s, n) { s.setAttribute('aria-hidden', n === index ? 'false' : 'true'); });
      if (thumbs) thumbs.forEach(function (b, n) { if (n === index) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    }
    var strip = document.querySelector('.thumbs[data-for="' + show.id + '"]');
    var thumbs = strip ? strip.querySelectorAll('button') : null;
    if (thumbs) thumbs.forEach(function (b, n) { b.addEventListener('click', function () { go(n); }); });
    var prev = show.querySelector('.prev');
    var next = show.querySelector('.next');
    if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); go(index - 1); });
    if (next) next.addEventListener('click', function (e) { e.stopPropagation(); go(index + 1); });
    track.addEventListener('click', function () { go(index + 1); });
    // swipe on touch screens
    var startX = null;
    show.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
    show.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
      startX = null;
    });
  });

  // ---------- contact forms ----------

  document.querySelectorAll('form.form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var action = form.getAttribute('action');
      if (!window.fetch || !/formsubmit\.co/.test(action)) return;
      e.preventDefault();
      var btn = form.querySelector('.submit');
      var status = form.querySelector('.form-status');
      var label = btn.textContent;
      btn.disabled = true;
      status.textContent = 'Invio in corso…';
      var url = action.replace('formsubmit.co/', 'formsubmit.co/ajax/').replace('/ajax/ajax/', '/ajax/');
      fetch(url, { method: 'POST', headers: { Accept: 'application/json' }, body: new FormData(form) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function () {
          form.reset();
          btn.textContent = btn.getAttribute('data-sent');
          status.textContent = '';
          setTimeout(function () { btn.textContent = label; btn.disabled = false; }, 4000);
        })
        .catch(function () {
          btn.disabled = false;
          status.textContent = 'Invio non riuscito. Scrivici a siamoelvira@gmail.com';
        });
    });
  });
})();
