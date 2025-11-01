#!/usr/bin/env python3
"""
data_injector.py

Fetches filtered news from NewsAPI, classifies relevance/topic/importance with Mistral 7B via OpenRouter,
resolves locations (dictionary -> dateline -> keyword -> regex -> AI),
geocodes using Nominatim (with optional Geoapify fallback), and pushes events to Firebase.
"""

import os
import time
import json
import re
import requests
from datetime import datetime, timedelta

# ---------------------------
# Safe geopy imports (Geoapify optional)
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
# Logging helper
# ---------------------------
def log(msg: str):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")


# ---------------------------
# Config
# ---------------------------
FIREBASE_URL = os.environ.get(
    "FIREBASE_URL",
    "https://geomonitor-2025-default-rtdb.europe-west1.firebasedatabase.app/",
).rstrip("/")
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
    raise SystemExit("❌ NEWS_API_KEY missing.")


# ---------------------------
# Load dictionary
# ---------------------------
DICTIONARY_PATH = os.path.join(BASE_DIR, "dictionary.json")
try:
    with open(DICTIONARY_PATH, "r", encoding="utf-8") as f:
        CUSTOM_LOCATIONS = json.load(f)
    log(f"📘 Loaded {len(CUSTOM_LOCATIONS)} dictionary entries from dictionary.json")
except Exception:
    CUSTOM_LOCATIONS = {}


# ---------------------------
# Regex and prompts
# ---------------------------
PLACE_REGEX = re.compile(r"\b(?:in|at|near|from)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)")
DATELINE_REGEX = re.compile(r"^\s*([A-Z][A-Z]+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s*—|,)")

AI_CLASSIFY_PROMPT = (
    "You are a geopolitical news classifier. "
    "Given a short news title and description, decide:\n"
    "1. show: true or false — should it appear on a global events map?\n"
    "2. topic: one of [geopolitics, finance, tech, disaster, social, science, other]\n"
    "3. importance: 1–5 (1=local, 5=major global)\n\n"
    "Always include world affairs, diplomacy, leaders, government policies, wars, military, economy, "
    "trade, security, or international relations. "
    "Be inclusive for any story about governments, politics, military, diplomacy, leaders, or global economics. "
    "Do NOT exclude stories mentioning political figures (e.g., Trump, Xi, Putin). "
    "Exclude only entertainment, celebrity gossip, lifestyle, fashion, sports, or recipes.\n\n"
    "Return ONLY this exact format (lowercase):\n"
    "show=<true|false>; topic=<topic>; importance=<1-5>"
)

AI_LOCATION_PROMPT = (
    "Given a news title and description, output one specific city or country most directly involved. "
    "Return ONLY the name, for example: 'Beijing, China' or 'Washington, D.C., USA' or 'Moscow, Russia'. "
    "If unsure, return the most likely capital city related to the context."
)


# ---------------------------
# Geocoders
# ---------------------------
try:
    geolocator_nom = Nominatim(user_agent="geomonitor_news_app")
    geolocator_geo = Geoapify(api_key=GEOAPIFY_KEY) if GEOAPIFY_AVAILABLE and GEOAPIFY_KEY else None
    if geolocator_geo:
        log("✅ Initialized geocoders: Nominatim + Geoapify fallback.")
    else:
        log("✅ Initialized Nominatim geocoder (Geoapify unavailable).")
except Exception as e:
    raise SystemExit(f"❌ Geocoder init failed: {e}")


def persist_caches():
    try:
        with open(GEOCACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(GEOCACHE, f, ensure_ascii=False, indent=2)
        with open(CLASSIFY_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(CLASSIFY_CACHE, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


# ---------------------------
# AI classification
# ---------------------------
def ai_classify_article(article):
    if not AI_IS_ON or not AI_CLASSIFY_ON or not OPENROUTER_KEY:
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
            {"role": "user", "content": f"Title: {title}\nDescription: {desc}"},
        ],
        "max_tokens": 50,
        "temperature": 0.0,
    }

    try:
        r = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "Content-Type": "application/json"},
            json=payload,
            timeout=20,
        )
        r.raise_for_status()
        raw = r.json()["choices"][0]["message"]["content"].lower().strip()
        if "show=" in raw:
            raw = raw[raw.index("show="):]
        raw = re.sub(r"[^a-z0-9;=\s.-]", "", raw)
        log(f"🧠 AI classify → {raw}")

        show = "true" in raw
        topic = re.search(r"topic=([a-z]+)", raw)
        topic = topic.group(1) if topic else "other"
        imp = re.search(r"importance=([1-5])", raw)
        imp = int(imp.group(1)) if imp else 2

        CLASSIFY_CACHE[cache_key] = {"show": show, "topic": topic, "importance": imp}
        persist_caches()
        return show, topic, imp
    except Exception as e:
        log(f"⚠️ AI classify failed: {e}")
        return True, "other", 2


