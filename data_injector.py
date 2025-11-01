#!/usr/bin/env python3
"""
Geomonitor Data Injector

Fetches filtered news from NewsAPI, classifies relevance/topic/importance with Mistral 7B (OpenRouter),
resolves locations (dictionary → dateline → keyword → regex → AI),
geocodes with Nominatim (Geoapify optional), and pushes events to Firebase.

- Uses environment variables for API keys.
- AI is toggleable.
- Keeps events for 2 days.
"""

import os
import time
import json
import re
import requests
from datetime import datetime, timedelta

# ---------------------------
# Safe geopy imports
# ---------------------------
try:
    from geopy.geocoders import Nominatim, Geoapify
    GEOAPIFY_AVAILABLE = True
except ImportError:
    from geopy.geocoders import Nominatim
    Geoapify = None
    GEOAPIFY_AVAILABLE = False
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

# ---------------------------
# Logger
# ---------------------------
def log(msg: str):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")

# ---------------------------
# Config
# ---------------------------
FIREBASE_URL = os.environ.get(
    "FIREBASE_URL",
    "https://geomonitor-2025-default-rtdb.europe-west1.firebasedatabase.app/"
).rstrip('/')
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

if not NEWS_API_KEY:
    raise SystemExit("❌ NEWS_API_KEY missing — cannot continue.")

# ---------------------------
# Load custom dictionary
# ---------------------------
DICTIONARY_PATH = os.path.join(BASE_DIR, "dictionary.json")
try:
    with open(DICTIONARY_PATH, "r", encoding="utf-8") as f:
        CUSTOM_LOCATIONS = json.load(f)
    log(f"📘 Loaded {len(CUSTOM_LOCATIONS)} dictionary entries from dictionary.json")
except Exception as e:
    CUSTOM_LOCATIONS = {}
    log(f"⚠️ Could not load dictionary.json: {e}")

# ---------------------------
# Regex patterns
# ---------------------------
PLACE_REGEX = re.compile(r"\b(?:in|at|near|from)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)")
DATELINE_REGEX = re.compile(r"^\s*([A-Z][A-Z]+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s*—|,)")

# ---------------------------
# AI prompts
# ---------------------------
AI_CLASSIFY_PROMPT = (
    "You are a strict but fair geopolitical news classifier.\n"
    "Given a short news title and description, respond with three items:\n"
    "1. show: true or false — should this story be displayed on a global map of real-world events?\n"
    "2. topic: choose exactly one from [geopolitics, finance, tech, disaster, social, science, other].\n"
    "3. importance: 1–5 scale:\n"
    "   1 = local or provincial news\n"
    "   2 = regional/national but minor\n"
    "   3 = national or continental significance\n"
    "   4 = important international issue\n"
    "   5 = major global event\n"
    "Return ONLY this format:\n"
    "show=<true|false>; topic=<one of the above>; importance=<1–5>\n\n"
    "Be less critical — include relevant world affairs, diplomacy, defense, conflicts, economy, technology, "
    "and disasters. Exclude entertainment, celebrity, lifestyle, or recipes."
)

AI_LOCATION_PROMPT = (
    "Given a news title and description, return ONE likely city or country involved, "
    "like 'Moscow', 'Beijing', or 'New York, USA'. Return only the location name, nothing else."
)

# ---------------------------
# Initialize geocoders
# ---------------------------
try:
    geolocator_nom = Nominatim(user_agent="geomonitor_news_app")
    geolocator_geo = Geoapify(api_key=GEOAPIFY_KEY) if GEOAPIFY_AVAILABLE and GEOAPIFY_KEY else None
    log("✅ Initialized Nominatim geocoder (Geoapify available)" if geolocator_geo else "✅ Initialized Nominatim geocoder (Geoapify unavailable).")
except Exception as e:
    log(f"❌ Geocoder init error: {e}")
    raise SystemExit(1)

