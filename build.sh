#!/usr/bin/env bash
# Manage the fw-battery-led GNOME Shell extension.
#
# Usage:
#   ./build.sh              — build & install (default)
#   ./build.sh --reinstall  — disable, build & install, re-enable, reload
#   ./build.sh --uninstall  — disable & remove the extension
#
# Requires: podman
set -euo pipefail

IMAGE="fw-battery-led-builder"
EXT_UUID="fw-battery-led@framework.local"
EXTENSIONS_DIR="$HOME/.local/share/gnome-shell/extensions"
DEST="$EXTENSIONS_DIR/$EXT_UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── helpers ──────────────────────────────────────────────────────────────────

reload_shell() {
  if [[ "${WAYLAND_DISPLAY:-}" != "" ]]; then
    echo ""
    echo "  Wayland detected — log out and back in to reload GNOME Shell."
  else
    echo ""
    echo "  X11 detected — reloading GNOME Shell now..."
    busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Reloading…")' 2>/dev/null \
      || echo "  (Could not auto-reload — press Alt+F2, type 'r', press Enter)"
  fi
}

uninstall() {
  echo "==> Disabling extension..."
  gnome-extensions disable "$EXT_UUID" 2>/dev/null || true

  echo "==> Removing $DEST ..."
  rm -rf "${DEST:?}"

  echo ""
  echo "Extension uninstalled."
  echo "Reload GNOME Shell to fully remove it from the current session:"
  reload_shell
}

build_and_install() {
  echo "==> Building container image (cached after first run)..."
  podman build -t "$IMAGE" "$SCRIPT_DIR"

  echo "==> Running TypeScript build inside container..."
  podman run --rm \
    -v "$SCRIPT_DIR":/workspace:z \
    -w /workspace \
    "$IMAGE" \
    sh -c "npm install && npm run build"

  echo "==> Installing extension to $DEST ..."
  mkdir -p "$EXTENSIONS_DIR"
  rm -rf "${DEST:?}"
  cp -r "$SCRIPT_DIR/dist" "$DEST"

  echo ""
  echo "Extension installed to $DEST"
}

# ── dispatch ─────────────────────────────────────────────────────────────────

case "${1:-}" in

  --uninstall)
    uninstall
    ;;

  --reinstall)
    echo "==> Disabling extension before reinstall..."
    gnome-extensions disable "$EXT_UUID" 2>/dev/null || true

    build_and_install

    echo "==> Re-enabling extension..."
    gnome-extensions enable "$EXT_UUID"

    echo "==> Reloading GNOME Shell..."
    reload_shell
    ;;

  "")
    build_and_install

    echo ""
    echo "First-time setup (skip if already done):"
    echo "  1. Install the udev rule:"
    echo "       sudo cp $SCRIPT_DIR/60-framework-power-led.rules /etc/udev/rules.d/"
    echo "       sudo udevadm control --reload-rules"
    echo "       sudo udevadm trigger /sys/class/leds/chromeos:multicolor:power"
    echo "       stat /sys/class/leds/chromeos:multicolor:power/multi_intensity"
    echo "  2. Check group membership:"
    echo "       groups \$USER   # must include 'video'"
    echo "       sudo usermod -aG video \$USER && <re-login>   # if missing"
    echo "  3. Enable the extension:"
    echo "       gnome-extensions enable $EXT_UUID"
    echo "  4. Reload GNOME Shell:"
    echo "       Alt+F2 → 'r' → Enter   (X11)"
    echo "       Log out and back in    (Wayland)"
    ;;

  *)
    echo "Usage: $0 [--reinstall | --uninstall]" >&2
    exit 1
    ;;

esac