# ---------------------------
# AI location
# ---------------------------
def ai_guess_location(article):
    if not AI_IS_ON or not AI_LOCATION_FALLBACK_ON or not OPENROUTER_KEY:
        return None

    title = article.get("title", "")
    desc = article.get("description", "")
    prompt_text = f"Title: {title}\nDescription: {desc}\n\n{AI_LOCATION_PROMPT}"

    try:
        r = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "Content-Type": "application/json"},
            json={
                "model": "mistralai/mistral-7b-instruct",
                "messages": [
                    {"role": "system", "content": AI_LOCATION_PROMPT},
                    {"role": "user", "content": prompt_text},
                ],
                "max_tokens": 20,
                "temperature": 0.0,
            },
            timeout=20,
        )
        r.raise_for_status()
        raw = r.json()["choices"][0]["message"]["content"].strip()
        if not re.search(r"[a-z]", raw.lower()) or len(raw) < 3:
            return None
        if any(x in raw.lower() for x in ["world", "internet", "global", "earth", "unknown"]):
            return None
        log(f"🧠 AI location guess → {raw}")
        return raw
    except Exception as e:
        log(f"⚠️ AI location guess failed: {e}")
        return None


# ---------------------------
# Geocoding
# ---------------------------
def geocode_location(name):
    if not name:
        return None, None
    key = name.lower().strip()
    if key in GEOCACHE:
        g = GEOCACHE[key]
        log(f"♻️ Cache hit for {name}")
        return g["lat"], g["lon"]

    time.sleep(1.2)
    try:
        loc = geolocator_nom.geocode(name, timeout=10)
        if loc:
            lat, lon = float(loc.latitude), float(loc.longitude)
            GEOCACHE[key] = {"lat": lat, "lon": lon}
            persist_caches()
            log(f"🗺️ Nominatim → {name} → ({lat:.4f}, {lon:.4f})")
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
                log(f"🌐 Geoapify → {name} → ({lat:.4f}, {lon:.4f})")
                return lat, lon
        except Exception:
            pass
    return None, None


# ---------------------------
# Fetch and process
# ---------------------------
def fetch_and_process():
    TOPICS = [
        "geopolitics",
        "international relations",
        "war OR conflict",
        "finance OR stock market OR economic crisis",
        "technology OR AI OR semiconductor OR cyber attack",
        "natural disaster OR earthquake OR hurricane",
    ]
    q = " OR ".join(TOPICS)
    url = f"https://newsapi.org/v2/everything?q={requests.utils.quote(q)}&language=en&sortBy=publishedAt&pageSize=30&apiKey={NEWS_API_KEY}"
    log(f"Fetching news: {url}")

    try:
        r = requests.get(url, timeout=20)
        r.raise_for_status()
        data = r.json()
        arts = data.get("articles", [])
        log(f"Fetched {len(arts)} raw articles.")
    except Exception as e:
        log(f"❌ News fetch failed: {e}")
        return {}

    bad_words = ["recipe", "bake", "fashion", "celebrity", "music", "sports", "film", "movie", "game", "tv"]
    arts = [a for a in arts if not any(b in (a.get("title","")+a.get("description","")).lower() for b in bad_words)]
    log(f"Filtered down to {len(arts)} articles.")

    events = {}
    for i, a in enumerate(arts):
        title = a.get("title","")
        desc = a.get("description","")
        log(f"\n[{i+1}/{len(arts)}] {title}")

        show, topic, imp = ai_classify_article(a)
        log(f"→ show={show}, topic={topic}, importance={imp}")
        if not show:
            continue

        loc_hint = None
        src = (a.get("source") or {}).get("name","").lower()
        if src in CUSTOM_LOCATIONS:
            loc_hint = CUSTOM_LOCATIONS[src]

        if not loc_hint:
            guess = ai_guess_location(a)
            if guess:
                loc_hint = guess
        if not loc_hint:
            continue

        lat, lon = geocode_location(loc_hint)
        if not lat:
            continue

        key = f"news_{int(time.time())}_{i}"
        events[key] = {
            "title": title,
            "description": desc,
            "type": a.get("source", {}).get("name", "News"),
            "url": a.get("url", ""),
            "lat": lat,
            "lon": lon,
            "timestamp": a.get("publishedAt") or datetime.utcnow().isoformat(),
            "topic": topic,
            "importance": imp,
        }
    return events


# ---------------------------
# Push to Firebase
# ---------------------------
def push_batch_events(events):
    fb_url = f"{FIREBASE_URL}/events.json"
    cutoff = datetime.utcnow() - timedelta(days=2)

    try:
        old = requests.get(fb_url, timeout=10).json() or {}
        log(f"Fetched {len(old)} old events.")
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

    merged = {**kept, **events}
    try:
        r = requests.put(fb_url, data=json.dumps(merged), timeout=15)
        r.raise_for_status()
        log(f"✅ PUSH COMPLETE: {len(merged)} total events.")
    except Exception as e:
        log(f"❌ PUSH FAILED: {e}")


# ---------------------------
# Main
# ---------------------------
if __name__ == "__main__":
    log("=== Starting Data Injection Job ===")
    ev = fetch_and_process()
    if ev:
        push_batch_events(ev)
    else:
        log("No new events to push.")
    log("=== Job Complete ===")
