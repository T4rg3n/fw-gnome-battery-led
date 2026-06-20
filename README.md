# fw-gnome-battery-led

A GNOME Shell extension for Framework laptops that adds a **Power LED** button
to the quick-settings panel.

<img src="./.github/quicksettings.png" width="320px" alt="screenshot of the extension with its dropdown in quick settings showing Off, White, and Battery Indicator modes" />

Three modes are available:


| Mode                  | Behaviour                                         |
| --------------------- | ------------------------------------------------- |
| **Off**               | LED disabled via `brightnessctl` (brightness → 0) |
| **White**             | White colour profile                              |
| **Battery Indicator** | Colour by battery level                           |


### Battery colour map


| Condition | Colour | Photo |
| --------- | ------ | ----- |
| ≥ 50 %    | White  | <img src="./.github/led_white.jpg" width="320px" alt="Framework laptop power LED glowing white at 50% or higher battery" /> |
| 30 – 49 % | Green  | <img src="./.github/led_green.jpg" width="320px" alt="Framework laptop power LED glowing green at 30–49% battery" /> |
| 20 – 29 % | Yellow | <img src="./.github/led_yellow.jpg" width="320px" alt="Framework laptop power LED glowing yellow at 20–29% battery" /> |
| 10 – 19 % | Amber  | <img src="./.github/led_amber.jpg" width="320px" alt="Framework laptop power LED glowing amber at 10–19% battery" /> |
| < 10 %    | Red    | <img src="./.github/led_red.jpg" width="320px" alt="Framework laptop power LED glowing red below 10% battery" /> |


Thresholds are defined in preferences menu:

<img src="./.github/preferences_menu.png" width="320px" alt="screenshot of the extension preferences menu showing configurable battery level thresholds for each LED colour" />

---

## Requirements

- GNOME Shell 47 – 50
- Podman (build only — not needed at runtime)
- `glib2` package (for `glib-compile-schemas` inside the container)
- Your user in the `video` group

---

## Build & Install

```bash
# 1. Clone / open the project
cd fw-gnome-battery-led

# 2. Build (first run pulls the Node.js container image)
./build.sh
```

`build.sh` will:

1. Build a Podman container with Node.js + glib tools.
2. Run `npm install && npm run build` inside the container (output → `dist/`).
3. Create `~/.local/share/gnome-shell/extensions/` if it does not exist yet.
4. Copy `dist/` to `~/.local/share/gnome-shell/extensions/fw-battery-led@framework.local`.
5. Print the remaining manual steps.

---

## Post-install steps (first time only)

### 1 — Install the udev rule

This grants write access to the LED sysfs file without requiring root at
runtime.

```bash
sudo cp 60-framework-power-led.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo udevadm trigger /sys/class/leds/chromeos:multicolor:power

# Confirm the attribute file (not just the device dir) is writable
stat /sys/class/leds/chromeos:multicolor:power/multi_intensity
# Expected: Access (0664/...)  GID (39/video)
```

Note: `MODE=` / `GROUP=` in udev only affect the device node udev creates.
The kernel creates `multi_intensity` separately as `root:root 0644`, so this
rule uses `RUN+=` to chmod/chgrp that file directly.

### 2 — Verify group membership

```bash
groups $USER   # should include "video"
```

If not:

```bash
sudo usermod -aG video $USER
# Log out and back in for the change to take effect
```

### 3 — Enable the extension

```bash
gnome-extensions enable fw-battery-led@framework.local
```

### 4 — Reload GNOME Shell

- **X11:** press `Alt + F2`, type `r`, press `Enter`.
- **Wayland:** log out and log back in.

---

## Day-to-day workflow

### First install (no prior installation)

```bash
./build.sh      # build + install, then follow the printed next-steps
```

### Uninstall

```bash
./build.sh --uninstall
```

To also remove the udev rule:

```bash
sudo rm /etc/udev/rules.d/60-framework-power-led.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

### Rebuild & reinstall

Useful for source changes. 
Triggers a whole rebuild, reinstall & re-enable.

```bash
./build.sh --reinstall
```

---

## Security notes

- **No sudo at runtime.** A udev `RUN` rule chmods/chgrps the single
`multi_intensity` sysfs file to `0664` / `video`. The extension writes to it
directly via `Gio.File` — no subprocess, no polkit.
- **No network access.** The extension only touches local sysfs and the system
D-Bus (UPower, read-only).
- **Battery data via D-Bus.** Battery percentage and charging state are read
from `org.freedesktop.UPower` — no shell commands.

---

## Troubleshooting

### Check extension logs

```bash
journalctl --user -b -g "fw-battery-led" --no-pager
journalctl --user -b -f -g "fw-battery-led"   # live, while switching modes
```

### Permission denied on `multi_intensity`

If `stat` still shows `0644 root:root`, the udev rule has **not** run yet.
Common causes:

- Used `--name-match` (wrong — that is for `/dev` names only)
- Trigger not run after copying the updated rules file

Apply and verify:

```bash
sudo cp 60-framework-power-led.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo udevadm trigger /sys/class/leds/chromeos:multicolor:power

stat /sys/class/leds/chromeos:multicolor:power/multi_intensity
# Must show: Access (0664/...)  GID (39/video)
```

No re-login is needed for the udev change itself. You only need `video`
in your current session (`groups` must list it).

Test a manual write:

```bash
echo "0 0 0 0 100 0" > /sys/class/leds/chromeos:multicolor:power/multi_intensity
```

If that works, reload the extension (`./build.sh --reinstall` or log out/in).

---

```
fw-gnome-battery-led/
├── Containerfile                  ← Podman build image
├── build.sh                       ← Build + install script
├── 60-framework-power-led.rules   ← udev rule (manual install)
├── metadata.json
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── src/
    ├── extension.ts   ← Quick Settings UI + lifecycle
    ├── led.ts         ← sysfs writer + colour mapping
    ├── battery.ts     ← UPower D-Bus monitor
    ├── utils.ts       ← D-Bus async helpers
    ├── global.d.ts    ← @girs ambient type imports
    ├── stylesheet.css
    ├── icons/
    │   └── power-led.svg
    └── schemas/
        └── org.gnome.shell.extensions.fw-battery-led.gschema.xml
```

---

## Disclaimer

This software is under MIT license and provided **"as is"**, without warranty of any kind, express or
implied, including but not limited to warranties of merchantability, fitness for
a particular purpose, or non-infringement.
The authors and contributors are not liable for any trouble arising from installation or use of this software.
