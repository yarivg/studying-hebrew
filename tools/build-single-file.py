#!/usr/bin/env python3
"""Bundle the whole course into one self-contained HTML file.

The service-worker build needs https and a first online visit. This one needs
nothing: every lesson, the stylesheet, the scripts and every vocabulary entry
are inlined, so the file works from a phone's Files app, a USB stick, or an
email attachment, with no server and no network.

Run:  python3 tools/build-single-file.py
Out:  hamachberet-offline.html
"""

import base64
import io
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "hamachberet-offline.html")

SCRIPTS = [
    "assets/data.js",
    "assets/hebrew.js",
    "assets/md.js",
    "assets/progress.js",
    "assets/sync.js",
    "assets/audio.js",
    "assets/speech.js",
    "assets/test.js",
    "assets/read.js",
    "assets/quiz.js",
    "assets/vocab.js",
    "assets/app.js",
    "assets/offline.js",
]


def read(rel):
    with io.open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def js_string(value):
    """JSON, made safe to sit inside a <script> element."""
    return (json.dumps(value, ensure_ascii=False)
            .replace("</", "<\\/")
            .replace(" ", "\\u2028")
            .replace(" ", "\\u2029"))


def main():
    manifest = json.loads(read("content/manifest.json"))

    embedded = {
        "content/manifest.json": manifest,
        "data/vocab.json": json.loads(read("data/vocab.json")),
    }

    chapters = banks = passages = 0
    for part in manifest["parts"]:
        for ch in part["chapters"]:
            rel = "content/" + ch["file"]
            embedded[rel] = read(rel)
            chapters += 1

            # Test banks are optional: a chapter may not have one yet.
            bank = "content/tests/" + ch["file"].replace(".md", ".json")
            if os.path.exists(os.path.join(ROOT, bank)):
                embedded[bank] = json.loads(read(bank))
                banks += 1

    reading_index = os.path.join(ROOT, "content/reading/index.json")
    if os.path.exists(reading_index):
        idx = json.loads(read("content/reading/index.json"))
        embedded["content/reading/index.json"] = idx
        for entry in idx.get("passages", []):
            rel = "content/reading/" + entry.get("file", "")
            if entry.get("file") and os.path.exists(os.path.join(ROOT, rel)):
                embedded[rel] = json.loads(read(rel))
                passages += 1

    html = read("index.html")

    # The hosted page forbids inline script. This build *is* inline script, and
    # it never talks to a network, so the policy is rewritten rather than
    # dropped: still no third-party anything, but inline is allowed.
    html = re.sub(
        r'<meta http-equiv="Content-Security-Policy"[^>]*>',
        '<meta http-equiv="Content-Security-Policy" content="'
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
        "img-src 'self' data:; font-src data:; connect-src 'none'; "
        "form-action 'none'; base-uri 'none'"
        '">',
        html, count=1)

    # Strip the tags that only make sense when served: the manifest link,
    # the icons, and the individual <script src> / <link rel=stylesheet>.
    html = re.sub(r'\n\s*<link rel="manifest"[^>]*>', "", html)
    html = re.sub(r'\n\s*<link rel="apple-touch-icon"[^>]*>', "", html)
    html = re.sub(r'\n\s*<link rel="stylesheet"[^>]*>', "\n<style>__CSS__</style>", html, count=1)
    html = re.sub(r'\n\s*<script src="[^"]+"></script>', "", html)
    html = html.replace("</body>", "__SCRIPTS__\n</body>")

    css = read("assets/style.css")

    # The Hebrew faces come along as data: URIs. Without them the file falls
    # back to whatever Hebrew font the machine has, and the nikud, which is
    # the whole reason they are here, lands in the wrong places.
    for name in ("noto-sans-hebrew.woff2", "frank-ruhl-libre-hebrew.woff2"):
        with open(os.path.join(ROOT, "assets", "fonts", name), "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode("ascii")
        css = css.replace('url("fonts/%s")' % name,
                          'url("data:font/woff2;base64,%s")' % b64)

    payload = ["<script>window.__EMBEDDED__ = " + js_string(embedded) + ";</script>"]
    for rel in SCRIPTS:
        payload.append("<script>\n" + read(rel) + "\n</script>")

    html = html.replace("__CSS__", css)
    html = html.replace("__SCRIPTS__", "\n".join(payload))

    # A note in the title so the file is identifiable once saved.
    html = html.replace(
        "<title>\u05d4\u05de\u05d7\u05d1\u05e8\u05ea - a Hebrew course</title>",
        "<title>\u05d4\u05de\u05d7\u05d1\u05e8\u05ea - a Hebrew course (offline)</title>")

    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write(html)

    size = os.path.getsize(OUT)
    print("wrote %s" % os.path.relpath(OUT, ROOT))
    print("  %d chapters, %d test banks, %d reading passages, %d vocabulary entries"
          % (chapters, banks, passages, embedded["data/vocab.json"]["count"]))
    print("  2 Hebrew fonts inlined")
    print("  %.1f KB" % (size / 1024.0))


if __name__ == "__main__":
    main()
