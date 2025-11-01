// =============================
// Geomonitor map — robust control panel + theme selector
// =============================

let activeMarkers = {};
let map;
let currentTheme = localStorage.getItem("gm_theme") || "dark";
let tileLayer = null;

// Tile themes (solarized requires a real key if you use MapTiler)
const TILE_THEMES = {
  dark: {
    name: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  },
  light: {
    name: "Light",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  },
  solarized: {
    name: "Solarized",
    url: "https://api.maptiler.com/maps/solarized-dark/{z}/{x}/{y}.png?key=GetYourOwnKey",
    attribution: '&copy; OpenStreetMap contributors & MapTiler'
  }
};

// ---------- init ----------
function initMap() {
  map = L.map("map", { preferCanvas: true }).setView([20, 0], 2);

  // add tile from chosen theme
  tileLayer = L.tileLayer(TILE_THEMES[currentTheme].url, {
    attribution: TILE_THEMES[currentTheme].attribution,
    maxZoom: 12
  }).addTo(map);

  setupRealtimeListener();
  createControlPanel(); // create and wire listeners
  // restore slider value
  const stored = parseFloat(localStorage.getItem("gm_crt") || "0.45");
  document.documentElement.style.setProperty("--crt-opacity", stored);
  const slider = document.getElementById("crt-intensity");
  if (slider) slider.value = stored;
}

// ---------- topic color aware of theme ----------
function getTopicColor(topic) {
  const t = (topic || "").toLowerCase();
  const isLight = currentTheme === "light";
  const defaultDot = isLight ? "black" : "white";

  if (["geopolitics", "conflict", "diplomacy", "security"].includes(t)) return "#ef4444"; // red
  if (["economy", "finance", "economy"].includes(t)) return "#22c55e"; // green
  if (["technology", "cyber", "science"].includes(t)) return "#0ea5e9"; // deepskyblue
  if (["environment", "disaster", "energy"].includes(t)) return "#fb923c"; // orange
  return defaultDot;
}

// ---------- importance -> min zoom ----------
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

