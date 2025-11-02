// === Firebase Config ===
const firebaseConfig = {
    databaseURL: "https://geomonitor-2025-default-rtdb.europe-west1.firebasedatabase.app"
};
firebase.initializeApp(firebaseConfig);

let map;
let activeMarkers = {};
let hurricaneMarkers = {};
let hurricanesVisible = true;

const HURRICANE_ICON_URL = "assets/hurricane.svg";

const hurricaneIcon = L.icon({
    iconUrl: HURRICANE_ICON_URL,
    iconSize: [50, 50],
    iconAnchor: [25, 25],
    popupAnchor: [0, -20],
});

// === Initialize the Map ===
function initMap() {
    map = L.map("map").setView([20, 0], 2);

    // Default dark mode map
    const darkTiles = L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
            attribution: '&copy; OpenStreetMap & CARTO',
            subdomains: "abcd",
            maxZoom: 12,
        }
    );

    const lightTiles = L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
            attribution: '&copy; OpenStreetMap & CARTO',
            subdomains: "abcd",
            maxZoom: 12,
        }
    );

    // Keep references to toggle
    map._darkTiles = darkTiles;
    map._lightTiles = lightTiles;
    darkTiles.addTo(map);

    setupRealtimeListener();
    setupHurricaneListener();
    setupUI();
}

// === Get color by topic ===
function getTopicColor(topic) {
    topic = (topic || "").toLowerCase();
    switch (topic) {
        case "geopolitics":
        case "conflict":
            return "red";
        case "finance":
            return "limegreen";
        case "tech":
        case "science":
            return "deepskyblue";
        case "disaster":
            return "orange";
        default:
            return "white";
    }
}

// === Min zoom by importance ===
function getMinZoomForImportance(importance) {
    switch (parseInt(importance)) {
        case 5: return 0;
        case 4: return 3;
        case 3: return 5;
        case 2: return 7;
        case 1:
        default: return 9;
    }
}

// === Setup news listener ===
function setupRealtimeListener() {
    const dbRef = firebase.database().ref("/events");

    const clearMarkers = () => {
        Object.values(activeMarkers).forEach(({ marker }) => map.removeLayer(marker));
        activeMarkers = {};
    };

    dbRef.on("value", (snapshot) => {
        clearMarkers();
        const events = snapshot.val();
        if (!events) return;
        Object.entries(events).forEach(([key, ev]) => {
            if (!ev.lat || !ev.lon) return;

            const color = getTopicColor(ev.topic);
            const minZoom = getMinZoomForImportance(ev.importance);

            const marker = L.circleMarker([ev.lat, ev.lon], {
                radius: 7,
                color,
                fillColor: color,
                fillOpacity: 0.85,
                weight: 1.5
            }).bindPopup(`
                <div style="max-width:250px;font-family:sans-serif;">
                    <strong>${ev.title || "Untitled"}</strong><br>
                    ${ev.description || ""}<br>
                    <b>Topic:</b> ${ev.topic || "?"}<br>
                    <b>Importance:</b> ${ev.importance || "?"}<br>
                    ${ev.url ? `<a href="${ev.url}" target="_blank">Read more →</a>` : ""}
                </div>
            `);

            activeMarkers[key] = { marker, minZoom };
            marker.addTo(map);
        });
        updateMarkerVisibility();
        map.on("zoomend", updateMarkerVisibility);
    });
}

// === Update visibility ===
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

// === Hurricanes ===
function setupHurricaneListener() {
    const hurricaneRef = firebase.database().ref("/hurricanes");

    hurricaneRef.on("value", (snapshot) => {
        Object.values(hurricaneMarkers).forEach(m => map.removeLayer(m));
        hurricaneMarkers = {};
        const data = snapshot.val();
        if (!data) return;

        Object.entries(data).forEach(([key, storm]) => {
            if (!storm.lat || !storm.lon) return;
            const marker = L.marker([storm.lat, storm.lon], { icon: hurricaneIcon })
                .bindPopup(`
                    <div style="font-family:sans-serif;max-width:250px;color:#fff;">
                        <strong>${storm.name || "Unnamed Storm"}</strong><br>
                        <b>Wind:</b> ${storm.wind_speed || "?"} km/h<br>
                        <b>Updated:</b> ${storm.updated || ""}<br>
                        ${storm.url ? `<a href="${storm.url}" target="_blank">Details →</a>` : ""}
                    </div>
                `);
            hurricaneMarkers[key] = marker;
            if (hurricanesVisible) marker.addTo(map);
        });
    });
}

// === UI controls ===
function setupUI() {
    const toggleHurricanes = document.getElementById("toggleHurricanes");
    const darkModeToggle = document.getElementById("darkModeToggle");
    const crtSlider = document.getElementById("crtSlider");

    // Hurricane toggle
    toggleHurricanes.addEventListener("change", (e) => {
        hurricanesVisible = e.target.checked;
        Object.values(hurricaneMarkers).forEach(marker => {
            if (hurricanesVisible) marker.addTo(map);
            else map.removeLayer(marker);
        });
    });

    // Dark/light mode toggle
    darkModeToggle.addEventListener("click", () => {
        const body = document.body;
        body.classList.toggle("dark");
        body.classList.toggle("light");

        if (body.classList.contains("light")) {
            map.removeLayer(map._darkTiles);
            map._lightTiles.addTo(map);
        } else {
            map.removeLayer(map._lightTiles);
            map._darkTiles.addTo(map);
        }
    });

    // CRT slider
    crtSlider.addEventListener("input", (e) => {
        document.documentElement.style.setProperty("--crt-opacity", e.target.value);
    });
}

// === Start ===
initMap();
