import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { dbusProxy, dbusCall, toError } from './utils.js';

export type BatteryState = {
  percentage: number;
  charging: boolean;
};

export type BatteryCallback = (state: BatteryState) => void;

const UPOWER_NAME   = 'org.freedesktop.UPower';
const UPOWER_PATH   = '/org/freedesktop/UPower';
const UPOWER_IFACE  = 'org.freedesktop.UPower';
const DEVICE_IFACE  = 'org.freedesktop.UPower.Device';

// UPower device State values
const UPOWER_STATE_CHARGING         = 1;
const UPOWER_STATE_PENDING_CHARGE   = 5;

/**
 * How long (ms) to wait after a "not charging" UPower signal before acting on
 * it. The Framework EC fires a spurious Discharging event a couple of seconds
 * after the charger is connected while it negotiates power delivery; this delay
 * absorbs that glitch so the LED doesn't briefly revert to the battery-level
 * colour. Genuine unplugs will still be reflected after this delay.
 */
const NOT_CHARGING_DEBOUNCE_MS = 6000;

/**
 * Subscribes to UPower D-Bus signals to track battery percentage and charging
 * state. Notifies a callback whenever the battery state changes.
 *
 * Uses the UPower "display device" (composite battery shown to the user).
 */
export class BatteryMonitor {
  private _proxy: Gio.DBusProxy | null = null;
  private _signalId: number | null = null;
  private _safetyTimerId: number | null = null;
  private _notChargingTimerId: number | null = null;
  private _cancellable = new Gio.Cancellable();

  constructor(private readonly _callback: BatteryCallback) {}

  async start(): Promise<void> {
    try {
      await this._connect();
    } catch (e) {
      console.error('[fw-battery-led] BatteryMonitor.start() failed:', toError(e).message);
    }
  }

  stop(): void {
    this._cancellable.cancel();

    if (this._proxy !== null && this._signalId !== null) {
      this._proxy.disconnect(this._signalId);
    }

    if (this._safetyTimerId !== null) {
      GLib.Source.remove(this._safetyTimerId);
      this._safetyTimerId = null;
    }

    if (this._notChargingTimerId !== null) {
      GLib.Source.remove(this._notChargingTimerId);
      this._notChargingTimerId = null;
    }

    this._proxy = null;
    this._signalId = null;
  }

  get currentState(): BatteryState | null {
    return this._proxy !== null ? this._readState(this._proxy) : null;
  }

  private async _connect(): Promise<void> {
    // Get the composite "display device" path from the UPower manager.
    const manager = await dbusProxy(
      UPOWER_NAME,
      UPOWER_PATH,
      UPOWER_IFACE,
      this._cancellable,
    );

    const result = await dbusCall(manager, 'GetDisplayDevice', null, this._cancellable);
    const devicePath = result.get_child_value(0).get_string()[0];

    if (!devicePath || devicePath === '/') {
      throw new Error('UPower returned no display device');
    }

    this._proxy = await dbusProxy(
      UPOWER_NAME,
      devicePath,
      DEVICE_IFACE,
      this._cancellable,
    );

    // React to property changes (percentage, state) pushed by UPower.
    this._signalId = this._proxy.connect(
      'g-properties-changed',
      (_proxy: Gio.DBusProxy, _changed: GLib.Variant, _invalidated: string[]) => {
        this._notifyDebounced();
      },
    );

    // Safety refresh every 60 s in case a signal is missed.
    this._safetyTimerId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      60,
      () => {
        this._notify();
        return GLib.SOURCE_CONTINUE;
      },
    );

    // Emit initial state immediately.
    this._notify();
  }

  private _notify(): void {
    if (this._proxy === null) return;
    this._callback(this._readState(this._proxy));
  }

  /**
   * Called on every g-properties-changed signal. Applies hysteresis on the
   * "not charging" transition: a charging→true update is applied immediately
   * and cancels any pending not-charging timer; a charging→false update is
   * deferred by NOT_CHARGING_DEBOUNCE_MS to absorb spurious EC glitches.
   */
  private _notifyDebounced(): void {
    if (this._proxy === null) return;
    const state = this._readState(this._proxy);

    if (state.charging) {
      // Charging confirmed — apply immediately and cancel any pending "not charging" update.
      if (this._notChargingTimerId !== null) {
        GLib.Source.remove(this._notChargingTimerId);
        this._notChargingTimerId = null;
      }
      this._callback(state);
    } else {
      // Possibly not charging — wait before acting to filter transient glitches.
      if (this._notChargingTimerId !== null) {
        GLib.Source.remove(this._notChargingTimerId);
      }
      this._notChargingTimerId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        NOT_CHARGING_DEBOUNCE_MS,
        () => {
          this._notChargingTimerId = null;
          // Re-read: if the charger came back during the delay, respect that.
          this._notify();
          return GLib.SOURCE_REMOVE;
        },
      );
    }
  }

  private _readState(proxy: Gio.DBusProxy): BatteryState {
    const percentage = proxy.get_cached_property('Percentage')?.get_double() ?? 100;
    const state      = proxy.get_cached_property('State')?.get_uint32() ?? 2;
    const charging   = state === UPOWER_STATE_CHARGING || state === UPOWER_STATE_PENDING_CHARGE;
    return { percentage, charging };
  }
}
