import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export type SleepCallback = (sleeping: boolean) => void;

/**
 * Subscribes to logind's PrepareForSleep D-Bus signal via a direct connection
 * signal subscription (more reliable than GDBusProxy for non-property signals
 * across multiple sleep/wake cycles).
 */
export class SleepMonitor {
  private _subscriptionId: number | null = null;

  constructor(private readonly _callback: SleepCallback) {}

  start(): void {
    if (this._subscriptionId !== null) return;

    this._subscriptionId = Gio.DBus.system.signal_subscribe(
      'org.freedesktop.login1',
      'org.freedesktop.login1.Manager',
      'PrepareForSleep',
      '/org/freedesktop/login1',
      null,
      Gio.DBusSignalFlags.NONE,
      (
        _conn: Gio.DBusConnection,
        _sender: string,
        _path: string,
        _iface: string,
        _signal: string,
        params: GLib.Variant,
      ) => {
        this._callback(params.get_child_value(0).get_boolean());
      },
    );
  }

  stop(): void {
    if (this._subscriptionId !== null) {
      Gio.DBus.system.signal_unsubscribe(this._subscriptionId);
      this._subscriptionId = null;
    }
  }
}
