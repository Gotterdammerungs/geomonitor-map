#!/usr/bin/env python3
"""
data_injector_news.py
Fetches filtered news from NewsAPI, classifies them with Mistral AI via OpenRouter,
geocodes locations, and pushes them to Firebase under /events.
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

def log(msg):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")

FIREBASE_URL = os.environ.get("FIREBASE_URL").rstrip("/")
NEWS_API_KEY = os.environ.get("NEWS_API_KEY")
OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY")
GEOAPIFY_KEY = os.environ.get("GEOAPIFY_KEY")

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

log("Booting Geomonitor News Injector...")

AI_CLASSIFY_PROMPT = (
    "You are a geopolitical news classifier. "
    "Given a short news title and description, decide:\n"
    "1. show: true or false — should it appear on a global events map?\n"
    "2. topic: one of [geopolitics, finance, tech, disaster, social, science, other]\n"
    "3. importance: 1–5 (1=local, 5=major global)\n\n"
    "Be lenient when assigning importance=5; anything affecting world business, geopolitics, or international relations counts as 5. "
    "Level 4 means minor global or large regional impact, level 1 means purely provincial/state-level.\n\n"
    "Return ONLY this exact format (lowercase): show=<true|false>; topic=<topic>; importance=<1-5>"
)

AI_LOCATION_PROMPT = (
    "Given a news title and description, output one specific city or country most directly involved. "
    "Return ONLY the name, e.g. 'Beijing, China'."
)

geolocator_nom = Nominatim(user_agent="geomonitor_news_app")
geolocator_geo = Geoapify(api_key=GEOAPIFY_KEY) if GEOAPIFY_KEY else None

def persist_caches():
    with open(GEOCACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(GEOCACHE, f, indent=2)
    with open(CLASSIFY_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(CLASSIFY_CACHE, f, indent=2)

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
            {"role": "user", "content": f"Title: {title}\nDescription: {desc}"}
        ],
        "max_tokens": 50, "temperature": 0.0
    }
    try:
        r = requests.post("https://openrouter.ai/api/v1/chat/completions",
                          headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "Content-Type": "application/json"},
                          json=payload, timeout=20)
        r.raise_for_status()
        raw = r.json()["choices"][0]["message"]["content"].lower().strip()
        if "show=" in raw:
            raw = raw[raw.index("show="):]
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

def geocode_location(name):
    if not name: return None, None
    key = name.lower().strip()
    if key in GEOCACHE: return GEOCACHE[key]["lat"], GEOCACHE[key]["lon"]
    time.sleep(1)
    try:
        loc = geolocator_nom.geocode(name, timeout=10)
        if loc:
            GEOCACHE[key] = {"lat": loc.latitude, "lon": loc.longitude}
            persist_caches()
            return loc.latitude, loc.longitude
    except Exception: pass
    return None, None

def fetch_and_process_news():
    topics = "geopolitics OR war OR finance OR tech OR disaster"
    url = f"https://newsapi.org/v2/everything?q={topics}&language=en&sortBy=publishedAt&pageSize=30&apiKey={NEWS_API_KEY}"
    log(f"Fetching news: {url}")
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    arts = r.json().get("articles", [])
    log(f"Fetched {len(arts)} raw articles.")

    events = {}
    for i, a in enumerate(arts):
        show, topic, imp = ai_classify_article(a)
        if not show: continue
        loc = (a.get("source") or {}).get("name", "")
        lat, lon = geocode_location(loc)
        if not lat: continue
        key = f"news_{int(time.time())}_{i}"
        events[key] = {
            "title": a.get("title", ""),
            "description": a.get("description", ""),
            "type": a.get("source", {}).get("name", "News"),
            "url": a.get("url", ""),
            "lat": lat, "lon": lon,
            "timestamp": a.get("publishedAt") or datetime.utcnow().isoformat(),
            "topic": topic, "importance": imp
        }
    return events

def push_to_firebase(events):
    fb_url = f"{FIREBASE_URL}/events.json"
    old = requests.get(fb_url, timeout=10).json() or {}
    merged = {**old, **events}
    r = requests.put(fb_url, json=merged, timeout=15)
    r.raise_for_status()
    log(f"✅ PUSH COMPLETE: {len(merged)} total events.")

if __name__ == "__main__":
    log("=== Starting News Injection Job ===")
    ev = fetch_and_process_news()
    if ev: push_to_firebase(ev)
    else: log("No new events.")
    log("=== Job Complete ===")
