#!/usr/bin/env python3
"""Generate the app icons: the flag of Israel. Pure stdlib, no image library.

Built from the flag's own proportions, squared off: the two stripes sit
15/160 of the height in from the top and bottom edges and are 25/160 tall,
and the star is 60/160 across. Keeping the real ratios is what stops it
reading as a generic blue-and-white square at 48px.

The star is a hexagram outline, drawn as the area inside the hexagram but
outside a smaller copy of it. Everything is sampled 4x4 per pixel, which is
all the antialiasing a shape of straight edges needs.

Run:  python3 tools/make-icons.py
"""

import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "icons")

BLEU = (0x00, 0x38, 0xb8)
WHITE = (0xff, 0xff, 0xff)

SS = 4                      # samples per pixel per axis


def write_png(path, width, height, pixel):
    raw = bytearray()
    for y in range(height):
        raw.append(0)                      # filter type 0 for each scanline
        for x in range(width):
            raw.extend(pixel(x, y))

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def triangle(cx, cy, r, up):
    """The three corners of an equilateral triangle about (cx, cy)."""
    half = r * math.sqrt(3) / 2.0
    if up:
        return [(cx, cy - r), (cx - half, cy + r / 2.0), (cx + half, cy + r / 2.0)]
    return [(cx, cy + r), (cx + half, cy - r / 2.0), (cx - half, cy - r / 2.0)]


def inside(tri, x, y):
    """Point in triangle, by the sign of the three edge cross products."""
    neg = pos = False
    for i in range(3):
        ax, ay = tri[i]
        bx, by = tri[(i + 1) % 3]
        d = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
        if d < 0:
            neg = True
        elif d > 0:
            pos = True
    return not (neg and pos)


def flag(size, inset=0.0):
    """A function from (x, y) to a colour, for a `size` square.

    `inset` shrinks the flag inside the square, which is what a maskable icon
    needs: a launcher may crop anything outside the middle 80%.
    """
    s = size * (1.0 - 2 * inset)
    o = size * inset
    cx = cy = size / 2.0

    top = o + s * 15 / 160.0
    thick = s * 25 / 160.0
    bottom = o + s - s * 15 / 160.0 - thick

    star = s * 60 / 160.0
    r = star / 2.0                          # the triangles' circumradius
    stroke = s * 5.5 / 160.0
    # A hexagram offset inward by `stroke` is the same hexagram scaled about
    # its centre: an equilateral triangle's inradius is half its circumradius.
    k = 1.0 - 2 * stroke / r

    outer = [triangle(cx, cy, r, True), triangle(cx, cy, r, False)]
    ring = [triangle(cx, cy, r * k, True), triangle(cx, cy, r * k, False)]

    def hit(x, y):
        if o <= x < o + s and (top <= y < top + thick or bottom <= y < bottom + thick):
            return True
        if any(inside(t, x, y) for t in outer) and \
           not any(inside(t, x, y) for t in ring):
            return True
        return False

    def pixel(px, py):
        n = 0
        for sy in range(SS):
            y = py + (sy + 0.5) / SS
            for sx in range(SS):
                if hit(px + (sx + 0.5) / SS, y):
                    n += 1
        if n == 0:
            return WHITE
        if n == SS * SS:
            return BLEU
        a = n / float(SS * SS)
        return tuple(int(round(WHITE[i] + (BLEU[i] - WHITE[i]) * a)) for i in range(3))

    return pixel


# name, pixel size, inset. The maskable one keeps the flag inside the middle
# 76%, which is the only part a launcher promises not to crop.
ICONS = [
    ("icon-192.png", 192, 0.0),
    ("icon-512.png", 512, 0.0),
    ("icon-maskable-512.png", 512, 0.12),
    ("apple-touch-icon.png", 180, 0.0),
]


def main():
    for name, size, inset in ICONS:
        path = os.path.join(OUT, name)
        write_png(path, size, size, flag(size, inset))
        print("wrote %s (%dx%d)" % (os.path.relpath(path, ROOT), size, size))


main()
