// ============================
// 🌍 GEOMONITOR MAP FRONTEND
// ============================

// Global variables
let activeMarkers = {};
let map;

// 1. Initialize the Map
function initMap() {
    map = L.map('map').setView([20, 0], 2);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 12,
    }).addTo(map);

    console.log("🗺️ Map initialized.");
    setupRealtimeListener();
}

// 2. Define colors by topic
function getTopicColor(topic) {
    topic = (topic || "").toLowerCase();
    switch (topic) {
        case "geopolitics":
        case "conflict":
        case "diplomacy":
        case "security":
            return "red";
        case "economy":
        case "finance":
            return "limegreen";
        case "technology":
        case "cyber":
        case "science":
            return "deepskyblue";
        case "environment":
        case "disaster":
        case "energy":
            return "orange";
        default:
            return "white"; // fallback for unknown topics
    }
}

// 3. Visibility by importance (zoom threshold)
// The AI’s "importance" field acts as PRIORITY (1–5)
// Higher importance = visible from farther out
function getMinZoomForImportance(importance) {
    const imp = parseInt(importance) || 3;
    switch (imp) {
        case 5: return 0;  // major global news
        case 4: return 3;  // regional/global
        case 3: return 5;  // medium importance
        case 2: return 7;  // local/regional
        case 1:
        default: return 9; // minor/local events
    }
}

// 4. Realtime listener for Firebase
function setupRealtimeListener() {
    const dbRef = firebase.database().ref('/events');

    const clearMarkers = () => {
        Object.values(activeMarkers).forEach(({ marker }) => map.removeLayer(marker));
        activeMarkers = {};
    };

    dbRef.on('value', (snapshot) => {
        clearMarkers();
        const events = snapshot.val();
        if (!events) {
            console.log("⚠️ No events found in database.");
            return;
        }

        const count = Object.keys(events).length;
        console.log(`📡 Received ${count} event${count !== 1 ? "s" : ""}.`);

        Object.entries(events).forEach(([key, event]) => {
            if (!event.lat || !event.lon) return;

            const {
                lat, lon, title, description,
                type, importance, topic, url
            } = event;

            const color = getTopicColor(topic);
            const minZoom = getMinZoomForImportance(importance);

            // Create marker
            const marker = L.circleMarker([lat, lon], {
                radius: 7,
                color,
                fillColor: color,
                fillOpacity: 0.85,
                weight: 1.5
            });

            // Build popup content
            const popupHTML = `
                <div style="font-family:sans-serif;color:#fff;max-width:260px;line-height:1.3;">
                    <div class="news-title" style="font-weight:600;font-size:15px;color:#f9fafb;margin-bottom:5px;">
                        ${title || "Untitled"}
                    </div>
                    <div class="news-source" style="font-size:12px;color:#9ca3af;margin-bottom:4px;">
                        ${type || "Unknown Source"}
                    </div>
                    <div class="news-topic" style="font-size:13px;color:#d1d5db;margin-bottom:4px;">
                        Topic: ${topic || "N/A"} | Priority: ${importance || "?"}
                    </div>
                    <div class="news-desc" style="font-size:13px;color:#cbd5e1;margin-bottom:6px;">
                        ${description || ""}
                    </div>
                    ${url ? `<a href="${url}" target="_blank" style="color:#60a5fa;text-decoration:none;font-weight:600;">Read full article →</a>` : ""}
                </div>
            `;

            marker.bindPopup(popupHTML);
            activeMarkers[key] = { marker, minZoom };
            marker.addTo(map);
        });

        // Update marker visibility based on zoom level
        updateMarkerVisibility();
        map.on("zoomend", updateMarkerVisibility);
    });
}

// 5. Show/hide markers according to zoom level and importance
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

// 6. Start
initMap();
