// @ts-expect-error — loginManager resource has no @girs types but exists at runtime.
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';

export type SleepCallback = (sleeping: boolean) => void;

/**
 * Listens for suspend/resume via GNOME Shell's LoginManager `prepare-for-sleep`
 * signal. This is the mechanism GNOME Shell itself uses; a raw
 * `Gio.DBus.system.signal_subscribe` for logind's PrepareForSleep does not get
 * delivered on the shell's shared system-bus connection.
 *
 * The signal fires with `true` just before suspend and `false` after resume.
 */
export class SleepMonitor {
  // biome-ignore lint/suspicious/noExplicitAny: LoginManager has no @girs types
  private _loginManager: any = null;
  private _signalId: number | null = null;

  constructor(private readonly _callback: SleepCallback) {}

  start(): void {
    if (this._signalId !== null) return;

    this._loginManager = LoginManager.getLoginManager();
    this._signalId = this._loginManager.connect(
      'prepare-for-sleep',
      // biome-ignore lint/suspicious/noExplicitAny: untyped signal source
      (_lm: any, aboutToSuspend: boolean) => {
        this._callback(aboutToSuspend);
      },
    );
  }

  stop(): void {
    if (this._loginManager !== null && this._signalId !== null) {
      this._loginManager.disconnect(this._signalId);
    }
    this._loginManager = null;
    this._signalId = null;
  }
}
