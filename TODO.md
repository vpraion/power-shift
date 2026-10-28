# TODO: Dynamic Hardware Limits & Device Compatibility

Currently, PowerShift uses default fallback ranges based on the **Steam Deck OLED** hardware specifications:
- **Display Refresh Rate**: 45 Hz - 90 Hz
- **Framerate Limit**: 30 - 90 FPS (or Unlimited)
- **TDP Limit**: 3 W - 15 W

## Next Steps for Dynamic Range Discovery

To support other devices seamlessly (such as Steam Deck LCD, ROG Ally, Lenovo Legion Go, AYANEO, etc.):

### 1. Retrieve Ranges from Steam's `PerfStore`
SteamOS GamepadUI already exposes the hardware limits via the `msgLimits` property of `PerfStore` (`mod83761.Hn.Get()`):

```ts
const stores = getSteamStores();
const limits = stores?.perfStore?.msgLimits;

// Refresh rate bounds
const minRefreshHz = limits?.display_refresh_manual_hz_min ?? 40;
const maxRefreshHz = limits?.display_refresh_manual_hz_max ?? 60;

// TDP bounds
const minTdp = limits?.tdp_limit_min ?? 3;
const maxTdp = limits?.tdp_limit_max ?? 15;

// Available Framerate limit options (list or object)
const fpsOptions = limits?.fps_limit_options; 
// e.g. on OLED: { 0: 22, 1: 45, 2: 90, 3: 0 } (0 represents unlimited)
// on LCD: { 0: 15, 1: 30, 2: 60, 3: 0 }
```

### 2. Update the UI Components Dynamically
- Pass `min={minRefreshHz}` and `max={maxRefreshHz}` to the Display Refresh Rate `SliderField`.
- Pass `min={minTdp}` and `max={maxTdp}` to the TDP `SliderField`.
- Map the framerate slider or dropdown to the discrete steps provided in `limits.fps_limit_options`.

### 3. Handle External Displays
When docked or connected to an external monitor:
- Check `limits.fps_limit_options_external` and `display_external_refresh_manual_hz`.
- Apply `SetDisplayRefreshRateManualHz(true, hz)` and `SetFPSLimit(true, fps)` when `is_external_display` is detected.
