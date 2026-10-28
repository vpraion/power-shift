import { definePlugin, toaster, call } from "@decky/api";
import {
  PanelSection,
  PanelSectionRow,
  ToggleField,
  Field,
} from "@decky/ui";
import { useEffect, useState, FC } from "react";
import { FaBolt } from "react-icons/fa";

interface PowerProfile {
  is_fps_limit_enabled: boolean;
  fps_limit: number;
  display_refresh_manual_hz: number;
  is_tdp_limit_enabled: boolean;
  tdp_limit: number;
  is_manual_gpu_clock_enabled?: boolean;
  manual_gpu_clock_hz?: number;
}

interface PluginConfig {
  show_notifications: boolean;
}

type PowerMode = "battery" | "plugged";

let currentPowerMode: PowerMode = "plugged";
let isApplyingProfile = false;
let configCache: PluginConfig = { show_notifications: true };
let lastAppliedHash = "";

// Webpack store references
let perfStoreRef: any = null;
let settingsStoreRef: any = null;
let setSettingFnRef: ((key: string, value: any) => void) | null = null;

// Find Steam UI internal stores
function getSteamStores() {
  if (perfStoreRef && settingsStoreRef && setSettingFnRef) {
    return { perfStore: perfStoreRef, settingsStore: settingsStoreRef, setSetting: setSettingFnRef };
  }

  const webpack = (window as any).webpackChunksteamui;
  if (!webpack) return null;

  let req: any = null;
  webpack.push([[Math.random()], {}, (r: any) => { req = r; }]);
  if (!req) return null;

  // 1. Locate PerfStore
  try {
    for (const chunk of webpack) {
      const modules = chunk[1] || {};
      for (const id in modules) {
        try {
          const mod = req(id);
          if (mod?.Hn?.Get && typeof mod.Hn.Get === "function") {
            const instance = mod.Hn.Get();
            if (instance && typeof instance.CreateSettingsUpdateRequest === "function") {
              perfStoreRef = instance;
              break;
            }
          }
        } catch (_) {}
      }
      if (perfStoreRef) break;
    }
  } catch (_) {}

  // 2. Locate SettingsStore & setter function
  try {
    for (const chunk of webpack) {
      const modules = chunk[1] || {};
      for (const id in modules) {
        try {
          const mod = req(id);
          if (mod?.rV?.clientSettings && mod.rV.clientSettings.steamos_tdp_limit !== undefined) {
            settingsStoreRef = mod.rV.clientSettings;
            if (typeof mod.qt === "function") {
              setSettingFnRef = mod.qt;
            }
            break;
          }
        } catch (_) {}
      }
      if (settingsStoreRef) break;
    }
  } catch (_) {}

  return {
    perfStore: perfStoreRef,
    settingsStore: settingsStoreRef,
    setSetting: setSettingFnRef,
  };
}

// Determines target profile based directly on QAM "Use per-game profile" toggle
function getProfileTarget(): { key: string; isPerGame: boolean; appId: string } {
  const stores = getSteamStores();
  const ps = stores?.perfStore;
  const currentApp = String(ps?.nCurrentGameID || ps?.msgState?.current_game_id || "769");
  const activeProfileApp = String(ps?.nActiveProfileGameID || ps?.msgState?.active_profile_game_id || "769");

  const isPerGameEnabled = (
    currentApp !== "769" &&
    Boolean(currentApp) &&
    currentApp === activeProfileApp
  );

  return {
    key: isPerGameEnabled ? currentApp : "default",
    isPerGame: isPerGameEnabled,
    appId: currentApp,
  };
}

