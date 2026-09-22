#!/usr/bin/env python3
"""Record every Hebrew string in the course with Carmit.

The browsers cannot be relied on to speak Hebrew: one lists a voice it will
not drive, another has none installed. The machine that builds this course
has Carmit and speaks her perfectly, so the recording happens here, once, and
the app plays a file.

A clip is named after the text it holds, so nothing needs an index at
runtime. The names come from tools/collect-audio.js, which calls the app's
own hash: this script never computes one, and the two cannot drift apart.

Rerunning is cheap. A clip that is already on disk is left alone, and a clip
whose text has gone from the course is deleted, so adding a chapter costs a
few seconds rather than half an hour.

Run:  python3 tools/build-audio.py          all of it, eight at a time
      python3 tools/build-audio.py --jobs 4 gentler on the machine
      python3 tools/build-audio.py --force  re-record everything
"""

import argparse
import concurrent.futures
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "audio")

VOICE = "Carmit"
BITRATE = "24000"          # mono AAC: speech is clear, a word is about 3 KB


def need(tool):
    if shutil.which(tool) is None:
        sys.exit("%s is not on the path (this script needs macOS)" % tool)


def collect():
    """Ask collect-audio.js what has to exist."""
    need("node")
    fd, tmp = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    try:
        subprocess.run(["node", os.path.join(ROOT, "tools", "collect-audio.js"), tmp],
                       check=True, cwd=ROOT)
        with open(tmp, encoding="utf-8") as f:
            return json.load(f)["jobs"]
    finally:
        os.remove(tmp)


def clip_path(key):
    return os.path.join(OUT, key[:2], key + ".m4a")


def record(job):
    """One clip: say it to an aiff, encode it, throw the aiff away."""
    key, text = job["key"], job["text"]
    dest = clip_path(key)
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    work = tempfile.mkdtemp(prefix="hamachberet-")
    try:
        src = os.path.join(work, "t.txt")
        aiff = os.path.join(work, "t.aiff")
        part = os.path.join(work, "t.m4a")
        # Through a file, not through argv: the text holds quotes, brackets
        # and punctuation, and `say` reads a file verbatim.
        with open(src, "w", encoding="utf-8") as f:
            f.write(text)
        subprocess.run(["say", "-v", VOICE, "-f", src, "-o", aiff],
                       check=True, capture_output=True)
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", BITRATE,
                        "-c", "1", aiff, part],
                       check=True, capture_output=True)
        # Into place in one step, so an interrupted run never leaves a clip
        # that is half written and will be skipped as done next time.
        os.replace(part, dest)
        return os.path.getsize(dest)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def prune(keep):
    """Delete clips for text the course no longer contains."""
    gone = 0
    if not os.path.isdir(OUT):
        return 0
    for sub in sorted(os.listdir(OUT)):
        d = os.path.join(OUT, sub)
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            if not name.endswith(".m4a"):
                continue
            if name[:-4] not in keep:
                os.remove(os.path.join(d, name))
                gone += 1
        if not os.listdir(d):
            os.rmdir(d)
    return gone


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=8, help="how many at a time")
    ap.add_argument("--force", action="store_true", help="re-record clips that exist")
    args = ap.parse_args()

    need("say")
    need("afconvert")
    if subprocess.run(["say", "-v", "?"], capture_output=True, text=True
                      ).stdout.find(VOICE) == -1:
        sys.exit("the %s voice is not installed: System Settings > Accessibility"
                 " > Spoken Content > System Voice > Manage Voices" % VOICE)

    jobs = collect()
    keys = set(j["key"] for j in jobs)

    gone = prune(keys)
    if gone:
        print("removed %d clip(s) whose text is no longer in the course" % gone)

    todo = jobs if args.force else [j for j in jobs if not os.path.exists(clip_path(j["key"]))]
    print("%d clips wanted, %d already recorded, %d to do"
          % (len(jobs), len(jobs) - len(todo), len(todo)))

    if todo:
        began = time.time()
        done = 0
        with concurrent.futures.ThreadPoolExecutor(args.jobs) as pool:
            for _ in pool.map(record, todo):
                done += 1
                if done % 100 == 0 or done == len(todo):
                    per = (time.time() - began) / done
                    print("  %d/%d  %.0fs left" % (done, len(todo), per * (len(todo) - done)),
                          flush=True)
        print("recorded %d clips in %.1f minutes" % (done, (time.time() - began) / 60))

    # The index is for the "download everything" button and for nothing else.
    # Normal playback finds a clip by name, so nothing loads this at startup.
    total = sum(os.path.getsize(clip_path(k)) for k in sorted(keys)
                if os.path.exists(clip_path(k)))
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"voice": VOICE, "bitrate": int(BITRATE), "count": len(keys),
                   "bytes": total, "keys": "".join(sorted(keys))}, f)

    print("%d clips, %.1f MB" % (len(keys), total / 1048576.0))


main()