# ---------------------------
# Cache persistence
# ---------------------------
def persist_caches():
    try:
        with open(GEOCACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(GEOCACHE, f, ensure_ascii=False, indent=2)
        with open(CLASSIFY_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(CLASSIFY_CACHE, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

# ---------------------------
# AI Classification (Mistral 7B)
# ---------------------------
def ai_classify_article(article):
    if not (AI_IS_ON and AI_CLASSIFY_ON and OPENROUTER_KEY):
        return True, "other", 2

    title = (article.get("title") or "").strip()
    desc = (article.get("description") or "").strip()
    cache_key = (title + desc)[:2000]
    if cache_key in CLASSIFY_CACHE:
        e = CLASSIFY_CACHE[cache_key]
        return e["show"], e["topic"], e["importance"]

    payload = {
        "model": "mistralai/mistral-7b-instruct",
        "messages": [
            {"role": "system", "content": AI_CLASSIFY_PROMPT},
            {"role": "user", "content": f"Title: {title}\nDescription: {desc}"}
        ],
        "max_tokens": 40,
        "temperature": 0.0
    }

    try:
        r = requests.post("https://openrouter.ai/api/v1/chat/completions",
                          headers={"Authorization": f"Bearer {OPENROUTER_KEY}",
                                   "Content-Type": "application/json"},
                          json=payload, timeout=25)
        r.raise_for_status()
        raw = r.json()["choices"][0]["message"]["content"].lower()
        log(f"🧠 AI classify → {raw}")
        show = "true" in raw
        topic = re.search(r"topic=([a-z]+)", raw)
        topic = topic.group(1) if topic else "other"
        imp = re.search(r"importance=([1-5])", raw)
        importance = int(imp.group(1)) if imp else 2
        CLASSIFY_CACHE[cache_key] = {"show": show, "topic": topic, "importance": importance}
        persist_caches()
        return show, topic, importance
    except Exception as e:
        log(f"⚠️ AI classify fail: {e}")
        return True, "other", 2

# ---------------------------
# AI Location fallback
# ---------------------------
def ai_guess_location(article):
    if not (AI_IS_ON and AI_LOCATION_FALLBACK_ON and OPENROUTER_KEY):
        return None
    title = (article.get("title") or "").strip()
    desc = (article.get("description") or "").strip()
    payload = {
        "model": "mistralai/mistral-7b-instruct",
        "messages": [
            {"role": "system", "content": AI_LOCATION_PROMPT},
            {"role": "user", "content": f"Title: {title}\nDescription: {desc}"}
        ],
        "max_tokens": 10,
        "temperature": 0.0
    }
    try:
        r = requests.post("https://openrouter.ai/api/v1/chat/completions",
                          headers={"Authorization": f"Bearer {OPENROUTER_KEY}",
                                   "Content-Type": "application/json"},
                          json=payload, timeout=20)
        r.raise_for_status()
        raw = r.json()["choices"][0]["message"]["content"].strip()
        log(f"🧩 AI location → {raw}")
        return raw
    except Exception as e:
        log(f"⚠️ AI location fail: {e}")
        return None

# ---------------------------
# Location extraction helpers
# ---------------------------
def extract_dateline_location(text):
    if not text:
        return None
    m = DATELINE_REGEX.match(text)
    if m:
        raw = m.group(1).strip()
        return CUSTOM_LOCATIONS.get(raw.lower(), raw)
    return None

def extract_location_hint(text):
    if not text:
        return None
    m = PLACE_REGEX.search(text)
    if m:
        raw = m.group(1).strip()
        return CUSTOM_LOCATIONS.get(raw.lower(), raw)
    return None

# ---------------------------
# Geocoding with cache
# ---------------------------
def geocode_location(name):
    if not name:
        return None, None
    key = name.lower().strip()
    if key in GEOCACHE:
        c = GEOCACHE[key]
        return c["lat"], c["lon"]

    time.sleep(1.2)
    try:
        loc = geolocator_nom.geocode(name, timeout=10)
        if loc:
            lat, lon = loc.latitude, loc.longitude
            GEOCACHE[key] = {"lat": lat, "lon": lon}
            persist_caches()
            log(f"🗺️ Nominatim → {name} → ({lat:.4f}, {lon:.4f})")
            return lat, lon
    except Exception as e:
        log(f"⚠️ Geocode fail {name}: {e}")
    return None, None

# ---------------------------
# Fetch, filter, classify, push
# ---------------------------
def fetch_and_process():
    TOPICS = [
        "geopolitics", "international relations", "war", "conflict",
        "finance", "economic crisis", "stock market",
        "technology", "AI", "semiconductor", "cyber attack",
        "natural disaster", "earthquake", "hurricane"
    ]
    query = " OR ".join(TOPICS)
    url = f"https://newsapi.org/v2/everything?q={requests.utils.quote(query)}&language=en&sortBy=publishedAt&pageSize=30&apiKey={NEWS_API_KEY}"
    log(f"Fetching: {url}")
    try:
        res = requests.get(url, timeout=20)
        res.raise_for_status()
        data = res.json()
        articles = data.get("articles", [])
        log(f"Fetched {len(articles)} articles.")
    except Exception as e:
        log(f"❌ Fetch fail: {e}")
        return {}

    REJECT = ["recipe", "fashion", "celebrity", "movie", "music", "holiday", "lifestyle"]
    filtered = [a for a in articles if not any(k in (a.get("title","")+a.get("description","")).lower() for k in REJECT)]
    log(f"Filtered down to {len(filtered)} articles.")

    events = {}
    for i, art in enumerate(filtered):
        title = art.get("title", "")
        desc = art.get("description", "")
        log(f"\n[{i+1}/{len(filtered)}] {title}")
        show, topic, importance = ai_classify_article(art)
        log(f"→ show={show}, topic={topic}, importance={importance}")
        if not show:
            continue

        loc_hint = None
        src = (art.get("source") or {}).get("name", "").lower()
        if src in CUSTOM_LOCATIONS:
            loc_hint = CUSTOM_LOCATIONS[src]
            log(f"📕 Dict source → {loc_hint}")
        if not loc_hint:
            loc_hint = extract_dateline_location(title + " " + desc)
        if not loc_hint:
            loc_hint = extract_location_hint(title + " " + desc)
        if not loc_hint and AI_LOCATION_FALLBACK_ON:
            loc_hint = ai_guess_location(art)
        if not loc_hint:
            log("❌ No location → skip")
            continue

        lat, lon = geocode_location(loc_hint)
        if not lat or not lon:
            continue

        key = f"news_{int(time.time())}_{i}"
        events[key] = {
            "title": title,
            "description": desc,
            "type": (art.get("source") or {}).get("name", "News"),
            "url": art.get("url", ""),
            "lat": lat, "lon": lon,
            "timestamp": art.get("publishedAt") or datetime.utcnow().isoformat(),
            "topic": topic,
            "importance": importance
        }
    return events

# ---------------------------
# Firebase push
# ---------------------------
def push_batch_events(events):
    fb_url = f"{FIREBASE_URL}/events.json"
    cutoff = datetime.utcnow() - timedelta(days=2)
    try:
        old = requests.get(fb_url, timeout=10).json() or {}
    except Exception:
        old = {}
    kept = {}
    for k, ev in old.items():
        try:
            ts = datetime.fromisoformat(ev["timestamp"].replace("Z", ""))
            if ts > cutoff:
                kept[k] = ev
        except Exception:
            continue
    merged = {**kept, **events}
    try:
        r = requests.put(fb_url, data=json.dumps(merged), timeout=15)
        r.raise_for_status()
        log(f"✅ PUSH COMPLETE: {len(merged)} total events.")
    except Exception as e:
        log(f"❌ PUSH FAIL: {e}")

# ---------------------------
# Main
# ---------------------------
if __name__ == "__main__":
    log("=== Starting Data Injection Job ===")
    new_events = fetch_and_process()
    if new_events:
        log(f"Pushing {len(new_events)} events...")
        push_batch_events(new_events)
    else:
        log("No new events.")
    log("=== Job Complete ===")
