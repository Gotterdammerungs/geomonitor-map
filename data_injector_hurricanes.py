#!/usr/bin/env python3
"""
data_injector_hurricanes.py
Fetches live hurricane/cyclone data from GDACS and pushes to Firebase under /hurricanes.
"""

import os, json, requests
from datetime import datetime
import xml.etree.ElementTree as ET

def log(msg):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")

FIREBASE_URL = os.environ.get("FIREBASE_URL").rstrip("/")
GDACS_URL = "https://www.gdacs.org/gdacsapi/api/eventsgeojson?eventtype=TC"
HEADERS = {"User-Agent": "GeomonitorBot/1.0"}

def fetch_hurricanes():
    events = {}
    try:
        r = requests.get(GDACS_URL, headers=HEADERS, timeout=20)
        r.raise_for_status()
        data = r.json()
        feats = data.get("features", [])
        for f in feats:
            props = f.get("properties", {})
            coords = f.get("geometry", {}).get("coordinates", [])
            if len(coords) < 2: continue
            lon, lat = coords[:2]
            eid = props.get("eventid", f"gdacs_{hash(json.dumps(props))%10**8}")
            key = f"hurricane_{eid}"
            events[key] = {
                "title": props.get("eventname", "Tropical Cyclone"),
                "description": props.get("description", ""),
                "url": f"https://www.gdacs.org/report.aspx?eventid={props.get('eventid')}&eventtype=TC",
                "lat": lat, "lon": lon,
                "timestamp": props.get("fromdate") or datetime.utcnow().isoformat(),
                "topic": "disaster", "importance": 5, "type": "Hurricane"
            }
        log(f"🌀 Parsed {len(events)} hurricanes.")
    except Exception as e:
        log(f"⚠️ GDACS fetch failed: {e}")
    return events

def push_to_firebase(events):
    fb_url = f"{FIREBASE_URL}/hurricanes.json"
    old = requests.get(fb_url, timeout=10).json() or {}
    merged = {**old, **events}
    r = requests.put(fb_url, json=merged, timeout=15)
    r.raise_for_status()
    log(f"✅ PUSH COMPLETE: {len(merged)} hurricanes in Firebase.")

if __name__ == "__main__":
    log("=== Starting Hurricane Injection Job ===")
    ev = fetch_hurricanes()
    if ev: push_to_firebase(ev)
    else: log("No new hurricanes found.")
    log("=== Job Complete ===")
