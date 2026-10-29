import { FC, useEffect, useState } from "react";
import { call } from "@decky/api";
import { PanelSection, PanelSectionRow, ToggleField, Field } from "@decky/ui";
import packageJson from "../../package.json";
import { PowerMode, PluginConfig } from "../types";
import { getProfileTarget } from "../steam";
import { getCurrentPowerMode, getConfigCache, setConfigCache } from "../settings";

export const Content: FC = () => {
  const [showNotifications, setShowNotifications] = useState(getConfigCache().show_notifications);
  const [activeMode, setActiveMode] = useState<PowerMode>(getCurrentPowerMode());
  const [targetInfo, setTargetInfo] = useState(getProfileTarget());
  const [newerVersion, setNewerVersion] = useState<string | null>(null);

  useEffect(() => {
    // Check GitHub releases for updates
    fetch("https://api.github.com/repos/vpraion/power-shift/releases/latest")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.tag_name) {
          const remoteTag = String(data.tag_name).replace(/^v/, "");
          if (remoteTag.localeCompare(packageJson.version, undefined, { numeric: true }) > 0) {
            setNewerVersion(data.tag_name);
          }
        }
      })
      .catch(() => {});

    call<[], PluginConfig>("get_config").then((res: PluginConfig) => {
      if (res) {
        setConfigCache(res);
        setShowNotifications(res.show_notifications);
      }
    });

    const interval = setInterval(() => {
      setActiveMode(getCurrentPowerMode());
      setTargetInfo(getProfileTarget());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleToggleNotifications = async (val: boolean) => {
    setShowNotifications(val);
    setConfigCache({ ...getConfigCache(), show_notifications: val });
    await call("set_config", { show_notifications: val });
  };

  return (
    <PanelSection title="PowerShift">
      <PanelSectionRow>
        <Field label="Version">
          {newerVersion ? (
            <span style={{ color: "#a3e635" }}>
              v{packageJson.version} ({newerVersion} available!)
            </span>
          ) : (
            <span style={{ opacity: 0.7 }}>v{packageJson.version} (Latest)</span>
          )}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Power Source">
          {activeMode === "docked"
            ? "🖥️ Docked (External Display)"
            : activeMode === "plugged"
            ? "⚡ Plugged"
            : "🔋 On Battery"}
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
          description="Display a toast when switching between battery, plugged, and docked"
          checked={showNotifications}
          onChange={handleToggleNotifications}
        />
      </PanelSectionRow>
    </PanelSection>
  );
};
