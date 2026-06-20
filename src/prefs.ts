import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {
  ExtensionPreferences,
  gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PowerLedPreferences extends ExtensionPreferences {
  async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();

    // ── Battery mode page ───────────────────────────────────────────────────
    const page = new Adw.PreferencesPage({
      title: _('Battery Mode'),
      iconName: 'battery-symbolic',
    });
    window.add(page);

    // ── Threshold group ─────────────────────────────────────────────────────
    const thresholdGroup = new Adw.PreferencesGroup({
      title: _('Colour Thresholds'),
      description: _(
        'The LED colour changes based on battery percentage. ' +
        'Each threshold is the minimum percentage for that colour. ' +
        'Below the lowest threshold the LED shows red.',
      ),
    });
    page.add(thresholdGroup);

    thresholdGroup.add(
      this._makeSpinRow(
        settings,
        'threshold-white',
        _('White (%)'),
        _('LED shows white at or above this percentage'),
      ),
    );

    thresholdGroup.add(
      this._makeSpinRow(
        settings,
        'threshold-green',
        _('Green (%)'),
        _('LED shows green at or above this percentage'),
      ),
    );

    thresholdGroup.add(
      this._makeSpinRow(
        settings,
        'threshold-yellow',
        _('Yellow (%)'),
        _('LED shows yellow at or above this percentage'),
      ),
    );

    thresholdGroup.add(
      this._makeSpinRow(
        settings,
        'threshold-amber',
        _('Amber (%)'),
        _('LED shows amber at or above this percentage (red below)'),
      ),
    );

    // ── Charging group ──────────────────────────────────────────────────────
    const chargingGroup = new Adw.PreferencesGroup({
      title: _('Charging'),
    });
    page.add(chargingGroup);

    const chargeRow = new Adw.SwitchRow({
      title: _('Show charging colour'),
      subtitle: _(
        'LED shows blue while the battery is charging. ' +
        'Note: the blue LED component is non-functional on some Framework hardware.',
      ),
    });
    // @ts-expect-error — @girs SwitchRow missing connectObject stub; runtime is fine
    settings.bind('charge-indicator', chargeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    chargingGroup.add(chargeRow);
  }

  private _makeSpinRow(
    settings: Gio.Settings,
    key: string,
    title: string,
    subtitle: string,
  ): Adw.SpinRow {
    const row = new Adw.SpinRow({
      title,
      subtitle,
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 100,
        step_increment: 1,
        page_increment: 5,
      }),
    });
    // @ts-expect-error — @girs type for settings.bind() value param is incomplete for SpinRow
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
  }
}
