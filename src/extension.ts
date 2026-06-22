import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import {
  PopupMenuSection,
  PopupMenuItem,
  PopupSeparatorMenuItem,
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
import { type LedMode, type Thresholds, applyMode, releaseToKernel } from './led.js';
import { BatteryMonitor } from './battery.js';
import { SleepMonitor } from './sleep.js';
import { ShutdownMonitor } from './shutdown.js';

// ----- types ----------------------------------------------------------------

type ColorMode = 'white' | 'battery';

// ----- mode metadata --------------------------------------------------------

/** Only the two "on" colour modes appear in the popup menu. */
const COLOR_MODES: ReadonlyArray<{ id: ColorMode; label: string }> = [
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
    private _items = new Map<ColorMode, PopupMenuItem>();
    // Guard against re-entrant notify::checked when we set it programmatically.
    private _settingChecked = false;

    constructor(readonly _extension: PowerLedExtension) {
      super({
        title: _('Power LED'),
        // toggleMode: true — left-click toggles on/off; right side opens the menu.
        toggleMode: true,
        gicon: Gio.icon_new_for_string(
          `${_extension.path}/icons/power-led-symbolic.svg`,
        ),
      });

      this.menu.setHeader(
        Gio.icon_new_for_string(`${_extension.path}/icons/power-led-symbolic.svg`),
        _('Power LED'),
      );

      // Toggle clicked → flip LED on/off.
      this.connect('notify::checked', () => {
        if (this._settingChecked) return;
        if (this.checked) {
          _extension.restoreColorMode();
        } else {
          _extension.setMode('off');
        }
      });

      this._section = new PopupMenuSection();

      for (const { id, label } of COLOR_MODES) {
        const item = new PopupMenuItem(_(label));
        this._section.addMenuItem(item);
        this._items.set(id, item);

        item.connect('activate', () => {
          _extension.setMode(id);
        });
      }

      this.menu.addMenuItem(this._section);

      // Separator + Preferences link at the bottom of the popup.
      this.menu.addMenuItem(new PopupSeparatorMenuItem());
      const prefsItem = new PopupMenuItem(_('Preferences…'));
      prefsItem.connect('activate', () => {
        _extension.openPreferences();
      });
      this.menu.addMenuItem(prefsItem);


      this.connect('destroy', () => {
        this._section?.destroy();
        this._section = null;
        this._items.clear();
      });
    }

    setActiveMode(mode: LedMode): void {
      this.subtitle = _(MODE_SUBTITLE[mode]);

      // Update checked state without triggering the notify handler.
      this._settingChecked = true;
      this.checked = mode !== 'off';
      this._settingChecked = false;

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
  private _sleepMonitor: SleepMonitor | null = null;
  private _shutdownMonitor: ShutdownMonitor | null = null;
  private _settingsChangedId: number | null = null;
  private _screenShieldId: number | null = null;

  private _suspended = false;
  private _currentMode: LedMode = 'white';
  private _lastColorMode: ColorMode = 'white';
  private _batteryPercentage = 100;
  private _batteryCharging = false;

  enable(): void {
    this._settings = this.getSettings();

    this._currentMode = (this._settings.get_string('mode') as LedMode) ?? 'white';
    this._lastColorMode =
      (this._settings.get_string('color-mode') as ColorMode) ?? 'white';

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

    this._sleepMonitor = new SleepMonitor(sleeping => {
      this._suspended = sleeping;
      if (sleeping) {
        releaseToKernel();
      } else {
        this._applyLed();
      }
    });

    this._sleepMonitor.start();

    this._shutdownMonitor = new ShutdownMonitor(() => {
      releaseToKernel();
    });

    this._shutdownMonitor.start();

    // Re-apply after the lock screen appears or is dismissed. GNOME resets LED
    // brightness as part of its wake/lock sequence, so we need to reapply once
    // the screen shield has settled.
    this._screenShieldId = Main.screenShield?.connect(
      'notify::locked',
      () => this._applyLed(),
    ) ?? null;

    // Re-apply LED immediately when any relevant setting changes.
    this._settingsChangedId = this._settings.connect('changed', (_s, key) => {
      if (key === 'threshold-white' || key === 'threshold-green' ||
          key === 'threshold-yellow' || key === 'threshold-amber' ||
          key === 'charge-indicator') {
        if (this._currentMode === 'battery') {
          this._applyLed();
        }
      }
    });

    this._applyLed();
  }

  disable(): void {
    if (this._settings !== null && this._settingsChangedId !== null) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }

    this._batteryMonitor?.stop();
    this._batteryMonitor = null;

    this._sleepMonitor?.stop();
    this._sleepMonitor = null;
    this._suspended = false;

    this._shutdownMonitor?.stop();
    this._shutdownMonitor = null;

    if (this._screenShieldId !== null) {
      Main.screenShield?.disconnect(this._screenShieldId);
      this._screenShieldId = null;
    }

    this._indicator?.destroy();
    this._indicator = null;

    this._toggle?.destroy();
    this._toggle = null;

    this._settings = null;

    // Hand the LED back to the EC/kernel driver so it resumes automatic
    // control (charging indicator, etc.) on shutdown or whenever the
    // extension is disabled.
    releaseToKernel();
  }

  /** Set the LED to the given mode and persist it. */
  setMode(mode: LedMode): void {
    this._currentMode = mode;
    this._settings?.set_string('mode', mode);

    if (mode === 'white' || mode === 'battery') {
      this._lastColorMode = mode;
      this._settings?.set_string('color-mode', mode);
    }

    this._toggle?.setActiveMode(mode);
    this._applyLed();
  }

  /** Restore the last active colour mode (used when toggling back on). */
  restoreColorMode(): void {
    this.setMode(this._lastColorMode);
  }

  private _getThresholds(): Thresholds {
    return {
      white:  this._settings!.get_int('threshold-white'),
      green:  this._settings!.get_int('threshold-green'),
      yellow: this._settings!.get_int('threshold-yellow'),
      amber:  this._settings!.get_int('threshold-amber'),
    };
  }

  private _applyLed(): void {
    if (this._suspended) return;

    const thresholds = this._getThresholds();
    const chargeIndicator = this._settings!.get_boolean('charge-indicator');
    applyMode(
      this._currentMode,
      this._batteryPercentage,
      this._batteryCharging,
      thresholds,
      chargeIndicator,
    );
  }
}
