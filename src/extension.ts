import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import {
  PopupMenuSection,
  PopupMenuItem,
  Ornament,
} from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {
  QuickMenuToggle,
  SystemIndicator,
} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {
  Extension,
  gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';
import { type LedMode, applyMode } from './led.js';
import { BatteryMonitor } from './battery.js';

// ----- mode metadata --------------------------------------------------------

const MODES: ReadonlyArray<{ id: LedMode; label: string }> = [
  { id: 'off',     label: 'Off' },
  { id: 'white',   label: 'White' },
  { id: 'battery', label: 'Battery Indicator' },
] as const;

const MODE_SUBTITLE: Record<LedMode, string> = {
  off:     'Off',
  white:   'White',
  battery: 'Battery',
};

// ----- Quick Settings toggle ------------------------------------------------

const PowerLedToggle = GObject.registerClass(
  class PowerLedToggle extends QuickMenuToggle {
    private _section: PopupMenuSection | null = null;
    private _items = new Map<LedMode, PopupMenuItem>();

    constructor(readonly _extension: PowerLedExtension) {
      super({
        title: _('Power LED'),
        // toggleMode: false — this is a mode selector, not an on/off switch
        toggleMode: false,
        gicon: Gio.icon_new_for_string(
          `${_extension.path}/icons/power-led.svg`,
        ),
      });

      this.menu.setHeader(
        Gio.icon_new_for_string(`${_extension.path}/icons/power-led.svg`),
        _('Power LED'),
      );

      this._section = new PopupMenuSection();

      for (const { id, label } of MODES) {
        const item = new PopupMenuItem(_(label));
        this._section.addMenuItem(item);
        this._items.set(id, item);

        item.connect('activate', () => {
          _extension.setMode(id);
        });
      }

      this.menu.addMenuItem(this._section);

      this.connect('destroy', () => {
        this._section?.destroy();
        this._section = null;
        this._items.clear();
      });
    }

    setActiveMode(mode: LedMode): void {
      this.subtitle = _(MODE_SUBTITLE[mode]);

      for (const [id, item] of this._items.entries()) {
        item.setOrnament(id === mode ? Ornament.CHECK : Ornament.NONE);
      }
    }
  },
);

// ----- Extension lifecycle --------------------------------------------------

export default class PowerLedExtension extends Extension {
  private _indicator: InstanceType<typeof SystemIndicator> | null = null;
  private _toggle: InstanceType<typeof PowerLedToggle> | null = null;
  private _settings: Gio.Settings | null = null;
  private _batteryMonitor: BatteryMonitor | null = null;

  private _currentMode: LedMode = 'white';
  private _batteryPercentage = 100;
  private _batteryCharging = false;

  enable(): void {
    this._settings = this.getSettings();
    this._currentMode = (this._settings.get_string('mode') as LedMode) ?? 'white';

    this._toggle = new PowerLedToggle(this);
    this._indicator = new SystemIndicator();
    this._indicator.quickSettingsItems.push(this._toggle);

    // @ts-expect-error — addExternalIndicator is not yet typed in @girs
    Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

    this._toggle.setActiveMode(this._currentMode);

    this._batteryMonitor = new BatteryMonitor(({ percentage, charging }) => {
      this._batteryPercentage = percentage;
      this._batteryCharging = charging;
      if (this._currentMode === 'battery') {
        this._applyLed();
      }
    });

    this._batteryMonitor
      .start()
      .catch(e => console.error('[fw-battery-led] Battery monitor error:', e));

    this._applyLed();
  }

  disable(): void {
    this._batteryMonitor?.stop();
    this._batteryMonitor = null;

    this._indicator?.destroy();
    this._indicator = null;

    this._toggle?.destroy();
    this._toggle = null;

    this._settings = null;
  }

  setMode(mode: LedMode): void {
    this._currentMode = mode;
    this._settings?.set_string('mode', mode);
    this._toggle?.setActiveMode(mode);
    this._applyLed();
  }

  private _applyLed(): void {
    applyMode(this._currentMode, this._batteryPercentage, this._batteryCharging);
  }
}
