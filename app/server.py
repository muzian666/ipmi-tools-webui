"""Flask server for IPMI Tools WebUI."""

import os
from flask import Flask, jsonify, request, session, render_template

from .ipmi import (
    IPMICredentials,
    test_connection,
    get_sensors,
    get_fan_mode,
    get_fan_duty,
    set_fan_mode,
    set_fan_speed,
    set_fan_threshold,
)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "ipmi-tools-webui-change-me")


def _get_creds() -> IPMICredentials | None:
    """Retrieve IPMI credentials from session."""
    if "ipmi_host" not in session:
        return None
    return IPMICredentials(
        host=session["ipmi_host"],
        username=session["ipmi_user"],
        password=session["ipmi_pass"],
    )


def _require_creds() -> tuple[IPMICredentials, tuple] | tuple[None, tuple]:
    """Get credentials or return an error response."""
    creds = _get_creds()
    if creds is None:
        return None, (jsonify({"error": "Not connected"}), 401)
    return creds, None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/connect", methods=["POST"])
def api_connect():
    data = request.get_json()
    host = data.get("host", "").strip()
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not all([host, username, password]):
        return jsonify({"error": "Host, username, and password are required"}), 400

    creds = IPMICredentials(host=host, username=username, password=password)
    if not test_connection(creds):
        return jsonify({"error": "Connection failed. Check credentials and network."}), 401

    session["ipmi_host"] = host
    session["ipmi_user"] = username
    session["ipmi_pass"] = password
    return jsonify({"ok": True, "host": host})


@app.route("/api/disconnect", methods=["POST"])
def api_disconnect():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/status")
def api_status():
    creds = _get_creds()
    if creds:
        return jsonify({"connected": True, "host": creds.host})
    return jsonify({"connected": False})


@app.route("/api/sensors")
def api_sensors():
    creds, err = _require_creds()
    if err:
        return err
    try:
        data = get_sensors(creds)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/fan/duty")
def api_get_fan_duty():
    creds, err = _require_creds()
    if err:
        return err
    try:
        zones = {}
        for z in (0, 1):
            d = get_fan_duty(creds, z)
            zones[f"zone{z}"] = d
        return jsonify(zones)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/fan/mode", methods=["GET"])
def api_get_fan_mode():
    creds, err = _require_creds()
    if err:
        return err
    try:
        mode = get_fan_mode(creds)
        return jsonify({"mode": mode})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/fan/mode", methods=["POST"])
def api_set_fan_mode():
    creds, err = _require_creds()
    if err:
        return err
    data = request.get_json()
    mode = data.get("mode")
    if not mode:
        return jsonify({"error": "mode is required"}), 400
    try:
        set_fan_mode(creds, mode)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/fan/speed", methods=["POST"])
def api_set_fan_speed():
    creds, err = _require_creds()
    if err:
        return err
    data = request.get_json()
    zone = data.get("zone")
    duty = data.get("duty")
    if zone is None or duty is None:
        return jsonify({"error": "zone and duty are required"}), 400
    try:
        result = set_fan_speed(creds, int(zone), int(duty))
        return jsonify({"ok": True, **result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/fan/threshold", methods=["POST"])
def api_set_fan_threshold():
    creds, err = _require_creds()
    if err:
        return err
    data = request.get_json()
    sensor = data.get("sensor")
    if not sensor:
        return jsonify({"error": "sensor name is required"}), 400
    try:
        set_fan_threshold(
            creds,
            sensor,
            lnr=data.get("lnr"),
            lcr=data.get("lcr"),
            lnc=data.get("lnc"),
        )
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
