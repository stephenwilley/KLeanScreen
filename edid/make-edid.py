#!/usr/bin/env python3
"""Build btt-hdmi5.bin: the BTT HDMI5's own EDID with its 25 MHz timings
replaced by the 800x480 timing the RK3566 can actually clock.

The panel's EDID offers only 800x480 @ 25.00 MHz, which the RK3566 can't
synthesize, so DRM prunes it and the connector has no modes. The one clock
that works is 37.125 MHz (HPLL 74.25 MHz / 2, set up at boot by
hdmi_clock_fix.ko). This is the X modeline that has always been used:

  Modeline "800x480" 37.125 800 900 1000 1125 480 500 510 550 -hsync +vsync

EDID stores the clock in 10 kHz steps, so it's written as 37.13 MHz. The
clock divider rounds down, so that lands on exactly 37.125 MHz (37.12 MHz
rounds down past it and was rejected). Refresh is 60.008 Hz.

Usage: make-edid.py [original.bin] [out.bin]
"""
import struct
import sys

src = sys.argv[1] if len(sys.argv) > 1 else "btt-hdmi5-original.bin"
out = sys.argv[2] if len(sys.argv) > 2 else "btt-hdmi5.bin"
e = bytearray(open(src, "rb").read())

OLD = bytes.fromhex("c40920803 0e02d102830d3006c410000001c".replace(" ", ""))
hact, hbl, vact, vbl = 800, 325, 480, 70      # totals 1125 x 550
hso, hsp, vso, vsp = 100, 100, 20, 10         # front porch / sync widths
dtd = bytearray(struct.pack("<H", 3713))      # 37.13 MHz in 10 kHz units
dtd += bytes([hact & 0xFF, hbl & 0xFF, (hact >> 8) << 4 | hbl >> 8,
              vact & 0xFF, vbl & 0xFF, (vact >> 8) << 4 | vbl >> 8,
              hso & 0xFF, hsp & 0xFF, (vso & 0xF) << 4 | (vsp & 0xF),
              (hso >> 8) << 6 | (hsp >> 8) << 4 | (vso >> 4) << 2 | (vsp >> 4)])
dtd += OLD[12:]       # image size, borders, flags 0x1c: digital separate sync, +vsync, -hsync

n = 0
while (i := e.find(OLD)) >= 0:
    e[i:i + 18] = dtd
    n += 1
if n == 0:
    sys.exit("no 25 MHz 800x480 timing found - is this the BTT HDMI5's EDID?")
for b in range(0, len(e), 128):
    e[b + 127] = (-sum(e[b:b + 127])) & 0xFF
open(out, "wb").write(e)
print(f"replaced {n} timing descriptors -> {out}")
