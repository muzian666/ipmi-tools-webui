"""IPMI command wrapper using ipmitool CLI."""

import subprocess
import re
from dataclasses import dataclass


@dataclass
class IPMICredentials:
    host: str
    username: str
    password: str


def _run_cmd(creds: IPMICredentials, args: list[str], timeout: int = 15) -> str:
    """Execute an ipmitool command and return stdout."""
    base_args = [
        "ipmitool", "-I", "lanplus",
        "-H", creds.host, "-U", creds.username, "-P", creds.password,
    ]
    cmd = base_args + args
    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout
    )
    if result.returncode != 0:
        stderr = result.stderr.strip()
        raise RuntimeError(stderr or f"ipmitool exited with code {result.returncode}")
    return result.stdout


def test_connection(creds: IPMICredentials) -> bool:
    """Verify IPMI credentials work by fetching sensor list."""
    try:
        _run_cmd(creds, ["sensor", "list"])
        return True
    except Exception:
        return False


def parse_sensor_list(raw: str) -> list[dict]:
    """Parse `ipmitool sensor list` output into structured data."""
    sensors = []
    for line in raw.strip().splitlines():
        if not line.strip():
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 10:
            continue

        value_str = parts[1].strip()
        value = None
        unit = None
        if value_str and value_str != "na":
            # Extract numeric value and unit
            m = re.match(r"([0-9.]+)\s*(.*)", value_str)
            if m:
                try:
                    value = float(m.group(1))
                except ValueError:
                    pass
                unit = m.group(2).strip() or None

        sensor = {
            "name": parts[0],
            "value": value,
            "unit": unit,
            "status": parts[2].strip() if len(parts) > 2 else "na",
            "lnr": _safe_float(parts[3]),
            "lcr": _safe_float(parts[4]),
            "lnc": _safe_float(parts[5]),
            "unc": _safe_float(parts[6]),
            "ucr": _safe_float(parts[7]),
            "unr": _safe_float(parts[8]),
        }
        sensors.append(sensor)
    return sensors


def get_sensors(creds: IPMICredentials) -> dict:
    """Get all sensors grouped by type (temperature, fan, voltage, power)."""
    raw = _run_cmd(creds, ["sensor", "list"])
    all_sensors = parse_sensor_list(raw)

    grouped = {"temperature": [], "fan": [], "voltage": [], "power": [], "other": []}
    for s in all_sensors:
        name_lower = s["name"].lower()
        unit = (s["unit"] or "").lower()
        if "temp" in name_lower or unit == "degrees c":
            grouped["temperature"].append(s)
        elif "fan" in name_lower or unit == "rpm":
            grouped["fan"].append(s)
        elif "volt" in name_lower or unit == "volts" or unit == "v":
            grouped["voltage"].append(s)
        elif "power" in name_lower or "watt" in unit:
            grouped["power"].append(s)
        else:
            grouped["other"].append(s)

    return grouped


def get_fan_mode(creds: IPMICredentials) -> str:
    """Get current fan mode by reading the raw register."""
    try:
        raw = _run_cmd(creds, ["raw", "0x30", "0x45", "0x00"])
        mode_byte = int(raw.strip(), 16)
        modes = {0x00: "standard", 0x01: "full", 0x02: "optimal", 0x04: "heavyio"}
        return modes.get(mode_byte, f"unknown({mode_byte})")
    except Exception:
        return "unknown"


def get_fan_duty(creds: IPMICredentials, zone: int) -> int | None:
    """Read current PWM duty cycle (0-100) for a zone from IPMI.

    Uses raw 0x30 0x70 0x66 0x00 <zone> to read back the register.
    Returns None if the read fails.
    """
    try:
        raw = _run_cmd(creds, ["raw", "0x30", "0x70", "0x66", "0x00", str(zone)])
        byte_val = int(raw.strip(), 16)
        # BMC stores duty as percentage (0-100), not 0-255
        return min(byte_val, 100)
    except Exception:
        return None


def set_fan_mode(creds: IPMICredentials, mode: str) -> None:
    """Set fan mode: full, optimal, or heavyio."""
    mode_map = {"full": "0x01", "optimal": "0x02", "heavyio": "0x04"}
    if mode not in mode_map:
        raise ValueError(f"Invalid mode: {mode}. Use: full, optimal, heavyio")
    _run_cmd(creds, ["raw", "0x30", "0x45", "0x01", mode_map[mode]])


def set_fan_speed(creds: IPMICredentials, zone: int, duty: int) -> dict:
    """Set fan PWM duty cycle for a zone (0 or 1), duty 0-100.

    Automatically switches to Full Speed mode first if not already in it,
    since Optimal/HeavyIO modes will override manual PWM settings.
    Returns info about any mode switch that occurred.
    """
    if zone not in (0, 1):
        raise ValueError("Zone must be 0 or 1")
    if not 0 <= duty <= 100:
        raise ValueError("Duty must be 0-100")

    mode_switched = False
    current_mode = get_fan_mode(creds)
    if current_mode != "full":
        set_fan_mode(creds, "full")
        mode_switched = True

    hex_duty = f"0x{duty:02x}"
    _run_cmd(creds, ["raw", "0x30", "0x70", "0x66", "0x01", str(zone), hex_duty])
    return {"mode_switched": mode_switched, "previous_mode": current_mode}


def set_fan_threshold(
    creds: IPMICredentials,
    sensor: str,
    lnr: float | None = None,
    lcr: float | None = None,
    lnc: float | None = None,
) -> None:
    """Set fan sensor lower thresholds."""
    args = ["sensor", "thresh", sensor, "lower"]
    if lnr is not None:
        args.append(str(int(lnr)))
    else:
        args.append("0")
    if lcr is not None:
        args.append(str(int(lcr)))
    else:
        args.append("0")
    if lnc is not None:
        args.append(str(int(lnc)))
    else:
        args.append("0")
    _run_cmd(creds, args)


def _safe_float(s: str) -> float | None:
    s = s.strip()
    if not s or s == "na":
        return None
    try:
        return float(s)
    except ValueError:
        return None
