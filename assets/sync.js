/* ============================================================
   sync.js - optional progress sync through a private GitHub gist.

   The course has no server, so the gist is the server: one private
   gist holding one JSON file, read on load and written back a few
   seconds after anything changes. Two devices reconcile through
   Progress.mergeRemote, so studying on the phone and on the laptop
   in the same day does not cost you either session.

   The token is a GitHub personal access token with the `gist`
   scope and nothing else. It is kept in this browser's
   localStorage and sent only to api.github.com.
   ============================================================ */

window.Sync = (function () {
  'use strict';

  var KEY = 'hamachberet.sync';
  var FILE = 'hamachberet-progress.json';
  var API = 'https://api.github.com';
  var DESCRIPTION = 'HaMachberet - Hebrew course progress';

  var cfg = load();
  var status = { state: 'off', message: '', at: 0 };
  var pushTimer = null;
  var running = null;

  function load() {
    var c = { token: '', gistId: '', lastSync: 0, lastPush: '' };
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var k in c) if (typeof saved[k] === typeof c[k]) c[k] = saved[k];
      }
    } catch (e) { /* nothing stored yet */ }
    return c;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* private mode */ }
  }

  function connected() { return !!(cfg.token && cfg.gistId); }
  function info() {
    return { connected: connected(), gistId: cfg.gistId, lastSync: cfg.lastSync, status: status };
  }

  function setStatus(stateName, message) {
    status = { state: stateName, message: message || '', at: Date.now() };
    window.dispatchEvent(new CustomEvent('sync:status', { detail: info() }));
  }

  /* ---------------------------------------------------------- github */

  function api(path, opts) {
    opts = opts || {};
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (r.status === 401) throw new Error('GitHub rejected the token. Make a new one with the gist scope.');
      if (r.status === 403) throw new Error('GitHub refused the request (rate limit, or the token has no gist scope).');
      if (r.status === 404) throw new Error('That gist is gone. Disconnect and connect again to make a new one.');
      if (!r.ok) throw new Error('GitHub returned ' + r.status);
      return r.json();
    });
  }

  // Reuse the gist from a previous device if there is one; the file name
  // is the marker, so nothing has to be copied between machines.
  function findGist() {
    return api('/gists?per_page=100').then(function (list) {
      var found = list.filter(function (g) { return g.files && g.files[FILE]; })[0];
      return found ? found.id : '';
    });
  }

  function createGist() {
    var body = { description: DESCRIPTION, public: false, files: {} };
    body.files[FILE] = { content: JSON.stringify(Progress.snapshot()) };
    return api('/gists', { method: 'POST', body: body }).then(function (g) { return g.id; });
  }

  /* ---------------------------------------------------------- operations */

  function connect(token) {
    token = String(token || '').trim();
    if (!token) return Promise.reject(new Error('Paste a token first.'));
    cfg.token = token;
    setStatus('syncing', 'Connecting…');
    return findGist()
      .then(function (id) { return id || createGist(); })
      .then(function (id) {
        cfg.gistId = id;
        save();
        return syncNow();
      })
      .catch(function (err) {
        cfg.token = '';
        cfg.gistId = '';
        save();
        setStatus('error', err.message);
        throw err;
      });
  }

  function disconnect() {
    cfg = { token: '', gistId: '', lastSync: 0, lastPush: '' };
    save();
    setStatus('off', '');
  }

  function pull() {
    return api('/gists/' + cfg.gistId).then(function (g) {
      var file = g.files && g.files[FILE];
      if (!file) return null;
      // GitHub truncates large files in the gist payload and hands you a
      // raw URL instead.
      var text = file.truncated ? fetch(file.raw_url).then(function (r) { return r.text(); })
                                : Promise.resolve(file.content);
      return Promise.resolve(text);
    }).then(function (text) {
      if (!text) return null;
      return JSON.parse(text);
    });
  }

  function push() {
    var content = JSON.stringify(Progress.snapshot());
    var body = { files: {} };
    body.files[FILE] = { content: content };
    return api('/gists/' + cfg.gistId, { method: 'PATCH', body: body }).then(function () {
      cfg.lastPush = Progress.fingerprint();
      return true;
    });
  }

  // Always pull-merge before pushing: the other device may have moved on
  // since this one last looked, and a blind PATCH would erase it.
  function syncNow() {
    if (!connected()) return Promise.resolve(false);
    if (running) return running;
    setStatus('syncing', '');
    running = pull()
      .then(function (remote) {
        if (remote) Progress.mergeRemote(remote);
        return push();
      })
      .then(function () {
        cfg.lastSync = Date.now();
        save();
        setStatus('ok', '');
        window.dispatchEvent(new CustomEvent('sync:done'));
        return true;
      })
      .catch(function (err) {
        setStatus('error', err.message);
        return false;
      })
      .then(function (result) { running = null; return result; });
    return running;
  }

  function schedulePush() {
    if (!connected()) return;
    clearTimeout(pushTimer);
    // Long enough that a run of flashcard grades is one request, short
    // enough that closing the tab afterwards rarely loses anything.
    pushTimer = setTimeout(function () {
      if (Progress.fingerprint() === cfg.lastPush) return;
      syncNow();
    }, 6000);
  }

  /* ---------------------------------------------------------- wiring */

  function setup() {
    if (!connected()) { setStatus('off', ''); return; }
    setStatus('idle', '');
    syncNow();
    window.addEventListener('progress:change', schedulePush);
    // Coming back to the tab on the other device is exactly when the
    // remote is most likely to be ahead.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Date.now() - cfg.lastSync > 60000) syncNow();
    });
  }

  return {
    setup: setup, connect: connect, disconnect: disconnect,
    syncNow: syncNow, connected: connected, info: info
  };
})();
