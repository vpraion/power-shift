import { ProfileTarget } from "./types";

let perfStoreRef: any = null;
let settingsStoreRef: any = null;
let setSettingFnRef: ((key: string, value: any) => void) | null = null;

export function getSteamStores() {
  if (perfStoreRef && settingsStoreRef && setSettingFnRef) {
    return {
      perfStore: perfStoreRef,
      settingsStore: settingsStoreRef,
      setSetting: setSettingFnRef,
    };
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

export function getProfileTarget(): ProfileTarget {
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

export function getQuickAccessWindow(): Window | null {
  try {
    const focusNav = (window as any).GamepadNavTree?.m_context?.m_controller || (window as any).FocusNavController;
    const context = focusNav?.m_ActiveContext || focusNav?.m_LastActiveContext;
    const trees = context?.m_rgGamepadNavigationTrees;
    return (
      trees?.find((tree: any) => tree?.id === "QuickAccess-NA")?.m_Root?.m_element?.ownerDocument?.defaultView ?? null
    );
  } catch (_) {
    return null;
  }
}
