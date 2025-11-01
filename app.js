// app.js — Secure Geomonitor with CRT effects, theme selector, and MapTiler integration

let activeMarkers = {};
let map;
let tileLayer = null;
let currentTheme = localStorage.getItem("gm_theme") || "dark";
let TILE_THEMES = {};

// ======= Load MapTiler key from config.json =======
async function loadConfig() {
  try {
    const res = await fetch("config.json");
    const cfg = await res.json();
    const key = cfg.maptiler_key;
    if (!key) throw new Error("Missing maptiler_key");

    TILE_THEMES = {
      dark: {
        name: "Dark",
        url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      },
      light: {
        name: "Light",
        url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      },
      solarized: {
        name: "Solarized",
        url: `https://api.maptiler.com/maps/solarized-dark/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
        attribution: '&copy; OpenStreetMap contributors & MapTiler',
      },
      satellite: {
        name: "Satellite",
        url: `https://api.maptiler.com/maps/hybrid/{z}/{x}/{y}.jpg?key=${encodeURIComponent(key)}`,
        attribution: '&copy; OpenStreetMap contributors & MapTiler',
      },
    };

    initMap();
  } catch (err) {
    console.error("Failed to load config.json:", err);
    alert("⚠️ Could not load map configuration or MapTiler key.");
  }
}

// ======= Initialize Map =======
function initMap() {
  map = L.map("map", { preferCanvas: true }).setView([20, 0], 2);
  ensureCrtClasses();

  const theme = TILE_THEMES[currentTheme] || TILE_THEMES.dark;
  tileLayer = L.tileLayer(theme.url, {
    attribution: theme.attribution,
    maxZoom: 12,
  }).addTo(map);

  setupRealtimeListener();
  createControlPanel();

  const stored = parseFloat(localStorage.getItem("gm_crt") || "0.45");
  document.documentElement.style.setProperty("--crt-opacity", stored);
}

// ======= CRT Classes =======
function ensureCrtClasses() {
  const body = document.body;
  ["crt-scanlines", "crt-flicker", "crt-colorsep"].forEach(cls => {
    if (!body.classList.contains(cls)) body.classList.add(cls);
  });
}

// ======= Marker Colors (auto theme aware) =======
function getTopicColor(topic) {
  const t = (topic || "").toLowerCase();
  const isLight = currentTheme === "light" || currentTheme === "satellite";
  const defaultDot = isLight ? "#000" : "#fff";

  if (["geopolitics", "conflict", "diplomacy", "security"].includes(t)) return "#ef4444";
  if (["economy", "finance"].includes(t)) return "#22c55e";
  if (["technology", "cyber", "science"].includes(t)) return "#0ea5e9";
  if (["environment", "disaster", "energy"].includes(t)) return "#fb923c";
  return defaultDot;
}

// ======= Marker Visibility by Zoom =======
function getMinZoomForImportance(importance) {
  const imp = parseInt(importance) || 3;
  switch (imp) {
    case 5: return 0;
    case 4: return 3;
    case 3: return 5;
    case 2: return 7;
    default: return 9;
  }
}

// ======= Firebase Realtime Listener =======
function setupRealtimeListener() {
  const dbRef = firebase.database().ref("/events");
  const clearMarkers = () => {
    Object.values(activeMarkers).forEach(({ marker }) => {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    });
    activeMarkers = {};
  };

  dbRef.on("value", (snapshot) => {
    clearMarkers();
    const events = snapshot.val();
    if (!events) return;

    Object.entries(events).forEach(([key, e]) => {
      if (!e || !e.lat || !e.lon) return;
      const color = getTopicColor(e.topic);
      const minZoom = getMinZoomForImportance(e.importance);

      const marker = L.circleMarker([e.lat, e.lon], {
        radius: 7,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 1.5,
      });
      marker.options._topic = e.topic || "other";

      const popupHTML = `
        <div style="font-family:sans-serif;max-width:260px;color:inherit;">
          <div style="font-weight:700;">${escapeHtml(e.title || "Untitled")}</div>
          <div style="font-size:12px;color:var(--popup-muted,#9ca3af);">${escapeHtml(e.type || "Source")}</div>
          <div style="font-size:13px;color:var(--popup-muted,#d1d5db);margin:5px 0;">Topic: ${escapeHtml(e.topic || "N/A")} | Importance: ${escapeHtml(e.importance ? String(e.importance) : "?")}</div>
          <div style="font-size:13px;">${escapeHtml(e.description || "")}</div>
          ${e.url ? `<div style="margin-top:6px;"><a href="${escapeAttribute(e.url)}" target="_blank" style="color:#60a5fa;text-decoration:none;">Read full article →</a></div>` : ""}
        </div>
      `;
      marker.bindPopup(popupHTML);
      activeMarkers[key] = { marker, minZoom };
      marker.addTo(map);
    });

    updateMarkerVisibility();
    map.on("zoomend", updateMarkerVisibility);
  });
}

function updateMarkerVisibility() {
  const zoom = map.getZoom();
  Object.values(activeMarkers).forEach(({ marker, minZoom }) => {
    if (zoom >= minZoom) map.addLayer(marker);
    else map.removeLayer(marker);
  });
}

// ======= Change Theme =======
function changeTheme(newTheme) {
  if (!TILE_THEMES[newTheme]) return;
  currentTheme = newTheme;
  localStorage.setItem("gm_theme", currentTheme);

  if (tileLayer) map.removeLayer(tileLayer);
  const cfg = TILE_THEMES[newTheme];
  tileLayer = L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: 12 }).addTo(map);

  Object.values(activeMarkers).forEach(({ marker }) => {
    const topic = marker.options._topic;
    const c = getTopicColor(topic);
    marker.setStyle({ color: c, fillColor: c });
  });
}

// ======= Control Panel =======
function createControlPanel() {
  const panel = document.createElement("div");
  panel.id = "gm-control-panel";
  panel.innerHTML = `
    <button id="gm-panel-toggle">☰ Themes</button>
    <div id="gm-panel" class="gm-hidden">
      <h4>🗺️ Map Themes</h4>
      <select id="gm-theme-selector">
        ${Object.keys(TILE_THEMES)
          .map(k => `<option value="${k}" ${k === currentTheme ? "selected" : ""}>${TILE_THEMES[k].name}</option>`)
          .join("")}
      </select>
      <label for="crt-intensity" style="display:block;margin-top:10px;font-weight:600;">📺 CRT Intensity</label>
      <input id="crt-intensity" type="range" min="0" max="1" step="0.05" />
    </div>
  `;
  document.body.appendChild(panel);

  const toggle = panel.querySelector("#gm-panel-toggle");
  const dialog = panel.querySelector("#gm-panel");
  const selector = panel.querySelector("#gm-theme-selector");
  const slider = panel.querySelector("#crt-intensity");

  const stored = parseFloat(localStorage.getItem("gm_crt") || "0.45");
  slider.value = stored;
  document.documentElement.style.setProperty("--crt-opacity", stored);

  toggle.addEventListener("click", () => {
    dialog.classList.toggle("gm-hidden");
  });

  selector.addEventListener("change", (e) => changeTheme(e.target.value));

  slider.addEventListener("input", (e) => {
    const v = e.target.value;
    document.documentElement.style.setProperty("--crt-opacity", v);
    localStorage.setItem("gm_crt", String(v));
  });
}

// ======= Safe HTML escaping =======
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}
function escapeAttribute(s) {
  return String(s || "").replace(/"/g, "%22");
}

// ======= Start =======
document.addEventListener("DOMContentLoaded", loadConfig);
