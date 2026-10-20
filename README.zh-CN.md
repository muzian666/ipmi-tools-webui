# IPMI Tools WebUI

[English](README.md)

一个轻量级的 Web 界面，用于通过 BMC（IPMI）监控 Supermicro 服务器的传感器并控制风扇。基于 Flask 构建，将 `ipmitool` 封装为简洁的 REST API 和单页 UI。

> **说明：** 风扇模式和 PWM 占空比控制使用 Supermicro 专有的 raw IPMI 命令（`0x30 0x45`、`0x30 0x70 0x66`）。传感器监控适用于任何支持 IPMI 的服务器，但风扇控制专为 Supermicro 主板设计（Zone 0：FAN1–FAN6，Zone 1：FANA–FANC）。

## 功能

- **风扇控制**
  - 切换风扇模式：Optimal（自动温控）、Heavy IO、Full Speed（手动全速）
  - 按分区（Zone）滑动调节 PWM 占空比（0–100%），带实时仪表盘
  - 每个分区内所有风扇的实时转速显示
  - 应用手动转速时会自动把 BMC 切换到 Full Speed 模式（其他模式会覆盖手动 PWM 设置）
  - 编辑风扇传感器的下限阈值（LNR / LCR / LNC）
- **监控**（每 5 秒自动刷新）
  - 温度、风扇转速、电压和功耗传感器卡片
  - 告警 / 严重状态高亮显示
- **基于会话的登录** —— 只需输入一次 BMC 地址和凭据，保存在服务端会话中

## 快速开始（Docker）

```bash
git clone https://github.com/muzian666/ipmi-tools-webui.git
cd ipmi-tools-webui
docker compose up -d --build
```

然后打开 http://localhost:8080，输入 BMC 地址和账号密码登录（BMC 默认用户通常是 `ADMIN`）。

镜像基于 `python:3.12-alpine` 并预装了 `ipmitool`，宿主机无需安装任何依赖。

> **重要：** 部署前请务必修改 `docker-compose.yml` 中的 `SECRET_KEY` 为随机值。

## 本地运行（不用 Docker）

需要 Python 3.10+，且 `PATH` 中有 `ipmitool`。

```bash
pip install -r requirements.txt
export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
flask --app app.server run --host 0.0.0.0 --port 8080
```

## API 概览

| 方法 | 端点 | 说明 |
| --- | --- | --- |
| POST | `/api/connect` | 登录 BMC（`host`、`username`、`password`） |
| POST | `/api/disconnect` | 清除会话 |
| GET | `/api/status` | 当前连接状态 |
| GET | `/api/sensors` | 所有传感器（按类型分组） |
| GET / POST | `/api/fan/mode` | 读取 / 设置风扇模式（`optimal`、`heavyio`、`full`） |
| GET | `/api/fan/duty` | 读取各分区当前 PWM 占空比 |
| POST | `/api/fan/speed` | 设置 PWM 占空比（`zone` 0/1，`duty` 0–100） |
| POST | `/api/fan/threshold` | 设置风扇传感器下限阈值 |

## 安全须知

- BMC 密码通过命令行参数传给 `ipmitool`，在宿主机上可以通过进程列表看到。请仅在可信网络中运行本服务，最好放在带 HTTPS 的反向代理后面。
- 务必设置强随机的 `SECRET_KEY`。
- Web UI 本身没有额外的用户认证 —— 任何能访问本服务的人都可以使用已保存的 BMC 会话，请做好访问限制（如内网 / VPN / 防火墙）。

## 项目结构

```
app/
├── server.py            # Flask 应用与 REST API
├── ipmi.py              # ipmitool 封装（传感器、风扇模式、PWM、阈值）
├── templates/index.html # 单页 UI
└── static/              # JS / CSS
Dockerfile
docker-compose.yml
```
