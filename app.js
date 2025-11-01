// =============================
// 🌍 Geomonitor Interactive Map
// =============================

// Global variables
let activeMarkers = {};
let map;
let currentTheme = "dark";
let tileLayer;

// =============================
// 1. Theme Tile Sources
// =============================
const TILE_THEMES = {
    dark: {
        name: "Dark",
        url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
    light: {
        name: "Light",
        url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
    solarized: {
        name: "Solarized",
        url: "https://api.maptiler.com/maps/solarized-dark/{z}/{x}/{y}.png?key=GetYourOwnKey",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors & MapTiler',
    },
};

// =============================
// 2. Initialize the Map
// =============================
function initMap() {
    map = L.map("map").setView([20, 0], 2);

    tileLayer = L.tileLayer(TILE_THEMES[currentTheme].url, {
        attribution: TILE_THEMES[currentTheme].attribution,
        maxZoom: 12,
    }).addTo(map);

    console.log("🗺️ Map initialized with theme:", currentTheme);

    setupRealtimeListener();
    setupControlPanel();
}

// =============================
// 3. Color System (theme-aware)
// =============================
function getTopicColor(topic) {
    topic = (topic || "").toLowerCase();

    const isLight = currentTheme === "light";
    const whiteDot = isLight ? "black" : "white";

    switch (topic) {
        case "geopolitics":
        case "conflict":
        case "diplomacy":
        case "security":
            return "red";
        case "economy":
        case "finance":
            return "green";
        case "technology":
        case "cyber":
        case "science":
            return "deepskyblue";
        case "environment":
        case "disaster":
        case "energy":
            return "orange";
        default:
            return whiteDot; // fallback color depends on theme
    }
}

// =============================
// 4. Visibility by Importance
// =============================
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

// =============================
// 5. Realtime Firebase Listener
// =============================
function setupRealtimeListener() {
    const dbRef = firebase.database().ref("/events");

    const clearMarkers = () => {
        Object.values(activeMarkers).forEach(({ marker }) => map.removeLayer(marker));
        activeMarkers = {};
    };

    dbRef.on("value", (snapshot) => {
        clearMarkers();
        const events = snapshot.val();
        if (!events) {
            console.log("⚠️ No events found in database.");
            return;
        }

        console.log(`📡 Received ${Object.keys(events).length} events.`);

        Object.entries(events).forEach(([key, event]) => {
            if (!event.lat || !event.lon) return;

            const { lat, lon, title, description, type, importance, topic, url } = event;

            const color = getTopicColor(topic);
            const minZoom = getMinZoomForImportance(importance);

            const marker = L.circleMarker([lat, lon], {
                radius: 7,
                color,
                fillColor: color,
                fillOpacity: 0.85,
                weight: 1.5,
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

        updateMarkerVisibility();
        map.on("zoomend", updateMarkerVisibility);
    });
}

// =============================
// 6. Marker Visibility Control
// =============================
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

// =============================
// 7. Control Panel + Theme Selector
// =============================
function setupControlPanel() {
    const controlPanel = document.createElement("div");
    controlPanel.id = "control-panel";

    controlPanel.innerHTML = `
        <button id="panel-toggle">☰ Themes</button>
        <div id="panel" class="hidden">
            <h4>🗺️ Map Themes</h4>
            <select id="theme-selector">
                ${Object.keys(TILE_THEMES).map(
                    (key) => `<option value="${key}" ${key === currentTheme ? "selected" : ""}>${TILE_THEMES[key].name}</option>`
                ).join("")}
            </select>

            <label for="crt-intensity">CRT Intensity</label>
            <input type="range" id="crt-intensity" min="0" max="1" step="0.05" value="0.4">
        </div>
    `;
    document.body.appendChild(controlPanel);

    // Toggle panel visibility
    const toggleButton = document.getElementById("panel-toggle");
    const panel = document.getElementById("panel");
    toggleButton.addEventListener("click", () => {
        panel.classList.toggle("hidden");
    });

    // Handle theme change
    const selector = document.getElementById("theme-selector");
    selector.addEventListener("change", (e) => {
        const selectedTheme = e.target.value;
        changeTheme(selectedTheme);
    });

    // Handle CRT intensity change
    const crtSlider = document.getElementById("crt-intensity");
    crtSlider.addEventListener("input", (e) => {
        document.documentElement.style.setProperty("--crt-opacity", e.target.value);
    });
}

// =============================
// 8. Change Map Theme
// =============================
function changeTheme(theme) {
    if (!TILE_THEMES[theme]) return;
    currentTheme = theme;

    // Replace tile layer
    map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(TILE_THEMES[theme].url, {
        attribution: TILE_THEMES[theme].attribution,
        maxZoom: 12,
    }).addTo(map);

    console.log(`🎨 Theme switched to: ${theme}`);

    // Redraw all markers with new colors
    updateAllMarkerColors();
}

// =============================
// 9. Refresh Marker Colors on Theme Change
// =============================
function updateAllMarkerColors() {
    Object.values(activeMarkers).forEach(({ marker }) => {
        const topic = marker.options.topic || "other";
        const newColor = getTopicColor(topic);
        marker.setStyle({
            color: newColor,
            fillColor: newColor,
        });
    });
}

// =============================
// 10. Start Everything
// =============================
initMap();
