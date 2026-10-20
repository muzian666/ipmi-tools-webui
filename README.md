# IPMI Tools WebUI

[中文文档](README.zh-CN.md)

A lightweight web interface for monitoring sensors and controlling fans on Supermicro servers through the BMC (IPMI). Built with Flask, it wraps `ipmitool` behind a clean REST API and a simple single-page UI.

> **Note:** Fan mode and PWM duty control use Supermicro-specific raw IPMI commands (`0x30 0x45`, `0x30 0x70 0x66`). Sensor monitoring works on any IPMI-capable server, but fan control is designed for Supermicro boards (Zone 0: FAN1–FAN6, Zone 1: FANA–FANC).

## Features

- **Fan Control**
  - Switch fan mode: Optimal (auto), Heavy IO, Full Speed (manual)
  - Set PWM duty (0–100%) per zone with sliders and live gauges
  - Real-time RPM readout for every fan in each zone
  - Applying a manual duty automatically switches the BMC to Full Speed mode (other modes would override manual PWM)
  - Edit fan sensor lower thresholds (LNR / LCR / LNC)
- **Monitoring** (auto-refreshes every 5 seconds)
  - Temperature, fan speed, voltage and power sensor cards
  - Status highlighting for warning / critical readings
- **Session-based login** — enter BMC host + credentials once; they are kept in the server-side session

## Quick Start (Docker)

```bash
git clone https://github.com/muzian666/ipmi-tools-webui.git
cd ipmi-tools-webui
docker compose up -d --build
```

Then open http://localhost:8080, log in with your BMC address and credentials (default BMC user is usually `ADMIN`).

The image is based on `python:3.12-alpine` with `ipmitool` pre-installed — no host-side dependencies needed.

> **Important:** change the `SECRET_KEY` in `docker-compose.yml` to a random value before deploying.

## Running Locally (without Docker)

Requires Python 3.10+ and `ipmitool` on your `PATH`.

```bash
pip install -r requirements.txt
export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
flask --app app.server run --host 0.0.0.0 --port 8080
```

## API Overview

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/api/connect` | Log in to a BMC (`host`, `username`, `password`) |
| POST | `/api/disconnect` | Clear the session |
| GET | `/api/status` | Current connection status |
| GET | `/api/sensors` | All sensors grouped by type |
| GET / POST | `/api/fan/mode` | Get / set fan mode (`optimal`, `heavyio`, `full`) |
| GET | `/api/fan/duty` | Read current PWM duty per zone |
| POST | `/api/fan/speed` | Set PWM duty (`zone` 0/1, `duty` 0–100) |
| POST | `/api/fan/threshold` | Set fan sensor lower thresholds |

## Security Notes

- The BMC password is passed to `ipmitool` via command-line arguments, which is visible in the process list on the host. Run this service on a trusted network only, ideally behind a reverse proxy with HTTPS.
- Always set a strong, random `SECRET_KEY`.
- The web UI has no built-in authentication of its own — anyone who can reach the service can use the stored BMC session. Restrict access accordingly (e.g. LAN / VPN / firewall).

## Project Structure

```
app/
├── server.py            # Flask app and REST API
├── ipmi.py              # ipmitool wrapper (sensors, fan mode, PWM, thresholds)
├── templates/index.html # Single-page UI
└── static/              # JS / CSS
Dockerfile
docker-compose.yml
```
