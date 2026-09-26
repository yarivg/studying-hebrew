/* ============================================================
   sw.js - service worker. Makes the whole course work offline.

   On install it reads content/manifest.json and derives the full
   file list from it, so adding a chapter to the manifest is
   enough - this file never needs a hand-maintained list.

   Strategy, split by what the file is:
     - the shell (html/css/js/manifest) → network first, cache as
       fallback. Cache-first here means a deploy is invisible until
       the *second* load, which is how a stale UI shipped once
       already. Offline it still comes from the cache, so nothing
       is lost.
     - content (markdown, json) → cache first, revalidated in the
       background. It is versioned prose, not live data.
   Bump CACHE_VERSION to force a full refetch.
   ============================================================ */

var CACHE_VERSION = 'hamachberet-v3';
var SHELL = [
  './',
  'index.html',
  'assets/style.css',
  'assets/boot.js',
  'assets/data.js',
  'assets/hebrew.js',
  'assets/md.js',
  'assets/progress.js',
  'assets/sync.js',
  'assets/audio.js',
  'assets/speech.js',
  'assets/test.js',
  'assets/read.js',
  'assets/quiz.js',
  'assets/vocab.js',
  'assets/select.js',
  'assets/app.js',
  'assets/offline.js',
  'manifest.webmanifest',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png',
  'assets/fonts/noto-sans-hebrew.woff2',
  'assets/fonts/frank-ruhl-libre-hebrew.woff2',
  'data/vocab.json',
  'content/manifest.json',
  'content/tests/groups.json'
];

/* ---------------------------------------------------------- install */

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) {
        return buildFileList().then(function (urls) {
          return cacheAll(cache, urls);
        });
      })
      .then(function () { return self.skipWaiting(); })
  );
});

// Everything the app can ask for: the shell, every chapter, every test bank
// and every reading passage. Derived from the two index files so adding
// content never means editing this worker.
//
// Test banks are *optional* -- the Part IV reference chapters have none -- so
// they are kept in a separate list. Counting them as required would mean the
// cache could never report itself complete.
function buildFileList() {
  var required = SHELL.slice();
  var optional = [];

  var chapters = fetch('content/manifest.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (m) {
      m.parts.forEach(function (part) {
        part.chapters.forEach(function (ch) {
          required.push('content/' + ch.file);
          optional.push('content/tests/' + ch.file.replace(/\.md$/, '.json'));
        });
      });
    })
    .catch(function () {});

  var reading = fetch('content/reading/index.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (idx) {
      required.push('content/reading/index.json');
      (idx.passages || []).forEach(function (p) {
        if (p && p.file) required.push('content/reading/' + p.file);
      });
    })
    .catch(function () {});

  return Promise.all([chapters, reading]).then(function () {
    return { required: required, optional: optional };
  });
}

// Fetch one at a time rather than cache.addAll(), so a single 404 cannot
// abort the whole install, and so we can report progress. A miss on an
// optional file is expected and is not an error.
function cacheAll(cache, list) {
  var urls = list.required.concat(list.optional);
  var isOptional = {};
  list.optional.forEach(function (u) { isOptional[u] = true; });

  var done = 0;
  var failed = [];

  return urls.reduce(function (chain, url) {
    return chain.then(function () {
      return fetch(url, { cache: 'no-cache' })
        .then(function (res) {
          if (!res.ok) throw new Error(res.status);
          return cache.put(url, res);
        })
        .catch(function (err) {
          if (!isOptional[url]) failed.push(url + ': ' + err.message);
        })
        .then(function () {
          done++;
          report({ type: 'cache-progress', done: done, total: urls.length });
        });
    });
  }, Promise.resolve()).then(function () {
    report({ type: 'cache-complete', total: urls.length, failed: failed });
    return failed;
  });
}

function report(msg) {
  self.clients.matchAll({ includeUncontrolled: true }).then(function (clients) {
    clients.forEach(function (c) { c.postMessage(msg); });
  });
}

/* ---------------------------------------------------------- activate */

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys
          .filter(function (k) { return k !== CACHE_VERSION; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* ---------------------------------------------------------- fetch */

// The app shell must never be served stale while online, or a fix stays
// invisible until the next load.
function isShell(url) {
  return /\.(html|css|js|webmanifest)$/.test(url.pathname) ||
         url.pathname.endsWith('/');
}

// A recorded clip. Named after a hash of the words it holds, so its contents
// can never change and it never needs revalidating.
function isClip(url) {
  return /\/audio\/[0-9a-f]{2}\/[0-9a-f]{16}\.m4a$/.test(url.pathname);
}

self.addEventListener('fetch', function (event) {
  var req = event.request;

  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // A navigation offline should still land on the app shell; the hash
  // route is handled client-side once it boots.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .catch(function () {
          return caches.match('index.html', { ignoreSearch: true })
            .then(function (hit) { return hit || caches.match('./'); });
        })
    );
    return;
  }

  // Clips are deliberately not in the precache list: 44 MB is not something
  // to download before the first lesson. They collect here instead, one per
  // thing you have actually listened to, and the Audio menu has a button that
  // walks the lot in one go for a flight.
  if (isClip(url)) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  if (isShell(url)) {
    event.respondWith(
      // 'reload' skips the browser's own HTTP cache. Without it the first
      // load after an upgrade can pair new HTML with a stale stylesheet.
      fetch(new Request(req.url, { cache: 'reload', credentials: 'same-origin' }))
        .then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
          }
          return res;
        })
        .catch(function () {
          return caches.match(req, { ignoreSearch: true });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });

      // Serve the cached copy immediately when we have one.
      return hit || network;
    })
  );
});

/* ---------------------------------------------------------- messages */

self.addEventListener('message', function (event) {
  var data = event.data || {};

  if (data.type === 'recache') {
    caches.open(CACHE_VERSION).then(function (cache) {
      buildFileList().then(function (urls) { cacheAll(cache, urls); });
    });
  }

  if (data.type === 'status') {
    Promise.all([caches.open(CACHE_VERSION), buildFileList()])
      .then(function (r) { return Promise.all([r[0].keys(), r[1]]); })
      .then(function (r) {
        // Clips are counted apart from the course. They are optional, there
        // are thousands of them, and folded in they would put the cache past
        // "complete" the first time anyone pressed play.
        var clips = 0;
        var course = r[0].filter(function (req) {
          if (!isClip(new URL(req.url))) return true;
          clips++;
          return false;
        });
        // Ready is measured against the required files only; the optional
        // test banks that do not exist must not hold the count back.
        report({ type: 'status', cached: course.length,
                 expected: r[1].required.length, clips: clips });
      });
  }
});
