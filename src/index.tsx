import { definePlugin, call } from "@decky/api";
import { FaBolt } from "react-icons/fa";
import { PowerMode, PluginConfig } from "./types";
import { getProfileTarget, getQuickAccessWindow } from "./steam";
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

  // Gated QAM watchers: only run while the Quick Access Menu is physically open on screen
  let settingsTimer: any = null;
  let targetTimer: any = null;

  function startQAMWatchers() {
    if (settingsTimer) return;

    handleSettingsChange();

    settingsTimer = setInterval(() => {
      handleSettingsChange();
    }, 1500);

    let lastTargetKey = getProfileTarget().key;
    targetTimer = setInterval(() => {
      const currentTarget = getProfileTarget();
      if (currentTarget.key !== lastTargetKey) {
        lastTargetKey = currentTarget.key;
        triggerProfileSwitch(getCurrentPowerMode(), "QAM per-game profile toggle", false);
      }
    }, 1000);
  }

  function stopQAMWatchers() {
    if (settingsTimer) {
      clearInterval(settingsTimer);
      settingsTimer = null;
    }
    if (targetTimer) {
      clearInterval(targetTimer);
      targetTimer = null;
    }
    handleSettingsChange();
  }

  const qaWindow = getQuickAccessWindow();
  const onVisibilityChange = () => {
    if (qaWindow?.document?.hidden) {
      stopQAMWatchers();
    } else {
      startQAMWatchers();
    }
  };

  if (qaWindow) {
    qaWindow.addEventListener("visibilitychange", onVisibilityChange);
    if (!qaWindow.document.hidden) {
      startQAMWatchers();
    }
  } else {
    // Fallback: start watchers if QuickAccess window object is not yet resolvable
    startQAMWatchers();
  }

  const cleanup = () => {
    clearInterval(powerWatchInterval);
    stopQAMWatchers();
    if (qaWindow) {
      try {
        qaWindow.removeEventListener("visibilitychange", onVisibilityChange);
      } catch (_) {}
    }
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
