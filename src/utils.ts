import Gio from 'gi://Gio';
import type GLib from 'gi://GLib';

export function toError(thing: unknown): Error {
  return thing instanceof Error ? thing : new Error(String(thing));
}

/**
 * Creates an async Gio.DBusProxy for the given bus name, object path, and
 * interface name on the system bus.
 */
export function dbusProxy(
  name: string,
  path: string,
  iface: string,
  cancellable: Gio.Cancellable | null,
): Promise<Gio.DBusProxy> {
  return new Promise((resolve, reject) => {
    Gio.DBusProxy.new_for_bus(
      Gio.BusType.SYSTEM,
      Gio.DBusProxyFlags.NONE,
      null,
      name,
      path,
      iface,
      cancellable,
      (_source, res: Gio.AsyncResult) => {
        try {
          resolve(Gio.DBusProxy.new_for_bus_finish(res));
        } catch (e) {
          reject(toError(e));
        }
      },
    );
  });
}

/**
 * Calls a D-Bus method on a proxy and returns the result GLib.Variant.
 */
export function dbusCall(
  proxy: Gio.DBusProxy,
  method: string,
  params: GLib.Variant | null,
  cancellable: Gio.Cancellable | null,
): Promise<GLib.Variant> {
  return new Promise((resolve, reject) => {
    proxy.call(
      method,
      params,
      Gio.DBusCallFlags.NONE,
      -1,
      cancellable,
      (_source, res: Gio.AsyncResult) => {
        try {
          resolve(proxy.call_finish(res));
        } catch (e) {
          reject(toError(e));
        }
      },
    );
  });
}
