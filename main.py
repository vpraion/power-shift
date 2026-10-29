import json
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
        Direct hardware query via sysfs across any available Mains or USB power supply.
        Supports Steam Deck (LCD/OLED) and other handhelds running SteamOS/Bazzite.
        """
        base = Path("/sys/class/power_supply")
        if base.exists():
            has_supply = False
            try:
                for entry in base.iterdir():
                    type_file = entry / "type"
                    online_file = entry / "online"
                    if online_file.exists() and type_file.exists():
                        has_supply = True
                        stype = type_file.read_text().strip()
                        if stype in ("Mains", "USB"):
                            if online_file.read_text().strip() == "1":
                                return "plugged"
                if has_supply:
                    return "battery"
            except Exception:
                pass
        return "plugged"

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
        Persists profile dictionary for a target key ('default' or numeric game app_id) and mode.
        """
        unpacked = _unpack_args(args)
        app_id = str(unpacked[0]) if len(unpacked) > 0 else str(kwargs.get("app_id", "default"))
        mode = str(unpacked[1]) if len(unpacked) > 1 else str(kwargs.get("mode", "battery"))
        profile = unpacked[2] if len(unpacked) > 2 else kwargs.get("profile", {})

        mode_file = f"{mode}.json"
        target_dir = (CONFIG_DIR / "games" / str(app_id)) if (app_id and app_id != "default" and app_id != "769") else (CONFIG_DIR / "default")
        _ensure_dir(target_dir)

        file_path = target_dir / mode_file
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(profile, f, indent=2)
            return True
        except Exception:
            return False