// Read current QAM settings
function readCurrentQAMSettings(): PowerProfile | null {
  const stores = getSteamStores();
  if (!stores?.settingsStore) return null;

  const ss = stores.settingsStore;
  const fps = Number(ss.gamescope_app_target_framerate ?? 0);
  const isFpsEnabled = ss.gamescope_enable_app_target_framerate !== undefined
    ? Boolean(ss.gamescope_enable_app_target_framerate && !ss.gamescope_disable_framelimit)
    : fps > 0;

  return {
    is_fps_limit_enabled: isFpsEnabled,
    fps_limit: fps,
    display_refresh_manual_hz: Number(ss.gamescope_display_refresh_rate || 90),
    is_tdp_limit_enabled: Boolean(ss.steamos_tdp_limit_enabled),
    tdp_limit: Number(ss.steamos_tdp_limit || 15),
    is_manual_gpu_clock_enabled: Boolean(ss.steamos_manual_gpu_clock_enabled),
    manual_gpu_clock_hz: Number(ss.steamos_manual_gpu_clock_hz || 1600),
  };
}

let lastToastTime = 0;

function showToast(title: string, body: string) {
  const now = Date.now();
  if (now - lastToastTime < 3000) {
    return;
  }
  lastToastTime = now;

  try {
    if (toaster && typeof toaster.toast === "function") {
      toaster.toast({ title, body });
      return;
    }
  } catch (_) {}

  try {
    const deckyToaster = (window as any).DeckyPluginLoader?.toaster;
    if (deckyToaster && typeof deckyToaster.toast === "function") {
      deckyToaster.toast({ title, body });
    }
  } catch (_) {}
}

// Apply profile atomically via native clientSettings
async function applyProfile(profile: PowerProfile, mode: PowerMode, targetKey: string, isPowerTransition: boolean) {
  const stores = getSteamStores();
  if (!stores?.setSetting) return;

  const setSetting = stores.setSetting;
  const fpsLimit = profile.is_fps_limit_enabled === false ? 0 : Number(profile.fps_limit ?? 0);

  try {
    // 1. Framerate limit via native clientSettings (same store as TDP)
    if (fpsLimit > 0) {
      setSetting("gamescope_app_target_framerate", fpsLimit);
      setSetting("gamescope_enable_app_target_framerate", true);
      setSetting("gamescope_disable_framelimit", false);
    } else {
      setSetting("gamescope_disable_framelimit", true);
      setSetting("gamescope_enable_app_target_framerate", false);
    }

    // 2. TDP limit & GPU clock via native clientSettings
    setSetting("steamos_tdp_limit_enabled", Boolean(profile.is_tdp_limit_enabled));
    setSetting("steamos_tdp_limit", Number(profile.tdp_limit));
    if (profile.is_manual_gpu_clock_enabled !== undefined) {
      setSetting("steamos_manual_gpu_clock_enabled", profile.is_manual_gpu_clock_enabled);
    }
    if (profile.manual_gpu_clock_hz !== undefined) {
      setSetting("steamos_manual_gpu_clock_hz", profile.manual_gpu_clock_hz);
    }

    // 3. Toast notification: ONLY on true battery/plugged transitions and if enabled in config
    if (isPowerTransition) {
      const cfg = await call<[], PluginConfig>("get_config").catch(() => null);
      const shouldNotify = cfg ? cfg.show_notifications : configCache.show_notifications;
      if (shouldNotify) {
        const modeLabel = mode === "plugged" ? "⚡ Plugged Mode" : "🔋 Battery Mode";
        const profileLabel = targetKey === "default" ? "Default" : "Per-Game";
        const tdpText = profile.is_tdp_limit_enabled ? `${profile.tdp_limit}W` : "TDP Auto";
        const fpsText = fpsLimit > 0 ? `${fpsLimit}FPS` : "Unlimited FPS";
        const details = `${fpsText} | ${tdpText} (${profileLabel})`;
        showToast(`PowerShift: ${modeLabel}`, details);
      }
    }
  } catch (err) {
    console.error("[PowerShift] Error applying profile:", err);
  }
}

let isSwitchingProfile = false;

