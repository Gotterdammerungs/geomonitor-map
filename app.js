// ============================================================
// 🌍 GEOMONITOR FRONTEND CONTROLLER — VERBOSE MODE ENABLED
// ============================================================

console.log("🛰️ Geomonitor starting up...");

// -------------------- Global Variables --------------------
let map;
let activeMarkers = {};
let maptilerKey = null;
let currentTheme = "dark";

// Tile layer references (switchable)
const tileLayers = {
    dark: null,
    light: null,
    satellite: null,
    solarized: null
};

// ============================================================
// 1️⃣ Load Configuration (config.json)
// ============================================================
async function loadConfig() {
    console.log("⚙️ Attempting to load config.json...");
    try {
        const res = await fetch("config.json", { cache: "no-cache" });
        if (!res.ok) {
            console.error(`❌ config.json fetch failed: HTTP ${res.status}`);
            throw new Error(`Config fetch failed with status ${res.status}`);
        }

        const data = await res.json();
        if (!data.maptiler_key) {
            throw new Error("⚠️ maptiler_key missing in config.json!");
        }

        maptilerKey = data.maptiler_key.trim();
        console.log(`✅ Loaded MapTiler key: ${maptilerKey.slice(0, 8)}********`);
    } catch (err) {
        console.error("🔥 Failed to load config.json:", err);
        alert("⚠️ Could not load map configuration or MapTiler key.\nCheck console for full error log.");
        throw err;
    }
}

// ============================================================
// 2️⃣ Initialize Map
// ============================================================
async function initMap() {
    console.log("🗺️ Initializing map system...");
    await loadConfig();

    // Define all tile layer URLs
    const mapTilerBase = `https://api.maptiler.com/maps`;
    const tileOpts = { tileSize: 512, zoomOffset: -1, crossOrigin: true };

    const urls = {
        dark: `${mapTilerBase}/darkmatter/{z}/{x}/{y}.png?key=${maptilerKey}`,
        light: `${mapTilerBase}/basic/{z}/{x}/{y}.png?key=${maptilerKey}`,
        satellite: `${mapTilerBase}/satellite/{z}/{x}/{y}.jpg?key=${maptilerKey}`,
        solarized: `${mapTilerBase}/toner/{z}/{x}/{y}.png?key=${maptilerKey}`
    };

    Object.entries(urls).forEach(([theme, url]) => {
        tileLayers[theme] = L.tileLayer(url, {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 12,
            ...tileOpts
        });
        console.log(`🌈 Tile layer registered: ${theme} (${url})`);
    });

    // Create base map
    map = L.map('map', {
        center: [20, 0],
        zoom: 2,
        worldCopyJump: true,
        zoomControl: true,
        layers: [tileLayers.dark] // default theme
    });

    console.log("✅ Map initialized successfully.");
    setupRealtimeListener();
}

// ============================================================
// 3️⃣ Firebase Realtime Listener
// ============================================================
function setupRealtimeListener() {
    console.log("📡 Setting up Firebase listener...");

    const dbRef = firebase.database().ref('/events');

    dbRef.on('value', (snapshot) => {
        const events = snapshot.val();
        if (!events) {
            console.warn("⚠️ Firebase returned no events.");
            return;
        }

        console.log(`📦 Received ${Object.keys(events).length} events from Firebase.`);
        renderMarkers(events);
    }, (error) => {
        console.error("🔥 Firebase listener error:", error);
    });
}

