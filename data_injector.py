#!/usr/bin/env python3
"""
data_injector.py

Fetches filtered news from NewsAPI, classifies relevance/topic/importance with Mistral 7B via OpenRouter,
resolves locations (dictionary -> dateline -> keyword -> regex -> AI),
geocodes using Nominatim (with optional Geoapify fallback), and pushes events to Firebase.
Now also fetches and uploads live hurricane data from GDACS.
"""

import os
import time
import json
import re
import requests
from datetime import datetime, timedelta

try:
    from geopy.geocoders import Nominatim, Geoapify
    GEOAPIFY_AVAILABLE = True
except ImportError:
    from geopy.geocoders import Nominatim
    Geoapify = None
    GEOAPIFY_AVAILABLE = False

from geopy.exc import GeocoderTimedOut, GeocoderServiceError

def log(msg: str):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")

# --- Config ---
FIREBASE_URL = os.environ.get("FIREBASE_URL", "https://geomonitor-2025-default-rtdb.europe-west1.firebasedatabase.app/").rstrip("/")
NEWS_API_KEY = os.environ.get("NEWS_API_KEY")
GEOAPIFY_KEY = os.environ.get("GEOAPIFY_KEY")
OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY")

AI_IS_ON = True
AI_CLASSIFY_ON = True
AI_LOCATION_FALLBACK_ON = True

BASE_DIR = os.path.dirname(__file__)
GEOCACHE_PATH = os.path.join(BASE_DIR, "geocache.json")
CLASSIFY_CACHE_PATH = os.path.join(BASE_DIR, "classify_cache.json")

try:
    with open(GEOCACHE_PATH, "r", encoding="utf-8") as f:
        GEOCACHE = json.load(f)
except Exception:
    GEOCACHE = {}

try:
    with open(CLASSIFY_CACHE_PATH, "r", encoding="utf-8") as f:
        CLASSIFY_CACHE = json.load(f)
except Exception:
    CLASSIFY_CACHE = {}

log("Booting Geomonitor Data Injector...")
log(f"Firebase URL: {FIREBASE_URL}")
log(f"NewsAPI key: {'✅ Present' if NEWS_API_KEY else '❌ Missing'}")
log(f"Geoapify key: {'✅ Present' if GEOAPIFY_KEY else '⚠️ Missing'}")
log(f"OpenRouter key: {'✅ Present' if OPENROUTER_KEY else '⚠️ Missing'}")

# --- Load dictionary ---
DICTIONARY_PATH = os.path.join(BASE_DIR, "dictionary.json")
try:
    with open(DICTIONARY_PATH, "r", encoding="utf-8") as f:
        CUSTOM_LOCATIONS = json.load(f)
    log(f"📘 Loaded {len(CUSTOM_LOCATIONS)} dictionary entries.")
except Exception:
    CUSTOM_LOCATIONS = {}

# --- Geocoders ---
try:
    geolocator_nom = Nominatim(user_agent="geomonitor_news_app")
    geolocator_geo = Geoapify(api_key=GEOAPIFY_KEY) if GEOAPIFY_AVAILABLE and GEOAPIFY_KEY else None
    if geolocator_geo:
        log("✅ Geocoders ready (Nominatim + Geoapify fallback).")
    else:
        log("✅ Using Nominatim only.")
except Exception as e:
    raise SystemExit(f"❌ Geocoder init failed: {e}")

# --- Helper ---
def persist_caches():
    try:
        with open(GEOCACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(GEOCACHE, f, ensure_ascii=False, indent=2)
        with open(CLASSIFY_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(CLASSIFY_CACHE, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

# --- AI classification (unchanged) ---
# (Keep your existing Mistral-based classification logic here)

# --- Geocoding helper ---
def geocode_location(name):
    if not name:
        return None, None
    key = name.lower().strip()
    if key in GEOCACHE:
        g = GEOCACHE[key]
        return g["lat"], g["lon"]
    time.sleep(1)
    try:
        loc = geolocator_nom.geocode(name, timeout=10)
        if loc:
            lat, lon = float(loc.latitude), float(loc.longitude)
            GEOCACHE[key] = {"lat": lat, "lon": lon}
            persist_caches()
            return lat, lon
    except Exception:
        pass
    if geolocator_geo:
        try:
            loc = geolocator_geo.geocode(name, timeout=10)
            if loc:
                lat, lon = float(loc.latitude), float(loc.longitude)
                GEOCACHE[key] = {"lat": lat, "lon": lon}
                persist_caches()
                return lat, lon
        except Exception:
            pass
    return None, None

# --- Fetch hurricanes (NEW) ---
def fetch_hurricanes():
    url = "https://www.gdacs.org/gdacsapi/api/eventsgeojson?eventtype=TC"
    log("🌪️ Fetching hurricane data from GDACS...")
    try:
        r = requests.get(url, timeout=20)
        r.raise_for_status()
        data = r.json()
        hurricanes = {}

        for feature in data.get("features", []):
            props = feature.get("properties", {})
            coords = feature.get("geometry", {}).get("coordinates", [None, None])
            lon, lat = coords if len(coords) == 2 else (None, None)
            if not lat or not lon:
                continue

            key = f"hurricane_{props.get('eventid')}"
            hurricanes[key] = {
                "name": props.get("eventname", "Unnamed Cyclone"),
                "country": props.get("country", "Unknown"),
                "alertlevel": props.get("alertlevel", "green"),
                "eventid": props.get("eventid", ""),
                "fromdate": props.get("fromdate", ""),
                "lat": lat,
                "lon": lon,
                "url": f"https://www.gdacs.org/report.aspx?eventid={props.get('eventid')}&eventtype=TC",
            }

        log(f"✅ Fetched {len(hurricanes)} hurricanes.")
        return hurricanes

    except Exception as e:
        log(f"❌ Hurricane fetch failed: {e}")
        return {}

# --- Firebase push ---
def push_to_firebase(node, data):
    fb_url = f"{FIREBASE_URL}/{node}.json"
    try:
        r = requests.put(fb_url, data=json.dumps(data), timeout=20)
        r.raise_for_status()
        log(f"✅ Pushed {len(data)} items to /{node}")
    except Exception as e:
        log(f"❌ Firebase push failed for {node}: {e}")

# --- Main ---
if __name__ == "__main__":
    log("=== Starting Data Injection Job ===")

    # Your normal news fetch
    from data_injector_news import fetch_and_process  # (optional modular separation)
    news_events = fetch_and_process()
    if news_events:
        push_to_firebase("events", news_events)
    else:
        log("⚠️ No new news events.")

    # New hurricane fetch
    hurricanes = fetch_hurricanes()
    if hurricanes:
        push_to_firebase("hurricanes", hurricanes)
    else:
        log("⚠️ No hurricanes fetched.")

    log("=== Job Complete ===")
