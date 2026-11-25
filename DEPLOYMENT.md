# Digital Logbook — Cloudflare Deployment & OneSignal Setup Guide

## Architecture Summary

- **Frontend**: React + TypeScript + Vite + PWA (`dist/`), deployed to **Cloudflare Pages**.
- **Backend API & Cron Triggers**: **Cloudflare Workers** (`worker/src/index.ts` & `wrangler.toml`) or Node/Express (`server.ts`) in local/container environments.
- **Database**: **Cloudflare D1 (SQLite)** using `/migrations/0001_initial.sql`.
- **Push Notifications**: **OneSignal Web Push + REST API** triggered from backend secrets (`ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`).

---

## 1. Create and Migrate Cloudflare D1 Database

```bash
npm install -g wrangler
wrangler login

# Create the D1 database
wrangler d1 create digital-logbook-db
```

Copy the returned `database_id` into `wrangler.toml`, then apply the SQL schema migration:

```bash
# Apply to remote D1 database
wrangler d1 migrations apply digital-logbook-db --remote
```

---

## 2. Configure Backend Secrets (Never Exposed to Frontend)

```bash
wrangler secret put ONESIGNAL_APP_ID
wrangler secret put ONESIGNAL_REST_API_KEY
wrangler secret put ALLOWED_ORIGIN
```

For local AI Studio / Express development, set `ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY` in the **Secrets** panel (matching `.env.example`).

---

## 3. Configure OneSignal Web Push

1. Create an application in the [OneSignal Dashboard](https://onesignal.com/).
2. Under **Settings → Platforms → Web**, choose **Typical Site** or **Custom Code**.
3. Enter your Cloudflare Pages URL (e.g., `https://digital-logbook.pages.dev`).
4. Copy your **App ID** into Settings inside Digital Logbook (and `ONESIGNAL_APP_ID` secret).
5. Generate a **REST API Key** under **Settings → Keys & IDs** and save it as `ONESIGNAL_REST_API_KEY` in Cloudflare Worker secrets (or AI Studio Secrets).
6. Use the **Notifications & Push Center** page in Digital Logbook to grant browser permission, register your admin device subscription, and send a test alert.

---

## 4. Deploy Backend Worker & Cron Triggers

```bash
wrangler deploy
```

The Cron Trigger in `wrangler.toml` (`0 8 * * *`) automatically executes daily at 08:00 UTC to evaluate:
- 30-day expiry reminders
- 14-day expiry reminders
- 7-day expiry reminders
- Same-day expiry notices (automatically flipping status to `NOT PAID`)
- Monthly payment summary reports on the 1st of each month

---

## 5. Deploy Frontend to Cloudflare Pages

```bash
npm run build
wrangler pages deploy dist --project-name=digital-logbook
```
