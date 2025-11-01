let map, darkTiles, lightTiles, hurricaneLayer;
let activeMarkers = {};

// === INIT MAP ===
function initMap() {
  map = L.map('map').setView([20, 0], 2);

  darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors & CARTO',
    subdomains: 'abcd',
    maxZoom: 12
  }).addTo(map);

  lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors & CARTO',
    subdomains: 'abcd',
    maxZoom: 12
  });

  hurricaneLayer = L.layerGroup().addTo(map);

  setupRealtimeListener();
  fetchHurricanes();
  setInterval(fetchHurricanes, 15 * 60 * 1000); // every 15min
}

// === THEME TOGGLE ===
document.getElementById("themeToggle").addEventListener("change", (e) => {
  if (e.target.checked) {
    document.body.classList.remove("light");
    document.body.classList.add("dark");
    map.removeLayer(lightTiles);
    darkTiles.addTo(map);
    localStorage.setItem("theme", "dark");
  } else {
    document.body.classList.remove("dark");
    document.body.classList.add("light");
    map.removeLayer(darkTiles);
    lightTiles.addTo(map);
    localStorage.setItem("theme", "light");
  }
});

// === CRT SLIDER ===
const crtSlider = document.getElementById("crtIntensity");
crtSlider.addEventListener("input", (e) => {
  const value = e.target.value;
  document.documentElement.style.setProperty("--crt-opacity", value);
});

// === HURRICANE TOGGLE ===
document.getElementById("hurricaneToggle").addEventListener("change", (e) => {
  if (e.target.checked) map.addLayer(hurricaneLayer);
  else map.removeLayer(hurricaneLayer);
});

// === HURRICANES (GDACS) ===
async function fetchHurricanes() {
  const url = "https://www.gdacs.org/gdacsapi/api/eventsgeojson?eventtype=TC";
  try {
    const res = await fetch(url);
    const data = await res.json();
    hurricaneLayer.clearLayers();

    for (const f of data.features) {
      const [lon, lat] = f.geometry.coordinates;
      const props = f.properties;
      const alert = props.alertlevel || "green";
      const color =
        alert === "red" ? "#ff5555" :
        alert === "orange" ? "#ffae42" :
        alert === "yellow" ? "#ffd93d" : "#7dd36b";

      const icon = L.icon({
        iconUrl: "assets/icons/noun-cyclone-5286192.svg",
        iconSize: [36, 36],
      });

      const popup = `
        <div>
          <b>${props.eventname}</b><br>
          <small>${props.country || "Unknown region"}</small><br>
          <b style="color:${color}">${alert.toUpperCase()}</b><br>
          <a href="https://www.gdacs.org/report.aspx?eventid=${props.eventid}&eventtype=TC" target="_blank">
            View on GDACS →
          </a>
        </div>
      `;

      L.marker([lat, lon], { icon }).bindPopup(popup).addTo(hurricaneLayer);
    }
  } catch (err) {
    console.error("Failed to fetch hurricanes:", err);
  }
}

// === FIREBASE NEWS ===
function setupRealtimeListener() {
  const dbRef = firebase.database().ref('/events');
  dbRef.on('value', (snapshot) => {
    const events = snapshot.val();
    if (!events) return;

    Object.values(activeMarkers).forEach(m => map.removeLayer(m));
    activeMarkers = {};

    for (const [key, event] of Object.entries(events)) {
      const { lat, lon, title, description, type, importance, topic, url } = event;
      if (!lat || !lon) continue;

      const color = getTopicColor(topic);
      const minZoom = getMinZoom(importance);

      const marker = L.circleMarker([lat, lon], {
        radius: 7,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 1.5
      });

      const popup = `
        <div>
          <b>${title}</b><br>
          ${description}<br>
          <small>${type}</small><br>
          <a href="${url}" target="_blank">Read →</a>
        </div>
      `;

      marker.bindPopup(popup);
      activeMarkers[key] = { marker, minZoom };
      marker.addTo(map);
    }
  });
}

function getTopicColor(t) {
  switch ((t || "").toLowerCase()) {
    case "geopolitics": return "red";
    case "finance": return "green";
    case "tech": return "deepskyblue";
    case "disaster": return "orange";
    case "science": return "violet";
    default: return "white";
  }
}

function getMinZoom(i) {
  return i >= 5 ? 0 : i === 4 ? 3 : i === 3 ? 5 : i === 2 ? 7 : 9;
}

initMap();
