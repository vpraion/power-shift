# PowerShift Roadmap & Future Enhancements

This document tracks planned improvements and broader hardware compatibility targets for **PowerShift**.

---

## 🎯 High Priority

### 1. Steam Deck LCD & Display Refresh Rate Handling
- [ ] Confirm power supply sysfs path (`/sys/class/power_supply/ACAD/online`) behaves identically on Steam Deck LCD.
- [ ] Dynamically query the device's native max refresh rate bounds (`display_refresh_manual_hz_max` from `PerfStore.msgLimits`) rather than using any hardcoded 90 Hz fallback.

### 2. Multi-Device Power Supply Discovery
- [ ] Support non-standard AC adapter sysfs names (`ACAD`, `AC`, `ADP1`) for third-party handhelds running SteamOS-like distros (Bazzite, ChimeraOS on ROG Ally, Legion Go, etc.).
- [ ] Ensure dynamic TDP bounds beyond 15 W (e.g. up to 30 W on Z1 Extreme handhelds) are captured and restored accurately from native QAM.

---

## 💡 Planned Features

### 3. Dedicated Docked / External Monitor Mode
- [ ] Detect when the Steam Deck is connected to an external display (docked mode).
- [ ] Provide an optional dedicated `docked.json` profile so users can automatically apply custom settings specifically for TV/monitor play (e.g., fixed 60 Hz / max TDP).

### 4. In-App Release Notifier (Out-of-Store Updates)
- [ ] Add an unobtrusive version check in the PowerShift panel querying GitHub Releases (`https://api.github.com/repos/vpraion/power-shift/releases/latest`).
- [ ] Display an "Update Available" indicator with a direct link/instructions for users who installed via ZIP or URL outside the official store.