// ---------- firebase realtime listener ----------
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

      // create marker and store topic on marker.options._topic for recolor
      const marker = L.circleMarker([e.lat, e.lon], {
        radius: 7,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 1.5,
      });

      // store topic on options so we can recolor later
      marker.options._topic = e.topic || "other";

      const popupHTML = `
        <div style="font-family:system-ui, sans-serif; max-width:260px; color:inherit;">
          <div style="font-weight:700; margin-bottom:6px;">${escapeHtml(e.title || "Untitled")}</div>
          <div style="font-size:12px;color:var(--popup-muted,#9ca3af); margin-bottom:6px;">${escapeHtml(e.type || "Source")}</div>
          <div style="font-size:13px;color:var(--popup-muted,#d1d5db); margin-bottom:8px;">Topic: ${escapeHtml(e.topic || "N/A")} | Importance: ${escapeHtml(e.importance ? String(e.importance) : "?")}</div>
          <div style="font-size:13px;color:var(--popup-text,#cbd5e1)">${escapeHtml(e.description || "")}</div>
          ${e.url ? `<div style="margin-top:8px;"><a href="${escapeAttribute(e.url)}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;text-decoration:none;font-weight:600;">Read full article →</a></div>` : ""}
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

// ---------- visibility ----------
function updateMarkerVisibility() {
  const zoom = map.getZoom();
  Object.values(activeMarkers).forEach(({ marker, minZoom }) => {
    if (zoom >= minZoom) {
      if (!map.hasLayer(marker)) map.addLayer(marker);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    }
  });
}

// ---------- change theme (tile swap + recolor) ----------
function changeTheme(newTheme) {
  if (!TILE_THEMES[newTheme]) return;
  currentTheme = newTheme;
  localStorage.setItem("gm_theme", currentTheme);

  // remove previous tile layer
  if (tileLayer) {
    try { map.removeLayer(tileLayer); } catch (e) {}
  }
  tileLayer = L.tileLayer(TILE_THEMES[newTheme].url, {
    attribution: TILE_THEMES[newTheme].attribution,
    maxZoom: 12,
  }).addTo(map);

  // recolor existing markers to match theme
  Object.values(activeMarkers).forEach(({ marker }) => {
    const topic = marker.options._topic || "other";
    const c = getTopicColor(topic);
    marker.setStyle({ color: c, fillColor: c });
  });
}

// ---------- create robust control panel and wire events ----------
function createControlPanel() {
  // if exists, remove then recreate to avoid duplicates
  const existing = document.getElementById("gm-control-panel");
  if (existing) existing.remove();

  // build markup (panel appended to body, above map)
  const panel = document.createElement("div");
  panel.id = "gm-control-panel";
  panel.innerHTML = `
    <button id="gm-panel-toggle" type="button" aria-expanded="false">☰ Themes</button>
    <div id="gm-panel" class="gm-hidden" role="dialog" aria-hidden="true">
      <h4 style="margin:0 0 8px 0;">🗺️ Map Themes</h4>
      <select id="gm-theme-selector" aria-label="Select map theme" style="width:100%;padding:6px;border-radius:6px;">
        ${Object.keys(TILE_THEMES).map(k => `<option value="${k}" ${k===currentTheme ? "selected":""}>${TILE_THEMES[k].name}</option>`).join("")}
      </select>
      <label for="crt-intensity" style="display:block;margin-top:10px;font-weight:600;">📺 CRT Intensity</label>
      <input id="crt-intensity" type="range" min="0" max="1" step="0.05" style="width:100%;" />
    </div>
  `;
  document.body.appendChild(panel);

  // style ensure on top (in case CSS missing)
  panel.style.position = "absolute";
  panel.style.bottom = "18px";
  panel.style.right = "18px";
  panel.style.zIndex = "99999";
  panel.style.pointerEvents = "auto";

  const toggle = document.getElementById("gm-panel-toggle");
  const dialog = document.getElementById("gm-panel");
  const selector = document.getElementById("gm-theme-selector");
  const slider = document.getElementById("crt-intensity");

  // init slider value from storage
  const stored = parseFloat(localStorage.getItem("gm_crt") || "0.45");
  document.documentElement.style.setProperty("--crt-opacity", stored);
  slider.value = stored;

  // careful: use pointerdown so Leaflet drag doesn't prevent it; stop propagation so map won't receive it
  function onTogglePointer(e) {
    e.stopPropagation();
    e.preventDefault();
    const isHidden = dialog.classList.toggle("gm-hidden");
    const expanded = !isHidden;
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    dialog.setAttribute("aria-hidden", isHidden ? "true" : "false");
  }

  // attach multiple event types for reliability
  ["pointerdown", "mousedown", "click", "touchstart"].forEach(ev => {
    toggle.addEventListener(ev, onTogglePointer, { passive: false });
  });

  // keyboard accessibility
  toggle.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault(); onTogglePointer(ev);
    }
  });

  // theme selector change
  selector.addEventListener("change", (ev) => {
    changeTheme(ev.target.value);
  });

  // slider change -> update css var and persist
  slider.addEventListener("input", (ev) => {
    const v = ev.target.value;
    document.documentElement.style.setProperty("--crt-opacity", v);
    localStorage.setItem("gm_crt", String(v));
  });

  // ensure clicks inside panel don't close it by bubbling to map
  dialog.addEventListener("pointerdown", (e) => { e.stopPropagation(); }, { passive: true });
  dialog.addEventListener("mousedown", (e) => { e.stopPropagation(); }, { passive: true });

  // close on outside click: clicking anywhere else closes panel
  document.addEventListener("pointerdown", (e) => {
    const tgt = e.target;
    if (!dialog.contains(tgt) && !toggle.contains(tgt)) {
      if (!dialog.classList.contains("gm-hidden")) {
        dialog.classList.add("gm-hidden");
        toggle.setAttribute("aria-expanded", "false");
        dialog.setAttribute("aria-hidden", "true");
      }
    }
  });

  // if theme was stored, apply it now
  changeTheme(currentTheme);
}

// ---------- small utils ----------
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" })[m]);
}
function escapeAttribute(s) { return String(s || "").replace(/"/g, "%22"); }

// ---------- start when DOM ready ----------
document.addEventListener("DOMContentLoaded", () => {
  initMap();
});
