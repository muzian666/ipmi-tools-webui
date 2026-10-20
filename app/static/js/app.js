/* IPMI Tools WebUI - Frontend Logic */

const API = "";
let monitorInterval = null;
let sensorCache = null;

// ========== Init ==========
document.addEventListener("DOMContentLoaded", () => {
    const saved = localStorage.getItem("ipmi_creds");
    if (saved) {
        try {
            const c = JSON.parse(saved);
            document.getElementById("host").value = c.host || "";
            document.getElementById("username").value = c.username || "";
        } catch {}
    }
    document.getElementById("login-form").addEventListener("submit", onLogin);
    checkStatus();
});

// ========== Auth ==========
async function checkStatus() {
    try {
        const r = await fetch(`${API}/api/status`);
        const d = await r.json();
        if (d.connected) {
            showApp(d.host);
        }
    } catch {}
}

async function onLogin(e) {
    e.preventDefault();
    const host = document.getElementById("host").value.trim();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const errEl = document.getElementById("login-error");
    const btn = document.getElementById("login-btn");

    errEl.classList.add("hidden");
    btn.disabled = true;
    btn.textContent = "Connecting...";

    try {
        const r = await fetch(`${API}/api/connect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ host, username, password }),
        });
        const d = await r.json();
        if (!r.ok) {
            errEl.textContent = d.error || "Connection failed";
            errEl.classList.remove("hidden");
            return;
        }
        localStorage.setItem("ipmi_creds", JSON.stringify({ host, username }));
        showApp(host);
    } catch (ex) {
        errEl.textContent = "Network error: " + ex.message;
        errEl.classList.remove("hidden");
    } finally {
        btn.disabled = false;
        btn.textContent = "Connect";
    }
}

async function disconnect() {
    await fetch(`${API}/api/disconnect`, { method: "POST" });
    stopMonitor();
    document.getElementById("app-view").classList.add("hidden");
    document.getElementById("login-view").classList.remove("hidden");
    document.getElementById("password").value = "";
}

function showApp(host) {
    document.getElementById("login-view").classList.add("hidden");
    document.getElementById("app-view").classList.remove("hidden");
    document.getElementById("nav-host").textContent = host;
    loadFanMode();
    loadFanDuty();
    loadSensorsForControl();
}

// ========== Tab Switching ==========
function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
    document.getElementById(`tab-${tab}`).classList.remove("hidden");

    if (tab === "monitor") {
        document.getElementById("monitor-host").textContent = document.getElementById("nav-host").textContent;
        loadMonitorData();
        startMonitor();
    } else {
        stopMonitor();
    }
}

// ========== Fan Mode ==========
async function loadFanMode() {
    try {
        const r = await fetch(`${API}/api/fan/mode`);
        const d = await r.json();
        if (d.mode) {
            document.getElementById("mode-value").textContent = d.mode;
            document.querySelectorAll(".mode-btn").forEach(b => {
                b.classList.toggle("active", b.dataset.mode === d.mode);
            });
        }
    } catch {}
}

async function setMode(mode) {
    try {
        const r = await fetch(`${API}/api/fan/mode`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode }),
        });
        const d = await r.json();
        if (r.ok) {
            toast("Mode set to " + mode, "success");
            document.querySelectorAll(".mode-btn").forEach(b => {
                b.classList.toggle("active", b.dataset.mode === mode);
            });
            document.getElementById("mode-value").textContent = mode;
        } else {
            toast(d.error || "Failed", "error");
        }
    } catch (ex) {
        toast("Error: " + ex.message, "error");
    }
}

// ========== Fan Duty (restore sliders) ==========
async function loadFanDuty() {
    // Always restore from localStorage first (reliable)
    const saved = localStorage.getItem("ipmi_fan_duty");
    if (saved) {
        try {
            const duties = JSON.parse(saved);
            if (duties.zone0 !== undefined) setZoneUI(0, duties.zone0);
            if (duties.zone1 !== undefined) setZoneUI(1, duties.zone1);
        } catch {}
    }

    // Try IPMI read as secondary source — only override if it returns
    // a meaningful (non-zero) value for zones we have no localStorage data for
    try {
        const r = await fetch(`${API}/api/fan/duty`);
        const d = await r.json();
        if (r.ok) {
            const cached = saved ? JSON.parse(saved) : {};
            if ((cached.zone0 === undefined) && d.zone0) setZoneUI(0, d.zone0);
            if ((cached.zone1 === undefined) && d.zone1) setZoneUI(1, d.zone1);
        }
    } catch {}
}

function setZoneUI(zone, duty) {
    const slider = document.getElementById(`slider-zone${zone}`);
    if (!slider) return;
    slider.value = duty;
    document.getElementById(`slider-label-zone${zone}`).textContent = duty + "%";
    updateGauge(zone, duty);
}

// ========== Fan Speed ==========
function updateSliderLabel(zone) {
    const val = document.getElementById(`slider-zone${zone}`).value;
    document.getElementById(`slider-label-zone${zone}`).textContent = val + "%";
}

async function applySpeed(zone) {
    const duty = parseInt(document.getElementById(`slider-zone${zone}`).value);
    try {
        const r = await fetch(`${API}/api/fan/speed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ zone, duty }),
        });
        const d = await r.json();
        if (r.ok) {
            let msg = `Zone ${zone} speed set to ${duty}%`;
            if (d.mode_switched) {
                msg += ` (auto-switched from ${d.previous_mode} to Full Speed)`;
                document.querySelectorAll(".mode-btn").forEach(b => {
                    b.classList.toggle("active", b.dataset.mode === "full");
                });
                document.getElementById("mode-value").textContent = "full";
            }
            toast(msg, "success");
            updateGauge(zone, duty);
            // Persist to localStorage
            const saved = JSON.parse(localStorage.getItem("ipmi_fan_duty") || "{}");
            saved[`zone${zone}`] = duty;
            localStorage.setItem("ipmi_fan_duty", JSON.stringify(saved));
        } else {
            toast(d.error || "Failed", "error");
        }
    } catch (ex) {
        toast("Error: " + ex.message, "error");
    }
}

