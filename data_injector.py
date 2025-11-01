#!/usr/bin/env python3
"""
data_injector.py

Fetches filtered news from NewsAPI, classifies relevance/topic/importance with a small LLM
(Mistral 7B via OpenRouter), resolves locations (dictionary -> dateline -> keyword -> regex -> AI),
geocodes using Nominatim (with optional Geoapify fallback), and pushes events to Firebase.
- Uses environment variables for secrets.
- AI usage is optional and controlled via toggles.
- Keeps events for 2 days and merges new events with existing ones.
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
# Basic logging helper
# ---------------------------
def log(msg: str):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")

# ---------------------------
# Configuration (via env vars)
# ---------------------------
FIREBASE_URL = os.environ.get(
    "FIREBASE_URL",
    "https://geomonitor-2025-default-rtdb.europe-west1.firebasedatabase.app/"
).rstrip('/')
NEWS_API_KEY = os.environ.get("NEWS_API_KEY")
GEOAPIFY_KEY = os.environ.get("GEOAPIFY_KEY")
OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY")

# AI toggles
AI_IS_ON = True               # allow AI usage at all (both classification and location fallback)
AI_CLASSIFY_ON = True         # use AI for classification (show/topic/importance)
AI_LOCATION_FALLBACK_ON = True  # use AI to guess location if other methods fail

# Caches (persist between runs)
BASE_DIR = os.path.dirname(__file__)
GEOCACHE_PATH = os.path.join(BASE_DIR, "geocache.json")
CLASSIFY_CACHE_PATH = os.path.join(BASE_DIR, "classify_cache.json")

# Load caches
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

# ---------------------------
# Logging
# ---------------------------
log("Booting Geomonitor Data Injector...")
log(f"Firebase URL: {FIREBASE_URL or '❌ NOT SET'}")
log(f"NewsAPI key: {'✅ Present' if NEWS_API_KEY else '❌ NOT SET'}")
log(f"Geoapify key: {'✅ Present' if GEOAPIFY_KEY else '⚠️ Missing'}")
log(f"OpenRouter key: {'✅ Present' if OPENROUTER_KEY else '⚠️ Missing'}")
if not NEWS_API_KEY:
    log("FATAL ERROR: NEWS_API_KEY is required. Set it in the environment and re-run.")
    raise SystemExit(1)

# ---------------------------
# Load custom dictionary
# ---------------------------
DICTIONARY_PATH = os.path.join(BASE_DIR, "dictionary.json")
try:
    with open(DICTIONARY_PATH, "r", encoding="utf-8") as f:
        CUSTOM_LOCATIONS = json.load(f)
    log(f"📘 Loaded {len(CUSTOM_LOCATIONS)} dictionary entries from dictionary.json")
except Exception as e:
    log(f"⚠️ Could not load dictionary.json: {e}")
    CUSTOM_LOCATIONS = {}

# ---------------------------
# Regex patterns
# ---------------------------
PLACE_REGEX = re.compile(r"\b(?:in|at|near|from)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)")
DATELINE_REGEX = re.compile(r"^\s*([A-Z][A-Z]+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s*—|,)")

# ---------------------------
# 🧠 New Strict AI Classification Prompt
# ---------------------------
AI_CLASSIFY_PROMPT = (
    "You are a global news intelligence analyst. "
    "Your job is to classify each news article for display on a world monitoring map.\n\n"
    "Follow these rules strictly:\n"
    "1. Determine whether the article is relevant to global, national, or regional affairs. "
    "If it is unrelated to global or national issues (e.g. entertainment, sports, lifestyle, celebrity news, or trivial events), set show=false.\n\n"
    "2. Choose ONE topic ONLY from this list:\n"
    "geopolitics, conflict, economy, finance, technology, science, environment, disaster, cyber, diplomacy, energy, security\n"
    "Do NOT invent or guess other topics. If unsure, pick the closest matching one.\n\n"
    "3. Assign an importance level from 1 to 5:\n"
    "5 = Global significance (wars, treaties, major sanctions, world economy shifts, pandemics, global natural disasters)\n"
    "4 = Important international or inter-country events (diplomatic talks, military movements, global company actions)\n"
    "3 = National impact (elections, major policies, large-scale national economy or tech events)\n"
    "2 = Regional or state-level importance (provincial disasters, regional policy changes)\n"
    "1 = Local or small-scale events (city or community level)\n\n"
    "4. When unsure, prefer to include rather than exclude. Borderline geopolitical or economic news should still be shown (show=true).\n\n"
    "Output EXACTLY in this format:\n"
    "show=true; topic=geopolitics; importance=4"
)

AI_LOCATION_PROMPT = (
    "You are a concise location guesser. Given a short news title and description, "
    "return a single likely city or country name (e.g. 'Paris' or 'France' or 'Cupertino, California'). "
    "Return only the location string, nothing else."
)

# ---------------------------
# Initialize geocoders
# ---------------------------
try:
    geolocator_nom = Nominatim(user_agent="geomonitor_news_app")
    geolocator_geo = Geoapify(api_key=GEOAPIFY_KEY) if GEOAPIFY_AVAILABLE and GEOAPIFY_KEY else None
    if geolocator_geo:
        log("✅ Initialized geocoders: Nominatim + Geoapify fallback.")
    else:
        log("✅ Initialized Nominatim geocoder (Geoapify unavailable).")
except Exception as e:
    log(f"❌ Geocoder initialization error: {e}")
    raise SystemExit(1)

# ---------------------------
# Helper: Save caches
# ---------------------------
def persist_caches():
    try:
        with open(GEOCACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(GEOCACHE, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    try:
        with open(CLASSIFY_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(CLASSIFY_CACHE, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

# ---------------------------
# AI Classification
# ---------------------------
def ai_classify_article(article):
    if not AI_IS_ON or not AI_CLASSIFY_ON or not OPENROUTER_KEY:
        return True, "other", 2

    title = (article.get("title") or "").strip()
    desc = (article.get("description") or "").strip()
    cache_key = (title + "\n" + desc)[:2000]

    if cache_key in CLASSIFY_CACHE:
        entry = CLASSIFY_CACHE[cache_key]
        return entry.get("show", True), entry.get("topic", "other"), int(entry.get("importance", 2))

    payload = {
        "model": "mistralai/mistral-7b-instruct",
        "messages": [
            {"role": "system", "content": AI_CLASSIFY_PROMPT},
            {"role": "user", "content": f"Title: {title}\nDescription: {desc}"}
        ],
        "max_tokens": 40,
        "temperature": 0.0,
    }

    try:
        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "Content-Type": "application/json"},
            json=payload,
            timeout=25
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip().lower()
        log(f"🧠 AI classification raw → {raw}")

        show = True
        topic = "other"
        importance = 2

        m_show = re.search(r"show=(true|false)", raw)
        if m_show:
            show = m_show.group(1) == "true"
        m_topic = re.search(r"topic=([a-z]+)", raw)
        if m_topic:
            topic = m_topic.group(1)
        m_imp = re.search(r"importance=([1-5])", raw)
        if m_imp:
            importance = int(m_imp.group(1))

        CLASSIFY_CACHE[cache_key] = {"show": show, "topic": topic, "importance": importance, "raw": raw}
        persist_caches()
        return show, topic, importance
    except Exception as e:
        log(f"⚠️ AI classification failed: {e}")
        return True, "other", 2

# (The rest of your code remains the same — location guessing, geocoding, fetch_and_process, and Firebase push)
