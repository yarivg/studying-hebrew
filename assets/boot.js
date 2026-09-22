/* ============================================================
   boot.js - makes an upgrade land on the first visit, not the second.

   Why this file exists, and why it has a name nothing else had:

   A service worker that caches the shell serves its cached copy of
   style.css and app.js even after a deploy. The worker that would
   know better ships *inside* that deploy, so the browser is holding
   the very code that would fix it. The result is one visit showing
   new HTML with an old stylesheet, and nothing to trigger a reload.

   A filename the previous cache has never seen cannot be served
   from it. The request misses, falls through to the network, and
   this runs fresh even on the first visit after an upgrade. From
   here it can notice the old worker being replaced and reload once.

   Keep this file tiny and dependency-free: it runs before anything
   else and must never be the reason a page fails to start.
   ============================================================ */

(function () {
  'use strict';

  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  var RELOADED = 'hamachberet.swReloaded';

  // Only meaningful when a worker is already in charge; a first-ever
  // install has nothing stale to replace.
  var hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController) return;
    // One reload, ever, per tab: a loop here would be unrecoverable
    // for the user, with no UI left to fix it from.
    try {
      if (sessionStorage.getItem(RELOADED)) return;
      sessionStorage.setItem(RELOADED, '1');
    } catch (e) { /* private mode: fall through and reload once */ }
    location.reload();
  });

  // An installed app can go days without asking whether it is current.
  navigator.serviceWorker.getRegistration().then(function (reg) {
    if (reg) reg.update().catch(function () {});
  }).catch(function () {});
})();
