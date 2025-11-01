let activeMarkers = {};
let map, darkTiles, lightTiles;

function initMap() {
  map = L.map('map').setView([20, 0], 2);

  darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap & CARTO',
    subdomains: 'abcd', maxZoom: 12,
  });
  lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap & CARTO',
    subdomains: 'abcd', maxZoom: 12,
  });

  const theme = localStorage.getItem("theme") || "dark";
  if (theme === "light") lightTiles.addTo(map); else darkTiles.addTo(map);
  document.body.classList.toggle("light", theme === "light");
  document.body.classList.toggle("dark", theme === "dark");

  setupRealtimeListener();
  setupPanelControls(theme);
}

function getTopicColor(t) {
  t = (t || "").toLowerCase();
  if (["geopolitics","conflict","diplomacy","security"].includes(t)) return "red";
  if (["economy","finance"].includes(t)) return "limegreen";
  if (["technology","cyber","science"].includes(t)) return "deepskyblue";
  if (["environment","disaster","energy"].includes(t)) return "orange";
  return "white";
}
function getMinZoomForImportance(i) {
  const z = parseInt(i)||3; return {5:0,4:3,3:5,2:7,1:9}[z]||9;
}

function setupRealtimeListener() {
  const dbRef = firebase.database().ref('/events');
  const clearMarkers = ()=>{Object.values(activeMarkers).forEach(({marker})=>map.removeLayer(marker));activeMarkers={};};
  dbRef.on('value', s=>{
    clearMarkers();
    const events = s.val(); if(!events) return;
    Object.entries(events).forEach(([k,e])=>{
      if(!e.lat||!e.lon) return;
      const m = L.circleMarker([e.lat,e.lon],{
        radius:7,color:getTopicColor(e.topic),
        fillColor:getTopicColor(e.topic),fillOpacity:0.85,weight:1.5
      }).bindPopup(`
        <div>
          <strong>${e.title||"Untitled"}</strong><br>
          <em>${e.type||"Unknown"}</em><br>
          Topic: ${e.topic||"N/A"} | Importance: ${e.importance||"?"}<br>
          ${e.url?`<a href="${e.url}" target="_blank">Read →</a>`:""}
        </div>`);
      activeMarkers[k]={marker:m,minZoom:getMinZoomForImportance(e.importance)};
      m.addTo(map);
    });
    map.on("zoomend", updateMarkerVisibility);
    updateMarkerVisibility();
  });
}
function updateMarkerVisibility(){
  const z = map.getZoom();
  Object.values(activeMarkers).forEach(({marker,minZoom})=>{
    if(z>=minZoom){if(!map.hasLayer(marker))map.addLayer(marker);}
    else if(map.hasLayer(marker))map.removeLayer(marker);
  });
}

function setupPanelControls(theme){
  const panel = document.getElementById("panel");
  document.getElementById("panel-toggle").onclick=()=>panel.classList.toggle("hidden");
  const themeBtn=document.getElementById("theme-toggle");
  const crtSlider=document.getElementById("crt-intensity");

  // CRT
  const saved=parseFloat(localStorage.getItem("crt_intensity")||"0.5");
  crtSlider.value=saved;
  document.documentElement.style.setProperty("--crt-opacity",saved);
  crtSlider.oninput=e=>{
    const val=parseFloat(e.target.value);
    document.documentElement.style.setProperty("--crt-opacity",val);
    localStorage.setItem("crt_intensity",val);
  };

  // Theme
  const setTheme=(mode)=>{
    localStorage.setItem("theme",mode);
    document.body.classList.toggle("dark",mode==="dark");
    document.body.classList.toggle("light",mode==="light");
    if(mode==="dark"){map.removeLayer(lightTiles);darkTiles.addTo(map);}
    else{map.removeLayer(darkTiles);lightTiles.addTo(map);}
    themeBtn.textContent=mode==="dark"?"🌙 Dark Mode":"☀️ Light Mode";
  };
  themeBtn.onclick=()=>setTheme(document.body.classList.contains("dark")?"light":"dark");
  setTheme(theme);
}

initMap();
