import { definePlugin, call } from "@decky/api";
import { FaBolt } from "react-icons/fa";
import { PowerMode, PluginConfig } from "./types";
import { getProfileTarget } from "./steam";
import {
  getCurrentPowerMode,
  triggerProfileSwitch,
  handleSettingsChange,
  setConfigCache,
} from "./settings";
import { Content } from "./components/Content";

const BoltIcon = FaBolt as any;

export default definePlugin(() => {
  // Terminate any previous instance timers/listeners left behind during hot-reload
  if (typeof (window as any).__powershift_cleanup === "function") {
    try {
      (window as any).__powershift_cleanup();
    } catch (_) {}
  }

  // Load initial config
  call<[], PluginConfig>("get_config").then((res: PluginConfig) => {
    if (res) {
      setConfigCache(res);
    }
  });

  async function checkHardwarePowerMode(reason: string) {
    try {
      const detectedMode = await call<[], PowerMode>("get_power_mode");
      if (detectedMode && detectedMode !== getCurrentPowerMode()) {
        triggerProfileSwitch(detectedMode, reason, true);
      }
    } catch (_) {}
  }

  // Initialize initial power mode from direct hardware query
  checkHardwarePowerMode("Initial hardware query");

  // Periodic heartbeat watching hardware sysfs directly to guarantee zero missed transitions
  const powerWatchInterval = setInterval(() => {
    checkHardwarePowerMode("Hardware sysfs heartbeat");
  }, 1000);

  // Watch QAM "Use per-game profile" toggle changes
  let lastTargetKey = getProfileTarget().key;
  const pollTargetInterval = setInterval(() => {
    const currentTarget = getProfileTarget();
    if (currentTarget.key !== lastTargetKey) {
      lastTargetKey = currentTarget.key;
      triggerProfileSwitch(getCurrentPowerMode(), "QAM per-game profile toggle", false);
    }
  }, 1000);

  // Hook setting adjustments to persist manual changes from QAM
  const settingsWatchInterval = setInterval(() => {
    handleSettingsChange();
  }, 1500);

  const cleanup = () => {
    clearInterval(powerWatchInterval);
    clearInterval(pollTargetInterval);
    clearInterval(settingsWatchInterval);
    delete (window as any).__powershift_cleanup;
  };

  (window as any).__powershift_cleanup = cleanup;

  return {
    name: "PowerShift",
    title: <div className="powershift-title">PowerShift</div>,
    content: <Content />,
    icon: <BoltIcon />,
    onDismount() {
      cleanup();
    },
  };
});