async function triggerProfileSwitch(newMode: PowerMode, reason: string, isPowerTransition: boolean) {
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
let saveDebounceTimer: any = null;
function handleSettingsChange() {
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

// React Panel UI in English (Minimalist: Status & Notifications toggle)
const Content: FC = () => {
  const [showNotifications, setShowNotifications] = useState(configCache.show_notifications);
  const [activeMode, setActiveMode] = useState<PowerMode>(currentPowerMode);
  const [targetInfo, setTargetInfo] = useState(getProfileTarget());

  useEffect(() => {
    call<[], PluginConfig>("get_config").then((res: PluginConfig) => {
      if (res) {
        configCache = res;
        setShowNotifications(res.show_notifications);
      }
    });

    const interval = setInterval(() => {
      setActiveMode(currentPowerMode);
      setTargetInfo(getProfileTarget());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleToggleNotifications = async (val: boolean) => {
    setShowNotifications(val);
    configCache.show_notifications = val;
    await call("set_config", { show_notifications: val });
  };

  return (
    <PanelSection title="PowerShift">
      <PanelSectionRow>
        <Field label="Power Source">
          {activeMode === "plugged" ? "⚡ Plugged" : "🔋 On Battery"}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="QAM Profile Target">
          {targetInfo.isPerGame ? `Per-Game (ID: ${targetInfo.appId})` : "Default Profile"}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Popup Notifications"
          description="Display a toast when switching between battery and plugged"
          checked={showNotifications}
          onChange={handleToggleNotifications}
        />
      </PanelSectionRow>
    </PanelSection>
  );
};

const BoltIcon = FaBolt as any;

function isACConnected(eACState: number | undefined): boolean {
  // k_EACState_Connected = 2, k_EACState_ConnectedSlow = 3
  return eACState === 2 || eACState === 3;
}

export default definePlugin(() => {
  // Load initial config
  call<[], PluginConfig>("get_config").then((res: PluginConfig) => {
    if (res) {
      configCache = res;
    }
  });

  // Initialize initial power mode from direct hardware query
  call<[], PowerMode>("get_power_mode").then((mode: PowerMode) => {
    if (mode) {
      currentPowerMode = mode;
    }
  });

  // Listen via SteamClient native battery state changes
  let unregisterBattery: any = null;
  if ((window as any).SteamClient?.System?.RegisterForBatteryStateChanges) {
    unregisterBattery = (window as any).SteamClient.System.RegisterForBatteryStateChanges(
      (batteryState: any) => {
        if (batteryState?.eACState !== undefined) {
          const newMode: PowerMode = isACConnected(batteryState.eACState) ? "plugged" : "battery";
          if (newMode !== currentPowerMode) {
            triggerProfileSwitch(newMode, "SteamClient AC state change", true);
          }
        }
      }
    );
  }

  // Periodic heartbeat watching SystemPowerStore to guarantee zero missed transitions
  const powerWatchInterval = setInterval(() => {
    const acState = (window as any).SystemPowerStore?.m_eACState;
    if (acState !== undefined) {
      const detectedMode: PowerMode = isACConnected(acState) ? "plugged" : "battery";
      if (detectedMode !== currentPowerMode) {
        triggerProfileSwitch(detectedMode, "SystemPowerStore heartbeat", true);
      }
    }
  }, 1500);

  // Watch QAM "Use per-game profile" toggle changes
  let lastTargetKey = getProfileTarget().key;
  const pollTargetInterval = setInterval(() => {
    const currentTarget = getProfileTarget();
    if (currentTarget.key !== lastTargetKey) {
      lastTargetKey = currentTarget.key;
      triggerProfileSwitch(currentPowerMode, "QAM per-game profile toggle", false);
    }
  }, 1000);

  // Hook setting adjustments to persist manual changes from QAM
  const settingsWatchInterval = setInterval(() => {
    handleSettingsChange();
  }, 1500);

  return {
    name: "PowerShift",
    title: <div className="powershift-title">PowerShift</div>,
    content: <Content />,
    icon: <BoltIcon />,
    onDismount() {
      if (unregisterBattery?.unregister) unregisterBattery.unregister();
      clearInterval(powerWatchInterval);
      clearInterval(pollTargetInterval);
      clearInterval(settingsWatchInterval);
    },
  };
});
