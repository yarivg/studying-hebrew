/* ============================================================
   select.js - highlight any Hebrew on any page, hear it, say it.

   A course is full of phrases that are not marked up as examples:
   half a table cell, a clause inside a rule, a line of your own
   vocabulary. Selecting text with the mouse is how you point at
   one of those, so that is the gesture this hangs off.

   Select, and a bubble appears above the selection with two
   offers: hear it read, or read it back and be scored. Both are
   the same engines the chapters and the tests already use - Say
   for the voice, Speech for the microphone - so a phrase caught
   mid-paragraph is worked exactly like a test question.

   Deliberately global: it binds to the document once and lives
   through every route, because "wherever I am" is the point.
   ============================================================ */

window.Selected = (function () {
  'use strict';

  // Long enough for a sentence or two of Hebrew, short enough that
  // selecting a whole chapter does not queue a five-minute reading.
  var MAX = 220;

  var bubble = null;
  var text = '';
  var rect = null;
  var listening = false;
  // The last gesture that produced a selection. On a phone the operating
  // system puts its own callout - Copy, Look Up, Share - directly above the
  // selection, which is exactly where this bubble wants to be, so a touch
  // selection is served from below instead.
  var touched = false;
  // Width only. Mobile browsers fire resize when the URL bar slides away,
  // which is not a layout change and must not take the bubble with it.
  var lastWidth = window.innerWidth;

  /* ---------------------------------------------------------- what is selected */

  // Only a text selection the user made in the prose counts. A caret with no
  // range, a click inside the bubble, and anything inside a field where the
  // selection belongs to typing are all left alone.
  function current() {
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

    var s = sel.toString().replace(/\s+/g, ' ').trim();
    if (s.length < 2 || s.length > MAX) return null;
    // Punctuation and digits alone are nothing to read out.
    if (!Heb.hasHebrew(s)) return null;

    var range = sel.getRangeAt(0);
    var host = range.commonAncestorContainer;
    if (host.nodeType === 3) host = host.parentNode;
    if (!host || !host.closest) return null;
    if (host.closest('input, textarea, [contenteditable=""], [contenteditable="true"], .sel-bubble')) return null;

    var box = range.getBoundingClientRect();
    if (!box || (!box.width && !box.height)) return null;

    return { text: s, rect: box };
  }

  /* ---------------------------------------------------------- the bubble */

  function ensure() {
    if (bubble) return bubble;
    bubble = document.createElement('div');
    bubble.className = 'sel-bubble';
    bubble.setAttribute('role', 'group');
    bubble.setAttribute('aria-label', 'What to do with the selected text');
    bubble.hidden = true;
    // mousedown, not click: pressing a button must not clear the very
    // selection the button is about to act on.
    bubble.addEventListener('mousedown', function (e) { e.preventDefault(); });
    bubble.addEventListener('click', onAction);
    document.body.appendChild(bubble);
    return bubble;
  }

  function paint(extra) {
    var b = ensure();
    var canSay = window.Say && Say.supported() && Say.on();
    var canHear = window.Speech && Speech.supported();

    b.innerHTML =
      '<div class="sel-row">' +
        (canSay
          ? '<button type="button" class="sel-btn" data-act="play">🔊 Hear it</button>' +
            '<button type="button" class="sel-btn" data-act="slow">Slower</button>'
          : '') +
        (canHear
          ? '<button type="button" class="sel-btn sel-btn-mic" data-act="rec">🎤 Say it</button>'
          : '') +
        '<button type="button" class="sel-btn sel-close" data-act="close" aria-label="Close">×</button>' +
      '</div>' +
      (extra || '');
    place();
  }

  function place() {
    if (!bubble || bubble.hidden || !rect) return;
    // Measured after paint, because the score line changes the height and
    // the bubble sits above the selection, not below it.
    var box = bubble.getBoundingClientRect();
    var pad = 8;
    var left = rect.left + (rect.width / 2) - (box.width / 2);
    left = Math.max(pad, Math.min(left, window.innerWidth - box.width - pad));

    // The top bar is sticky and the bubble outranks it, so without this the
    // bubble covers the navigation whenever the selection is near the top.
    var bar = parseInt(getComputedStyle(document.documentElement)
      .getPropertyValue('--topbar-h'), 10) || 0;
    var min = bar + pad;

    var above = rect.top - box.height - 10;
    var below = rect.bottom + 12;
    var top;
    if (touched) {
      // Under the selection, clear of the system callout. If there is no room
      // down there either, above is still better than covered.
      top = (below + box.height <= window.innerHeight - pad) ? below
          : (above >= min ? above : below);
    } else {
      // No room above - a selection in the first line of the page - so drop it
      // under the selection instead of behind the bar.
      top = above >= min ? above : below;
    }
    // A selection scrolled half under the bar can push it either way; the
    // bubble stays on screen and below the bar whatever the arithmetic says.
    if (top + box.height > window.innerHeight - pad) top = window.innerHeight - box.height - pad;
    if (top < min) top = min;

    bubble.style.left = Math.round(left) + 'px';
    bubble.style.top = Math.round(top) + 'px';
  }

  function show(sel) {
    // Nothing to offer - no voice and no microphone - so no bubble.
    if (!(window.Say && Say.supported() && Say.on()) &&
        !(window.Speech && Speech.supported())) return hide();
    text = sel.text;
    rect = sel.rect;
    ensure().hidden = false;
    paint();
  }

  function hide() {
    if (!bubble || bubble.hidden) return;
    bubble.hidden = true;
    bubble.innerHTML = '';
    text = '';
    rect = null;
    if (listening) { listening = false; if (window.Speech) Speech.stop(); }
    if (window.Say) Say.stop();
  }

  /* ---------------------------------------------------------- the two offers */

  function onAction(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.dataset.act;

    if (act === 'close') return hide();
    if (act === 'play' || act === 'slow') {
      if (window.Speech) Speech.stop();
      return void Say.speak(text, { slow: act === 'slow' });
    }
    if (act === 'rec') record(btn);
  }

  function record(btn) {
    if (listening) return;
    listening = true;
    Say.stop();                  // the voice must not be heard as your answer
    btn.disabled = true;
    btn.textContent = '🎤 Listening…';

    Speech.check(text, {
      onPartial: function (heard) { btn.textContent = '🎤 ' + heard; }
    }).then(function (r) {
      listening = false;
      paint(scoreHtml(r));
    }).catch(function (err) {
      listening = false;
      paint('<p class="sel-note is-bad">' + escapeHtml(err.message) + '</p>');
    });
  }

  // The same three states the tests use - right, close, missed - so a phrase
  // scored here reads exactly like a scored test answer.
  function scoreHtml(r) {
    if (r.unclear) {
      return '<p class="sel-note is-bad">The recogniser did not make that out. ' +
        'Say it again, a little slower.</p>';
    }
    var words = text.split(/\s+/);
    return '<p class="sel-heard">' + r.words.map(function (w, i) {
        return '<span class="hw hw-' + w.state + '">' + escapeHtml(words[i] || w.word) + '</span>';
      }).join(' ') +
      '<span class="sel-pct' + (r.pass ? ' is-pass' : '') + '">' + r.pct + '%</span></p>' +
      '<p class="sel-note">Heard: ' + escapeHtml(r.heard || '-') + '</p>';
  }

  /* ---------------------------------------------------------- wiring */

  // selectionchange fires on every tick of a drag, so the bubble is only
  // decided once the gesture is over. Keyboard selection has no such end,
  // which is what the keyup branch is for.
  function settle() {
    // A recording in flight owns the bubble: repainting it here would wipe
    // the score the microphone is about to put there.
    if (listening) return;
    var sel = current();
    if (sel) return show(sel);
    // On a phone the selection is collapsed by the system the moment you
    // reach for the bubble, so an empty selection is not a reason to close
    // one that is already open and holding the text. Touch closes it by the
    // × , by Escape, or by touching the page somewhere else.
    if (touched && bubble && !bubble.hidden) return;
    hide();
  }

  function inBubble(el) {
    return !!(bubble && el && el.closest && el.closest('.sel-bubble'));
  }

  document.addEventListener('mouseup', function (e) {
    if (inBubble(e.target)) return;
    touched = false;
    setTimeout(settle, 0);
  });

  // Touching the page outside the bubble is what closes it, since the
  // collapsed selection no longer can. A long press that is about to select
  // something new closes it too, and settle() opens it again over the new
  // selection a moment later.
  document.addEventListener('touchstart', function (e) {
    touched = true;
    if (inBubble(e.target) || listening) return;
    hide();
  }, { passive: true });

  // A touch selection is still being adjusted by the handles when touchend
  // arrives, so this one waits out the gesture rather than reading it early.
  document.addEventListener('touchend', function (e) {
    if (inBubble(e.target)) return;
    touched = true;
    setTimeout(settle, 140);
  }, { passive: true });

  // The backstop for the phones. A long-press selection, and every drag of a
  // selection handle after it, can finish without a touchend this document
  // ever sees - the gesture belongs to the system, not to the page. This
  // fires whatever happened, so the bubble appears even when no other event
  // does, and it is debounced because it also fires on every tick of a drag.
  var settleTimer = null;
  document.addEventListener('selectionchange', function () {
    if (listening) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 220);
  });

  document.addEventListener('keyup', function (e) {
    if (e.key === 'Escape') return hide();
    if (e.shiftKey || e.key === 'a') setTimeout(settle, 0);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hide();
  });

  // A selection cleared by clicking elsewhere takes the bubble with it, and a
  // recording in progress is not interrupted by the click that started it.
  document.addEventListener('mousedown', function (e) {
    if (inBubble(e.target)) return;
    // On a phone this is the synthetic mousedown behind a tap, and it arrives
    // after the operating system has already collapsed the selection. Hiding
    // here would close the bubble on the way to pressing one of its buttons,
    // so touch is left to selectionchange to decide.
    if (touched) return;
    hide();
  });

  // The bubble is positioned in viewport coordinates, so it has to follow.
  window.addEventListener('scroll', function () {
    if (!bubble || bubble.hidden) return;
    var sel = current();
    if (!sel) return hide();
    rect = sel.rect;
    place();
  }, { passive: true });

  window.addEventListener('resize', function () {
    if (window.innerWidth === lastWidth) return;   // the URL bar, not a reflow
    lastWidth = window.innerWidth;
    if (bubble && !bubble.hidden) hide();
  });

  // Leaving the page the text was on: the selection is gone, and a bubble
  // left behind would point at whatever now sits in that spot.
  window.addEventListener('hashchange', hide);

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { hide: hide };
})();
