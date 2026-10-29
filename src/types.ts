export interface PowerProfile {
  is_fps_limit_enabled: boolean;
  fps_limit: number;
  display_refresh_manual_hz?: number;
  is_tdp_limit_enabled?: boolean;
  tdp_limit?: number;
  is_manual_gpu_clock_enabled?: boolean;
  manual_gpu_clock_hz?: number;
}

export interface PluginConfig {
  show_notifications: boolean;
}

export type PowerMode = "battery" | "plugged" | "docked";

export interface ProfileTarget {
  key: string;
  isPerGame: boolean;
  appId: string;
}
