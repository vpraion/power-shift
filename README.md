# PowerShift ⚡🔋

**PowerShift** is a lightweight Decky Loader plugin for Steam Deck that automatically switches performance profiles (TDP limit, Framerate cap, GPU clock) between **Battery** and **Plugged-in (AC)** modes.

> [!NOTE]
> **Compatibility Notice**: At the moment, PowerShift is **only designed and tested for the Steam Deck OLED**. LCD model support has not been validated yet.

> [!IMPORTANT]
> **Plugin Compatibility**: If you use PowerShift, **do not use `PowerTools` or `SimpleDeckyTDP` concurrently** to avoid conflicting hardware overrides.
>
> PowerShift is deliberately designed for **plug & play simplicity** — it hooks directly into Steam's native Quick Access Menu (QAM) with zero complex setup. It does not aim to offer the deep, advanced hardware granularity of powerful tools like `SimpleDeckyTDP`.

## Features

- **Automatic Power State Switching**: Seamlessly switches between battery and plugged profiles the instant you plug or unplug your charger.
- **Native QAM Integration**: Adjust your sliders directly in Steam's native Quick Access Menu (QAM) — PowerShift automatically captures and saves your changes to the active power mode.
- **Per-Game & Default Profiles**: Honors Steam's native "Use per-game profile" toggle.
- **Unified Slider UI Friendly**: Fully compatible with SteamOS 3.5+ unified framerate slider.
- **Popup Notifications**: Clean, unobtrusive toast notifications confirming profile switches (can be toggled on/off in the PowerShift tab).

## 📦 Installation

### From GitHub Releases (Decky Loader)
1. Download the latest `PowerShift.zip` from the [Releases](https://github.com/vpraion/power-shift/releases) tab.
2. In Game Mode, open **Decky Loader Settings** > **Developer**.
3. Select **Install plugin from ZIP file** and select `PowerShift.zip`.

## 🛠️ Development

```bash
# Install dependencies
pnpm install

# Build frontend
pnpm run build

# Package plugin into release ZIP
pnpm run package
```

## 📄 License

This project is licensed under the [MIT License](LICENSE).
