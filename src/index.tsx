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

// Apply profile to QAM / SteamClient
async function applyProfile(profile: PowerProfile, mode: PowerMode) {
  const stores = getSteamStores();
  if (!stores?.perfStore) return;

  isApplyingProfile = true;
  try {
    const ps = stores.perfStore;
    const setSetting = stores.setSetting;

    // Apply framerate limit & refresh rate
    if (typeof ps.SetFPSLimitEnabled === "function") {
      ps.SetFPSLimitEnabled(profile.is_fps_limit_enabled);
    }
    if (typeof ps.SetFPSLimit === "function") {
      ps.SetFPSLimit(profile.fps_limit);
    }
    if (typeof ps.SetDisplayRefreshRateManualHz === "function") {
      ps.SetDisplayRefreshRateManualHz(profile.display_refresh_manual_hz);
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
      const modeLabel = mode === "plugged" ? "⚡ Secteur" : "🔋 Batterie";
      const details = `${profile.display_refresh_manual_hz}Hz | ${profile.fps_limit}FPS | ${profile.is_tdp_limit_enabled ? profile.tdp_limit + "W" : "TDP Auto"}`;
      toaster.toast({
        title: `PowerShift : Profil ${modeLabel}`,
        body: details,
      });
    }
  } catch (err) {
    console.error("[PowerShift] Error applying profile:", err);
  } finally {
    setTimeout(() => {
      isApplyingProfile = false;
    }, 700);
  }
}

// Save current settings to active profile
let saveDebounceTimer: any = null;
function handleSettingsChange() {
  if (isApplyingProfile) return;

  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    const current = readCurrentQAMSettings();
    if (!current) return;

    try {
      await call("save_profile", currentAppId, currentPowerMode, current);
    } catch (err) {
      console.error("[PowerShift] Failed to auto-save profile:", err);
    }
  }, 800);
}

// React Panel UI
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
        <Field label="Alimentation actuelle">
          {activeMode === "plugged" ? "⚡ Secteur" : "🔋 Batterie"}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Jeu actif">
          {activeApp === "default" || activeApp === "769" ? "Profil par défaut" : `AppID : ${activeApp}`}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Notifications popup"
          description="Affiche un toast à chaque basculement batterie / secteur"
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

  // Watch power state changes natively via SteamClient
  let unregisterBattery: any = null;
  if ((window as any).SteamClient?.System?.RegisterForBatteryStateChanges) {
    unregisterBattery = (window as any).SteamClient.System.RegisterForBatteryStateChanges(
      async (batteryState: any) => {
        const newMode: PowerMode = batteryState.eACState === 2 ? "plugged" : "battery";

        if (newMode !== currentPowerMode) {
          currentPowerMode = newMode;
          // Fetch profile and apply
          const res = await call<[string, string], { profile: PowerProfile }>("get_profile", currentAppId, newMode);

          if (res?.profile) {
            await applyProfile(res.profile, newMode);
          }
        }
      }
    );
  }

  // Watch app lifetime / current running game
  let unregisterAppLifetime: any = null;
  if ((window as any).SteamClient?.GameSessions?.RegisterForAppLifetimeNotifications) {
    unregisterAppLifetime = (window as any).SteamClient.GameSessions.RegisterForAppLifetimeNotifications(
      async (appLifetime: any) => {
        if (appLifetime?.bRunning && appLifetime?.unAppID) {
          const newAppId = String(appLifetime.unAppID);
          if (newAppId !== currentAppId) {
            currentAppId = newAppId;
            // Fetch profile for new game in current mode
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
    if (!isApplyingProfile) {
      handleSettingsChange();
    }
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
