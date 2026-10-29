import { call } from "@decky/api";
import { PowerMode, PowerProfile, PluginConfig } from "./types";
import { getSteamStores, getProfileTarget } from "./steam";
import { showToast, showErrorToast } from "./toasts";

let currentPowerMode: PowerMode = "plugged";
let isApplyingProfile = false;
let isSwitchingProfile = false;
let configCache: PluginConfig = { show_notifications: true };
let lastAppliedHash = "";
let saveDebounceTimer: any = null;

export function getCurrentPowerMode(): PowerMode {
  return currentPowerMode;
}

export function setCurrentPowerMode(mode: PowerMode) {
  currentPowerMode = mode;
}

export function getConfigCache(): PluginConfig {
  return configCache;
}

export function setConfigCache(config: PluginConfig) {
  configCache = config;
}

// Read current QAM settings dynamically from hardware without unsafe hardcoded fallbacks
export function readCurrentQAMSettings(): PowerProfile | null {
  const stores = getSteamStores();
  if (!stores?.settingsStore) {
    showErrorToast("settingsStore", "Steam UI");
    return null;
  }

  const ss = stores.settingsStore;
  const limits = stores.perfStore?.msgLimits;

  const fps = Number(ss.gamescope_app_target_framerate ?? 0);
  const isFpsEnabled = ss.gamescope_disable_framelimit !== undefined
    ? !ss.gamescope_disable_framelimit
    : (ss.gamescope_enable_app_target_framerate !== undefined ? Boolean(ss.gamescope_enable_app_target_framerate) : fps > 0);

  const refreshHz = ss.gamescope_display_refresh_rate ??
    limits?.display_refresh_manual_hz_max ??
    stores.perfStore?.msgState?.display_refresh_rate;

  const isTdpEnabled = Boolean(ss.steamos_tdp_limit_enabled);
  const tdp = ss.steamos_tdp_limit ??
    limits?.steamos_tdp_limit_default ??
    limits?.steamos_tdp_limit_max;

  if (isTdpEnabled && (tdp === undefined || tdp === null)) {
    showErrorToast("steamos_tdp_limit", "QAM hardware");
  }

  const isGpuManual = Boolean(ss.steamos_manual_gpu_clock_enabled);
  const gpuHz = ss.steamos_manual_gpu_clock_hz ??
    limits?.steamos_manual_gpu_clock_hz_max;

  if (isGpuManual && (gpuHz === undefined || gpuHz === null)) {
    showErrorToast("steamos_manual_gpu_clock_hz", "QAM hardware");
  }

  const profile: PowerProfile = {
    is_fps_limit_enabled: isFpsEnabled,
    fps_limit: fps,
    is_tdp_limit_enabled: isTdpEnabled,
    is_manual_gpu_clock_enabled: isGpuManual,
  };

  if (refreshHz !== undefined && refreshHz !== null) {
    profile.display_refresh_manual_hz = Number(refreshHz);
  }
  if (tdp !== undefined && tdp !== null) {
    profile.tdp_limit = Number(tdp);
  }
  if (gpuHz !== undefined && gpuHz !== null) {
    profile.manual_gpu_clock_hz = Number(gpuHz);
  }

  return profile;
}

