// =========================================================
// app.js — Geomonitor Frontend (MapTiler + Firebase + Fallback)
// =========================================================

console.log("🛰️ Geomonitor starting up...");
console.log("ℹ️ Verbose diagnostics enabled.");

// ---------------------- Globals ----------------------
let map;
let activeMarkers = {};
let tileLayer = null;
let currentTheme = document.body.getAttribute("data-theme") || "dark";
const statusEl = () => document.getElementById("status-text");

// 🔑 Get MapTiler key from global, meta, or env injection
let MAPTILER_KEY_VALUE = null;
try {
  if (typeof MAPTILER_KEY !== "undefined" && MAPTILER_KEY) {
    MAPTILER_KEY_VALUE = MAPTILER_KEY;
  } else {
    const meta = document.querySelector('meta[name="maptiler-key"]');
    if (meta) MAPTILER_KEY_VALUE = meta.getAttribute("content");
  }
} catch (e) {
  console.warn("MapTiler key lookup failed:", e);
}

// ---------------------- Helpers ----------------------
function logStatus(msg) {
  try { if (statusEl()) statusEl().textContent = msg; } catch (e) {}
  console.log(msg);
}

function verboseError(msg, err) {
  console.error(msg, err || "");
  logStatus(msg);
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[m]));
}

