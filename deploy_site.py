#!/usr/bin/env python3
"""
deploy_site.py

Deploys the Geomonitor website by committing built files (HTML, JS, CSS, assets)
to the 'gh-pages' branch for GitHub Pages hosting.
Works inside GitHub Actions or locally.
"""

import os
import subprocess
from datetime import datetime

def log(msg: str):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")

def run(cmd: str):
    log(f"→ {cmd}")
    subprocess.run(cmd, shell=True, check=True)

def main():
    log("=== Starting Site Deployment ===")

    # Ensure we are in the repo root
    cwd = os.getcwd()
    log(f"Working directory: {cwd}")

    # Configure git user
    run('git config --global user.name "Geomonitor Bot"')
    run('git config --global user.email "bot@geomonitor"')

    # Build step (if needed)
    # In your case, it's static HTML, so no build step required.
    # If you later use React/Vite, run "npm run build" here.

    # Create a temporary directory for deployment
    run("rm -rf site-deploy")
    run("mkdir site-deploy")

    # Copy deployable files
    run("cp -r index.html style.css app.js assets site-deploy/ || true")
    run("cp -r firebase.json 404.html site-deploy/ || true")

    os.chdir("site-deploy")

    # Initialize fresh gh-pages repo
    run("git init")
    run("git add .")
    run('git commit -m "🚀 Auto-deploy from workflow"')
    run("git branch -M main")

    repo = os.environ.get("GITHUB_REPOSITORY")
    token = os.environ.get("GITHUB_TOKEN")

    if not repo or not token:
        log("❌ Missing GITHUB_REPOSITORY or GITHUB_TOKEN — cannot deploy.")
        return

    run(f"git remote add origin https://x-access-token:{token}@github.com/{repo}.git")
    run("git push --force origin main:gh-pages")

    log("✅ Deployment complete! Site should be live on GitHub Pages.")
    log("=== Job Complete ===")

if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        log(f"❌ Deployment failed: {e}")
        exit(1)
