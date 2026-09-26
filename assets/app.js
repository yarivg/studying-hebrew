/* ============================================================
   app.js - routing, navigation, search and the non-lesson pages.

   Routes
     #/                  home
     #/dashboard         progress overview
     #/stats             statistics: progress over time, words known, activity
     #/vocab             vocabulary browser
     #/cards             deck list
     #/cards/<deckId>    review session
     #/tests             every chapter and part test
     #/test/<slug>       one chapter's test
     #/test/part-<n>     a whole-part exam
     #/read              reading passages
     #/read/<id>         one passage
     #/<slug>            a lesson from content/
   ============================================================ */

(function () {
  'use strict';

  var manifest = null;
  var chapters = [];          // flat list, in reading order
  var bySlug = {};
  var cache = {};             // slug -> raw markdown
  var searchIndex = null;

  var view = document.getElementById('view');
  var pager = document.getElementById('pager');
  var navEl = document.getElementById('nav');

  /* ---------------------------------------------------------- boot */

  function boot() {
    setupTheme();
    setupNikud();
    setupNav();
    setupSearch();
    setupQuickAdd();
    Say.setup();

    Data.json('content/manifest.json')
      .then(function (json) {
        manifest = json;
        chapters = [];
        json.parts.forEach(function (part) {
          part.chapters.forEach(function (ch) {
            ch.part = part;
            chapters.push(ch);
            bySlug[ch.slug] = ch;
          });
        });
        // The reading list names the chapters a passage needs. It has the
        // slugs; the titles are here.
        Read.useTitles(function (slug) {
          return bySlug[slug] ? bySlug[slug].title : slug.replace(/-/g, ' ');
        });
        renderNav();
        window.addEventListener('hashchange', route);
        window.addEventListener('progress:change', function () {
          updateProgressCard();
          markNavRead();
          recordSnapshot();
        });
        recordSnapshot();
        // A sync can change everything the dashboard is showing.
        window.addEventListener('sync:status', function () {
          if (location.hash.replace(/^#\/?/, '') === 'dashboard') renderSyncCard();
        });
        window.addEventListener('sync:done', function () {
          if (location.hash.replace(/^#\/?/, '') === 'dashboard') renderDashboard();
        });
        route();
        Sync.setup();
      })
      .catch(function (err) {
        view.innerHTML =
          '<div class="empty"><div class="empty-icon">⚠️</div>' +
          '<p><strong>Could not load the course.</strong></p>' +
          '<p>' + escapeHtml(err.message) + '</p>' +
          '<p>If you opened this file directly from disk, the browser blocks the requests ' +
          'this page makes. Serve the folder instead:</p>' +
          '<pre><code>python3 -m http.server 8000</code></pre>' +
          '<p>then open <code>http://localhost:8000</code>.</p></div>';
      });
  }

  /* ---------------------------------------------------------- theme */

  function setupTheme() {
    var saved = localStorage.getItem('hamachberet.theme');
    if (saved) document.documentElement.dataset.theme = saved;
    document.getElementById('themeBtn').addEventListener('click', function () {
      var cur = document.documentElement.dataset.theme;
      if (!cur) {
        cur = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('hamachberet.theme', next);
    });
  }

  /* ---------------------------------------------------------- nikud */

  // One switch for the whole course: draw the vowel points, or do not.
  // Turning them off is how a learner moves from reading with training
  // wheels to reading what is actually written on a sign in Israel, so it
  // has to be one tap away on every page, not a setting buried somewhere.
  function setupNikud() {
    var btn = document.getElementById('nikudBtn');
    if (!btn) return;
    paint();
    btn.addEventListener('click', function () {
      Heb.setNikud(!Heb.nikudOn());
      paint();
      // Everything on screen was rendered through Heb.show(), so the only
      // way to apply the change is to draw the page again. Which must not
      // move you: this switch is meant to be flicked in the middle of a
      // paragraph to check whether you can still read it.
      var y = window.pageYOffset;
      route(true);
      function hold() { window.scrollTo(0, y); }
      hold();
      // The page is a little shorter without the points, and some views
      // paint from a promise, so put it back once more after the layout
      // has settled.
      requestAnimationFrame(hold);
      setTimeout(hold, 150);
    });
    function paint() {
      var on = Heb.nikudOn();
      document.body.classList.toggle('nikud-off', !on);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('title', on ? 'Vowel points are on' : 'Vowel points are off');
    }
  }

  /* ---------------------------------------------------------- nav */

  function setupNav() {
    var btn = document.getElementById('menuBtn');
    var scrim = document.getElementById('scrim');
    function close() {
      document.body.classList.remove('nav-open');
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      btn.setAttribute('aria-expanded', String(open));
    });
    scrim.addEventListener('click', close);
    navEl.addEventListener('click', function (e) {
      if (e.target.closest('a')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  function renderNav() {
    var html =
      '<a class="nav-link nav-meta" href="#/"><span>Start here</span></a>' +
      '<a class="nav-link nav-meta" href="#/dashboard"><span>Progress</span></a>' +
      '<a class="nav-link nav-meta" href="#/stats"><span>Statistics</span></a>' +
      '<a class="nav-link nav-meta" href="#/vocab"><span>Vocabulary</span></a>' +
      '<a class="nav-link nav-meta" href="#/cards"><span>Flashcards</span></a>' +
      '<a class="nav-link nav-meta" href="#/tests"><span>Tests</span></a>' +
      '<a class="nav-link nav-meta" href="#/read"><span>Reading</span></a>';

    manifest.parts.forEach(function (part) {
      html += '<div class="nav-part"><span class="nav-part-n">' + escapeHtml(part.numeral) + '</span>' +
              escapeHtml(part.title) + '</div>';
      part.chapters.forEach(function (ch, i) {
        html += '<a class="nav-link" href="#/' + ch.slug + '" data-slug="' + ch.slug + '">' +
                '<span class="tick" aria-hidden="true"></span>' +
                '<span class="nav-num">' + (i + 1) + '</span>' +
                '<span>' + escapeHtml(ch.title) + '</span></a>';
      });
    });
    navEl.innerHTML = html;
    markNavRead();
    updateProgressCard();
  }

  function markNavRead() {
    navEl.querySelectorAll('a[data-slug]').forEach(function (a) {
      a.classList.toggle('is-read', studied(a.dataset.slug));
      // Read and understood are different things, so they get different marks.
      var level = Progress.mastery(a.dataset.slug).level;
      a.classList.toggle('is-shaky', level === 1);
      a.classList.toggle('is-solid', level === 2);
    });
  }

  function setCurrentNav(slug) {
    navEl.querySelectorAll('a').forEach(function (a) {
      a.classList.toggle('is-current', a.getAttribute('href') === '#/' + slug);
    });
  }

  var renderSidebarProgress = function () { markNavRead(); updateProgressCard(); };

  // How much of a chapter counts as done. It comes from the mark you give
  // yourself after the chapter's test: confident is a whole lesson, shaky is
  // half, nothing is nothing. Mark as read used to be the only thing that
  // counted, which is why a chapter tested and marked *Confident* still read
  // as 0% progress. Reading a lesson still ticks it in the sidebar, but
  // having read something is not the same as knowing it, so it is not
  // progress on its own.
  function credit(slug) {
    var level = Progress.mastery(slug).level;
    return level === 2 ? 1 : level === 1 ? 0.5 : 0;
  }

  // Ticked in the sidebar: read, or judged, since you cannot judge unread.
  function studied(slug) { return Progress.studied(slug); }

  function marked(list) {
    return list.filter(function (c) { return Progress.mastery(c.slug).level > 0; }).length;
  }

  function creditOf(list) {
    return list.reduce(function (sum, c) { return sum + credit(c.slug); }, 0);
  }

  function pctOf(list) {
    return list.length ? Math.round((creditOf(list) / list.length) * 100) : 0;
  }

  function solidOf(list) {
    return list.filter(function (c) { return Progress.mastery(c.slug).level === 2; }).length;
  }

  // Every card id from every deck, deduplicated. Counting only the FR → EN
  // deck used to hide all of a session spent on EN → FR: the two directions
  // are separate cards with separate schedules.
  function allCardIds() {
    var seen = Object.create(null);
    Vocab.decks().forEach(function (d) {
      d.cards.forEach(function (c) { seen[c.id] = 1; });
    });
    return Object.keys(seen);
  }

  // One reading of the counters a day, for the statistics page. Words ticked
  // as known and flashcard boxes carry no date of their own, so without this
  // there would be no way to draw them over time. Written after things settle
  // so a run of grades is one write, not twenty.
  var snapTimer = null;
  function recordSnapshot() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(function () {
      Vocab.load().then(function () {
        var cs = Progress.cardStats(allCardIds());
        Progress.snapDay({
          pct: pctOf(chapters),
          marked: marked(chapters),
          solid: solidOf(chapters),
          known: Progress.knownCount(),
          words: Progress.wordCount(),
          right: cs.right,
          stuck: cs.learned
        });
      });
    }, 2500);
  }

  function updateProgressCard() {
    var total = chapters.length || 1;
    var pct = pctOf(chapters);
    var ring = document.getElementById('progressRing');
    var circ = 2 * Math.PI * 19;
    ring.style.strokeDasharray = circ;
    ring.style.strokeDashoffset = circ * (1 - pct / 100);
    document.getElementById('progressPct').textContent = pct + '%';
    document.getElementById('progressText').textContent =
      marked(chapters) + ' of ' + total + ' lessons marked';
    document.querySelector('.progress-card').title =
      'From the mark you give yourself after a chapter test: confident counts a ' +
      'whole lesson, shaky counts half.';
  }

  /* ---------------------------------------------------------- routing */

  // `keepScroll` is for a redraw of the page you are already on, where
  // jumping to the top would lose your place: the nikud switch is the only
  // caller. Every real navigation scrolls to the top, as it should.
  function route(keepScroll) {
    var hash = location.hash.replace(/^#\/?/, '');
    closeSearch();
    Quiz.endSession();
    Test.stop();
    if (!keepScroll) window.scrollTo(0, 0);
    document.getElementById('main').focus({ preventScroll: true });

    if (!hash) return renderHome();
    if (hash === 'dashboard') return renderDashboard();
    if (hash === 'stats') return renderStats();
    if (hash === 'vocab') return renderVocabPage();
    if (hash === 'cards') return renderDeckList();
    if (hash.indexOf('cards/') === 0) return renderDeck(hash.slice(6));
    if (hash === 'tests') return renderTestList();
    if (hash.indexOf('test/') === 0) return renderTest(hash.slice(5));
    if (hash === 'read') return renderReadList();
    if (hash.indexOf('read/') === 0) return renderPassage(hash.slice(5));
    return renderChapter(hash);
  }

  /* ---------------------------------------------------------- chapter */

  function fetchChapter(ch) {
    if (cache[ch.slug]) return Promise.resolve(cache[ch.slug]);
    return Data.text('content/' + ch.file)
      .then(function (text) { cache[ch.slug] = text; return text; });
  }

  function renderChapter(slug) {
    var ch = bySlug[slug];
    if (!ch) {
      view.innerHTML = '<div class="empty"><div class="empty-icon">🤷</div>' +
        '<p>No lesson called <code>' + escapeHtml(slug) + '</code>.</p>' +
        '<p><a href="#/">Back to the start</a></p></div>';
      pager.innerHTML = '';
      return;
    }

    setCurrentNav(slug);
    view.innerHTML = '<div class="loading">Loading…</div>';

    fetchChapter(ch).then(function (md) {
      var doc = MD.frontMatter(md);
      var idx = chapters.indexOf(ch);

      var head = '<div class="eyebrow">' +
        '<span>' + escapeHtml(ch.part.numeral) + ' · ' + escapeHtml(ch.part.title) + '</span>' +
        (ch.level ? '<span class="dot"></span><span class="pill pill-' + ch.level.toLowerCase() + '">' +
          escapeHtml(ch.level) + '</span>' : '') +
        '</div>';

      view.innerHTML = head + MD.render(doc.body);

      Quiz.bindExercises(view, slug);
      Say.hydrate(view);
      Vocab.hydrateEmbeds(view).then(function () {
        Say.hydrate(view);
        bindEmbedEdits(view);
      });
      renderDoneBar(ch);
      renderPager(idx);
    }).catch(function (err) {
      view.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><p>' +
        escapeHtml(err.message) + '</p></div>';
    });
  }

  function renderDoneBar(ch) {
    var bar = document.createElement('div');
    bar.className = 'chapter-done';
    function paint(hasTest) {
      var done = Progress.isRead(ch.slug);
      var m = Progress.mastery(ch.slug);
      bar.classList.toggle('is-done', done);
      bar.innerHTML = '<p>' +
          (m.level ? 'You marked this <strong>' + LEVEL_LABEL[m.level].toLowerCase() + '</strong>.'
                   : done ? 'Marked as read.' : 'Finished this lesson?') +
        '</p>' +
        (hasTest ? '<a class="btn btn-primary" href="#/test/' + ch.slug + '">Test yourself</a>' : '') +
        '<button class="btn ' + (done || hasTest ? '' : 'btn-primary') + '">' +
        (done ? 'Mark as unread' : 'Mark as read') + '</button>';
      bar.querySelector('button').addEventListener('click', function () {
        Progress.toggleRead(ch.slug);
        paint(hasTest);
      });
    }
    paint(false);
    view.appendChild(bar);
    // Drawn without the test button first, so the lesson never waits on it.
    Test.loadChapter(ch).then(function (bank) { if (bank) paint(true); });
  }

  function renderPager(idx) {
    var prev = chapters[idx - 1], next = chapters[idx + 1];
    var html = '';
    if (prev) {
      html += '<a class="prev" href="#/' + prev.slug + '">' +
        '<span class="pager-dir">← Previous</span>' +
        '<span class="pager-title">' + escapeHtml(prev.title) + '</span></a>';
    }
    if (next) {
      html += '<a class="next" href="#/' + next.slug + '">' +
        '<span class="pager-dir">Next →</span>' +
        '<span class="pager-title">' + escapeHtml(next.title) + '</span></a>';
    }
    pager.innerHTML = html;
  }

  /* ---------------------------------------------------------- home */

  function renderHome() {
    setCurrentNav('');
    pager.innerHTML = '';
    var read = chapters.filter(function (c) { return studied(c.slug); }).length;
    var nextCh = chapters.find(function (c) { return !studied(c.slug); }) || chapters[0];

    var html =
      '<div class="eyebrow"><span>A course built from the alef-bet up</span></div>' +
      '<h1>' + escapeHtml(manifest.title) + '</h1>' +
      '<p class="lead">' + escapeHtml(manifest.subtitle) + '</p>' +
      '<div class="cards">' +
        card('#/' + nextCh.slug, '▶', read ? 'Continue' : 'Start reading', nextCh.title) +
        card('#/tests', '📝', 'Tests', 'A drill per chapter, an exam per part, marked by you') +
        card('#/read', '📕', 'Reading', 'Passages to read, hear, and read back out loud') +
        card('#/vocab', '📖', 'Vocabulary', 'Searchable and filterable, and you can add your own') +
        card('#/cards', '🗂', 'Flashcards', 'Spaced repetition across every theme') +
        card('#/dashboard', '📊', 'Progress', 'What you have read, learned and still owe') +
        card('#/stats', '📈', 'Statistics', 'Your progress over time, and how many words you know') +
      '</div>';

    manifest.parts.forEach(function (part) {
      html += '<h2>' + escapeHtml(part.numeral) + ' - ' + escapeHtml(part.title) + '</h2>' +
              '<p>' + escapeHtml(part.blurb) + '</p><div class="toc"><ol>';
      part.chapters.forEach(function (ch) {
        html += '<li><a href="#/' + ch.slug + '">' + escapeHtml(ch.title) + '</a></li>';
      });
      html += '</ol></div>';
    });

    view.innerHTML = html;
  }

  function card(href, icon, title, body) {
    return '<a class="card" href="' + href + '">' +
      '<div class="card-icon" aria-hidden="true">' + icon + '</div>' +
      '<h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(body) + '</p></a>';
  }

  /* ---------------------------------------------------------- dashboard */

  function renderDashboard() {
    setCurrentNav('dashboard');
    pager.innerHTML = '';

    Vocab.load().then(function () {
      var total = chapters.length;
      var read = chapters.filter(function (c) { return Progress.isRead(c.slug); }).length;
      var words = Vocab.all();
      var ids = allCardIds();
      var stats = Progress.cardStats(ids);
      var due = Progress.dueCount(ids);

      var html =
        '<h1>Progress</h1>' +
        '<p class="lead">' + (Sync.connected()
          ? 'Kept in this browser and mirrored to your private gist.'
          : 'Everything here lives in this browser only. Nothing is uploaded.') + '</p>' +
        '<div class="stat-grid">' +
          stat('<a href="#/stats" style="color:inherit;text-decoration:none">' +
            pctOf(chapters) + '%</a>', 'Course progress', 'accent') +
          stat(read + '<span style="font-size:1rem;color:var(--muted)"> / ' + total + '</span>', 'Lessons read', '') +
          stat(Progress.knownCount(), 'Words marked known', 'good') +
          stat(due, 'Cards due now', due ? 'warn' : '') +
          stat(Progress.streak(), 'Day streak', '') +
        '</div>' +
        '<p><a href="#/stats">Statistics →</a> for the same figures over time, day by day.</p>';

      html += '<h2>By part</h2>';
      manifest.parts.forEach(function (part) {
        var solid = part.chapters.filter(function (c) {
          return Progress.mastery(c.slug).level === 2;
        }).length;
        var pct = pctOf(part.chapters);
        html += '<h3>' + escapeHtml(part.numeral) + ' - ' + escapeHtml(part.title) + '</h3>' +
          '<p style="margin-bottom:.3rem;color:var(--muted);font-size:.88rem">' +
          marked(part.chapters) + ' of ' + part.chapters.length + ' marked, ' + solid +
          ' confident · ' + pct + '%</p>' +
          '<div class="bar"><span style="width:' + pct + '%"></span></div>';
      });

      html += '<h2>What you have understood</h2>' +
        '<p>Progress comes from these marks, not from how many lessons you have opened. ' +
        'You give them yourself at the end of a chapter test: <strong>confident</strong> ' +
        'counts a whole lesson, <strong>shaky</strong> counts half, and a lesson you have ' +
        'only read counts nothing until you have judged it. Reading one still ticks it in ' +
        'the sidebar.</p>' +
        '<div class="stat-grid">' +
          stat(Progress.masteryCount(2), 'Marked confident', 'good') +
          stat(Progress.masteryCount(1) - Progress.masteryCount(2), 'Marked shaky', 'warn') +
        '</div>';

      manifest.parts.forEach(function (part, pi) {
        if (part.reference) return;
        var solid = part.chapters.filter(function (c) { return Progress.mastery(c.slug).level === 2; }).length;
        var shaky = part.chapters.filter(function (c) { return Progress.mastery(c.slug).level === 1; }).length;
        var exam = Progress.testScore('part-' + (pi + 1));
        html += '<p style="margin:.7rem 0 .3rem"><strong>' + escapeHtml(part.numeral) + '</strong> - ' +
          solid + ' confident, ' + shaky + ' shaky, of ' + part.chapters.length + ' chapters' +
          (exam.runs ? ' · exam best ' + exam.best + '%' : '') + '</p>' +
          '<div class="bar"><span style="width:' +
          Math.round((solid / part.chapters.length) * 100) + '%"></span></div>';
      });
      html += '<p><a class="btn btn-primary btn-lg" href="#/tests" ' +
        'style="display:inline-block;text-decoration:none">Go to the tests</a></p>';

      html += '<h2>Flashcards</h2>' +
        '<p>Each word is two cards, Hebrew to English and back, scheduled ' +
        'separately. <strong>Got right</strong> counts every card you have ever ' +
        'answered correctly. <strong>Stuck</strong> is the stricter claim: still ' +
        'right after four reviews spread over at least a fortnight, which is what ' +
        'the boxes are for. The first number moves today; the second is the one ' +
        'that means you will still know the word next month.</p>' +
        '<div class="stat-grid">' +
          stat(stats.right, 'Got right at least once', stats.right ? 'accent' : '') +
          stat(stats.learned, 'Stuck (box 4+)', 'good') +
          stat(stats.fresh, 'Never seen', '') +
          stat(Progress.reviewsToday(), 'Reviews today', 'accent') +
        '</div>' +
        '<p><a class="btn btn-primary btn-lg" href="#/cards" style="display:inline-block;text-decoration:none">Go to the decks</a></p>';

      html += '<h2>Vocabulary</h2><p>' + words.length + ' words in the list' +
        (Vocab.mine().length ? ', ' + Vocab.mine().length + ' of them yours' : '') + '. ' +
        Progress.knownCount() + ' marked as known.</p>' +
        '<div class="bar"><span style="width:' +
        Math.round((Progress.knownCount() / words.length) * 100) + '%"></span></div>';

      html += '<h2 id="offline">Offline</h2><div id="offlineBox"></div>';

      html += '<h2>Sync across devices</h2><div id="syncCard"></div>';

      html += '<h2>Your data</h2>' +
        '<p>Progress is stored under the key <code>hamachberet.v1</code> in this browser. ' +
        'Export it if you want to move to another machine.</p>' +
        '<p><button class="btn" id="exportBtn">Export progress</button> ' +
        '<button class="btn" id="importBtn">Import progress</button> ' +
        '<button class="btn btn-again" id="resetBtn">Reset everything</button></p>' +
        '<input type="file" id="importFile" accept="application/json" hidden>';

      view.innerHTML = html;
      renderSyncCard();
      renderOfflineBox();

      document.getElementById('exportBtn').addEventListener('click', function () {
        var blob = new Blob([Progress.exportJSON()], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'hamachberet-progress.json';
        a.click();
        URL.revokeObjectURL(a.href);
      });
      var file = document.getElementById('importFile');
      document.getElementById('importBtn').addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () {
        var f = file.files[0];
        if (!f) return;
        f.text().then(function (t) {
          try { Progress.importJSON(t); renderDashboard(); }
          catch (e) { alert('That file could not be read: ' + e.message); }
        });
      });
      document.getElementById('resetBtn').addEventListener('click', function () {
        if (confirm('Erase all progress, scores and flashcard scheduling?')) {
          Progress.reset();
          renderDashboard();
        }
      });
    });
  }

  /* ---------------------------------------------------------- sync card */

  var TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=HaMachberet';

  function renderOfflineBox() {
    var box = document.getElementById('offlineBox');
    if (!box) return;

    function paint() {
      var st = Offline.state;
      var body;

      if (st.embedded) {
        body = '<p style="color:var(--vert);font-weight:600">✓ This is the standalone file.</p>' +
          '<p>Every lesson, test, reading passage and all 1,493 words are inside this one HTML ' +
          'file. It needs no server and no network, ever.</p>';
      } else if (!st.supported || !window.isSecureContext) {
        body = '<p>Offline storage needs the page served over <strong>https</strong> (or from ' +
          'localhost). On a plain <code>http://</code> or <code>file://</code> address the ' +
          'browser will not allow it.</p>' +
          '<p>Use the published site, or <code>hamachberet-offline.html</code>, which needs none ' +
          'of this.</p>';
      } else if (st.caching) {
        var pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
        body = '<p>Saving the course to this device - <strong>' + st.done + ' / ' + st.total +
          '</strong> files.</p><div class="bar"><span style="width:' + pct + '%"></span></div>' +
          '<p style="font-size:.88rem;color:var(--muted)">Stay on this page until it finishes.</p>';
      } else if (st.ready) {
        // st.done is what the cache actually holds; st.total is only the
        // required subset, so it under-reports by the ~47 test banks.
        var stored = Math.max(st.done, st.total);
        body = '<p style="color:var(--vert);font-weight:600;font-size:1.05rem">' +
          '✓ Ready to go offline.</p>' +
          '<p>All ' + stored + ' files are stored on this device - every lesson, every test, ' +
          'the reading passages and the whole vocabulary. Turn the network off and it all still ' +
          'works. Your progress was already local, so nothing changes there.</p>';
      } else {
        body = '<p><strong>Not saved to this device yet.</strong></p>' +
          '<p>Stay on the page a few seconds while you still have signal, or press the button ' +
          'below. It is about 1 MB.</p>';
      }

      var actions = (!st.embedded && st.supported && window.isSecureContext)
        ? '<p><button class="btn' + (st.ready ? '' : ' btn-primary') + '" id="recacheBtn">' +
          (st.ready ? 'Refresh the offline copy' : 'Save for offline now') +
          '</button> <span id="storageInfo" style="font-size:.85rem;color:var(--muted)"></span></p>'
        : '';

      box.innerHTML = body + actions;

      var btn = document.getElementById('recacheBtn');
      if (btn) btn.addEventListener('click', function () { Offline.recache(); });

      Offline.estimate().then(function (e) {
        var el = document.getElementById('storageInfo');
        if (el && e && e.usage) {
          el.textContent = Math.round(e.usage / 1024) + ' KB used on this device';
        }
      });
    }

    Offline.on(paint);
    paint();
    Offline.status();
  }

  function renderSyncCard() {
    var host = document.getElementById('syncCard');
    if (!host) return;
    var s = Sync.info();

    if (!s.connected) {
      host.innerHTML =
        '<p>The course keeps your progress in the browser, which is why the phone and the ' +
        'laptop each start from zero. Point both at one private GitHub gist and they stay in ' +
        'step: whichever device studied last wins, entry by entry, so neither session is lost.</p>' +
        '<ol class="sync-steps">' +
          '<li><a href="' + TOKEN_URL + '" target="_blank" rel="noopener">Create a token</a> with the ' +
            '<strong>gist</strong> scope ticked and nothing else.</li>' +
          '<li>Paste it here. It is stored in this browser and sent only to api.github.com.</li>' +
          '<li>Repeat on your other device - the same gist is found automatically.</li>' +
        '</ol>' +
        '<p class="sync-note">The gist is private, so the progress can only be read or ' +
        'changed by something holding this token. Note that a <code>gist</code>-scoped token ' +
        'covers <em>all</em> your gists, not just this one: keep the expiry short-ish, and ' +
        'revoke it on GitHub if a device goes missing.</p>' +
        '<div class="sync-form">' +
          '<input type="password" id="syncToken" placeholder="ghp_… or github_pat_…" autocomplete="off" spellcheck="false">' +
          '<button class="btn btn-primary" id="syncConnect">Connect</button>' +
        '</div>' +
        '<p class="sync-note" id="syncMsg"></p>';

      var input = document.getElementById('syncToken');
      var msg = document.getElementById('syncMsg');
      var go = function () {
        var token = input.value;
        input.value = '';
        msg.textContent = 'Connecting…';
        Sync.connect(token)
          .then(function () { renderDashboard(); })
          .catch(function (err) { msg.textContent = err.message; });
      };
      document.getElementById('syncConnect').addEventListener('click', go);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      return;
    }

    var label = { ok: 'In sync', idle: 'Connected', syncing: 'Syncing…', error: 'Sync failed', off: 'Off' };
    host.innerHTML =
      '<p class="sync-state sync-' + s.status.state + '">' +
        '<span class="sync-dot"></span>' + (label[s.status.state] || 'Connected') +
        (s.lastSync ? ' · last synced ' + timeAgo(s.lastSync) : '') +
      '</p>' +
      (s.status.state === 'error' ? '<p class="sync-note">' + escapeHtml(s.status.message) + '</p>' : '') +
      '<p>Progress is mirrored to the private gist ' +
        '<a href="https://gist.github.com/' + escapeHtml(s.gistId) + '" target="_blank" rel="noopener">' +
        escapeHtml(s.gistId.slice(0, 8)) + '…</a>, on load and a few seconds after anything changes.</p>' +
      '<p><button class="btn" id="syncNow">Sync now</button> ' +
      '<button class="btn" id="syncOff">Disconnect this device</button></p>' +
      '<p class="sync-note">Disconnecting forgets the token here. The gist and your progress stay.</p>';

    document.getElementById('syncNow').addEventListener('click', function () {
      Sync.syncNow().then(function () { renderDashboard(); });
    });
    document.getElementById('syncOff').addEventListener('click', function () {
      Sync.disconnect();
      renderDashboard();
    });
  }

  function timeAgo(ts) {
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    var days = Math.round(s / 86400);
    return days === 1 ? 'yesterday' : days + ' days ago';
  }

  function stat(num, label, kind) {
    return '<div class="stat ' + (kind || '') + '">' +
      '<div class="stat-num">' + num + '</div>' +
      '<div class="stat-label">' + escapeHtml(label) + '</div></div>';
  }

  /* ---------------------------------------------------------- statistics */

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  // Days are counted as whole local days, the same way the streak counts
  // them, so a chart and the streak never disagree about what "yesterday" is.
  function dayKeyOf(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function dayNum(key) {
    var p = key.split('-');
    return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }

  function keyOfDayNum(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function fmtDay(key) {
    var p = key.split('-');
    return (+p[2]) + ' ' + MONTHS[+p[1] - 1];
  }

  function fmtWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var age = Date.now() - ts;
    if (age < 7 * 86400000) return timeAgo(ts);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    var step = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var mult = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < mult.length; i++) {
      if (step * mult[i] >= v) return step * mult[i];
    }
    return step * 10;
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  /* One chart function for every line on this page. `sets` is a list of
     { label, cls, points: [{ day, v }] }, oldest point first. The x axis is
     real time, not the index of a point, so a fortnight of doing nothing
     looks like a fortnight. */
  function lineChart(sets, opts) {
    opts = opts || {};
    sets = sets.filter(function (s) { return s.points.length; });
    if (!sets.length) return '';
    // L leaves room for the widest y label at the size it grows to on a
    // phone, where the whole viewBox is scaled to about half.
    var W = 720, H = 210, L = 50, R = 12, T = 14, B = 30;

    var all = sets.reduce(function (a, s) { return a.concat(s.points); }, []);
    var x0 = Math.min.apply(null, all.map(function (p) { return dayNum(p.day); }));
    var x1 = Math.max.apply(null, all.map(function (p) { return dayNum(p.day); }));
    // A single day still needs a width, or every point sits on one pixel.
    if (x1 <= x0) x0 = x1 - 1;
    var top = opts.max || niceMax(Math.max.apply(null, all.map(function (p) { return p.v; })));

    function px(day) { return L + (dayNum(day) - x0) / (x1 - x0) * (W - L - R); }
    function py(v) { return T + (1 - Math.min(v, top) / top) * (H - T - B); }

    var svg = '';
    [0, 0.5, 1].forEach(function (f) {
      var y = py(top * f);
      svg += '<line class="chart-grid" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>' +
        '<text class="chart-tick" x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' +
        round1(top * f) + (opts.suffix || '') + '</text>';
    });

    sets.forEach(function (s) {
      var pts = s.points.map(function (p) { return px(p.day).toFixed(1) + ' ' + py(p.v).toFixed(1); });
      var line = 'M' + pts.join(' L');
      if (s.points.length > 1) {
        svg += '<path class="chart-area ' + s.cls + '" d="' + line +
          ' L' + px(s.points[s.points.length - 1].day).toFixed(1) + ' ' + py(0) +
          ' L' + px(s.points[0].day).toFixed(1) + ' ' + py(0) + ' Z"/>';
      }
      svg += '<path class="chart-line ' + s.cls + '" d="' + line + '"/>';
      var last = s.points[s.points.length - 1];
      svg += '<circle class="chart-dot ' + s.cls + '" cx="' + px(last.day).toFixed(1) +
        '" cy="' + py(last.v).toFixed(1) + '" r="3.5"/>';
    });

    var labels = [keyOfDayNum(x0), keyOfDayNum(x1)];
    if (x1 - x0 > 40) labels.splice(1, 0, keyOfDayNum(Math.round((x0 + x1) / 2)));
    labels.forEach(function (key, i) {
      svg += '<text class="chart-tick" x="' + px(key).toFixed(1) + '" y="' + (H - 8) +
        '" text-anchor="' + (i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle') +
        '">' + fmtDay(key) + '</text>';
    });

    var legend = sets.length > 1 || opts.legend
      ? '<p class="chart-legend">' + sets.map(function (s) {
          return '<span class="' + s.cls + '"><i></i>' + escapeHtml(s.label) + '</span>';
        }).join('') + '</p>'
      : '';

    return legend + '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      escapeHtml(sets.map(function (s) {
        return s.label + ': ' + round1(s.points[s.points.length - 1].v) + (opts.suffix || '');
      }).join(', ')) + '">' + svg + '</svg>';
  }

  /* Half a year of days, one square each, darker the more you did. */
  function heatmap(counts) {
    var WEEKS = 26, CELL = 13, GAP = 3, STEP = CELL + GAP, TOP = 14;
    var W = WEEKS * STEP - GAP, H = TOP + 7 * STEP - GAP;
    var now = new Date();
    var todayN = dayNum(dayKeyOf(now.getTime()));
    var startN = todayN - now.getDay() - (WEEKS - 1) * 7;

    var cells = '', months = '', lastMonth = -1, active = 0, reviews = 0;
    for (var w = 0; w < WEEKS; w++) {
      var weekStart = startN + w * 7;
      var m = new Date(weekStart * 86400000).getUTCMonth();
      if (m !== lastMonth && w < WEEKS - 1) {
        months += '<text class="chart-tick" x="' + (w * STEP) + '" y="9">' + MONTHS[m] + '</text>';
        lastMonth = m;
      }
      for (var d = 0; d < 7; d++) {
        var n = weekStart + d;
        if (n > todayN) continue;
        var key = keyOfDayNum(n);
        var c = counts[key] || 0;
        if (c) { active++; reviews += c; }
        var level = !c ? 0 : c < 3 ? 1 : c < 10 ? 2 : c < 25 ? 3 : 4;
        cells += '<rect class="hm-cell hm-' + level + '" x="' + (w * STEP) + '" y="' +
          (TOP + d * STEP) + '" width="' + CELL + '" height="' + CELL + '" rx="3">' +
          '<title>' + fmtDay(key) + ': ' + (c ? c + (c === 1 ? ' review' : ' reviews') : 'nothing') +
          '</title></rect>';
      }
    }

    return '<svg class="heatmap" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="Activity over the last 26 weeks: ' + active + ' days studied, ' +
      reviews + ' reviews">' + months + cells + '</svg>' +
      '<p class="hm-legend">Fewer' +
      [0, 1, 2, 3, 4].map(function (l) { return '<i class="hm-' + l + '"></i>'; }).join('') +
      'More · <strong>' + active + '</strong> day' + (active === 1 ? '' : 's') +
      ' studied here, <strong>' + reviews + '</strong> answers</p>';
  }

  // The longest run of consecutive studied days ever, not only the current one.
  function longestStreak(counts) {
    var keys = Object.keys(counts).filter(function (k) { return counts[k]; }).sort();
    var best = 0, run = 0, prev = null;
    keys.forEach(function (k) {
      var n = dayNum(k);
      run = prev !== null && n === prev + 1 ? run + 1 : 1;
      prev = n;
      if (run > best) best = run;
    });
    return best;
  }

  function renderStats() {
    setCurrentNav('stats');
    pager.innerHTML = '';
    view.innerHTML = '<div class="loading">Adding it all up…</div>';

    Vocab.load().then(function () {
      var total = chapters.length;
      var words = Vocab.all();
      var cs = Progress.cardStats(allCardIds());
      var hist = Progress.history();
      var days = Progress.dayCounts();
      var todayKey = dayKeyOf(Date.now());

      /* -- course progress over time. Every chapter carries the time you
            last marked it, so the curve can be drawn for days before this
            page existed. It is the marks you hold *now*, each placed on the
            day you gave it: re-marking a chapter moves its step along. */
      var marks = [];
      chapters.forEach(function (ch) {
        var m = Progress.mastery(ch.slug);
        if (m.level && m.at) marks.push({ at: m.at, credit: m.level === 2 ? 1 : 0.5 });
      });
      marks.sort(function (a, b) { return a.at - b.at; });
      var byDay = {}, run = 0;
      marks.forEach(function (m) { run += m.credit; byDay[dayKeyOf(m.at)] = run; });
      var markDays = Object.keys(byDay).sort();
      var curve = [];
      if (markDays.length) {
        curve.push({ day: keyOfDayNum(dayNum(markDays[0]) - 1), v: 0 });
        markDays.forEach(function (k) { curve.push({ day: k, v: byDay[k] / total * 100 }); });
        // Flat since the last mark is worth seeing, so the line runs to today.
        if (markDays[markDays.length - 1] !== todayKey) {
          curve.push({ day: todayKey, v: run / total * 100 });
        }
      }

      var html =
        '<h1>Statistics</h1>' +
        '<p class="lead">Where you have got to, and how you got there. Worked out from what ' +
        'is already stored on this device, so nothing here is tracked anywhere else.</p>' +
        '<div class="stat-grid">' +
          stat(pctOf(chapters) + '%', 'Course progress', 'accent') +
          stat(solidOf(chapters), 'Chapters confident', 'good') +
          stat(marked(chapters) - solidOf(chapters), 'Chapters shaky', 'warn') +
          stat(Progress.knownCount(), 'Words you know', 'good') +
          stat(Progress.streak(), 'Day streak', '') +
        '</div>';

      html += '<h2>Course progress over time</h2>';
      if (curve.length) {
        html += '<p>Confident counts a whole chapter, shaky counts half, out of ' + total +
          '. Each chapter steps up on the day you last marked it.</p>' +
          lineChart([{ label: 'Course progress', cls: 'c-bleu', points: curve }],
            { max: 100, suffix: '%' });
      } else {
        html += '<p class="stats-empty">Nothing to plot yet. Take a chapter test and mark ' +
          'yourself at the end, and the line starts here. ' +
          '<a href="#/tests">Go to the tests</a>.</p>';
      }

      /* -- words. The ticks in the vocabulary list are the direct claim;
            the flashcards are the evidence, and disagree with it on purpose. */
      html += '<h2>Words you know</h2>' +
        '<p>Three different claims, deliberately. <strong>Ticked known</strong> is you saying ' +
        'so in the list. <strong>Right at least once</strong> counts flashcards you have ever ' +
        'answered correctly. <strong>Stuck</strong> is the strict one: still right after four ' +
        'reviews spread over a fortnight or more.</p>' +
        '<div class="stat-grid">' +
          stat(Progress.knownCount() + '<span class="stat-of"> / ' + words.length + '</span>',
            'Ticked known', 'good') +
          stat(cs.right, 'Right at least once', cs.right ? 'accent' : '') +
          stat(cs.learned, 'Stuck (box 4+)', 'good') +
          stat(Vocab.mine().length, 'Words you added', '') +
        '</div>' +
        '<div class="bar"><span style="width:' +
        Math.round((Progress.knownCount() / (words.length || 1)) * 100) + '%"></span></div>';

      var knownSeries = hist.map(function (h) { return { day: h.day, v: h.known }; });
      var stuckSeries = hist.map(function (h) { return { day: h.day, v: h.stuck }; });
      if (hist.length > 1) {
        html += '<h3>Words over time</h3>' +
          lineChart([
            { label: 'Ticked known', cls: 'c-vert', points: knownSeries },
            { label: 'Stuck flashcards', cls: 'c-bleu', points: stuckSeries }
          ], {});
      } else {
        html += '<p class="stats-empty">A tick in the list and a flashcard box carry no date ' +
          'of their own, so these two are counted once a day from now on. Come back tomorrow ' +
          'and there is a line here.</p>';
      }

      // Which themes you have actually got through, rather than how big they are.
      var themes = {};
      words.forEach(function (w) {
        (w.themes.length ? w.themes : ['general']).forEach(function (t) {
          var row = themes[t] || (themes[t] = { total: 0, known: 0 });
          row.total++;
          if (Progress.isKnown(w.id)) row.known++;
        });
      });
      var themeRows = Object.keys(themes).map(function (t) {
        return { theme: t, total: themes[t].total, known: themes[t].known,
                 pct: Math.round(themes[t].known / themes[t].total * 100) };
      }).filter(function (r) { return r.known; })
        .sort(function (a, b) { return b.pct - a.pct || b.known - a.known; });

      if (themeRows.length) {
        html += '<h3>By theme</h3><div class="stats-rows">' +
          themeRows.slice(0, 12).map(function (r) {
            return '<div class="stats-row"><span class="sr-name">' + escapeHtml(r.theme) + '</span>' +
              '<span class="sr-bar"><i style="width:' + r.pct + '%"></i></span>' +
              '<span class="sr-num">' + r.known + ' / ' + r.total + '</span></div>';
          }).join('') + '</div>' +
          (themeRows.length > 12 ? '<p class="stats-note">' + (themeRows.length - 12) +
            ' more themes started.</p>' : '');
      }

      /* -- activity */
      var totalReviews = Object.keys(days).reduce(function (a, k) { return a + days[k]; }, 0);
      var activeDays = Object.keys(days).filter(function (k) { return days[k]; }).length;
      html += '<h2>Activity</h2>' +
        '<p>One square a day. It counts answers: exercises, flashcard grades and test ' +
        'questions, whatever you were working on.</p>' +
        heatmap(days) +
        '<div class="stat-grid">' +
          stat(Progress.streak(), 'Day streak', Progress.streak() ? 'accent' : '') +
          stat(longestStreak(days), 'Longest streak', '') +
          stat(activeDays, 'Days studied', '') +
          stat(totalReviews, 'Answers given', '') +
          stat(Progress.reviewsToday(), 'Today', Progress.reviewsToday() ? 'good' : '') +
        '</div>';

      /* -- tests */
      var runs = [];
      chapters.forEach(function (ch) {
        var t = Progress.testScore(ch.slug);
        if (t.runs) runs.push({ name: ch.title, href: '#/test/' + ch.slug, t: t,
                                level: Progress.mastery(ch.slug).level });
      });
      manifest.parts.forEach(function (part, i) {
        var id = 'part-' + (i + 1);
        var t = Progress.testScore(id);
        if (t.runs) runs.push({ name: part.numeral + ' exam', href: '#/test/' + id, t: t,
                                level: Progress.mastery(id).level });
      });
      runs.sort(function (a, b) { return b.t.at - a.t.at; });

      html += '<h2>Tests you have taken</h2>';
      if (runs.length) {
        var avg = Math.round(runs.reduce(function (a, r) { return a + r.t.best; }, 0) / runs.length);
        var attempts = runs.reduce(function (a, r) { return a + r.t.runs; }, 0);
        // Part IV is reference: its chapters have no test, and there is no
        // exam for it, so counting them would make the total unreachable.
        var testable = chapters.filter(function (c) { return !c.part.reference; }).length +
          manifest.parts.filter(function (part) { return !part.reference; }).length;
        html += '<div class="stat-grid">' +
          stat(runs.length + '<span class="stat-of"> / ' + testable + '</span>',
            'Tests attempted', 'accent') +
          stat(attempts, 'Attempts in total', '') +
          stat(avg + '%', 'Average of your bests', avg >= 80 ? 'good' : '') +
        '</div>' +
        '<div class="stats-rows">' + runs.slice(0, 20).map(function (r) {
          var mark = ['-', 'shaky', 'confident'][r.level];
          return '<div class="stats-row"><a class="sr-name" href="' + r.href + '">' +
            escapeHtml(r.name) + '</a>' +
            '<span class="sr-bar"><i class="lv' + r.level + '" style="width:' + r.t.best + '%"></i></span>' +
            '<span class="sr-num">' + r.t.best + '%</span>' +
            '<span class="sr-when">' + escapeHtml(mark) + ' · ' + escapeHtml(fmtWhen(r.t.at)) + '</span>' +
            '</div>';
        }).join('') + '</div>' +
        (runs.length > 20 ? '<p class="stats-note">' + (runs.length - 20) + ' more.</p>' : '');
      } else {
        html += '<p class="stats-empty">No test taken yet. ' +
          '<a href="#/tests">Pick one</a> and this fills in: best score, how many goes, ' +
          'and the mark you gave yourself.</p>';
      }

      /* -- what happened lately. Words added on the same day are one line,
            or a batch paste would be the whole feed. */
      var events = [];
      chapters.forEach(function (ch) {
        var m = Progress.mastery(ch.slug);
        if (m.level && m.at) {
          events.push({ at: m.at, icon: m.level === 2 ? '✔' : '~',
            text: 'Marked <strong>' + (m.level === 2 ? 'confident' : 'shaky') + '</strong>: ' +
              '<a href="#/' + ch.slug + '">' + escapeHtml(ch.title) + '</a>' });
        }
      });
      manifest.parts.forEach(function (part, i) {
        var m = Progress.mastery('part-' + (i + 1));
        if (m.level && m.at) {
          events.push({ at: m.at, icon: '★',
            text: 'Marked the ' + escapeHtml(part.numeral) + ' exam <strong>' +
              (m.level === 2 ? 'confident' : 'shaky') + '</strong>' });
        }
      });
      var wordDays = {};
      Progress.words().forEach(function (w) {
        var k = dayKeyOf(w.at);
        var row = wordDays[k] || (wordDays[k] = { at: w.at, list: [] });
        row.at = Math.max(row.at, w.at);
        row.list.push(w.he);
      });
      Object.keys(wordDays).forEach(function (k) {
        var row = wordDays[k];
        events.push({ at: row.at, icon: '+',
          text: 'Added ' + row.list.length + ' word' + (row.list.length === 1 ? '' : 's') +
            ': <em>' + escapeHtml(row.list.slice(0, 4).join(', ')) + '</em>' +
            (row.list.length > 4 ? ' and ' + (row.list.length - 4) + ' more' : '') });
      });
      events.sort(function (a, b) { return b.at - a.at; });

      if (events.length) {
        html += '<h2>Lately</h2><ul class="stats-feed">' +
          events.slice(0, 14).map(function (e) {
            return '<li><span class="sf-icon">' + e.icon + '</span>' +
              '<span class="sf-text">' + e.text + '</span>' +
              '<span class="sf-when">' + escapeHtml(fmtWhen(e.at)) + '</span></li>';
          }).join('') + '</ul>';
      }

      html += '<p><a class="btn btn-lg" href="#/dashboard" ' +
        'style="display:inline-block;text-decoration:none">Progress and your data</a></p>';

      view.innerHTML = html;
    });
  }

  /* ---------------------------------------------------------- vocabulary */

  // What the toolbar was set to. Adding or correcting a word redraws the
  // whole page, and coming back to an unfiltered list of every word when
  // you had narrowed it to one is the wrong place to be put.
  var vocabView = { q: '', theme: 'all', pos: 'all', status: 'all' };

  function renderVocabPage() {
    setCurrentNav('vocab');
    pager.innerHTML = '';
    view.innerHTML = '<div class="loading">Loading vocabulary…</div>';

    Vocab.load().then(function () {
      var themeOpts = ['<option value="all">All themes</option>'].concat(
        Vocab.themes().map(function (t) {
          return '<option value="' + t + '">' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
        })).join('');
      var posOpts = ['<option value="all">Any type</option>'].concat(
        Object.keys(Vocab.POS_LABEL).map(function (p) {
          return '<option value="' + p + '">' + Vocab.POS_LABEL[p] + '</option>';
        })).join('');

      view.innerHTML =
        '<h1>Vocabulary</h1>' +
        '<p class="lead">' + Vocab.all().length + ' words, with gender, transliteration and theme, ' +
        Vocab.mine().length + ' of them added by you' +
        (Progress.editCount() ? ', ' + Progress.editCount() + ' corrected by you' : '') +
        '. Tap the <span class="v-know-demo">✓</span> ' +
        'at the left of a row when you know a word; it turns green and counts on the ' +
        '<a href="#/dashboard">Progress</a> page. Use <em>Not yet known</em> to hide the ones ' +
        'you have already ticked.</p>' +
        '<div class="vocab-toolbar">' +
          '<input type="search" id="vq" dir="auto" ' +
            'placeholder="Search Hebrew, transliteration or English\u2026" autocomplete="off">' +
          '<select id="vtheme">' + themeOpts + '</select>' +
          '<select id="vpos">' + posOpts + '</select>' +
          '<select id="vstatus">' +
            '<option value="all">All</option>' +
            '<option value="unknown">Not yet known</option>' +
            '<option value="known">Known</option>' +
            '<option value="mine">My words</option>' +
          '</select>' +
          '<button class="btn btn-primary" id="vadd">+ Add word</button>' +
          '<span class="vocab-count" id="vcount"></span>' +
        '</div>' +
        '<div id="vform"></div>' +
        '<div id="vlist"></div>';

      var q = document.getElementById('vq');
      var theme = document.getElementById('vtheme');
      var pos = document.getElementById('vpos');
      var status = document.getElementById('vstatus');
      var list = document.getElementById('vlist');
      var count = document.getElementById('vcount');

      q.value = vocabView.q;
      // A theme can go away when the last word in it is retagged, so a
      // stale choice falls back to "all" rather than showing nothing.
      [[theme, 'theme'], [pos, 'pos'], [status, 'status']].forEach(function (pair) {
        var el = pair[0], want = vocabView[pair[1]];
        el.value = want;
        if (el.value !== want) el.value = 'all';
      });

      function refresh() {
        var words = Vocab.search(q.value, {
          theme: theme.value, pos: pos.value, status: status.value
        });
        // Long lists stay responsive if we only paint the first slice.
        var shown = words.slice(0, 400);
        list.innerHTML = Vocab.listHtml(shown) +
          (words.length > shown.length
            ? '<p style="text-align:center;color:var(--muted);font-size:.85rem;margin-top:1rem">' +
              'Showing the first ' + shown.length + ' of ' + words.length + ' - narrow the search to see the rest.</p>'
            : '');
        count.textContent = words.length + ' word' + (words.length === 1 ? '' : 's');
        Say.hydrate(list);
      }

      [q, theme, pos, status].forEach(function (el) {
        el.addEventListener('input', function () {
          vocabView = { q: q.value, theme: theme.value, pos: pos.value, status: status.value };
          refresh();
        });
      });
      Vocab.bindList(list);

      var form = new WordForm(document.getElementById('vform'), function () {
        // A new word changes the counts and the theme list, so the whole
        // page is cheaper to redraw than to patch.
        renderVocabPage();
      });
      document.getElementById('vadd').addEventListener('click', function () { form.open(null); });
      list.addEventListener('vocab:edit', function (e) { form.open(e.detail.id); });

      refresh();
    });
  }

  // The vocabulary blocks inside a lesson are the same rows as the browser,
  // so their edit button has to lead somewhere too. Each block gets its own
  // form, opening under the block you tapped in, and only that block is
  // redrawn afterwards.
  function bindEmbedEdits(root) {
    root.querySelectorAll('.vocab-embed').forEach(function (el) {
      var host = document.createElement('div');
      var form = new WordForm(host, function () {
        Vocab.fillEmbed(el);
        // Refilling the block took the form host with it.
        el.appendChild(host);
        Say.hydrate(el);
      });
      el.appendChild(host);
      el.addEventListener('vocab:edit', function (e) { form.open(e.detail.id); });
    });
  }

  /* ---------------------------------------------------------- add a word */

  // One panel, three jobs: add, edit, and paste a whole list. Kept small
  // enough to use one-handed, because words turn up away from the desk.
  function WordForm(host, onChange) {
    var editing = null;
    var curated = false;    // editing a word the course shipped, not one of yours
    var dirty = false;      // words were added while the panel stayed open

    function close() {
      host.innerHTML = '';
      if (dirty) { dirty = false; onChange(); }
    }

    function open(id) {
      editing = id || null;
      // A "w" id is a word the site shipped, a "u" id is one you added.
      // Both are edited in this form; only where the change is stored
      // differs, and only the curated one can be put back as it was.
      curated = !!editing && editing.charAt(0) === 'w';
      var w = null;
      if (editing) {
        w = curated ? Vocab.byId(editing) : Progress.getWord(editing);
        if (!w) return;
      }
      var reverts = curated && !!Progress.getEdit(editing);

      host.innerHTML =
        '<div class="word-form">' +
          '<div class="word-form-head">' +
            '<strong>' + (editing ? 'Edit word' : 'Add a word') + '</strong>' +
            '<button class="btn btn-sm" data-act="bulk">Paste a list</button>' +
            '<button class="btn btn-sm" data-act="close" aria-label="Close">✕</button>' +
          '</div>' +
          '<div class="word-fields">' +
            '<label>Hebrew<input id="whe" dir="auto" lang="he" value="' + escapeAttr(w ? w.he : '') +
              '" placeholder="\u05e9\u05bb\u05c1\u05dc\u05b0\u05d7\u05b8\u05df" ' +
              'autocomplete="off" spellcheck="false"></label>' +
            '<label>English<input id="wen" value="' + escapeAttr(w ? w.en : '') +
              '" placeholder="table" autocomplete="off"></label>' +
          '</div>' +
          (curated
            ? '<p class="sync-note">This one came with the course. Your correction is kept ' +
              'with your progress and follows you to your other devices; the shipped entry is ' +
              'left alone, so you can put it back at any time.</p>'
            : '') +
          '<details class="word-more word-help">' +
            '<summary>How to write the Hebrew side</summary>' +
            '<ul class="word-help-list">' +
              '<li><code>\u05e9\u05bb\u05c1\u05dc\u05b0\u05d7\u05b8\u05df</code> a noun ' +
                'with its nikud; the gender is guessed from the ending, fix it below</li>' +
              '<li><code>\u05dc\u05b4\u05db\u05b0\u05ea\u05bc\u05d5\u05b9\u05d1</code> ' +
                'a verb is its infinitive</li>' +
              '<li><code>\u05d9\u05b8\u05e4\u05b6\u05d4 / \u05d9\u05b8\u05e4\u05b8\u05d4</code> ' +
                'an adjective: masculine, space, slash, space, feminine</li>' +
              '<li><code>\u05de\u05b7\u05d4 \u05e0\u05b4\u05e9\u05c1\u05b0\u05de\u05b8\u05e2</code> ' +
                'a phrase, written as you would say it</li>' +
            '</ul>' +
            '<p class="word-help-note">Nikud is optional on your own words: grading never ' +
            'needs it, and neither does the search.</p>' +
          '</details>' +
          // Two fields are the whole job. Type, gender and theme are worked
          // out from the Hebrew, and a word with no theme lands in "mine",
          // which is a real deck you can revise from on its own.
          '<p class="word-auto" id="wauto"></p>' +
          '<details class="word-more"' + (editing ? ' open' : '') + '>' +
            '<summary>Change what it guessed</summary>' +
            '<div class="word-fields">' +
              '<label>Type<select id="wpos">' + posOptions(w ? w.pos : '', !editing) + '</select></label>' +
              '<label>Gender<select id="wg">' + genderOptions(w ? w.g : '') + '</select></label>' +
              '<label>Transliteration<input id="wtr" value="' + escapeAttr(w ? (w.tr || '') : '') +
                '" placeholder="shulkhan" autocomplete="off" spellcheck="false"></label>' +
              '<label>Binyan<select id="wbinyan">' + binyanOptions(w ? (w.binyan || '') : '') +
                '</select></label>' +
              '<label>Themes<input id="wth" value="' + escapeAttr(w ? w.themes.join(', ') : '') +
                '" placeholder="leave empty for \u201cmine\u201d" autocomplete="off"></label>' +
            '</div>' +
          '</details>' +
          '<p class="word-msg" id="wmsg" hidden></p>' +
          '<div class="word-actions">' +
            '<button class="btn btn-primary" data-act="save">' + (editing ? 'Save' : 'Add word') + '</button>' +
            (editing && !curated ? '<button class="btn btn-again" data-act="delete">Delete</button>' : '') +
            (reverts ? '<button class="btn" data-act="revert">Put the original back</button>' : '') +
          '</div>' +
        '</div>';

      var he = host.querySelector('#whe');
      var en = host.querySelector('#wen');

      // Show the guess as it is typed, so nothing is decided behind your
      // back and there is no field to fill in when it is already right.
      if (!editing) {
        var auto = host.querySelector('#wauto');
        var show = function () {
          var g = Vocab.guess(he.value, en.value);
          var th = host.querySelector('#wth').value.split(/[,\s]+/).filter(Boolean);
          if (!he.value.trim()) { auto.textContent = ''; return; }
          auto.textContent = 'Filed as ' +
            (g.g ? { m: 'masculine', f: 'feminine', pl: 'plural', mf: 'either-gender' }[g.g] + ' ' : '') +
            (Vocab.POS_LABEL[g.pos] || g.pos) +
            ' (guessed from the ending), theme ' + (th.length ? th.join(' \u00b7 ') : 'mine') +
            '. Change it if wrong.';
        };
        he.addEventListener('input', show);
        en.addEventListener('input', show);
        host.querySelector('#wth').addEventListener('input', show);
      }

      host.querySelector('.word-form').addEventListener('click', onClick);
      host.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); }
        if (e.key === 'Escape') close();
      });
      he.focus();
      host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function onClick(e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') return close();
      if (b.dataset.act === 'bulk') return openBulk();
      if (b.dataset.act === 'save') return save();
      if (b.dataset.act === 'delete') return remove();
      if (b.dataset.act === 'revert') return revert();
    }

    function msg(text, bad) {
      var el = host.querySelector('#wmsg');
      if (!el) return;
      el.textContent = text;
      el.hidden = !text;
      el.classList.toggle('is-bad', !!bad);
    }

    function save() {
      var input = {
        he: host.querySelector('#whe').value,
        en: host.querySelector('#wen').value,
        pos: host.querySelector('#wpos').value,
        g: host.querySelector('#wg').value,
        tr: host.querySelector('#wtr').value,
        binyan: host.querySelector('#wbinyan').value,
        themes: host.querySelector('#wth').value.split(/[,\s]+/).filter(Boolean)
      };
      // An untouched Type or Gender means "you work it out".
      var guess = Vocab.guess(input.he, input.en);
      if (!input.pos) input.pos = guess.pos;
      if (!input.g) input.g = guess.g;
      try {
        if (curated) {
          Progress.setEdit(editing, input);
        } else if (editing) {
          Progress.updateWord(editing, input);
        } else {
          var dupe = Progress.findWord(input.he);
          if (dupe) return msg('You already added that one.', true);
          Progress.addWord(input);
        }
      } catch (err) {
        return msg(err.message, true);
      }
      close();
      onChange();
    }

    function revert() {
      if (!confirm('Put the original entry back? Your correction is dropped, here and on your ' +
        'other devices. What you have marked known or revised is not affected.')) return;
      Progress.clearEdit(editing);
      close();
      onChange();
    }

    function remove() {
      if (!confirm('Delete this word? It disappears from your other devices too.')) return;
      Progress.deleteWord(editing);
      close();
      onChange();
    }

    function openBulk() {
      host.innerHTML =
        '<div class="word-form">' +
          '<div class="word-form-head">' +
            '<strong>Paste a list</strong>' +
            '<button class="btn btn-sm" data-act="close" aria-label="Close">✕</button>' +
          '</div>' +
          '<p class="sync-note">One word per line, <code>hebrew - english</code>. A leading ' +
          'number is ignored, and a pipe-separated line from <code>vocab-source.txt</code> ' +
          'pastes straight in, transliteration and all. Duplicates are skipped.</p>' +
          '<textarea id="wbulk" rows="8" spellcheck="false" dir="auto" lang="he" ' +
            'placeholder="\u05e9\u05bb\u05c1\u05dc\u05b0\u05d7\u05b8\u05df - table&#10;' +
            '\u05dc\u05b4\u05db\u05b0\u05ea\u05bc\u05d5\u05b9\u05d1 - to write"></textarea>' +
          '<p class="word-msg" id="wmsg" hidden></p>' +
          '<div class="word-actions">' +
            '<button class="btn btn-primary" data-act="import">Add them</button>' +
            '<button class="btn" data-act="export">Copy my words out</button>' +
          '</div>' +
        '</div>';

      host.querySelector('.word-form').addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'close') return close();
        if (b.dataset.act === 'export') {
          var text = Vocab.exportMine();
          if (!text) return msg('You have not added any words yet.', true);
          host.querySelector('#wbulk').value = text;
          return msg('Numbered from where vocab-source.txt left off. Copy, paste at the end of that ' +
            'file, then run tools/build-vocab.py to make them part of the curated list.');
        }
        var rows = Vocab.parseBulk(host.querySelector('#wbulk').value);
        if (!rows.length) return msg('Nothing there I could read as "hebrew - english".', true);
        var added = 0, skipped = 0;
        rows.forEach(function (r) {
          if (Progress.findWord(r.he)) { skipped++; return; }
          Progress.addWord(r);
          added++;
        });
        // Keep the panel open with the count rather than throwing up a
        // dialog: pasting several batches in a row is the normal case.
        // The page behind it redraws when the panel closes, because
        // redrawing now would tear this panel out of the document.
        dirty = true;
        host.querySelector('#wbulk').value = '';
        msg(added + ' added' + (skipped ? ', ' + skipped + ' already on your list' : '') + '.');
      });
    }

    return { open: open, close: close };
  }

  function posOptions(current, auto) {
    return (auto ? '<option value="" selected>work it out</option>' : '') +
      Object.keys(Vocab.POS_LABEL).map(function (p) {
      return '<option value="' + p + '"' + (p === current ? ' selected' : '') + '>' +
        Vocab.POS_LABEL[p] + '</option>';
    }).join('');
  }

  function binyanOptions(current) {
    var opts = [['', '\u2014 (not a verb)']].concat(
      Object.keys(Vocab.BINYAN_LABEL).map(function (b) { return [b, Vocab.BINYAN_LABEL[b]]; }));
    return opts.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === current ? ' selected' : '') + '>' +
        o[1] + '</option>';
    }).join('');
  }

  function genderOptions(current) {
    var opts = [['', '-'], ['m', 'masculine'], ['f', 'feminine'], ['pl', 'plural'], ['mf', 'either']];
    return opts.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === current ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
  }

  /* ---------------------------------------------------------- tests */

  var LEVEL_LABEL = ['Not yet', 'Shaky', 'Confident'];

  function renderTestList() {
    setCurrentNav('tests');
    pager.innerHTML = '';

    var html = '<h1>Tests</h1>' +
      '<p class="lead">A drill for each chapter, a longer exam for each part, and sets ' +
      'that cut across both. The score is automatic; whether you have actually got it is your call.</p>' +
      weakSpotHtml() +
      '<div id="groupBlock"></div>';

    manifest.parts.forEach(function (part, pi) {
      // Part IV is lookup tables. There is nothing there to be tested on.
      if (part.reference) return;
      var key = 'part-' + (pi + 1);
      var m = Progress.mastery(key);
      var score = Progress.testScore(key);
      html += '<h2>' + escapeHtml(part.numeral) + ' - ' + escapeHtml(part.title) + '</h2>' +
        '<p class="test-partline">' +
          '<a class="btn btn-primary" href="#/test/' + key + '">Take the ' + escapeHtml(part.numeral) + ' exam</a>' +
          (score.runs
            ? '<span class="test-best">best ' + score.best + '% over ' + score.runs +
              ' attempt' + (score.runs === 1 ? '' : 's') + '</span>'
            : '') +
          (m.level ? '<span class="mastery-tag lv' + m.level + '">' + LEVEL_LABEL[m.level] + '</span>' : '') +
        '</p>' +
        '<div class="test-grid">';

      part.chapters.forEach(function (ch) {
        var cm = Progress.mastery(ch.slug);
        var cs = Progress.testScore(ch.slug);
        html += '<a class="test-tile lv' + cm.level + '" href="#/test/' + ch.slug + '">' +
          '<span class="test-tile-name">' + escapeHtml(ch.title) + '</span>' +
          '<span class="test-tile-meta">' +
            (cs.runs ? 'best ' + cs.best + '%' : 'not taken') +
            (cm.level ? ' · ' + LEVEL_LABEL[cm.level] : '') +
          '</span></a>';
      });
      html += '</div>';
    });

    view.innerHTML = html;
    paintGroups();
  }

  // What you keep getting wrong, across every sitting. Only questions asked
  // more than once count: one bad answer is a slip, three out of four is a gap.
  function weakSpotHtml() {
    if (!Progress.weakSpots) return '';
    var weak = Progress.weakSpots(2).filter(function (w) { return w.rate >= 0.4; }).slice(0, 8);
    var sittings = Progress.runs ? Progress.runs().length : 0;
    if (!weak.length) {
      return sittings
        ? '<p class="test-weak-none">' + sittings + ' sitting' + (sittings === 1 ? '' : 's') +
          ' recorded, nothing repeatedly wrong. </p>'
        : '';
    }
    // A question id is "<chapter-slug>-NN", so the chapter is everything
    // before the last dash.
    var byCh = {};
    weak.forEach(function (w) {
      var slug = w.id.replace(/-\d+$/, '');
      byCh[slug] = (byCh[slug] || 0) + 1;
    });
    var chips = Object.keys(byCh).map(function (slug) {
      var ch = bySlug[slug];
      return '<a class="pill" href="#/test/' + slug + '">' +
        escapeHtml(ch ? ch.title : slug.replace(/-/g, ' ')) + ' · ' + byCh[slug] + '</a>';
    }).join(' ');
    return '<div class="test-weak"><h2>What keeps catching you</h2>' +
      '<p>' + weak.length + ' question' + (weak.length === 1 ? '' : 's') + ' you have got wrong ' +
      'more often than not, over ' + sittings + ' sitting' + (sittings === 1 ? '' : 's') + '.</p>' +
      '<p class="test-weak-chips">' + chips + '</p></div>';
  }

  function paintGroups() {
    var host = document.getElementById('groupBlock');
    if (!host || !Test.loadGroups) return;
    Test.loadGroups().then(function (groups) {
      if (!groups.length) return;
      // Only offer a set whose chapters this course actually has.
      var usable = groups.filter(function (g) {
        return g.chapters.some(function (slug) { return bySlug[slug]; });
      });
      if (!usable.length) return;
      host.innerHTML = '<h2>By subject</h2>' +
        '<p class="test-groupline">Sets that cross chapters, because mistakes do.</p>' +
        '<div class="test-grid">' +
        usable.map(function (g) {
          var key = 'group-' + g.id;
          var sc = Progress.testScore(key);
          return '<a class="test-tile" href="#/test/' + key + '">' +
            '<span class="test-tile-name">' + escapeHtml(g.title) + '</span>' +
            '<span class="test-tile-blurb">' + escapeHtml(g.blurb || '') + '</span>' +
            '<span class="test-tile-meta">' +
              (sc.runs ? 'best ' + sc.best + '%' : 'not taken') +
              ' · ' + g.chapters.length + ' chapters' +
            '</span></a>';
        }).join('') +
        '</div>';
    });
  }

  function renderTest(key) {
    setCurrentNav('tests');
    pager.innerHTML = '';
    view.innerHTML = '<div class="loading">Loading the questions…</div>';

    if (key.indexOf('group-') === 0) return startGroupTest(key, key.slice(6));

    var part = key.indexOf('part-') === 0 ? manifest.parts[Number(key.slice(5)) - 1] : null;
    if (part) return startPartTest(key, part);

    var ch = bySlug[key];
    if (!ch) return notFound(key);

    Test.loadChapter(ch).then(function (bank) {
      if (!bank) {
        return noBank(ch.title, 'There is no question bank for this chapter yet.');
      }
      // Where the summary should point once this chapter is done.
      var at = chapters.indexOf(ch);
      var after = at > -1 ? chapters[at + 1] : null;
      runTest({
        id: ch.slug,
        title: ch.title,
        eyebrow: ch.part.numeral + ' · chapter test',
        back: '#/' + ch.slug,
        backLabel: 'Back to the lesson',
        questions: Test.shuffle(bank.questions),
        masteryKey: ch.slug,
        next: after ? { href: '#/' + after.slug, label: 'Next: ' + after.title } : null
      });
    });
  }

  function startPartTest(key, part) {
    Test.loadPart(part).then(function (banks) {
      if (!banks.length) {
        return noBank(part.numeral, 'No chapter in this part has a question bank yet.');
      }
      // Two per chapter keeps a 22-chapter part to a sitting rather than a
      // marathon, while still touching everything.
      var questions = Test.sample(banks, 2);
      // A part exam has no next chapter of its own, so it points at the
      // first chapter of the part after it.
      var pi = manifest.parts.indexOf(part);
      var nextPart = manifest.parts.slice(pi + 1).filter(function (p) { return !p.reference; })[0];
      var after = nextPart && nextPart.chapters[0];
      runTest({
        id: key,
        title: part.numeral + ' exam - ' + part.title,
        eyebrow: banks.length + ' chapters covered',
        back: '#/tests',
        backLabel: 'All tests',
        questions: questions,
        subtitle: 'part',
        masteryKey: key,
        next: after ? { href: '#/' + after.slug, label: 'On to ' + nextPart.numeral } : null
      });
    });
  }

  // A subject group crosses chapters on purpose: the mistakes worth drilling
  // cluster by idea, not by where the idea happened to be taught.
  function startGroupTest(key, id) {
    Test.findGroup(id).then(function (group) {
      if (!group) return notFound(key);
      Test.loadGroupBanks(group, manifest).then(function (banks) {
        if (!banks.length) {
          return noBank(group.title, 'None of the chapters in this set has a question bank yet.');
        }
        var questions = Test.sample(banks, group.perChapter || 4);
        runTest({
          id: key,
          title: group.title,
          eyebrow: banks.length + ' chapters · ' + questions.length + ' questions',
          back: '#/tests',
          backLabel: 'All tests',
          questions: questions,
          subtitle: 'part',          // shows which chapter each question came from
          masteryKey: key,
          next: null
        });
      });
    });
  }

  function runTest(opts) {
    view.innerHTML =
      '<div class="eyebrow"><a href="' + opts.back + '" style="color:inherit;text-decoration:none">← ' +
        escapeHtml(opts.backLabel) + '</a><span class="dot"></span><span>' +
        escapeHtml(opts.eyebrow) + '</span></div>' +
      '<h1>' + escapeHtml(opts.title) + '</h1>' +
      '<div id="testHost"></div>';

    Test.start(document.getElementById('testHost'), {
      id: opts.id,
      title: opts.title,
      subtitle: opts.subtitle,
      masteryKey: opts.masteryKey,
      questions: opts.questions,
      next: opts.next,
      onDone: function (r) {
        if (r.retry) return renderTest(opts.id);
        renderSidebarProgress();
      }
    });
  }

  function noBank(title, message) {
    view.innerHTML = '<h1>' + escapeHtml(title) + '</h1>' +
      '<div class="empty"><div class="empty-icon">📝</div><p>' + escapeHtml(message) + '</p>' +
      '<p><a href="#/tests">Back to the tests</a></p></div>';
  }

  function notFound(key) {
    view.innerHTML = '<div class="empty"><div class="empty-icon">🤷</div>' +
      '<p>No test called <code>' + escapeHtml(key) + '</code>.</p>' +
      '<p><a href="#/tests">All tests</a></p></div>';
  }

  /* ---------------------------------------------------------- reading */

  function renderReadList() {
    setCurrentNav('read');
    pager.innerHTML = '';
    view.innerHTML = '<div class="loading">Loading the passages…</div>';

    Promise.all([Read.loadIndex(), Vocab.load()]).then(function (r) {
      view.innerHTML =
        '<h1>Reading</h1>' +
        '<p class="lead">Passages that use only the grammar the course has covered by that level. ' +
        'Tap a line to hear it, tap a word for the meaning, then answer for what you understood ' +
        'and read a line back into the microphone.</p>' +
        Read.listHtml(r[0]);
    }).catch(function (err) {
      view.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><p>' +
        escapeHtml(err.message) + '</p></div>';
    });
  }

  function renderPassage(id) {
    setCurrentNav('read');
    pager.innerHTML = '';
    view.innerHTML = '<div class="loading">Loading…</div>';

    Promise.all([Read.loadIndex(), Vocab.load()]).then(function () {
      var entry = Read.byId(id);
      if (!entry) {
        view.innerHTML = '<div class="empty"><div class="empty-icon">🤷</div>' +
          '<p>No passage called <code>' + escapeHtml(id) + '</code>.</p>' +
          '<p><a href="#/read">All passages</a></p></div>';
        return;
      }
      return Read.render(view, entry, { onRetry: function () { renderPassage(id); } });
    }).catch(function (err) {
      view.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><p>' +
        escapeHtml(err.message) + '</p></div>';
    });
  }

  /* ---------------------------------------------------------- flashcards */

  function renderDeckList() {
    setCurrentNav('cards');
    pager.innerHTML = '';
    view.innerHTML = '<div class="loading">Loading decks…</div>';

    Vocab.load().then(function () {
      var known = Progress.knownCount();
      var html = '<h1>Flashcards</h1>' +
        '<p class="lead">Leitner spaced repetition: a card you get right moves up a box and comes ' +
        'back later (1, 2, 5, 10, 21, then 45 days). Get it wrong and it drops back to daily.</p>' +
        (known
          ? '<p class="deck-note">' + known + ' word' + (known === 1 ? '' : 's') +
            ' you marked as known ' + (known === 1 ? 'is' : 'are') + ' held out of every deck. ' +
            'Untick ' + (known === 1 ? 'it' : 'them') + ' in the ' +
            '<a href="#/vocab">vocabulary list</a> to bring ' +
            (known === 1 ? 'it' : 'them') + ' back - the old schedule is kept.</p>'
          : '<p class="deck-note">Marking a word known in the ' +
            '<a href="#/vocab">vocabulary list</a>, or retiring it mid-review, takes it out of ' +
            'every deck.</p>') +
        '<div class="deck-grid">';

      Vocab.decks().forEach(function (d) {
        var ids = d.cards.map(function (c) { return c.id; });
        var due = Progress.dueCount(ids);
        var s = Progress.cardStats(ids);
        html += '<button class="deck" data-deck="' + d.id + '">' +
          '<div class="deck-name">' + escapeHtml(d.name) + '</div>' +
          '<div class="deck-meta">' + d.size + ' cards · ' + s.learned + ' learned</div>' +
          '<div class="deck-meta ' + (due ? 'deck-due' : '') + '">' +
            (due ? due + ' due now' : 'nothing due') + '</div>' +
          '</button>';
      });
      view.innerHTML = html + '</div>';

      view.addEventListener('click', function (e) {
        var b = e.target.closest('[data-deck]');
        if (b) location.hash = '#/cards/' + b.dataset.deck;
      });
    });
  }

  function renderDeck(id) {
    setCurrentNav('cards');
    pager.innerHTML = '';
    view.innerHTML = '<div class="loading">Loading…</div>';

    Vocab.load().then(function () {
      var d = Vocab.deckById(id);
      if (!d) {
        view.innerHTML = '<div class="empty"><p>No deck called <code>' + escapeHtml(id) + '</code>.</p>' +
          '<p><a href="#/cards">Back to the decks</a></p></div>';
        return;
      }
      view.innerHTML =
        '<div class="eyebrow"><a href="#/cards" style="color:inherit;text-decoration:none">← All decks</a></div>' +
        '<h1>' + escapeHtml(d.name) + '</h1>' +
        '<div id="stage"></div>';
      Quiz.startSession(document.getElementById('stage'), d.cards, { limit: 25 });
    });
  }

  /* ------------------------------------------------------- quick add */

  // A word turns up mid-lesson, and the vocabulary page is three taps away.
  // This is the same two fields as the full form, in the topbar, on every
  // page: type, read the one line under the fields, press Enter. It stays
  // open afterwards because words arrive in twos and threes.
  function setupQuickAdd() {
    var btn = document.getElementById('addWordBtn');
    var menu = document.getElementById('addWordMenu');
    if (!btn || !menu) return;
    var timer = null;

    function close() {
      if (menu.hidden) return;
      menu.hidden = true;
      menu.innerHTML = '';
      btn.setAttribute('aria-expanded', 'false');
    }

    function open() {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      menu.innerHTML =
        '<div class="qa-head"><strong>Add a word</strong>' +
          '<span class="qa-hint">Enter to add · Esc to close</span></div>' +
        '<input id="qaHe" class="qa-in" dir="auto" lang="he" ' +
          'placeholder="\u05e9\u05bb\u05c1\u05dc\u05b0\u05d7\u05b8\u05df" ' +
          'autocomplete="off" spellcheck="false" aria-label="Hebrew">' +
        '<input id="qaEn" class="qa-in" placeholder="table" autocomplete="off" aria-label="English">' +
        '<p class="qa-note" id="qaNote">Two fields, that is all: the type, the gender and the ' +
          'theme are read off the Hebrew.</p>' +
        '<div class="qa-actions">' +
          '<button class="btn btn-primary btn-sm" id="qaSave">Add</button>' +
          '<a class="qa-link" href="#/vocab">All my words</a>' +
        '</div>';

      var he = menu.querySelector('#qaHe');
      var en = menu.querySelector('#qaEn');
      he.focus();
      // The duplicate check needs the curated list, but the fields are usable
      // before it lands; the note simply gets better once it has.
      Vocab.load().then(function () { look(); });

      function look() {
        var note = menu.querySelector('#qaNote');
        var save = menu.querySelector('#qaSave');
        if (!note) return;
        var text = he.value.trim();
        if (!text) {
          note.className = 'qa-note';
          note.textContent = 'Two fields, that is all: the type, the gender and the theme are ' +
            'read off the Hebrew.';
          save.disabled = false;
          return;
        }
        var hit = Vocab.findExisting(text);
        if (hit) {
          note.className = 'qa-note is-dupe';
          note.innerHTML = (hit.mine ? 'You already added ' : 'Already in the course: ') +
            '<strong lang="he" dir="rtl">' + escapeHtml(Heb.show(hit.he)) + '</strong>, ' +
            escapeHtml(hit.en);
          save.disabled = true;
          return;
        }
        var g = Vocab.guess(text, en.value);
        note.className = 'qa-note is-new';
        note.textContent = 'New. Filed as ' +
          (g.g ? { m: 'masculine', f: 'feminine', pl: 'plural', mf: 'either-gender' }[g.g] + ' ' : '') +
          (Vocab.POS_LABEL[g.pos] || g.pos) + ' (guessed from the ending), theme mine.';
        save.disabled = false;
      }

      function add() {
        var note = menu.querySelector('#qaNote');
        var input = { he: he.value, en: en.value, themes: [] };
        if (!input.he.trim() || !input.en.trim()) {
          note.className = 'qa-note is-dupe';
          note.textContent = 'Both sides, please: the Hebrew and what it means.';
          (input.he.trim() ? en : he).focus();
          return;
        }
        if (Vocab.findExisting(input.he)) return look();
        var g = Vocab.guess(input.he, input.en);
        input.pos = g.pos;
        input.g = g.g;
        try {
          Progress.addWord(input);
        } catch (err) {
          note.className = 'qa-note is-dupe';
          note.textContent = err.message;
          return;
        }
        var added = input.he.trim();
        he.value = '';
        en.value = '';
        he.focus();
        note.className = 'qa-note is-done';
        note.innerHTML = '\u2713 Added <strong lang="he" dir="rtl">' +
          escapeHtml(Heb.show(added)) + '</strong>. Next one?';
        // The vocabulary page is a snapshot, so it has to be redrawn to show
        // the new word; every other page is unaffected.
        if (location.hash.replace(/^#\/?/, '') === 'vocab') renderVocabPage();
      }

      menu.addEventListener('input', function (e) {
        if (e.target !== he && e.target !== en) return;
        clearTimeout(timer);
        timer = setTimeout(look, 140);
      });
      menu.addEventListener('click', function (e) {
        if (e.target.closest('#qaSave')) add();
        if (e.target.closest('.qa-link')) close();
      });
      menu.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); add(); }
        if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
      });
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.hidden) open(); else close();
    });
    menu.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', close);

    // A word heard in passing should cost one key. Not while something is
    // being typed, and not while a test is taking the digits.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
      e.preventDefault();
      if (menu.hidden) open();
    });
  }

  /* ---------------------------------------------------------- search */

  function setupSearch() {
    var input = document.getElementById('globalSearch');
    var results = document.getElementById('searchResults');
    var timer = null;

    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { runSearch(input.value, results); }, 120);
    });
    input.addEventListener('focus', function () {
      if (input.value.trim()) runSearch(input.value, results);
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.topbar-search')) closeSearch();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.blur(); closeSearch(); }
      if (e.key === 'Enter') {
        var first = results.querySelector('a');
        if (first) { location.hash = first.getAttribute('href'); input.blur(); closeSearch(); }
      }
    });
  }

  function closeSearch() {
    var r = document.getElementById('searchResults');
    if (r) { r.hidden = true; r.innerHTML = ''; }
  }

  // Lessons are indexed on first use, so the initial page load stays cheap.
  function buildSearchIndex() {
    if (searchIndex) return Promise.resolve(searchIndex);
    return Promise.all(chapters.map(function (ch) {
      return fetchChapter(ch)
        .then(function (md) {
          return {
            ch: ch,
            text: MD.plain(MD.frontMatter(md).body).toLowerCase(),
            headings: MD.headings(md)
          };
        })
        .catch(function () { return { ch: ch, text: '', headings: [] }; });
    })).then(function (docs) { searchIndex = docs; return docs; });
  }

  function runSearch(query, results) {
    var q = query.trim().toLowerCase();
    if (q.length < 2) { closeSearch(); return; }
    results.hidden = false;
    results.innerHTML = '<div class="sr-empty">Searching…</div>';

    Promise.all([buildSearchIndex(), Vocab.load()]).then(function () {
      var html = '';

      var lessons = [];
      searchIndex.forEach(function (doc) {
        var at = doc.text.indexOf(q);
        var titleHit = doc.ch.title.toLowerCase().indexOf(q) !== -1;
        if (at === -1 && !titleHit) return;
        lessons.push({
          ch: doc.ch,
          score: (titleHit ? 0 : 1000) + (at === -1 ? 0 : at),
          excerpt: at === -1 ? doc.ch.summary || '' : snippet(doc.text, at, q.length)
        });
      });
      lessons.sort(function (a, b) { return a.score - b.score; });

      if (lessons.length) {
        html += '<div class="sr-group">Lessons</div>';
        lessons.slice(0, 6).forEach(function (r) {
          html += '<a href="#/' + r.ch.slug + '">' +
            '<span class="sr-title">' + escapeHtml(r.ch.title) + '</span>' +
            '<span class="sr-sub">' + highlight(r.excerpt, q) + '</span></a>';
        });
      }

      var words = Vocab.search(q, {}).slice(0, 6);
      if (words.length) {
        html += '<div class="sr-group">Vocabulary</div>';
        words.forEach(function (w) {
          html += '<a href="#/vocab">' +
            '<span class="sr-title" lang="he" dir="rtl">' + highlight(Heb.show(w.he), q) + '</span>' +
            (w.tr ? '<span class="sr-sub">' + escapeHtml(w.tr) +
              (w.g ? ' \u00b7 ' + Vocab.GENDER_LABEL[w.g] : '') + '</span>'
                  : w.g ? '<span class="sr-sub">' + Vocab.GENDER_LABEL[w.g] + '</span>' : '') +
            '<span class="sr-sub">' + highlight(w.en, q) + '</span></a>';
        });
      }

      results.innerHTML = html || '<div class="sr-empty">Nothing found for “' + escapeHtml(query) + '”.</div>';
    });
  }

  function snippet(text, at, len) {
    var start = Math.max(0, at - 40);
    return (start ? '…' : '') + text.slice(start, at + len + 60).trim() + '…';
  }

  function highlight(text, q) {
    var safe = escapeHtml(String(text));
    if (!q) return safe;
    var i = safe.toLowerCase().indexOf(q);
    if (i === -1) return safe;
    return safe.slice(0, i) + '<mark>' + safe.slice(i, i + q.length) + '</mark>' + safe.slice(i + q.length);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var escapeAttr = escapeHtml;   // escapeHtml already quotes "

  boot();
})();
