import Gio from 'gi://Gio';

export type LedMode = 'off' | 'white' | 'battery';

const LED_PATH = '/sys/class/leds/chromeos:multicolor:power/multi_intensity';

// multi_index order on the Framework laptop: red green blue yellow white amber
// Each value is 0–100 intensity for the corresponding colour component.
const INTENSITY = {
  off:    '0 0 0 0 0 0',
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

/**
 * Writes the LED intensity string to the sysfs file synchronously.
 *
 * sysfs writes are instantaneous kernel operations so blocking here is safe.
 * The udev rule `60-framework-power-led.rules` must grant write permission to
 * the `video` group before this call will succeed without root privileges.
 */
export function applyMode(
  mode: LedMode,
  percentage: number,
  charging: boolean,
): void {
  let value: string;
  switch (mode) {
    case 'off':     value = INTENSITY.off; break;
    case 'white':   value = INTENSITY.white; break;
    case 'battery': value = batteryIntensity(percentage, charging); break;
  }

  try {
    const file = Gio.File.new_for_path(LED_PATH);
    file.replace_contents(
      new TextEncoder().encode(`${value}\n`),
      null,   // expected etag
      false,  // make_backup
      Gio.FileCreateFlags.NONE,
      null,   // cancellable
    );
  } catch (e) {
    // Log but don't throw — a failed LED write should never crash the shell.
    console.error('[fw-battery-led] Failed to write LED intensity:', e);
  }
}
