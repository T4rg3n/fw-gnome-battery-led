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
const BRIGHTNESS_PATH = `/sys/class/leds/${LED_DEVICE}/brightness`;

// On the Framework multicolor LED, `multi_intensity` sets the per-channel colour
// while `brightness` is the master on/off multiplier. On cold boot the EC leaves
// `brightness` at 0, so colour writes alone produce no light — we must set it.
const MAX_BRIGHTNESS = 100;

// multi_index order on the Framework laptop: red green blue yellow white amber
// Each value is 0–100 intensity for the corresponding colour component.
const INTENSITY = {
  off:    '0 0 0 0 0 0',
  red:    '100 0 0 0 0 0',
  green:  '0 100 0 0 0 0',
  blue:   '0 0 100 0 0 0', // unsupported on some fw models 
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
  try {
    stream.get_output_stream().write_bytes(new TextEncoder().encode(`${value}\n`), null);
  } finally {
    stream.close(null);
  }
}

/** Writes the master brightness (group-writable via udev rule). 0 turns the LED off. */
function writeBrightness(level: number): void {
  const file = Gio.File.new_for_path(BRIGHTNESS_PATH);
  const stream = file.open_readwrite(null);
  try {
    stream.get_output_stream().write_bytes(new TextEncoder().encode(`${level}\n`), null);
  } finally {
    stream.close(null);
  }
}

/**
 * Applies the requested LED mode by writing the colour to multi_intensity and
 * then setting the master brightness: 0 for off, 100 for on. Setting brightness
 * is required because the EC leaves it at 0 after a cold boot, which would
 * otherwise keep the LED dark regardless of the colour intensity.
 */
export function applyMode(
  mode: LedMode,
  percentage: number,
  charging: boolean,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  chargeIndicator = false,
): void {
  try {
    const intensity =
      mode === 'off'
        ? INTENSITY.off
        : mode === 'white'
          ? INTENSITY.white
          : batteryIntensity(percentage, charging, thresholds, chargeIndicator);

    writeIntensity(intensity);
    writeBrightness(mode === 'off' ? 0 : MAX_BRIGHTNESS);
  } catch (e) {
    console.error('[fw-battery-led] Failed to apply LED mode:', e);
  }
}
