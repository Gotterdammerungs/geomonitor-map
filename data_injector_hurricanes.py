#!/usr/bin/env python3
"""
data_injector_hurricanes.py

Fetches live tropical cyclone (hurricane/typhoon) data from GDACS,
parses it, and uploads the current active storms to Firebase under `/hurricanes`.
"""

import os
import time
import json
import requests
from datetime import datetime, timedelta

# ---------------------------
# Logging helper
# ---------------------------
def log(msg: str):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")


# ---------------------------
# Config
# ---------------------------
FIREBASE_URL = os.environ.get(
    "FIREBASE_URL",
    "https://geomonitor-2025-default-rtdb.europe-west1.firebasedatabase.app/"
).rstrip("/")

BASE_DIR = os.path.dirname(__file__)
CACHE_PATH = os.path.join(BASE_DIR, "hurricane_cache.json")

try:
    with open(CACHE_PATH, "r", encoding="utf-8") as f:
        HURR_CACHE = json.load(f)
except Exception:
    HURR_CACHE = {}

log("Booting Geomonitor Hurricane Injector...")
log(f"Firebase URL: {FIREBASE_URL}")


# ---------------------------
# GDACS Hurricane Fetch (fixed)
# ---------------------------
def fetch_gdacs_hurricanes():
    GDACS_URL = "https://www.gdacs.org/gdacsapi/api/Events/geteventlist/map?eventtype=TC"

    headers = {
        "User-Agent": "data_injector/1.0 (geomonitor)",
        "Accept": "application/json"
    }

    try:
        r = requests.get(GDACS_URL, headers=headers, timeout=30)

        if r.status_code == 404:
            log(f"⚠️ GDACS endpoint not found (404): {GDACS_URL}")
            return {}

        r.raise_for_status()

        data = r.json()

        if data.get("type") != "FeatureCollection":
            log(f"⚠️ Unexpected GDACS response type: {data.get('type')}")
            return {}

        features = data.get("features", [])
        if not features:
            log("[INFO] No active hurricanes found.")
            return {}

        hurricanes = []
        for i, feat in enumerate(features):
            props = feat.get("properties", {})
            geom = feat.get("geometry", {})
            coords = geom.get("coordinates", [None, None])

            # Handle possible nested coordinate array
            if coords and isinstance(coords[0], list):
                coords = coords[0]

            lon, lat = (coords[0], coords[1]) if coords else (None, None)

            hurricanes.append({
                "id": props.get("eventid") or f"hurricane_{int(time.time())}_{i}",
                "name": props.get("name") or props.get("eventname"),
                "alert": props.get("alertlevel"),
                "severity": str(props.get("severity")).lower(),
                "fromdate": props.get("fromdate"),
                "todate": props.get("todate"),
                "lon": lon,
                "lat": lat,
            })

        log(f"[INFO] Retrieved {len(hurricanes)} active hurricanes from GDACS.")
        return hurricanes

    except requests.RequestException as e:
        log(f"⚠️ GDACS fetch failed: {e}")
        return {}


# ---------------------------
# Push to Firebase
# ---------------------------
def push_hurricanes_to_firebase(hurricanes):
    fb_url = f"{FIREBASE_URL}/hurricanes.json"
    cutoff = datetime.utcnow() - timedelta(days=5)

    try:
        old = requests.get(fb_url, timeout=10).json() or {}
        log(f"Fetched {len(old)} old hurricane entries.")
    except Exception:
        old = {}

    kept = {}
    for k, v in old.items():
        ts = v.get("fromdate") or v.get("timestamp")
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(ts.replace("Z", ""))
            if dt > cutoff:
                kept[k] = v
        except Exception:
            pass

    merged = {**kept}
    for h in hurricanes:
        key = h.get("id") or f"hurricane_{int(time.time())}"
        merged[key] = {
            "name": h.get("name", "Unnamed"),
            "alert": h.get("alert", "unknown"),
            "severity": h.get("severity", "unknown"),
            "lat": h.get("lat"),
            "lon": h.get("lon"),
            "fromdate": h.get("fromdate"),
            "todate": h.get("todate"),
            "timestamp": datetime.utcnow().isoformat(),
        }

    try:
        r = requests.put(fb_url, data=json.dumps(merged), timeout=15)
        r.raise_for_status()
        log(f"✅ PUSH COMPLETE: {len(merged)} hurricanes total.")
    except Exception as e:
        log(f"❌ PUSH FAILED: {e}")


# ---------------------------
# Main
# ---------------------------
if __name__ == "__main__":
    log("=== Starting Hurricane Injection Job ===")
    hurricanes = fetch_gdacs_hurricanes()
    if hurricanes:
        push_hurricanes_to_firebase(hurricanes)
    else:
        log("No new hurricane data to push.")
    log("=== Job Complete ===")