function escapeAttr(s) {
  return String(s || "").replace(/"/g, "%22");
}

// ---------------------- Tile sources ----------------------
function getTileSources(maptilerKey) {
  const carto = {
    dark: {
      name: "Carto Dark",
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
    },
    light: {
      name: "Carto Light",
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
    }
  };

  if (!maptilerKey || typeof maptilerKey !== "string" || maptilerKey.includes("PLACEHOLDER")) {
    console.warn("⚠️ No MapTiler key detected on page. Using fallback Carto tiles — map will still work.");
    return carto;
  }

  const base = "https://api.maptiler.com/maps";
  return {
    dark: {
      name: "MapTiler Dark",
      url: `${base}/darkmatter/{z}/{x}/{y}.png?key=${encodeURIComponent(maptilerKey)}`,
      attribution: "&copy; OpenStreetMap contributors & MapTiler"
    },
    light: {
      name: "MapTiler Light",
      url: `${base}/basic/{z}/{x}/{y}.png?key=${encodeURIComponent(maptilerKey)}`,
      attribution: "&copy; OpenStreetMap contributors & MapTiler"
    },
    solarized: {
      name: "MapTiler Solarized",
      url: `${base}/solarized-dark/{z}/{x}/{y}.png?key=${encodeURIComponent(maptilerKey)}`,
      attribution: "&copy; OpenStreetMap contributors & MapTiler"
    },
    satellite: {
      name: "MapTiler Satellite",
      url: `${base}/satellite/{z}/{x}/{y}.jpg?key=${encodeURIComponent(maptilerKey)}`,
      attribution: "&copy; OpenStreetMap contributors & MapTiler"
    }
  };
}

// ---------------------- Topic color ----------------------
function getTopicColor(topic) {
  const t = (topic || "").toLowerCase();
  const isLight = currentTheme === "light" || currentTheme === "satellite";
  const defaultDot = isLight ? "#000000" : "#ffffff";

  if (["geopolitics", "conflict", "diplomacy", "security"].includes(t)) return "#ef4444";
  if (["economy", "finance"].includes(t)) return "#22c55e";
  if (["technology", "cyber", "science"].includes(t)) return "#0ea5e9";
  if (["environment", "disaster", "energy"].includes(t)) return "#fb923c";
  return defaultDot;
}

// ---------------------- Importance -> zoom ----------------------
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

// ---------------------- Initialize map ----------------------
function initMap() {
  logStatus("loading...");
  console.log("initializing map...");

  const tiles = getTileSources(MAPTILER_KEY_VALUE);
  const availableThemes = Object.keys(tiles);
  console.log("Available tile themes:", availableThemes.join(", "));

  map = L.map("map", { preferCanvas: true }).setView([20, 0], 2);

  const initialTheme = availableThemes.includes(currentTheme) ? currentTheme : availableThemes[0];
  try {
    tileLayer = L.tileLayer(tiles[initialTheme].url, {
      attribution: tiles[initialTheme].attribution,
      maxZoom: 12
    }).addTo(map);
    console.log(`Tile layer added: ${initialTheme} -> ${tiles[initialTheme].name}`);
    logStatus(`map loaded (${tiles[initialTheme].name})`);
  } catch (err) {
    verboseError("Failed to add tile layer, see error:", err);
    logStatus("tile init failed — see console");
  }

  setupRealtimeListener();
  setupPanelControls(tiles);
}

// ---------------------- Firebase listener ----------------------
function setupRealtimeListener() {
  console.log("setting up Firebase realtime listener...");
  logStatus("connecting to Firebase...");

  try {
    const dbRef = firebase.database().ref("/events");
    dbRef.on(
      "value",
      (snapshot) => {
        const events = snapshot.val();
        if (!events) {
          console.warn("Firebase returned no events.");
          logStatus("no events");
          return;
        }
        console.log(`Firebase: got ${Object.keys(events).length} events.`);
        renderMarkers(events);
      },
      (err) => {
        verboseError("Firebase listener error:", err);
        logStatus("firebase error");
      }
    );
  } catch (err) {
    verboseError("Failed to set up Firebase listener:", err);
    logStatus("firebase init failed");
  }
}

// ---------------------- Render markers ----------------------
function renderMarkers(events) {
  Object.values(activeMarkers).forEach(({ marker }) => {
    if (map.hasLayer(marker)) map.removeLayer(marker);
  });
  activeMarkers = {};

  Object.entries(events).forEach(([key, e]) => {
    if (!e || !e.lat || !e.lon) return;
    const color = getTopicColor(e.topic);
    const minZoom = getMinZoomForImportance(e.importance);

    const marker = L.circleMarker([e.lat, e.lon], {
      radius: 7,
      color,
      fillColor: color,
      fillOpacity: 0.85,
      weight: 1.5
    });
    marker.options._topic = e.topic || "other";

    const popupHTML = `
      <div style="font-family:system-ui, sans-serif; max-width:260px; color:inherit;">
        <div style="font-weight:700; margin-bottom:6px;">${escapeHtml(e.title || "Untitled")}</div>
        <div style="font-size:12px;color:grey;margin-bottom:6px;">${escapeHtml(e.type || "Source")}</div>
        <div style="font-size:13px;color:grey;margin-bottom:8px;">Topic: ${escapeHtml(e.topic || "N/A")} | Importance: ${escapeHtml(e.importance ? String(e.importance) : "?")}</div>
        <div style="font-size:13px;color:inherit;">${escapeHtml(e.description || "")}</div>
        ${e.url ? `<div style="margin-top:8px;"><a href="${escapeAttr(e.url)}" target="_blank" rel="noopener noreferrer">Read full article →</a></div>` : ""}
      </div>
    `;
    marker.bindPopup(popupHTML);
    activeMarkers[key] = { marker, minZoom };
    marker.addTo(map);
  });

  console.log(`Rendered ${Object.keys(activeMarkers).length} markers.`);
  updateMarkerVisibility();
  map.on("zoomend", updateMarkerVisibility);
  logStatus(`${Object.keys(activeMarkers).length} events displayed`);
}

// ---------------------- Visibility ----------------------
function updateMarkerVisibility() {
  const zoom = map.getZoom();
  Object.values(activeMarkers).forEach(({ marker, minZoom }) => {
    if (zoom >= minZoom) {
      if (!map.hasLayer(marker)) map.addLayer(marker);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    }
  });
  console.log(`Updated marker visibility at zoom ${zoom}.`);
}

// ---------------------- Theme switching ----------------------
function changeTheme(theme, tiles) {
  const available = Object.keys(tiles);
  if (!available.includes(theme)) {
    console.warn(`Theme "${theme}" not available for current tile set. Available: ${available.join(", ")}`);
    theme = available[0];
  }
  currentTheme = theme;
  document.body.setAttribute("data-theme", theme);

  if (tileLayer) try { map.removeLayer(tileLayer); } catch (e) {}

  tileLayer = L.tileLayer(tiles[theme].url, {
    attribution: tiles[theme].attribution,
    maxZoom: 12
  }).addTo(map);
  console.log(`Theme switched to ${theme} -> ${tiles[theme].name}`);

  // recolor markers
  Object.values(activeMarkers).forEach(({ marker }) => {
    const topic = marker.options._topic || "other";
    const c = getTopicColor(topic);
    marker.setStyle({ color: c, fillColor: c });
  });

  logStatus(`theme: ${theme}`);
}

// ---------------------- Control panel ----------------------
function setupPanelControls(tiles) {
  const toggle = document.getElementById("gm-panel-toggle");
  const panel = document.getElementById("gm-panel");
  const selector = document.getElementById("gm-theme-selector");
  const slider = document.getElementById("crt-intensity");

  if (!toggle || !panel || !selector || !slider) {
    console.warn("Control panel DOM missing. Skipping control wiring.");
    return;
  }

  function togglePanel(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const hidden = panel.classList.toggle("gm-hidden");
    panel.setAttribute("aria-hidden", hidden.toString());
    toggle.setAttribute("aria-expanded", (!hidden).toString());
  }
  ["click", "touchstart"].forEach((ev) =>
    toggle.addEventListener(ev, togglePanel, { passive: false })
  );

  selector.innerHTML = Object.keys(tiles)
    .map((k) => `<option value="${k}" ${k === currentTheme ? "selected" : ""}>${tiles[k].name}</option>`)
    .join("");
  selector.addEventListener("change", (e) => changeTheme(e.target.value, tiles));

  slider.addEventListener("input", (e) => {
    document.documentElement.style.setProperty("--crt-opacity", e.target.value);
  });

  console.log("Control panel wired (robust).");
}

// ---------------------- Start ----------------------
document.addEventListener("DOMContentLoaded", initMap);
