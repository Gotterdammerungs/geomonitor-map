#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Geomonitor News Injector
---------------------------------
Fetches recent global news, geocodes article locations using Geoapify,
and pushes structured data to Firebase.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timezone
from geopy.geocoders import Geoapify
from geopy.exc import GeocoderServiceError

# ============================================================
#  Configuration and environment setup
# ============================================================

print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] Booting Geomonitor News Injector...")

FIREBASE_URL = os.getenv("FIREBASE_URL")
NEWS_API_KEY = os.getenv("NEWS_API_KEY")
GEOAPIFY_KEY = os.getenv("GEOAPIFY_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

if not FIREBASE_URL:
    print("❌ ERROR: FIREBASE_URL not set.")
    sys.exit(1)

if not NEWS_API_KEY:
    print("⚠️  Warning: NEWS_API_KEY not set — news fetching may fail.")

# Initialize Geoapify geocoder safely
geolocator_geo = None
if GEOAPIFY_KEY:
    try:
        geolocator_geo = Geoapify(api_key=GEOAPIFY_KEY)
    except Exception as e:
        print(f"⚠️ Failed to initialize Geoapify: {e}")
else:
    print("⚠️ GEOAPIFY_KEY not provided — geocoding disabled.")


# ============================================================
#  Helper functions
# ============================================================

def fetch_latest_news():
    """Fetch latest world news from NewsAPI."""
    url = f"https://newsapi.org/v2/top-headlines?language=en&pageSize=20&apiKey={NEWS_API_KEY}"
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        data = r.json()
        return data.get("articles", [])
    except Exception as e:
        print(f"❌ Error fetching news: {e}")
        return []


def geocode_location(location_name: str):
    """Geocode a location using Geoapify."""
    if not geolocator_geo:
        return None
    try:
        loc = geolocator_geo.geocode(location_name, timeout=10)
        if loc:
            return {"lat": loc.latitude, "lon": loc.longitude, "name": loc.address}
    except GeocoderServiceError as e:
        print(f"⚠️ Geocoding error for '{location_name}': {e}")
    except Exception as e:
        print(f"⚠️ Unknown geocoding error for '{location_name}': {e}")
    return None


def push_to_firebase(entry):
    """Push a single entry to Firebase Realtime Database."""
    if not FIREBASE_URL:
        print("❌ Firebase URL missing — skipping upload.")
        return

    try:
        url = f"{FIREBASE_URL.rstrip('/')}/news.json"
        r = requests.post(url, json=entry, timeout=10)
        r.raise_for_status()
        print(f"✅ Uploaded to Firebase: {entry.get('title', 'unknown')}")
    except Exception as e:
        print(f"❌ Firebase upload failed: {e}")


# ============================================================
#  Main logic
# ============================================================

def main():
    articles = fetch_latest_news()
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] Found {len(articles)} news articles.")

    for a in articles:
        title = a.get("title", "").strip()
        source = a.get("source", {}).get("name", "")
        published = a.get("publishedAt", "")
        description = a.get("description", "")
        url = a.get("url", "")

        if not title:
            continue

        # Attempt to geocode using location hints from title/description
        location_guess = None
        for field in [title, description, source]:
            if field and any(x in field.lower() for x in ["in ", "at ", "near "]):
                location_guess = field
                break

        coords = geocode_location(location_guess) if location_guess else None

        entry = {
            "title": title,
            "source": source,
            "publishedAt": published,
            "description": description,
            "url": url,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "coords": coords,
        }

        push_to_firebase(entry)
        time.sleep(0.3)  # small delay to avoid rate limits

    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] ✅ Job complete.")


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
