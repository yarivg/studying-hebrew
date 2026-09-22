/* ============================================================
   offline.js - registers the service worker and reports how much
   of the course is stored on this device.

   Exposes window.Offline for the dashboard, and keeps a small
   pill in the topbar in sync so you can tell, at a glance and
   before you lose signal, whether you are safe to go offline.
   ============================================================ */

window.Offline = (function () {
  'use strict';

  var state = {
    supported: 'serviceWorker' in navigator,
    // A single-file build has everything inlined already.
    embedded: !!window.__EMBEDDED__,
    registered: false,
    caching: false,
    done: 0,
    total: 0,
    ready: false,
    failed: []
  };

  var listeners = [];

  function on(fn) { listeners.push(fn); return function () { emit(); }; }
  function emit() { listeners.forEach(function (fn) { fn(state); }); }

  function init() {
    if (state.embedded) {
      state.ready = true;
      paint();
      return;
    }
    if (!state.supported) { paint(); return; }

    // Service workers need a secure context: https, or localhost.
    if (!window.isSecureContext) { paint(); return; }

    navigator.serviceWorker.addEventListener('message', function (e) {
      var d = e.data || {};
      if (d.type === 'cache-progress') {
        state.caching = true;
        state.done = d.done;
        state.total = d.total;
      } else if (d.type === 'cache-complete') {
        state.caching = false;
        state.ready = true;
        state.done = d.total;
        state.total = d.total;
        state.failed = d.failed || [];
      } else if (d.type === 'status') {
        state.done = d.cached;
        state.total = d.expected;
        state.ready = d.cached >= d.expected;
      }
      paint();
      emit();
    });

    // The reload-on-upgrade is handled by boot.js, which loads first.
    navigator.serviceWorker.register('sw.js', { scope: './' })
      .then(function (reg) {
        state.registered = true;
        paint();
        // Ask for a count once the worker is running.
        navigator.serviceWorker.ready.then(function () {
          setTimeout(status, 400);
        });
        reg.addEventListener('updatefound', function () { paint(); });
        // An installed PWA can sit for days without checking.
        reg.update().catch(function () {});
      })
      .catch(function () { paint(); });
  }

  function send(msg) {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(msg);
    }
  }

  function status() { send({ type: 'status' }); }
  function recache() { state.caching = true; paint(); send({ type: 'recache' }); }

  function estimate() {
    if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
    return navigator.storage.estimate();
  }

  /* ---------------------------------------------------------- the pill */

  function paint() {
    var el = document.getElementById('offlinePill');
    if (!el) return;

    var online = navigator.onLine;

    if (state.embedded) {
      set(el, 'ok', '✓', 'Offline file', 'Everything is inside this one HTML file');
      return;
    }
    if (!state.supported || !window.isSecureContext) {
      // Not an error the user caused: http:// and file:// simply cannot do this.
      set(el, 'off', '', '', '');
      el.hidden = true;
      return;
    }
    if (state.caching) {
      var pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
      set(el, 'busy', '↓', 'Saving ' + pct + '%', 'Storing the course on this device - ' + state.done + ' of ' + state.total + ' files');
      return;
    }
    if (state.ready) {
      set(el, 'ok', '✓', online ? 'Offline ready' : 'Offline',
        online ? 'The whole course is stored on this device - tap for details'
               : 'No network - running entirely from this device');
      return;
    }
    set(el, 'wait', '☁', 'Not saved', 'The course is not yet stored on this device');
  }

  function set(el, kind, icon, label, detail) {
    el.hidden = false;
    el.className = 'offline-pill is-' + kind;
    // The glyph is its own element so a narrow screen can hide the words
    // without hiding the state -- font-size:0 on the parent would take both.
    el.innerHTML = '';
    var g = document.createElement('span');
    g.className = 'offline-glyph';
    g.textContent = icon;
    var t = document.createElement('span');
    t.className = 'offline-text';
    t.textContent = label;
    el.appendChild(g);
    el.appendChild(t);
    el.title = detail || label;
    el.setAttribute('aria-label', detail || label);
  }

  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    state: state, on: on, status: status, recache: recache, estimate: estimate
  };
})();