// Apply profile atomically via native clientSettings
export async function applyProfile(profile: PowerProfile, mode: PowerMode, targetKey: string, isPowerTransition: boolean) {
  const stores = getSteamStores();
  if (!stores?.setSetting) {
    showErrorToast("setSetting", "Steam UI");
    return;
  }

  const setSetting = stores.setSetting;
  const fpsLimit = profile.is_fps_limit_enabled === false ? 0 : Number(profile.fps_limit ?? 0);

  try {
    // 1. Framerate limit via native clientSettings (same store as TDP)
    // gamescope_enable_app_target_framerate MUST remain true to prevent QAM from reverting to legacy 2-slider UI
    setSetting("gamescope_enable_app_target_framerate", true);
    if (fpsLimit > 0) {
      setSetting("gamescope_app_target_framerate", fpsLimit);
      setSetting("gamescope_disable_framelimit", false);
    } else {
      setSetting("gamescope_disable_framelimit", true);
    }

    // 2. TDP limit: only touch hardware TDP if explicitly enabled with a valid value
    if (profile.is_tdp_limit_enabled) {
      if (profile.tdp_limit !== undefined && profile.tdp_limit !== null) {
        setSetting("steamos_tdp_limit_enabled", true);
        setSetting("steamos_tdp_limit", Number(profile.tdp_limit));
      } else {
        showErrorToast("tdp_limit", "active profile");
        setSetting("steamos_tdp_limit_enabled", false);
      }
    } else if (profile.is_tdp_limit_enabled !== undefined) {
      setSetting("steamos_tdp_limit_enabled", false);
    }

    // 3. GPU clock: only touch hardware GPU clock if explicitly enabled with a valid frequency
    if (profile.is_manual_gpu_clock_enabled) {
      if (profile.manual_gpu_clock_hz !== undefined && profile.manual_gpu_clock_hz !== null) {
        setSetting("steamos_manual_gpu_clock_enabled", true);
        setSetting("steamos_manual_gpu_clock_hz", Number(profile.manual_gpu_clock_hz));
      } else {
        showErrorToast("manual_gpu_clock_hz", "active profile");
        setSetting("steamos_manual_gpu_clock_enabled", false);
      }
    } else if (profile.is_manual_gpu_clock_enabled !== undefined) {
      setSetting("steamos_manual_gpu_clock_enabled", false);
    }

    // 4. Toast notification: ONLY on true battery/plugged transitions and if enabled in config
    if (isPowerTransition) {
      const cfg = await call<[], PluginConfig>("get_config").catch(() => null);
      const shouldNotify = cfg ? cfg.show_notifications : configCache.show_notifications;
      if (shouldNotify) {
        const modeLabel = mode === "docked" ? "🖥️ Docked Mode" : (mode === "plugged" ? "⚡ Plugged Mode" : "🔋 Battery Mode");
        const profileLabel = targetKey === "default" ? "Default" : "Per-Game";
        const tdpText = profile.is_tdp_limit_enabled && profile.tdp_limit !== undefined ? `${profile.tdp_limit}W` : "TDP Auto";
        const fpsText = fpsLimit > 0 ? `${fpsLimit}FPS` : "Unlimited FPS";
        const details = `${fpsText} | ${tdpText} (${profileLabel})`;
        showToast(`PowerShift: ${modeLabel}`, details);
      }
    }
  } catch (err: any) {
    console.error("[PowerShift] Error applying profile:", err);
    showErrorToast(err?.message || "applyProfile", "runtime error");
  }
}

export async function triggerProfileSwitch(newMode: PowerMode, reason: string, isPowerTransition: boolean) {
  if (isSwitchingProfile) return;
  isSwitchingProfile = true;
  isApplyingProfile = true;
  clearTimeout(saveDebounceTimer);

  const target = getProfileTarget();

  try {
    const res = await call<[string, string], { exists: boolean; profile: PowerProfile | null }>(
      "get_profile",
      target.key,
      newMode
    );

    if (res?.exists && res.profile) {
      await applyProfile(res.profile, newMode, target.key, isPowerTransition);
    } else {
      // Profile file doesn't exist yet: snapshot current QAM values!
      const current = readCurrentQAMSettings();
      if (current) {
        await call("save_profile", target.key, newMode, current);
      }
    }
    currentPowerMode = newMode;
  } catch (err) {
    console.error(`[PowerShift] Failed to apply profile on ${reason}:`, err);
  } finally {
    setTimeout(() => {
      const current = readCurrentQAMSettings();
      if (current) {
        lastAppliedHash = JSON.stringify(current);
      }
      isApplyingProfile = false;
      isSwitchingProfile = false;
    }, 1500);
  }
}

// Auto-save manual slider adjustments made directly in the native QAM
export function handleSettingsChange() {
  if (isApplyingProfile) return;

  const current = readCurrentQAMSettings();
  if (!current) return;

  const currentHash = JSON.stringify(current);
  if (currentHash === lastAppliedHash) return;

  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    if (isApplyingProfile) return;
    const target = getProfileTarget();
    try {
      lastAppliedHash = currentHash;
      await call("save_profile", target.key, currentPowerMode, current);
    } catch (err) {
      console.error("[PowerShift] Failed to auto-save profile:", err);
    }
  }, 1000);
}