function updateGauge(zone, percent) {
    const circumference = 326.73;
    const offset = circumference - (percent / 100) * circumference;
    document.getElementById(`gauge-zone${zone}`).style.strokeDashoffset = offset;
    document.getElementById(`gauge-val-zone${zone}`).textContent = percent + "%";

    const gaugeFill = document.getElementById(`gauge-zone${zone}`);
    if (percent > 80) gaugeFill.style.stroke = "var(--danger)";
    else if (percent > 50) gaugeFill.style.stroke = "var(--warning)";
    else gaugeFill.style.stroke = "var(--accent)";
}

// ========== Sensors for Fan Control ==========
async function loadSensorsForControl() {
    try {
        const r = await fetch(`${API}/api/sensors`);
        const d = await r.json();
        if (!r.ok) return;
        sensorCache = d;
        renderZoneFans(d.fan || []);
        renderThresholds(d.fan || []);
    } catch {}
}

function renderZoneFans(fans) {
    const zone0Names = ["fan1", "fan2", "fan3", "fan4", "fan5", "fan6"];
    const zone1Names = ["fana", "fanb", "fanc"];

    const zone0El = document.getElementById("zone0-fans");
    const zone1El = document.getElementById("zone1-fans");

    zone0El.innerHTML = fans
        .filter(f => zone0Names.includes(f.name.toLowerCase()))
        .map(f => `<div class="fan-rpm"><span class="fan-rpm-name">${f.name}</span><span class="fan-rpm-val">${f.value ?? "N/A"} RPM</span></div>`)
        .join("") || "<div style='color:var(--text-muted);font-size:0.82rem'>No fans detected in this zone</div>";

    zone1El.innerHTML = fans
        .filter(f => zone1Names.includes(f.name.toLowerCase()))
        .map(f => `<div class="fan-rpm"><span class="fan-rpm-name">${f.name}</span><span class="fan-rpm-val">${f.value ?? "N/A"} RPM</span></div>`)
        .join("") || "<div style='color:var(--text-muted);font-size:0.82rem'>No fans detected in this zone</div>";
}

function renderThresholds(fans) {
    const el = document.getElementById("threshold-editor");
    el.innerHTML = fans.map(f => `
        <div class="threshold-row">
            <span class="threshold-name">${f.name}</span>
            <div class="threshold-inputs">
                <input type="number" placeholder="LNR" value="${f.lnr ?? ""}" id="thr-lnr-${f.name}">
                <input type="number" placeholder="LCR" value="${f.lcr ?? ""}" id="thr-lcr-${f.name}">
                <input type="number" placeholder="LNC" value="${f.lnc ?? ""}" id="thr-lnc-${f.name}">
            </div>
            <button class="btn btn-ghost threshold-btn" onclick="applyThreshold('${f.name}')">Set</button>
        </div>
    `).join("");
}

