import Gio from 'gi://Gio';

export type LedMode = 'off' | 'white' | 'battery';

export type Thresholds = {
  white: number;
  green: number;
  yellow: number;
  amber: number;
};

const LED_DEVICE = 'chromeos:multicolor:power';
const MULTI_INTENSITY_PATH = `/sys/class/leds/${LED_DEVICE}/multi_intensity`;

// multi_index order on the Framework laptop: red green blue yellow white amber
// Each value is 0–100 intensity for the corresponding colour component.
const INTENSITY = {
  red:    '100 0 0 0 0 0',
  green:  '0 100 0 0 0 0',
  blue:   '0 0 100 0 0 0',
  yellow: '0 0 0 100 0 0',
  white:  '0 0 0 0 100 0',
  amber:  '0 0 0 0 0 100',
} as const;

/** Default thresholds — used as fallback when no GSettings object is available. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  white:  50, // ≥ 50 % → white
  green:  30, // 30–49 % → green
  yellow: 20, // 20–29 % → yellow
  amber:  10, // 10–19 % → amber
              //  < 10 % → red
};

/**
 * Returns the intensity string for a given battery state.
 *
 * @param percentage   Current battery percentage (0–100).
 * @param charging     Whether the battery is currently charging.
 * @param thresholds   Colour-change thresholds; defaults to DEFAULT_THRESHOLDS.
 * @param chargeIndicator  When true, the LED shows blue while charging.
 *                         When false, charging has no effect on the colour.
 */
export function batteryIntensity(
  percentage: number,
  charging: boolean,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  chargeIndicator = false,
): string {
  if (charging && chargeIndicator)       return INTENSITY.blue;
  if (percentage >= thresholds.white)    return INTENSITY.white;
  if (percentage >= thresholds.green)    return INTENSITY.green;
  if (percentage >= thresholds.yellow)   return INTENSITY.yellow;
  if (percentage >= thresholds.amber)    return INTENSITY.amber;
  return INTENSITY.red;
}

/** Writes the colour profile to multi_intensity (group-writable via udev rule). */
function writeIntensity(value: string): void {
  const file = Gio.File.new_for_path(MULTI_INTENSITY_PATH);
  const stream = file.open_readwrite(null);
  stream.get_output_stream().write_bytes(new TextEncoder().encode(`${value}\n`), null);
  stream.close(null);
}

/**
 * Controls the LED on/off via brightnessctl. The `brightness` sysfs file is
 * root-only, so brightnessctl (which is setuid-free and uses its own helper)
 * is required. multi_intensity sets colour; brightness sets lightness.
 */
function setBrightness(level: number): void {
  const proc = Gio.Subprocess.new(
    ['brightnessctl', '-d', LED_DEVICE, 'set', String(level)],
    Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
  );
  proc.wait(null);
}

/**
 * Applies the requested LED mode.
 *
 * - off: brightness 0 (colour profile preserved).
 * - white / battery: set colour via multi_intensity, then brightness 100.
 */
export function applyMode(
  mode: LedMode,
  percentage: number,
  charging: boolean,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  chargeIndicator = false,
): void {
  try {
    if (mode === 'off') {
      setBrightness(0);
      return;
    }

    const intensity =
      mode === 'white'
        ? INTENSITY.white
        : batteryIntensity(percentage, charging, thresholds, chargeIndicator);

    writeIntensity(intensity);
    setBrightness(100);
  } catch (e) {
    console.error('[fw-battery-led] Failed to apply LED mode:', e);
  }
}
