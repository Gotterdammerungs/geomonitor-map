#!/usr/bin/env python3
"""
data_injector_hurricanes.py

Fetches active tropical cyclone data from GDACS (global, free),
extracts coordinates and metadata, and pushes to Firebase under /hurricanes.
"""

import os
import time
import json
import requests
from datetime import datetime, timedelta

# ---------------------------
# Config
# ---------------------------
FIREBASE_URL = os.environ.get(
    "FIREBASE_URL",
    "https://geomonitor-2025-default-rtdb.europe-west1.firebasedatabase.app/"
).rstrip("/")

GDACS_URL = "https://www.gdacs.org/gdacsapi/api/eventsgeojson?eventtype=TC"

def log(msg: str):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")

log("=== Starting Hurricane Injection Job ===")

# ---------------------------
# Fetch hurricanes from GDACS
# ---------------------------
def fetch_hurricanes():
    try:
        r = requests.get(GDACS_URL, timeout=30)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        log(f"⚠️ GDACS fetch failed: {e}")
        return {}

    features = data.get("features", [])
    if not features:
        log("[INFO] No hurricanes found or API returned empty data.")
        return {}

    hurricanes = {}
    for i, f in enumerate(features):
        props = f.get("properties", {})
        geom = f.get("geometry", {})
        coords = geom.get("coordinates")

        if not coords or len(coords) < 2:
            continue

        lon, lat = coords[0], coords[1]
        name = props.get("eventname") or props.get("eventid") or "Unnamed Storm"
        severity = props.get("alertlevel", "green")
        desc = props.get("fromdate") + " → " + props.get("todate") if props.get("fromdate") else "Active tropical cyclone"

        key = f"hurricane_{int(time.time())}_{i}"
        hurricanes[key] = {
            "title": f"🌀 {name}",
            "description": f"{desc}",
            "type": "Hurricane",
            "url": f"https://www.gdacs.org/report.aspx?eventtype=TC&eventid={props.get('eventid', '')}",
            "lat": lat,
            "lon": lon,
            "timestamp": datetime.utcnow().isoformat(),
            "topic": "disaster",
            "importance": 5 if severity.lower() in ["red", "orange"] else 4,
        }

    log(f"✅ Parsed {len(hurricanes)} hurricanes from GDACS.")
    return hurricanes


# ---------------------------
# Push to Firebase
# ---------------------------
def push_hurricanes(hurricanes):
    fb_url = f"{FIREBASE_URL}/hurricanes.json"
    cutoff = datetime.utcnow() - timedelta(days=7)

    try:
        old = requests.get(fb_url, timeout=10).json() or {}
        log(f"Fetched {len(old)} old hurricanes.")
    except Exception:
        old = {}

    kept = {}
    for k, v in old.items():
        ts = v.get("timestamp")
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(ts.replace("Z", ""))
            if dt > cutoff:
                kept[k] = v
        except Exception:
            pass

    merged = {**kept, **hurricanes}
    try:
        r = requests.put(fb_url, data=json.dumps(merged), timeout=15)
        r.raise_for_status()
        log(f"✅ PUSH COMPLETE: {len(merged)} total hurricanes.")
    except Exception as e:
        log(f"❌ PUSH FAILED: {e}")


# ---------------------------
# Main
# ---------------------------
if __name__ == "__main__":
    hurricanes = fetch_hurricanes()
    if hurricanes:
        push_hurricanes(hurricanes)
    else:
        log("[INFO] No new hurricane data to push.")
    log("=== Job Complete ===")
