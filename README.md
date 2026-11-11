# KLeanScreen

A small touchscreen UI for the Voron Trident (Kalico, Bondtech INDX, BTT HDMI5
800×480 on an Orange Pi CM4). It replaces KlipperScreen with only the screens
used at the printer: E-stop, load/unload/purge per tool, home, pick a file and
print, and the printing screen (progress, first-layer Z offset, message log,
pause/resume/cancel, speed and flow).

The flows stay in Klipper macros (`LOAD_TOOL`, `PURGE_TOOL` and friends in
`trident-printer-settings`), using Mainsail's `action:prompt_*` protocol. The
screen renders any macro prompt, so Mainsail and the screen never disagree.

The design spec is the mockup in
`trident-printer-settings/docs/kleanscreen/` (and its HANDOFF.md).

## How it runs

```
systemd (KlipperScreen.service for now, KLeanScreen.service later)
  └ scripts/kleanscreen-start.sh
      └ cage            Wayland kiosk compositor, straight on KMS/DRM, no X
          └ kiosk/kiosk.py   WebKitGTK view, fullscreen; also serves web/ on 127.0.0.1:7136
              └ web/         plain HTML/CSS/JS, no framework, no build step
                  └ ws://127.0.0.1:7125/websocket  (Moonraker)
```

The page is served over HTTP rather than `file://` because Moonraker refuses
websockets whose `Origin` is `null`.

`kiosk.py` uses KlipperScreen's venv Python (`~/.KlipperScreen-env`), which has
PyGObject and pycairo; the system Python lacks `gi._gi_cairo`.

Packages: `cage wlr-randr gir1.2-webkit2-4.1 fonts-inter` (installed with
`--no-install-recommends`; about 187 MB with dependencies).

### Display: the EDID override

The panel's EDID offers only 800×480 at 25.00 MHz, which the RK3566 can't
clock, so the kernel prunes it and the connector has no modes. X got round
that with a custom modeline; cage can't. `edid/make-edid.py` writes the X
modeline's timing into a copy of the panel's EDID (37.13 MHz in the EDID,
which the clock divider rounds down to exactly 37.125 MHz).

This kernel is built without `CONFIG_DRM_LOAD_EDID_FIRMWARE`, so
`drm.edid_firmware=` on the command line is ignored. The override goes in
through debugfs instead, and lasts until reboot:

```
sudo sh -c 'cat edid/btt-hdmi5.bin > /sys/kernel/debug/dri/0/HDMI-A-1/edid_override; echo detect > /sys/class/drm/card0-HDMI-A-1/status'
```

`system/kleanscreen-edid.service` + `system/kleanscreen-edid-load` apply it at
boot (install as root; see the comments at the top of each). X keeps working
with the override in place.

## Trying it (current state)

KlipperScreen's start script runs `scripts/launch_KlipperScreen.sh` instead of
X when that file exists. For the trial it contains one line:

```
exec /home/stephen/git/KLeanScreen/scripts/kleanscreen-start.sh
```

Then restart KlipperScreen (Mainsail's service menu or Moonraker's
`machine.services.restart`). **Roll back** by deleting that file and restarting
KlipperScreen. The file is listed in KlipperScreen's `.git/info/exclude` so
Moonraker doesn't see a dirty repo.

The log is `~/printer_data/logs/kleanscreen.log`. For checking the screen over
SSH, `kill -USR2 $(cat $XDG_RUNTIME_DIR/kleanscreen/kiosk.pid)` saves
`$XDG_RUNTIME_DIR/kleanscreen/shot.png`; `-USR1` first runs `cmd.js` from the
same folder in the page (`window.KLEAN` exposes the state).

## Measurements (2026-11-10, printer idle)

| | CPU (one core) | Memory |
|---|---|---|
| X + KlipperScreen, idle | 1.2% | ~86 MB (MemAvailable drop) |
| cage + WebKit, KLeanScreen idle (live Moonraker updates) | 2.0% | ~220 MB |
| cage + WebKit, printing screen updating 4×/s | ~13% | |

The RK3566 has four cores and 7.5 GB, of which ~5.9 GB is free with everything
running. Status pushes arrive every 250 ms; the app redraws at most twice a
second for them and only patches the DOM when the HTML changed (that took idle
CPU from 7% to 2%).

## Not done yet

- Touch hasn't been tried on the panel (tested by script and snapshots only).
- Screen sleep: `SCREEN_SLEEP`/`SCREEN_WAKE` in `klipperscreen.cfg` use `xset`,
  which does nothing under cage. `wlr-randr --output HDMI-A-1 --off/--on` works,
  but nothing wakes the panel on touch yet.
- `KLeanScreen.service` and the EDID unit are drafts in `system/`, not installed.
- Moonraker `[update_manager]` entry.
