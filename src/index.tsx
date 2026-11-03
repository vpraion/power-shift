import { definePlugin, call } from "@decky/api";
import { FaBolt } from "react-icons/fa";
import { PowerMode, PluginConfig } from "./types";
import { getProfileTarget, getQuickAccessWindow } from "./steam";
import {
  getCurrentPowerMode,
  triggerProfileSwitch,
  handleSettingsChange,
  setConfigCache,
  invalidateLastAppliedHash,
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

  async function checkHardwarePowerMode(reason: string): Promise<boolean> {
    try {
      const detectedMode = await call<[], PowerMode>("get_power_mode");
      if (detectedMode && detectedMode !== getCurrentPowerMode()) {
        triggerProfileSwitch(detectedMode, reason, true);
        return true;
      }
    } catch (_) {}
    return false;
  }

  // Initialize initial power mode from direct hardware query
  checkHardwarePowerMode("Initial hardware query");

  let lastHeartbeat = Date.now();
  let lastTargetKey = getProfileTarget().key;
  let lastResumeTime = 0;

  async function onSystemResume() {
    const now = Date.now();
    if (now - lastResumeTime < 2000) return;
    lastResumeTime = now;

    invalidateLastAppliedHash();

    // 1. Immediate hardware check on wake
    await checkHardwarePowerMode("System resume (immediate)");

    // 2. Re-assert after 1.5s when gamescope and running game have fully settled
    setTimeout(async () => {
      try {
        const detectedMode = await call<[], PowerMode>("get_power_mode");
        if (detectedMode) {
          lastTargetKey = getProfileTarget().key;
          await triggerProfileSwitch(detectedMode, "System resume (settled)", true, true);
        }
      } catch (_) {}
    }, 1500);
  }

  // Hook native Steam client resume events if available
  let resumeReg: any = null;
  if (typeof (window as any).SteamClient?.User?.RegisterForResumeSuspendedGamesProgress === "function") {
    try {
      resumeReg = (window as any).SteamClient.User.RegisterForResumeSuspendedGamesProgress(() => {
        onSystemResume();
      });
    } catch (_) {}
  }

  // Periodic heartbeat watching hardware sysfs, sleep/resume, and game transitions directly
  const powerWatchInterval = setInterval(async () => {
    const now = Date.now();
    const timeDelta = now - lastHeartbeat;
    lastHeartbeat = now;

    // Detect system resume from sleep via RTC monotonic time jump
    if (timeDelta > 3000) {
      await onSystemResume();
      return;
    }

    const powerChanged = await checkHardwarePowerMode("Hardware sysfs heartbeat");
    if (powerChanged) return;

    // Check game launch / exit / focus change
    const currentTarget = getProfileTarget();
    if (currentTarget.key !== lastTargetKey) {
      const prevKey = lastTargetKey;
      lastTargetKey = currentTarget.key;
      triggerProfileSwitch(getCurrentPowerMode(), `Target transition (${prevKey} -> ${currentTarget.key})`, false);
    }
  }, 1000);

  // Gated QAM watchers: only run slider change detection while Quick Access Menu is open
  let settingsTimer: any = null;

  function startQAMWatchers() {
    if (settingsTimer) return;

    handleSettingsChange();

    settingsTimer = setInterval(() => {
      handleSettingsChange();
    }, 1500);
  }

  function stopQAMWatchers() {
    if (settingsTimer) {
      clearInterval(settingsTimer);
      settingsTimer = null;
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
    if (resumeReg?.unregister) {
      try {
        resumeReg.unregister();
      } catch (_) {}
    }
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
