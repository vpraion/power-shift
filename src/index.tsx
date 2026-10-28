import { definePlugin, toaster, call } from "@decky/api";
import {
  PanelSection,
  PanelSectionRow,
  ToggleField,
  Field,
  SliderField,
  DropdownItem,
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

// Determines target profile based directly on QAM "Use per-game profile" toggle
function getProfileTarget(): { key: string; isPerGame: boolean; appId: string } {
  const stores = getSteamStores();
  const ps = stores?.perfStore;
  const currentApp = String(ps?.msgState?.current_game_id || "769");
  const activeProfileApp = String(ps?.msgState?.active_profile_game_id || "769");

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
async function applyProfile(profile: PowerProfile, mode: PowerMode, targetKey: string) {
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
      const profileLabel = targetKey === "default" ? "Default" : "Per-Game";
      const tdpText = profile.is_tdp_limit_enabled ? `${profile.tdp_limit}W` : "TDP Auto";
      const fpsText = profile.is_fps_limit_enabled ? `${profile.fps_limit}FPS` : "Unlimited FPS";
      const details = `${profile.display_refresh_manual_hz}Hz | ${fpsText} | ${tdpText} (${profileLabel})`;
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

async function triggerProfileSwitch(reason: string) {
  const target = getProfileTarget();

  try {
    const res = await call<[string, string], { profile: PowerProfile }>(
      "get_profile",
      target.key,
      currentPowerMode
    );

    if (res?.profile) {
      await applyProfile(res.profile, currentPowerMode, target.key);
    }
  } catch (err) {
    console.error(`[PowerShift] Failed to apply profile on ${reason}:`, err);
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
    const target = getProfileTarget();
    try {
      lastAppliedHash = currentHash;
      await call("save_profile", target.key, currentPowerMode, current);
    } catch (err) {
      console.error("[PowerShift] Failed to auto-save profile:", err);
    }
  }, 1000);
}

// React Panel UI in English
const Content: FC = () => {
  const [showNotifications, setShowNotifications] = useState(configCache.show_notifications);
  const [activeMode, setActiveMode] = useState<PowerMode>(currentPowerMode);
  const [targetInfo, setTargetInfo] = useState(getProfileTarget());

  // Editing Default Profiles
  const [editMode, setEditMode] = useState<PowerMode>("battery");
  const [profileState, setProfileState] = useState<PowerProfile>({
    is_fps_limit_enabled: true,
    fps_limit: 45,
    display_refresh_manual_hz: 90,
    is_tdp_limit_enabled: true,
    tdp_limit: 11,
  });

  const loadDefaultProfile = (mode: PowerMode) => {
    call<[string, string], { profile: PowerProfile }>("get_profile", "default", mode).then((res) => {
      if (res?.profile) {
        setProfileState(res.profile);
      }
    });
  };

  useEffect(() => {
    call<[], PluginConfig>("get_config").then((res: PluginConfig) => {
      if (res) {
        configCache = res;
        setShowNotifications(res.show_notifications);
      }
    });

    loadDefaultProfile(editMode);

    const interval = setInterval(() => {
      setActiveMode(currentPowerMode);
      setTargetInfo(getProfileTarget());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleEditModeChange = (newMode: PowerMode) => {
    setEditMode(newMode);
    loadDefaultProfile(newMode);
  };

  const updateProfileField = async (updatedFields: Partial<PowerProfile>) => {
    const newProfile = { ...profileState, ...updatedFields };
    setProfileState(newProfile);

    // Save to default profile
    await call("save_profile", "default", editMode, newProfile);

    // If we're currently in this mode and not using a custom per-game profile, apply immediately
    if (editMode === currentPowerMode && !targetInfo.isPerGame) {
      await applyProfile(newProfile, currentPowerMode, "default");
    }
  };

  const handleToggleNotifications = async (val: boolean) => {
    setShowNotifications(val);
    configCache.show_notifications = val;
    await call("set_config", { show_notifications: val });
  };

  return (
    <PanelSection title="PowerShift">
      <PanelSectionRow>
        <Field label="Current Status">
          {activeMode === "plugged" ? "⚡ Plugged" : "🔋 On Battery"}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="QAM Profile Target">
          {targetInfo.isPerGame ? `Per-Game (ID: ${targetInfo.appId})` : "Default Profile"}
        </Field>
      </PanelSectionRow>

      <PanelSection title="Configure Default Profiles">
        <PanelSectionRow>
          <DropdownItem
            label="Configure Mode"
            menuLabel="Select Power Mode"
            rgOptions={[
              { data: "battery", label: "🔋 Battery Mode" },
              { data: "plugged", label: "⚡ Plugged Mode" },
            ]}
            selectedOption={editMode}
            onChange={(opt) => handleEditModeChange(opt.data as PowerMode)}
          />
        </PanelSectionRow>

        {/* TDP Control */}
        <PanelSectionRow>
          <ToggleField
            label="TDP Limit"
            description="Enable manual TDP limitation"
            checked={profileState.is_tdp_limit_enabled}
            onChange={(val) => updateProfileField({ is_tdp_limit_enabled: val })}
          />
        </PanelSectionRow>
        {profileState.is_tdp_limit_enabled && (
          <PanelSectionRow>
            <SliderField
              label="TDP Limit Value"
              value={profileState.tdp_limit}
              min={3}
              max={15}
              step={1}
              showValue={true}
              valueSuffix=" W"
              onChange={(val) => updateProfileField({ tdp_limit: val })}
            />
          </PanelSectionRow>
        )}

        {/* Framerate & Refresh Rate Controls */}
        <PanelSectionRow>
          <ToggleField
            label="Framerate Limit"
            description="Toggle between frame limit and unlimited refresh rate"
            checked={profileState.is_fps_limit_enabled}
            onChange={(val) => updateProfileField({ is_fps_limit_enabled: val })}
          />
        </PanelSectionRow>

        {profileState.is_fps_limit_enabled ? (
          <PanelSectionRow>
            <SliderField
              label="Framerate Limit"
              value={profileState.fps_limit}
              min={30}
              max={90}
              step={5}
              showValue={true}
              valueSuffix=" FPS"
              onChange={(val) => updateProfileField({ fps_limit: val })}
            />
          </PanelSectionRow>
        ) : (
          <PanelSectionRow>
            <SliderField
              label="Display Refresh Rate"
              value={profileState.display_refresh_manual_hz}
              min={45}
              max={90}
              step={1}
              showValue={true}
              valueSuffix=" Hz"
              onChange={(val) => updateProfileField({ display_refresh_manual_hz: val })}
            />
          </PanelSectionRow>
        )}
      </PanelSection>

      <PanelSection title="Settings">
        <PanelSectionRow>
          <ToggleField
            label="Popup Notifications"
            description="Display a toast when switching between battery and plugged"
            checked={showNotifications}
            onChange={handleToggleNotifications}
          />
        </PanelSectionRow>
      </PanelSection>
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

  // Battery detection via Battery API
  const nav = navigator as any;
  if (nav.getBattery) {
    nav.getBattery().then((battery: any) => {
      currentPowerMode = battery.charging ? "plugged" : "battery";
      battery.addEventListener("chargingchange", () => {
        const newMode: PowerMode = battery.charging ? "plugged" : "battery";
        if (newMode !== currentPowerMode) {
          currentPowerMode = newMode;
          triggerProfileSwitch("battery API event");
        }
      });
    });
  }

  // Also listen via SteamClient native battery state changes
  let unregisterBattery: any = null;
  if ((window as any).SteamClient?.System?.RegisterForBatteryStateChanges) {
    unregisterBattery = (window as any).SteamClient.System.RegisterForBatteryStateChanges(
      (batteryState: any) => {
        if (batteryState?.eACState !== undefined) {
          const newMode: PowerMode = batteryState.eACState === 2 ? "plugged" : "battery";
          if (newMode !== currentPowerMode) {
            currentPowerMode = newMode;
            triggerProfileSwitch("SteamClient AC state change");
          }
        }
      }
    );
  }

  // Watch QAM "Use per-game profile" toggle changes
  let lastTargetKey = getProfileTarget().key;
  const pollTargetInterval = setInterval(() => {
    const currentTarget = getProfileTarget();
    if (currentTarget.key !== lastTargetKey) {
      lastTargetKey = currentTarget.key;
      triggerProfileSwitch("QAM per-game profile toggle");
    }
  }, 1000);

  // Hook setting adjustments to persist manual changes
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
      clearInterval(pollTargetInterval);
      clearInterval(settingsWatchInterval);
    },
  };
});