// ============================================================
// 4️⃣ Render Markers
// ============================================================
function renderMarkers(events) {
    console.log("🧩 Rendering markers...");
    Object.values(activeMarkers).forEach(({ marker }) => map.removeLayer(marker));
    activeMarkers = {};

    Object.entries(events).forEach(([key, ev]) => {
        const { lat, lon, title, description, topic, importance, type, url } = ev;
        if (!lat || !lon) return;

        const color = getTopicColor(topic);
        const minZoom = getMinZoomForImportance(importance);

        const marker = L.circleMarker([lat, lon], {
            radius: 7,
            color,
            fillColor: color,
            fillOpacity: 0.85,
            weight: 1.5
        });

        const popupHTML = `
            <div style="font-family:sans-serif;color:#fff;max-width:250px;">
                <div class="news-title">${title || "Untitled"}</div>
                <div class="news-source">${type || "Unknown Source"}</div>
                <div class="news-topic">Topic: ${topic || "N/A"} | Importance: ${importance || "?"}</div>
                <div class="news-desc">${description || ""}</div>
                ${url ? `<a href="${url}" target="_blank" class="news-link">Read full article →</a>` : ""}
            </div>
        `;

        marker.bindPopup(popupHTML);
        activeMarkers[key] = { marker, minZoom };
        marker.addTo(map);
    });

    console.log(`✅ Rendered ${Object.keys(activeMarkers).length} markers.`);
    updateMarkerVisibility();
    map.on("zoomend", updateMarkerVisibility);
}

// ============================================================
// 5️⃣ Marker Visibility Control
// ============================================================
function updateMarkerVisibility() {
    const zoom = map.getZoom();
    Object.values(activeMarkers).forEach(({ marker, minZoom }) => {
        if (zoom >= minZoom) {
            if (!map.hasLayer(marker)) map.addLayer(marker);
        } else {
            if (map.hasLayer(marker)) map.removeLayer(marker);
        }
    });
    console.log(`🔍 Updated marker visibility at zoom ${zoom}.`);
}

// ============================================================
// 6️⃣ Topic Colors & Importance
// ============================================================
function getTopicColor(topic) {
    topic = (topic || "").toLowerCase();
    const theme = document.body.getAttribute("data-theme") || "dark";

    const colorsDark = {
        geopolitics: "red",
        conflict: "crimson",
        diplomacy: "darkred",
        security: "firebrick",
        economy: "limegreen",
        finance: "green",
        technology: "deepskyblue",
        cyber: "steelblue",
        science: "dodgerblue",
        environment: "orange",
        disaster: "darkorange",
        energy: "gold",
        other: "white"
    };

    const colorsLight = {
        geopolitics: "#b20000",
        conflict: "#ff5555",
        diplomacy: "#b23a3a",
        security: "#d9534f",
        economy: "#007700",
        finance: "#006400",
        technology: "#0077cc",
        cyber: "#005fa3",
        science: "#0066cc",
        environment: "#ff8c00",
        disaster: "#ff6600",
        energy: "#ffaa00",
        other: "black"
    };

    const palette = theme === "light" ? colorsLight : colorsDark;
    return palette[topic] || (theme === "light" ? "black" : "white");
}

function getMinZoomForImportance(importance) {
    switch (parseInt(importance)) {
        case 5: return 0;  // global
        case 4: return 3;
        case 3: return 5;
        case 2: return 7;
        case 1:
        default: return 9; // local
    }
}

// ============================================================
// 7️⃣ Theme System
// ============================================================
function switchTheme(theme) {
    if (!tileLayers[theme]) {
        console.error(`❌ Unknown theme: ${theme}`);
        return;
    }

    Object.values(tileLayers).forEach(layer => {
        if (map.hasLayer(layer)) map.removeLayer(layer);
    });

    map.addLayer(tileLayers[theme]);
    document.body.setAttribute("data-theme", theme);
    currentTheme = theme;

    console.log(`🌗 Theme switched → ${theme}`);
}

// ============================================================
// 8️⃣ Init everything
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
    console.log("🚀 DOM loaded. Launching Geomonitor...");
    try {
        await initMap();
        console.log("✅ Geomonitor fully initialized!");
    } catch (e) {
        console.error("💥 Fatal error during initialization:", e);
    }

    // Theme selector event
    const themeMenu = document.getElementById("themeMenu");
    if (themeMenu) {
        themeMenu.addEventListener("change", (e) => {
            switchTheme(e.target.value);
        });
        console.log("🎛️ Theme selector initialized.");
    } else {
        console.warn("⚠️ No theme selector found in DOM.");
    }
});
