import json
import os
import subprocess
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "power-shift"

DEFAULT_CONFIG = {
    "show_notifications": True
}


def _ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def _unpack_args(args):
    if len(args) == 1 and isinstance(args[0], (list, tuple)):
        return list(args[0])
    return list(args)


class Plugin:
    async def _main(self):
        _ensure_dir(CONFIG_DIR / "default")
        _ensure_dir(CONFIG_DIR / "games")

        cfg_file = CONFIG_DIR / "config.json"
        if not cfg_file.exists():
            with open(cfg_file, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_CONFIG, f, indent=2)

    async def _unload(self):
        pass

    async def get_config(self, *args, **kwargs):
        cfg_file = CONFIG_DIR / "config.json"
        if cfg_file.exists():
            try:
                with open(cfg_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return DEFAULT_CONFIG

    async def set_config(self, *args, **kwargs):
        unpacked = _unpack_args(args)
        config = unpacked[0] if len(unpacked) > 0 else kwargs.get("config", {})
        cfg_file = CONFIG_DIR / "config.json"
        _ensure_dir(CONFIG_DIR)
        try:
            with open(cfg_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)
            return True
        except Exception:
            return False

    async def get_power_mode(self, *args, **kwargs):
        """
        Direct hardware query via sysfs ACAD/online (1 = plugged, 0 = battery).
        """
        acad = Path("/sys/class/power_supply/ACAD/online")
        if acad.exists():
            try:
                val = acad.read_text().strip()
                return "plugged" if val == "1" else "battery"
            except Exception:
                pass
        return "plugged"

    async def apply_gamescope_settings(self, *args, **kwargs):
        """
        Directly enforces Gamescope FPS limit and refresh rate on all active Xwayland displays (:0 and :1).
        """
        unpacked = _unpack_args(args)
        fps_limit = unpacked[0] if len(unpacked) > 0 else kwargs.get("fps_limit", 0)
        refresh_hz = unpacked[1] if len(unpacked) > 1 else kwargs.get("refresh_hz", 90)
        try:
            fps = int(fps_limit)
            hz = int(refresh_hz)
            for disp in (":0", ":1"):
                env = dict(os.environ, DISPLAY=disp)
                subprocess.run(
                    ["xprop", "-root", "-f", "GAMESCOPE_FPS_LIMIT", "32c", "-set", "GAMESCOPE_FPS_LIMIT", str(fps)],
                    env=env,
                    capture_output=True,
                    check=False
                )
                if hz > 0:
                    subprocess.run(
                        ["xprop", "-root", "-f", "GAMESCOPE_DYNAMIC_REFRESH", "32c", "-set", "GAMESCOPE_DYNAMIC_REFRESH", str(hz)],
                        env=env,
                        capture_output=True,
                        check=False
                    )
            return True
        except Exception:
            return False

    async def get_profile(self, *args, **kwargs):
        """
        Retrieves profile for a target key ('default' or numeric game app_id) and mode ('battery' | 'plugged').
        Returns exists: True/False so the frontend can snapshot current QAM values if missing.
        """
        unpacked = _unpack_args(args)
        app_id = str(unpacked[0]) if len(unpacked) > 0 else str(kwargs.get("app_id", "default"))
        mode = str(unpacked[1]) if len(unpacked) > 1 else str(kwargs.get("mode", "battery"))
        mode_file = f"{mode}.json"
        if app_id and app_id != "default" and app_id != "769":
            game_file = CONFIG_DIR / "games" / str(app_id) / mode_file
            if game_file.exists():
                try:
                    with open(game_file, "r", encoding="utf-8") as f:
                        return {"exists": True, "profile": json.load(f)}
                except Exception:
                    pass

        # Check default profile file
        default_file = CONFIG_DIR / "default" / mode_file
        if default_file.exists():
            try:
                with open(default_file, "r", encoding="utf-8") as f:
                    return {"exists": True, "profile": json.load(f)}
            except Exception:
                pass

        return {"exists": False, "profile": None}

    async def save_profile(self, *args, **kwargs):
        """
        Saves profile data directly to games/<app_id>/<mode>.json or default/<mode>.json.
        """
        unpacked = _unpack_args(args)
        app_id = str(unpacked[0]) if len(unpacked) > 0 else str(kwargs.get("app_id", "default"))
        mode = str(unpacked[1]) if len(unpacked) > 1 else str(kwargs.get("mode", "battery"))
        profile = unpacked[2] if len(unpacked) > 2 else kwargs.get("profile", {})
        mode_file = f"{mode}.json"
        if app_id and app_id != "default" and app_id != "769":
            target_dir = CONFIG_DIR / "games" / str(app_id)
        else:
            target_dir = CONFIG_DIR / "default"

        _ensure_dir(target_dir)
        target_file = target_dir / mode_file
        try:
            with open(target_file, "w", encoding="utf-8") as f:
                json.dump(profile, f, indent=2)
            return True
        except Exception:
            return False
