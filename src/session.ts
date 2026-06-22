import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SESSION_MANAGER_NAME  = 'org.gnome.SessionManager';
const SESSION_MANAGER_PATH  = '/org/gnome/SessionManager';
const SESSION_MANAGER_IFACE = 'org.gnome.SessionManager';
const CLIENT_PRIVATE_IFACE  = 'org.gnome.SessionManager.ClientPrivate';

export type SessionEndCallback = () => void;

/**
 * Registers with GNOME Session Manager as a client so we are notified before
 * the user's session ends on logout.
 *
 * gnome-session orchestrates logout (not logind), so ShutdownMonitor's
 * PrepareForShutdown inhibitor does not fire on logout. This class fills that
 * gap by listening to the ClientPrivate interface signals that gnome-session
 * delivers to every registered client:
 *
 *   QueryEndSession  – SM asks clients if they're ready; we acknowledge immediately.
 *   EndSession       – SM tells clients the session is ending; we release the LED
 *                      and acknowledge so SM can proceed without delay.
 *   Stop             – final "you're being killed" notice; we release the LED.
 */
export class SessionMonitor {
  private _clientPath:          string | null = null;
  private _querySignalId:       number | null = null;
  private _endSessionSignalId:  number | null = null;
  private _stopSignalId:        number | null = null;

  constructor(private readonly _callback: SessionEndCallback) {}

  start(): void {
    if (this._clientPath !== null) return;

    Gio.DBus.session.call(
      SESSION_MANAGER_NAME,
      SESSION_MANAGER_PATH,
      SESSION_MANAGER_IFACE,
      'RegisterClient',
      new GLib.Variant('(ss)', ['fw-battery-led', '']),
      new GLib.VariantType('(o)'),
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (_conn: Gio.DBusConnection, result: Gio.AsyncResult) => {
        try {
          const reply = Gio.DBus.session.call_finish(result);
          const [clientPath] = reply.deepUnpack() as [string];
          this._clientPath = clientPath;
          this._subscribeSignals(clientPath);
        } catch (e) {
          console.error('[fw-battery-led] SessionMonitor: failed to register client:', e);
        }
      },
    );
  }

  stop(): void {
    if (this._querySignalId !== null) {
      Gio.DBus.session.signal_unsubscribe(this._querySignalId);
      this._querySignalId = null;
    }
    if (this._endSessionSignalId !== null) {
      Gio.DBus.session.signal_unsubscribe(this._endSessionSignalId);
      this._endSessionSignalId = null;
    }
    if (this._stopSignalId !== null) {
      Gio.DBus.session.signal_unsubscribe(this._stopSignalId);
      this._stopSignalId = null;
    }
    this._clientPath = null;
  }

  private _subscribeSignals(clientPath: string): void {
    this._querySignalId = Gio.DBus.session.signal_subscribe(
      SESSION_MANAGER_NAME,
      CLIENT_PRIVATE_IFACE,
      'QueryEndSession',
      clientPath,
      null,
      Gio.DBusSignalFlags.NONE,
      this._onQueryEndSession.bind(this),
    );

    this._endSessionSignalId = Gio.DBus.session.signal_subscribe(
      SESSION_MANAGER_NAME,
      CLIENT_PRIVATE_IFACE,
      'EndSession',
      clientPath,
      null,
      Gio.DBusSignalFlags.NONE,
      this._onEndSession.bind(this),
    );

    this._stopSignalId = Gio.DBus.session.signal_subscribe(
      SESSION_MANAGER_NAME,
      CLIENT_PRIVATE_IFACE,
      'Stop',
      clientPath,
      null,
      Gio.DBusSignalFlags.NONE,
      this._onStop.bind(this),
    );
  }

  /** SM is checking if we're ready to end the session. Always say yes. */
  private _onQueryEndSession(
    _conn: Gio.DBusConnection,
    _sender: string,
    _path: string,
    _iface: string,
    _signal: string,
    _params: GLib.Variant,
  ): void {
    this._respondEndSession();
  }

  /** SM is telling us the session is ending. Release the LED first, then ack. */
  private _onEndSession(
    _conn: Gio.DBusConnection,
    _sender: string,
    _path: string,
    _iface: string,
    _signal: string,
    _params: GLib.Variant,
  ): void {
    this._callback();
    this._respondEndSession();
  }

  /** Final notice: the session process is about to be killed. */
  private _onStop(
    _conn: Gio.DBusConnection,
    _sender: string,
    _path: string,
    _iface: string,
    _signal: string,
    _params: GLib.Variant,
  ): void {
    this._callback();
  }

  private _respondEndSession(): void {
    if (this._clientPath === null) return;
    Gio.DBus.session.call(
      SESSION_MANAGER_NAME,
      this._clientPath,
      CLIENT_PRIVATE_IFACE,
      'EndSessionResponse',
      new GLib.Variant('(bs)', [true, '']),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      null,
    );
  }
}
