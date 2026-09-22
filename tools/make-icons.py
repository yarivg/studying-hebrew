#!/usr/bin/env python3
"""Generate the PWA icons. Pure stdlib, no image library on this machine.

The icon is the flag as a book cover: a navy field with five horizontal stripes
inset, white and blue alternating, so it still reads as "Hebrew notebook" at
48px and survives the circular mask Android applies to maskable icons.

Run:  python3 tools/make-icons.py
"""

import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "icons")

NAVY  = (0x0d, 0x16, 0x2e)
BLEU  = (0x00, 0x38, 0xb8)
CREAM = (0xfa, 0xf8, 0xf4)


def write_png(path, width, height, pixel):
    raw = bytearray()
    for y in range(height):
        raw.append(0)                      # filter type 0 for each scanline
        for x in range(width):
            raw.extend(pixel(x, y))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", header)
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return len(png)


def make(size, pad_ratio):
    """pad_ratio is the navy margin around the stripes, as a fraction of the size."""
    pad = int(size * pad_ratio)
    inner = size - 2 * pad

    def pixel(x, y):
        if x < pad or x >= size - pad or y < pad or y >= size - pad:
            return NAVY
        # Five bands down the cover: white, blue, white, blue, white.
        i = (y - pad) / inner
        return BLEU if 0.20 <= i < 0.40 or 0.60 <= i < 0.80 else CREAM

    return pixel


def main():
    os.makedirs(OUT, exist_ok=True)
    specs = [
        # (filename, size, padding) - maskable needs more padding for the crop
        ("icon-192.png", 192, 0.16),
        ("icon-512.png", 512, 0.16),
        ("icon-maskable-512.png", 512, 0.26),
        ("apple-touch-icon.png", 180, 0.16),
    ]
    for name, size, pad in specs:
        n = write_png(os.path.join(OUT, name), size, size, make(size, pad))
        print("%-26s %4dx%-4d %6d bytes" % (name, size, size, n))


if __name__ == "__main__":
    main()
