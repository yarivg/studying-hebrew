/* ============================================================
   data.js - the one place the app reads its content from.

   Normally this is just fetch(). But the single-file build
   (tools/build-single-file.py) inlines every lesson and the
   vocabulary into window.__EMBEDDED__, and then there is no
   server to fetch from at all. Routing every read through here
   means neither app.js nor vocab.js has to know which it is.
   ============================================================ */

window.Data = (function () {
  'use strict';

  var embedded = window.__EMBEDDED__ || null;

  function isEmbedded() { return !!embedded; }

  function text(url) {
    if (embedded && Object.prototype.hasOwnProperty.call(embedded, url)) {
      return Promise.resolve(embedded[url]);
    }
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' - ' + r.status);
      return r.text();
    });
  }

  function json(url) {
    if (embedded && Object.prototype.hasOwnProperty.call(embedded, url)) {
      var v = embedded[url];
      return Promise.resolve(typeof v === 'string' ? JSON.parse(v) : v);
    }
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' - ' + r.status);
      return r.json();
    });
  }

  return { text: text, json: json, isEmbedded: isEmbedded };
})();
