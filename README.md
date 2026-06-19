# fw-gnome-battery-led

A GNOME Shell extension for Framework laptops that adds a **Power LED** button
to the quick-settings panel. Three modes are available:

| Mode | Behaviour |
|------|-----------|
| **Off** | LED disabled |
| **White** | Constant white (Framework default) |
| **Battery Indicator** | Colour reflects battery level (blue while charging) |

### Battery colour map

| Condition | Colour |
|-----------|--------|
| Charging | Blue |
| ≥ 50 % | White |
| 30 – 49 % | Green |
| 20 – 29 % | Yellow |
| 10 – 19 % | Amber |
| < 10 % | Red |

Thresholds are defined as constants in [`src/led.ts`](src/led.ts) and can be
edited before building.

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
1. Build a Podman container with Node.js + pnpm + glib tools.
2. Run `pnpm install && pnpm build` inside the container (output → `dist/`).
3. Copy `dist/` to `~/.local/share/gnome-shell/extensions/fw-battery-led@framework.local`.
4. Print the remaining manual steps.

---

## Post-install steps (first time only)

### 1 — Install the udev rule

This grants write access to the LED sysfs file without requiring root at
runtime.

```bash
sudo cp 60-framework-power-led.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger
```

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

### Rebuild & reinstall after source changes

```bash
./build.sh --reinstall
```

This disables the extension, rebuilds inside the container, reinstalls, re-enables,
and attempts to reload GNOME Shell automatically (X11 only; on Wayland you will
be prompted to log out and back in).

### Uninstall

```bash
./build.sh --uninstall
```

Disables the extension, removes it from `~/.local/share/gnome-shell/extensions/`,
and prompts you to reload GNOME Shell.

To also remove the udev rule:

```bash
sudo rm /etc/udev/rules.d/60-framework-power-led.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

### First install (no prior installation)

```bash
./build.sh      # build + install, then follow the printed next-steps
```

---

## Security notes

- **No sudo at runtime.** The udev rule grants `GROUP="video"` with `MODE="0664"`
  to the single sysfs LED file. The extension writes to it directly via
  `Gio.File` — no subprocess, no polkit.
- **No network access.** The extension only touches local sysfs and the system
  D-Bus (UPower, read-only).
- **Battery data via D-Bus.** Battery percentage and charging state are read
  from `org.freedesktop.UPower` — no shell commands.

---

## Project structure

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
