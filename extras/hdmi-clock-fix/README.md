# hdmi-clock-fix (RK3566/RK3568 only)

A one-shot kernel module for boards whose kernel leaves the HDMI reference clock
at 24 MHz. It sets the HPLL to 74.25 MHz and points `clk_hdmi_ref` at its half,
giving the 37.125 MHz that the BTT HDMI5 EDID in `edid/` uses. It changes the
clock once at load and does nothing after. Tested on an Orange Pi CM4 with its
vendor 6.13.0 kernel; a Raspberry Pi doesn't need it.

Build against headers that match the running kernel, then install:

```sh
make -C /lib/modules/$(uname -r)/build M=$PWD modules
sudo install -D -m 644 hdmi_clock_fix.ko /lib/modules/$(uname -r)/extra/hdmi_clock_fix.ko
sudo depmod
sudo install -m 755 hdmi-clock-fix-load /usr/local/sbin/
sudo install -m 644 hdmi-clock-fix.service /etc/systemd/system/
sudo systemctl daemon-reload
```

`KLeanScreen.service.d/10-btt-hdmi5-rk3566.conf` pulls the service in at boot.
Check it worked with `dmesg | grep hdmi_clock_fix` (look for `ref=37125000`).
The module is out-of-tree and tied to one kernel build: rebuild it after a
kernel update. Some vendor kernels don't ship usable headers; you then need the
vendor's kernel source tree for that exact build.
