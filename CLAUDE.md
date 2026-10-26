# Visus – Eye Condition Diary

## What it is
A patient-facing mobile app for logging daily eye condition symptoms. Primary purpose: collect subjective symptom data to support a scientific research paper on eye conditions.

**Owner:** dejan.dundjerski@gmail.com  
**Bundle ID:** `com.mina.visus`

---

## The 5 Symptom Metrics
All metrics are **subjective only** — no clinical measurements (patients cannot measure IOP or Snellen acuity themselves).

| # | Metric | Scale |
|---|---|---|
| 1 | Dryness | 1–5 |
| 2 | Vision clarity | 1–5 |
| 3 | Eye fatigue | 1–5 |
| 4 | Redness | 1–5 |
| 5 | Light sensitivity | 1–5 |

---

## Authentication
- **Google Sign-In** (primary — required for access)
- **Sign in with Apple** (required for App Store)

---

## Data Architecture — Two Tiers

### Tier 1 — Anonymous Research Data
- Collected from all users who **opt in** during onboarding
- Contains **no PII whatsoever**: no name, no email, no device ID
- User identity replaced by a one-way hash (pseudonym) — cannot be reversed to identify the individual
- Contains only: pseudonym, timestamp, period (morning/working/evening), 5 metric scores, optional eye image crop
- Purpose: scientific research only
- Accessible to: research team only (admin panel)
- Retention: indefinite (research archive)

### Tier 2 — Personal Data (GDPR-designed from day one)
- Collected only from **authenticated users** with **explicit, granular consent**
- Contains: user identity, full diary entries with notes, notification preferences, demographics
- GDPR principles applied at design level:
  - **Lawful basis:** explicit consent (not legitimate interest)
  - **Purpose limitation:** symptom tracking only; no secondary use without new consent
  - **Data minimization:** only data fields the user actively provides
  - **Storage limitation:** user controls retention; deletion on account close
  - **Data subject rights:** access, rectification, erasure, portability — all self-service in-app
  - **Storage region:** EU only
  - **Consent versioning:** consent version stored with each user record; re-consent triggered on policy changes
  - **Opt-in research participation:** research data collection is a separate, clearly explained opt-in — not bundled with app consent
  - **Right to withdraw:** user can withdraw research opt-in at any time without losing app access

---

## Key Product Rules
- **Streak:** minimum 3 consecutive days; retroactive entries do not count
- **3 daily log slots:** Morning / During the day / Evening (internal key: `morning` / `working` / `evening`; UI label "Tokom dana")
- **Gamification:** XP (entries × 15 + streak × 5), 10 levels, badges, milestone rewards from pharmaceutical sponsor
- **Sponsor:** Vizim Dom Zdravlja — visible card on home screen + physical reward redemption flow
- **Notifications:** 3× daily configurable reminders (morning, mid-day, evening)
- **Optional selfie:** eye region extracted via on-device ML, only the crop is uploaded — original photo never leaves the device

---

## Platforms — Build Priority
1. **Website** (first — mobile-optimised, landing page + privacy policy + terms)
2. **iOS app**
3. **Android app**

---

## Admin / Analytics
- Handled outside the app entirely
- Pipeline: backend → data warehouse → Power BI
- No admin UI inside the app

---

## What has been built (iOS)
- All screens: auth, onboarding (consent + research opt-in + demographics), home, log entry, history calendar, trends charts, rewards, settings
- Full backend integration: auth, database, notifications

## Current direction (web demo)
Right now Visus is built as a **desktop web app** (sidebar layout, mobile only needs to not break) on **Supabase**, as a demo. Native iOS/Android is decided later.

## Web app (this repo)
- `public/` – static files only, deployable to any static host. Cream background, green accents.
  - `index.html` – the web app shell (code in `public/app/`, vanilla JS ES modules, no build step). Guests see the **same app** (sidebar, Home with today's slots, entry form) over an empty `GUEST_VIEW`; other pages (Istorija, Trendovi, …) send them to login. A guest can fill in an entry; on save they must sign up/log in, go through consent (onboarding), and only then the entry is inserted (`resumePending()`; until then it waits in localStorage `visus.pendingEntry`, never sent before consent).
  - `o-aplikaciji.html` – former landing page (features, privacy, mobile-app waitlist). `privacy.html`, `terms.html`.
  - `app/index.html` + `app/redirect.js` – old `/app/` URL redirects to `/` keeping `?code=` and `#route`.
- `public/config.js` – Supabase URL + anon key, `GOOGLE_LOGIN` flag.
- `public/app/rules.js` – single source of product rules (metrics, periods, XP/levels/streak, badges, milestones, demographic options).
- `supabase/schema.sql` – the whole backend; run once in Supabase SQL Editor (idempotent). Business rules live in the DB, not the client:
  - Tier 2 tables in `public` (`profiles`, `entries`, `consent_events`, `redemptions`, `waitlist`) with RLS; all cascade from `auth.users`.
  - Tier 1 in schema `research` (not exposed via API); filled by trigger on entry insert when opted in; pseudonym = HMAC(pepper in `private.settings`, user id).
  - Triggers: future dates rejected, `retroactive` computed in user's timezone, immutable fields on update, consent log written automatically.
  - RPCs: `claim_reward` (checks XP server-side; XP thresholds duplicated from rules.js), `research_preview`, `delete_account`.
  - Admin (research team): `private.admins` (added only via SQL Editor), RPCs `is_admin`, `admin_overview` (aggregate counts only), `admin_research` (Tier 1 records only). Admins never get Tier 2 personal data.
- `public/admin.html` + `public/app/admin.js` / `admin.css` – separate admin page at `/admin`; the app sidebar shows an "Admin" link only when `is_admin()` is true (access itself is enforced by the DB): research dashboard + CSV export. Chart shared via `public/app/chart.js`.
  - Consent version lives in `private.current_consent_version()` **and** `CONSENT_VERSION` in rules.js – change both together.
- Auth: Supabase email+password (PKCE); Google via Supabase provider when `GOOGLE_LOGIN = true`.
- Reminders: browser notifications while the app tab is open (no push server in the demo).
- Gamification details chosen by us (not in the original spec, confirm with owner/sponsor): level names + XP thresholds, 5 badges (no badge for research opt-in – consent must not be incentivised), milestone rewards are placeholders.
- Local dev: `npm run dev` → http://localhost:3000 (zero-dependency static server in `scripts/serve.js`; applies the same headers as `vercel.json`).
- Hosting: Vercel, static (`vercel.json`: output `public/`, clean URLs, security headers incl. CSP). The CSP `connect-src` hard-codes the Supabase project URL – update it if the project changes.

## Still to do (in priority order)
### Website (current priority)
- Waitlist / notify-me sign-up form
- Any remaining polish

### iOS app (next)
- Selfie / eye extraction feature
- GDPR self-service screens: data export, account deletion
- App Store submission (requires paid Apple Developer account)

### Android app (last)
