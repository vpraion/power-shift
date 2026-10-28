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
let currentAppId: string = "default";
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

  // 1. Locate PerfStore (module with Hn.Get() providing SetFPSLimit)
  try {
    for (const chunk of webpack) {
      const modules = chunk[1] || {};
      for (const id in modules) {
        try {
          const mod = req(id);
          if (mod?.Hn?.Get && typeof mod.Hn.Get === "function") {
            const instance = mod.Hn.Get();
            if (instance && typeof instance.SetFPSLimit === "function") {
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

// Read current QAM settings
function readCurrentQAMSettings(): PowerProfile | null {
  const stores = getSteamStores();
  if (!stores?.perfStore || !stores?.settingsStore) return null;

  const ps = stores.perfStore;
  const ss = stores.settingsStore;
  const perApp = ps.msgSettingsPerApp || {};

  return {
    is_fps_limit_enabled: Boolean(perApp.is_fps_limit_enabled),
    fps_limit: Number(perApp.fps_limit || 60),
    display_refresh_manual_hz: Number(perApp.display_refresh_manual_hz || 60),
    is_tdp_limit_enabled: Boolean(ss.steamos_tdp_limit_enabled),
    tdp_limit: Number(ss.steamos_tdp_limit || 15),
    is_manual_gpu_clock_enabled: Boolean(ss.steamos_manual_gpu_clock_enabled),
    manual_gpu_clock_hz: Number(ss.steamos_manual_gpu_clock_hz || 1600),
  };
}

function showToast(title: string, body: string) {
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

// Apply profile to QAM / SteamClient
async function applyProfile(profile: PowerProfile, mode: PowerMode) {
  const stores = getSteamStores();
  if (!stores?.perfStore) return;

  isApplyingProfile = true;
  lastAppliedHash = JSON.stringify(profile);

  try {
    const ps = stores.perfStore;
    const setSetting = stores.setSetting;

    // Apply framerate limit & refresh rate (first param: false = internal screen)
    if (typeof ps.SetFPSLimitEnabled === "function") {
      ps.SetFPSLimitEnabled(profile.is_fps_limit_enabled);
    }
    if (typeof ps.SetFPSLimit === "function") {
      ps.SetFPSLimit(false, profile.fps_limit);
    }
    if (typeof ps.SetDisplayRefreshRateManualHz === "function") {
      ps.SetDisplayRefreshRateManualHz(false, profile.display_refresh_manual_hz);
    }

    // Apply TDP limit & GPU clock
    if (setSetting) {
      setSetting("steamos_tdp_limit_enabled", profile.is_tdp_limit_enabled);
      setSetting("steamos_tdp_limit", profile.tdp_limit);
      if (profile.is_manual_gpu_clock_enabled !== undefined) {
        setSetting("steamos_manual_gpu_clock_enabled", profile.is_manual_gpu_clock_enabled);
      }
      if (profile.manual_gpu_clock_hz !== undefined) {
        setSetting("steamos_manual_gpu_clock_hz", profile.manual_gpu_clock_hz);
      }
    }

    // Toast notification
    if (configCache.show_notifications) {
      const modeLabel = mode === "plugged" ? "⚡ Plugged Mode" : "🔋 Battery Mode";
      const tdpText = profile.is_tdp_limit_enabled ? `${profile.tdp_limit}W` : "TDP Auto";
      const details = `${profile.display_refresh_manual_hz}Hz | ${profile.fps_limit}FPS | ${tdpText}`;
      showToast(`PowerShift: ${modeLabel}`, details);
    }
  } catch (err) {
    console.error("[PowerShift] Error applying profile:", err);
  } finally {
    setTimeout(() => {
      isApplyingProfile = false;
    }, 2500);
  }
}

async function onPowerModeChange(newMode: PowerMode) {
  if (newMode === currentPowerMode) return;
  currentPowerMode = newMode;

  try {
    const res = await call<[string, string], { profile: PowerProfile }>("get_profile", currentAppId, newMode);
    if (res?.profile) {
      await applyProfile(res.profile, newMode);
    }
  } catch (err) {
    console.error("[PowerShift] Failed to fetch and apply profile on power change:", err);
  }
}

// Auto-save manual slider adjustments
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
    try {
      lastAppliedHash = currentHash;
      await call("save_profile", currentAppId, currentPowerMode, current);
    } catch (err) {
      console.error("[PowerShift] Failed to auto-save profile:", err);
    }
  }, 1000);
}

// React Panel UI in English
const Content: FC = () => {
  const [showNotifications, setShowNotifications] = useState(configCache.show_notifications);
  const [activeMode, setActiveMode] = useState<PowerMode>(currentPowerMode);
  const [activeApp, setActiveApp] = useState<string>(currentAppId);

  useEffect(() => {
    call<[], PluginConfig>("get_config").then((res: PluginConfig) => {
      if (res) {
        configCache = res;
        setShowNotifications(res.show_notifications);
      }
    });

    const interval = setInterval(() => {
      setActiveMode(currentPowerMode);
      setActiveApp(currentAppId);
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
        <Field label="Active Profile">
          {activeApp === "default" || activeApp === "769" ? "Default Profile" : `Game AppID: ${activeApp}`}
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

export default definePlugin(() => {
  // Load initial config
  call<[], PluginConfig>("get_config").then((res: PluginConfig) => {
    if (res) {
      configCache = res;
    }
  });

  // Initial power detection via Battery API
  const nav = navigator as any;
  if (nav.getBattery) {
    nav.getBattery().then((battery: any) => {
      currentPowerMode = battery.charging ? "plugged" : "battery";
      battery.addEventListener("chargingchange", () => {
        onPowerModeChange(battery.charging ? "plugged" : "battery");
      });
    });
  }

  // Also listen via SteamClient battery state changes
  let unregisterBattery: any = null;
  if ((window as any).SteamClient?.System?.RegisterForBatteryStateChanges) {
    unregisterBattery = (window as any).SteamClient.System.RegisterForBatteryStateChanges(
      (batteryState: any) => {
        if (batteryState?.eACState !== undefined) {
          onPowerModeChange(batteryState.eACState === 2 ? "plugged" : "battery");
        }
      }
    );
  }

  // Watch app lifetime / active running game
  let unregisterAppLifetime: any = null;
  if ((window as any).SteamClient?.GameSessions?.RegisterForAppLifetimeNotifications) {
    unregisterAppLifetime = (window as any).SteamClient.GameSessions.RegisterForAppLifetimeNotifications(
      async (appLifetime: any) => {
        if (appLifetime?.bRunning && appLifetime?.unAppID) {
          const newAppId = String(appLifetime.unAppID);
          if (newAppId !== currentAppId) {
            currentAppId = newAppId;
            const res = await call<[string, string], { profile: PowerProfile }>("get_profile", currentAppId, currentPowerMode);
            if (res?.profile) {
              await applyProfile(res.profile, currentPowerMode);
            }
          }
        } else if (!appLifetime?.bRunning) {
          currentAppId = "default";
        }
      }
    );
  }

  // Periodic check on active profile/game in perfStore
  const pollStoresInterval = setInterval(() => {
    const stores = getSteamStores();
    if (stores?.perfStore) {
      const activeGame = stores.perfStore.msgState?.active_profile_game_id || stores.perfStore.msgState?.current_game_id;
      if (activeGame && activeGame !== "769" && activeGame !== currentAppId) {
        currentAppId = String(activeGame);
      }
    }
  }, 2000);

  // Hook setting changes to persist manual adjustments
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
      if (unregisterAppLifetime?.unregister) unregisterAppLifetime.unregister();
      clearInterval(pollStoresInterval);
      clearInterval(settingsWatchInterval);
    },
  };
});
