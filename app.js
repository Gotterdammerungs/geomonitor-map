// app.js — Verbose Geomonitor frontend (uses MAPTILER_KEY injected into index.html)

console.log("🛰️ Geomonitor starting up...");

// ------------- Globals -------------
let map;
let activeMarkers = {};
let tileLayer = null;
let maptilerKey = typeof MAPTILER_KEY !== "undefined" ? MAPTILER_KEY : null;
let currentTheme = (document.body.getAttribute("data-theme") || "dark");
const statusText = () => document.getElementById("status-text");

// ------------- Utility helpers -------------
function logStatus(msg) {
  try { if (statusText()) statusText().textContent = msg; } catch(e) {}
  console.log(msg);
}
function abort(msg) {
  console.error(msg);
  logStatus(msg);
  throw new Error(msg);
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" })[m]);
}
function escapeAttr(s) { return String(s||"").replace(/"/g, "%22"); }

// ------------- verify key is present -------------
function ensureMapKey() {
  if (!maptilerKey || maptilerKey.includes("PLACEHOLDER")) {
    abort("⚠️ MapTiler key missing. Ensure MAPTILER_KEY was injected at deploy time.");
  } else {
    console.log("🔒 MapTiler key present (hidden).");
  }
}

// ------------- Tile theme definitions (use MapTiler for solarized + satellite) -------------
function getTileConfig(key) {
  // CSP-friendly MapTiler endpoints:
  const base = "https://api.maptiler.com/maps";
  return {
    dark: {
      name: "Dark",
      url: `${base}/darkmatter/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
      attribution: '&copy; OpenStreetMap contributors & MapTiler'
    },
    light: {
      name: "Light",
      url: `${base}/basic/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
      attribution: '&copy; OpenStreetMap contributors & MapTiler'
    },
    solarized: {
      name: "Solarized",
      url: `${base}/solarized-dark/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
      attribution: '&copy; OpenStreetMap contributors & MapTiler'
    },
    satellite: {
      name: "Satellite",
      url: `${base}/satellite/{z}/{x}/{y}.jpg?key=${encodeURIComponent(key)}`,
      attribution: '&copy; OpenStreetMap contributors & MapTiler'
    }
  };
}

// ------------- Theme-aware dot color -------------
function getTopicColor(topic) {
  const t = (topic || "").toLowerCase();
  const isLight = (currentTheme === "light" || currentTheme === "satellite");
  const defaultDot = isLight ? "#000000" : "#ffffff";

  if (["geopolitics","conflict","diplomacy","security"].includes(t)) return "#ef4444";
  if (["economy","finance"].includes(t)) return "#22c55e";
  if (["technology","cyber","science"].includes(t)) return "#0ea5e9";
  if (["environment","disaster","energy"].includes(t)) return "#fb923c";
  return defaultDot;
}

// ------------- Importance -> min zoom -------------
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

// ------------- Initialize map & layers -------------
function initMap() {
  logStatus("initializing map...");
  console.log("🗺️ Initializing map...");

  ensureMapKey();
  const cfg = getTileConfig(maptilerKey);

  map = L.map("map", { preferCanvas: true }).setView([20, 0], 2);

  try {
    tileLayer = L.tileLayer(cfg[currentTheme].url, { attribution: cfg[currentTheme].attribution, maxZoom: 12 }).addTo(map);
    console.log(`🧭 Added initial tile layer: ${currentTheme}`);
  } catch (err) {
    console.error("Tile layer init failed:", err);
  }

  setupRealtimeListener();
  setupPanelControls(cfg);
  logStatus("map initialized, listening for events");
}

// ------------- Realtime Firebase listener -------------
function setupRealtimeListener() {
  logStatus("connecting to Firebase...");
  console.log("📡 Connecting to Firebase Realtime DB...");

  const dbRef = firebase.database().ref("/events");
  dbRef.on("value", (snap) => {
    const events = snap.val();
    if (!events) {
      console.warn("⚠️ No events returned from Firebase.");
      logStatus("no events");
      return;
    }
    console.log(`📦 Firebase returned ${Object.keys(events).length} events.`);
    renderMarkers(events);
  }, (err) => {
    console.error("Firebase listener error:", err);
    logStatus("firebase error (see console)");
  });
}

// ------------- Render markers -------------
function renderMarkers(events) {
  // clear old markers
  Object.values(activeMarkers).forEach(({ marker }) => {
    if (map.hasLayer(marker)) map.removeLayer(marker);
  });
  activeMarkers = {};

  Object.entries(events).forEach(([k, e]) => {
    if (!e || !e.lat || !e.lon) return;
    const color = getTopicColor(e.topic);
    const minZoom = getMinZoomForImportance(e.importance);

    const marker = L.circleMarker([e.lat, e.lon], {
      radius: 7, color, fillColor: color, fillOpacity: 0.85, weight: 1.5
    });
    marker.options._topic = e.topic || "other";

    const popup = `
      <div style="font-family:system-ui, sans-serif; color:inherit; max-width:260px;">
        <div style="font-weight:700">${escapeHtml(e.title || "Untitled")}</div>
        <div style="font-size:12px;color:grey">${escapeHtml(e.type || "Source")}</div>
        <div style="margin:6px 0;font-size:13px;color:grey">Topic: ${escapeHtml(e.topic || "N/A")} | Importance: ${escapeHtml(e.importance ? String(e.importance) : "?")}</div>
        <div style="font-size:13px">${escapeHtml(e.description || "")}</div>
        ${e.url ? `<div style="margin-top:8px;"><a href="${escapeAttr(e.url)}" target="_blank" rel="noopener noreferrer">Read →</a></div>` : ""}
      </div>
    `;
    marker.bindPopup(popup);
    activeMarkers[k] = { marker, minZoom };
    marker.addTo(map);
  });

  console.log(`✅ Rendered ${Object.keys(activeMarkers).length} markers.`);
  updateMarkerVisibility();
  logStatus(`${Object.keys(activeMarkers).length} events displayed`);
}

// ------------- Visibility control -------------
function updateMarkerVisibility() {
  const zoom = map.getZoom();
  Object.values(activeMarkers).forEach(({ marker, minZoom }) => {
    if (zoom >= minZoom) {
      if (!map.hasLayer(marker)) map.addLayer(marker);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    }
  });
  console.log(`🔍 Marker visibility updated at zoom ${zoom}`);
}

// ------------- Change theme & recolor markers -------------
function changeTheme(theme, cfg) {
  if (!cfg[theme]) { console.warn("Unknown theme:", theme); return; }
  currentTheme = theme;
  document.body.setAttribute("data-theme", theme);

  if (tileLayer) try { map.removeLayer(tileLayer); } catch(e) {}
  tileLayer = L.tileLayer(cfg[theme].url, { attribution: cfg[theme].attribution, maxZoom: 12 }).addTo(map);
  console.log(`🎨 Theme switched to ${theme}`);

  // recolor markers according to new theme
  Object.values(activeMarkers).forEach(({ marker }) => {
    const t = marker.options._topic || "other";
    const c = getTopicColor(t);
    marker.setStyle({ color: c, fillColor: c });
  });
  logStatus(`theme: ${theme}`);
}

// ------------- Control panel wiring -------------
function setupPanelControls(cfg) {
  // ensure controls exist (index.html contains them)
  const toggle = document.getElementById("gm-panel-toggle");
  const panel = document.getElementById("gm-panel");
  const selector = document.getElementById("gm-theme-selector");
  const slider = document.getElementById("crt-intensity");

  if (!toggle || !panel || !selector || !slider) {
    console.warn("Control panel elements missing in DOM.");
    return;
  }

  // toggle open/close robustly
  function togglePanel(e) {
    e && e.stopPropagation && e.stopPropagation();
    const hidden = panel.classList.toggle("gm-hidden");
    toggle.setAttribute("aria-expanded", (!hidden).toString());
  }
  ["pointerdown","click","touchstart"].forEach(ev => toggle.addEventListener(ev, togglePanel, { passive:false }));

  // init selector
  selector.value = currentTheme;
  selector.addEventListener("change", (e) => changeTheme(e.target.value, cfg));

  // init slider (CRT)
  const stored = parseFloat(localStorage.getItem("gm_crt") || "0.45");
  slider.value = stored;
  document.documentElement.style.setProperty("--crt-opacity", stored);
  slider.addEventListener("input", (e) => {
    const v = e.target.value;
    document.documentElement.style.setProperty("--crt-opacity", v);
    localStorage.setItem("gm_crt", String(v));
  });

  // clicking outside closes
  document.addEventListener("pointerdown", (ev) => {
    if (!panel.contains(ev.target) && !toggle.contains(ev.target)) {
      if (!panel.classList.contains("gm-hidden")) {
        panel.classList.add("gm-hidden");
        toggle.setAttribute("aria-expanded", "false");
      }
    }
  }, { passive: true });

  console.log("🧭 Control panel wired.");
}

// ------------- DOM ready: start -------------
document.addEventListener("DOMContentLoaded", () => {
  try {
    logStatus("loading...");
    initMap();
  } catch (err) {
    console.error("Fatal initialization error:", err);
    logStatus("initialization failed — see console");
  }
});
