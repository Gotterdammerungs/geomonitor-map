#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Geomonitor Hurricane Data Injector
----------------------------------
Fetches tropical cyclone data from GDACS (Global Disaster Alert and Coordination System)
and pushes it to Firebase in GeoJSON-like format.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timezone

print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] === Starting Hurricane Injection Job ===")

# ============================================================
#  Configuration and environment setup
# ============================================================

FIREBASE_URL = os.getenv("FIREBASE_URL")
GDACS_URL = "https://www.gdacs.org/gdacsapi/api/events/getEvents?eventtype=TC"

if not FIREBASE_URL:
    print("❌ ERROR: FIREBASE_URL not set.")
    sys.exit(1)

# ============================================================
#  Helper functions
# ============================================================

def fetch_hurricanes():
    """Fetch hurricane (tropical cyclone) data from GDACS API."""
    try:
        r = requests.get(GDACS_URL, timeout=15)
        r.raise_for_status()
        data = r.json()
        return data.get("features", []) or data.get("events", [])
    except requests.exceptions.HTTPError as e:
        print(f"⚠️ GDACS fetch failed: {e}")
    except Exception as e:
        print(f"⚠️ Error fetching GDACS data: {e}")
    return []


def push_to_firebase(event):
    """Push a single hurricane event to Firebase."""
    if not FIREBASE_URL:
        print("❌ Firebase URL missing — skipping upload.")
        return

    try:
        url = f"{FIREBASE_URL.rstrip('/')}/hurricanes.json"
        r = requests.post(url, json=event, timeout=10)
        r.raise_for_status()
        print(f"✅ Uploaded hurricane: {event.get('name', 'unnamed')}")
    except Exception as e:
        print(f"❌ Firebase upload failed: {e}")


# ============================================================
#  Main logic
# ============================================================

def main():
    hurricanes = fetch_hurricanes()
    if not hurricanes:
        print("[INFO] No hurricanes found or API returned empty data.")
        print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] === Job Complete ===")
        return

    print(f"[INFO] Found {len(hurricanes)} hurricane events.")
    for h in hurricanes:
        # Handle both GeoJSON and legacy GDACS formats
        props = h.get("properties", h)
        geometry = h.get("geometry", {})

        name = props.get("eventname", "Unknown Storm")
        event_id = props.get("eventid") or props.get("identifier", "none")
        from_date = props.get("fromdate") or props.get("date", "")
        alert_level = props.get("alertlevel", "green").lower()
        country = props.get("country", "Unknown")
        magnitude = props.get("severity", props.get("magnitude", ""))

        coords = None
        if geometry and "coordinates" in geometry:
            coords = geometry["coordinates"]
            if isinstance(coords, list) and len(coords) >= 2:
                coords = {"lon": coords[0], "lat": coords[1]}
            else:
                coords = None

        entry = {
            "id": event_id,
            "name": name,
            "country": country,
            "alert_level": alert_level,
            "magnitude": magnitude,
            "from_date": from_date,
            "coords": coords,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        }

        push_to_firebase(entry)
        time.sleep(0.3)  # small delay to avoid rate limits

    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] === Job Complete ===")


# ============================================================
#  Entrypoint
# ============================================================

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n🛑 Interrupted by user.")
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        sys.exit(1)