async function applyThreshold(sensor) {
    const lnr = parseFloat(document.getElementById(`thr-lnr-${sensor}`).value) || undefined;
    const lcr = parseFloat(document.getElementById(`thr-lcr-${sensor}`).value) || undefined;
    const lnc = parseFloat(document.getElementById(`thr-lnc-${sensor}`).value) || undefined;

    try {
        const r = await fetch(`${API}/api/fan/threshold`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sensor, lnr, lcr, lnc }),
        });
        const d = await r.json();
        if (r.ok) {
            toast(`Thresholds updated for ${sensor}`, "success");
        } else {
            toast(d.error || "Failed", "error");
        }
    } catch (ex) {
        toast("Error: " + ex.message, "error");
    }
}

// ========== Monitor View ==========
function startMonitor() {
    stopMonitor();
    monitorInterval = setInterval(loadMonitorData, 5000);
}

function stopMonitor() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }
}

async function loadMonitorData() {
    try {
        const r = await fetch(`${API}/api/sensors`);
        const d = await r.json();
        if (!r.ok) {
            document.getElementById("monitor-status-dot").style.background = "var(--danger)";
            return;
        }
        sensorCache = d;
        document.getElementById("monitor-status-dot").style.background = "var(--success)";
        const now = new Date().toLocaleTimeString();
        document.getElementById("monitor-refresh-time").textContent = `Last update: ${now}`;

        renderMonitorTemp(d.temperature || []);
        renderMonitorFans(d.fan || []);
        renderMonitorVoltage([...(d.voltage || []), ...(d.power || []), ...(d.other || [])]);
    } catch {
        document.getElementById("monitor-status-dot").style.background = "var(--danger)";
    }
}

function getStatusClass(sensor) {
    const s = (sensor.status || "").toLowerCase();
    if (s === "na" || sensor.value === null) return "status-na";
    if (s.includes("critical") || s.includes("non-recoverable")) return "status-critical";
    if (s.includes("warning") || s.includes("non-critical")) return "status-warning";
    return "";
}

function renderMonitorTemp(sensors) {
    const el = document.getElementById("monitor-temp");
    el.innerHTML = sensors.map(s => {
        const val = s.value !== null ? s.value.toFixed(1) : "N/A";
        const unit = s.unit || "°C";
        const maxTemp = 100;
        const pct = s.value !== null ? Math.min((s.value / maxTemp) * 100, 100) : 0;
        return `
            <div class="sensor-card ${getStatusClass(s)}">
                <div class="sensor-card-name">${s.name}</div>
                <div class="sensor-card-value">${val}<span class="sensor-card-unit"> ${unit}</span></div>
                <div class="sensor-card-bar"><div class="sensor-card-bar-fill" style="width:${pct}%"></div></div>
            </div>`;
    }).join("");
}

function renderMonitorFans(sensors) {
    const el = document.getElementById("monitor-fans");
    el.innerHTML = sensors.map(s => {
        const val = s.value !== null ? Math.round(s.value) : "N/A";
        const unit = s.unit || "RPM";
        const maxRPM = 15000;
        const pct = s.value !== null ? Math.min((s.value / maxRPM) * 100, 100) : 0;
        return `
            <div class="sensor-card ${getStatusClass(s)}">
                <div class="sensor-card-name">${s.name}</div>
                <div class="sensor-card-value">${val}<span class="sensor-card-unit"> ${unit}</span></div>
                <div class="sensor-card-bar"><div class="sensor-card-bar-fill" style="width:${pct}%"></div></div>
            </div>`;
    }).join("");
}

function renderMonitorVoltage(sensors) {
    const el = document.getElementById("monitor-voltage");
    el.innerHTML = sensors.map(s => {
        const val = s.value !== null ? s.value.toFixed(2) : "N/A";
        const unit = s.unit || "";
        return `
            <div class="sensor-card ${getStatusClass(s)}">
                <div class="sensor-card-name">${s.name}</div>
                <div class="sensor-card-value">${val}<span class="sensor-card-unit"> ${unit}</span></div>
            </div>`;
    }).join("");
}

// ========== Toast ==========
function toast(msg, type = "") {
    const el = document.getElementById("toast");
    const msgEl = document.getElementById("toast-msg");
    msgEl.textContent = msg;
    el.className = "toast " + type;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 3000);
}
