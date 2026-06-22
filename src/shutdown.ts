import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const LOGIND_NAME    = 'org.freedesktop.login1';
const LOGIND_PATH    = '/org/freedesktop/login1';
const LOGIND_MANAGER = 'org.freedesktop.login1.Manager';

export type ShutdownCallback = () => void;

/**
 * Listens for an imminent system shutdown via logind's PrepareForShutdown
 * D-Bus signal and fires the callback before the shutdown proceeds.
 *
 * A logind 'delay' inhibitor is held while the monitor is active. This
 * serves two purposes:
 *   1. It ensures the PrepareForShutdown signal is actually delivered to us
 *      (logind only sends it to subscribers that hold an inhibitor, analogous
 *      to how GNOME Shell's LoginManager holds a sleep inhibitor to receive
 *      PrepareForSleep).
 *   2. It guarantees logind waits for us to release the lock before
 *      continuing with the shutdown sequence, giving the callback time to act.
 */
export class ShutdownMonitor {
  private _signalId: number | null = null;
  private _inhibitorFd: number | null = null;

  constructor(private readonly _callback: ShutdownCallback) {}

  start(): void {
    if (this._signalId !== null) return;

    // Subscribe before acquiring the inhibitor so we cannot miss a racing signal.
    this._signalId = Gio.DBus.system.signal_subscribe(
      LOGIND_NAME,
      LOGIND_MANAGER,
      'PrepareForShutdown',
      LOGIND_PATH,
      null,
      Gio.DBusSignalFlags.NONE,
      this._onSignal.bind(this),
    );

    this._acquireInhibitor();
  }

  stop(): void {
    if (this._signalId !== null) {
      Gio.DBus.system.signal_unsubscribe(this._signalId);
      this._signalId = null;
    }
    this._releaseInhibitor();
  }

  private _acquireInhibitor(): void {
    // biome-ignore lint/suspicious/noExplicitAny: async callback source is untyped
    (Gio.DBus.system as any).call_with_unix_fd_list(
      LOGIND_NAME,
      LOGIND_PATH,
      LOGIND_MANAGER,
      'Inhibit',
      new GLib.Variant('(ssss)', [
        'shutdown',
        'fw-battery-led',
        'Turn off power LED before shutdown',
        'delay',
      ]),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      null,
      (_source: unknown, result: Gio.AsyncResult) => {
        try {
          // biome-ignore lint/suspicious/noExplicitAny: call_with_unix_fd_list_finish not yet in @girs
          const [, fdList] = (Gio.DBus.system as any).call_with_unix_fd_list_finish(result) as [GLib.Variant, Gio.UnixFDList | null];
          if (fdList && fdList.get_length() > 0) {
            this._inhibitorFd = fdList.get(0);
          }
        } catch (e) {
          console.error('[fw-battery-led] ShutdownMonitor: failed to acquire inhibitor:', e);
        }
      },
    );
  }

  private _releaseInhibitor(): void {
    if (this._inhibitorFd !== null) {
      try {
        // Wrapping in a UnixInputStream with closeFd:true is the idiomatic GJS
        // way to close a raw fd without a direct POSIX close() binding.
        // biome-ignore lint/suspicious/noExplicitAny: UnixInputStream not in @girs
        new (Gio as any).UnixInputStream({ fd: this._inhibitorFd, closeFd: true }).close(null);
      } catch (_e) {
        // best-effort
      }
      this._inhibitorFd = null;
    }
  }

  private _onSignal(
    _conn: Gio.DBusConnection,
    _sender: string,
    _path: string,
    _iface: string,
    _signal: string,
    params: GLib.Variant,
  ): void {
    const [active] = params.deepUnpack() as [boolean];
    if (active) {
      this._callback();
      this._releaseInhibitor();
    }
  }
}
