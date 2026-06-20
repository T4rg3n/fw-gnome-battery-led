import Gio from 'gi://Gio';

export type LedMode = 'off' | 'white' | 'battery';

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

/**
 * Battery percentage thresholds for the battery-indicator mode.
 * Edit these constants to adjust when each colour activates.
 */
export const THRESHOLDS = {
  white:  50, // ≥ 50 % → white
  green:  30, // 30–49 % → green
  yellow: 20, // 20–29 % → yellow
  amber:  10, // 10–19 % → amber
              //  < 10 % → red
} as const;

export function batteryIntensity(percentage: number, charging: boolean): string {
  if (charging)                        return INTENSITY.blue;
  if (percentage >= THRESHOLDS.white)  return INTENSITY.white;
  if (percentage >= THRESHOLDS.green)  return INTENSITY.green;
  if (percentage >= THRESHOLDS.yellow) return INTENSITY.yellow;
  if (percentage >= THRESHOLDS.amber)  return INTENSITY.amber;
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
): void {
  try {
    if (mode === 'off') {
      setBrightness(0);
      return;
    }

    const intensity =
      mode === 'white' ? INTENSITY.white : batteryIntensity(percentage, charging);

    writeIntensity(intensity);
    setBrightness(100);
  } catch (e) {
    // Log but don't throw — a failed LED write should never crash the shell.
    console.error('[fw-battery-led] Failed to apply LED mode:', e);
  }
}
