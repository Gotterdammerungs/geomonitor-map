async function setupHurricaneListener() {
  const dbRef = firebase.database().ref('/hurricanes');
  dbRef.on('value', (snapshot) => {
    hurricaneLayer.clearLayers();
    const hurricanes = snapshot.val();
    if (!hurricanes) return;

    Object.values(hurricanes).forEach(h => {
      const color =
        h.alertlevel === "red" ? "#ff5555" :
        h.alertlevel === "orange" ? "#ffae42" :
        h.alertlevel === "yellow" ? "#ffd93d" : "#7dd36b";

      const icon = L.icon({
        iconUrl: "assets/icons/noun-cyclone-5286192.svg",
        iconSize: [36, 36],
      });

      const popup = `
        <div>
          <b>${h.name}</b><br>
          <small>${h.country}</small><br>
          <b style="color:${color}">${h.alertlevel.toUpperCase()}</b><br>
          <a href="${h.url}" target="_blank">View on GDACS →</a>
        </div>
      `;

      L.marker([h.lat, h.lon], { icon }).bindPopup(popup).addTo(hurricaneLayer);
    });

    console.log(`🌪️ Loaded ${Object.keys(hurricanes).length} hurricanes from Firebase.`);
  });
}
