# Visus – Eye Condition Diary

## What it is
A patient-facing mobile app for logging daily eye condition symptoms. Primary purpose: collect subjective symptom data to support a scientific research paper on eye conditions.

**Owner:** dejan.dundjerski@gmail.com  
**Bundle ID:** `com.mina.visus`

---

## The 5 Symptom Metrics
All metrics are **subjective only** — no clinical measurements (patients cannot measure IOP or Snellen acuity themselves).

**Per eye:** each metric is scored for both eyes at once by default; the user can click "Različito po oku" to score the right (`_r`) and left (`_l`) eye separately. Stored in `entries.<metric>_r` / `<metric>_l`; the plain `<metric>` column is then the worse eye (computed by `private.apply_eye_scores`, same rule as `worseEye` in rules.js; clarity: lower = worse). Old entries have empty per-eye columns (= same for both eyes). Added without a consent bump (same 5 metrics, finer detail; privacy text updated).

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
- Contains only: pseudonym, timestamp, period (morning/working/evening), 5 metric scores (overall + per eye), symptom checklist, urgency, optional eye image crop (symptoms + urgency added in consent v1.1)
- Purpose: scientific research only
- Accessible to: research team only (admin panel)
- Retention: indefinite (research archive)

### Tier 2 — Personal Data (GDPR-designed from day one)
- Collected only from **authenticated users** with **explicit, granular consent**
- Contains: user identity, full diary entries with notes, notification preferences, profile (demographics + eye-health history: medication use, surgeries, glasses/lenses + diopter per eye, conditions, screen time, allergy – all optional)
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
- **Each entry also has:** a symptom checklist (`SYMPTOMS` in rules.js: suzenje, krmeljenje, crveno oko, osećaj stranog tela, peckanje, svrab, bol u oku, osećaj pritiska, smanjena vidna oštrina, drugo – optional; "drugo" has a free-text description in `entries.symptom_other` that stays in Tier 2 only – research gets just the `other` flag) and an **urgency** (`usual` / `sudden` / `doctor` – required for new entries). For `sudden`/`doctor` the form shows a "go to an ophthalmologist / 194" warning; choosing `doctor` also pops up a call button for Vizim Dom Zdravlja (011 785 7777, `CLINIC` in rules.js). The app never notifies a doctor.
- **3 daily log slots:** Morning / During the day / Evening (internal key: `morning` / `working` / `evening`; UI label "Tokom dana")
- **Gamification:** XP (entries × 15 + streak × 5), 10 levels, badges, milestone rewards from pharmaceutical sponsor
- **Sponsor:** Vizim Dom Zdravlja — visible card on home screen + physical reward redemption flow. **Temporarily removed from the web app (2026-10-26, owner's request):** no Nagrade page, sponsor card or reward claiming; streak/XP/levels/badges stay. DB parts (`redemptions`, `claim_reward`) are left in place, unused; the old UI is in git history.
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
  - Admin (Vizim team): `private.admins` (added only via SQL Editor), RPCs `is_admin`, `admin_overview` (aggregate counts only), `admin_research` (Tier 1 records only), `admin_reports` (only reports patients explicitly sent). No other Tier 2 access.
- **Doctor report ("Izveštaj za lekara", page `#/report`):** patient downloads a PDF of the last 7 days and/or sends it to the clinic. `private.report_data()` builds the snapshot (patient name/email, profile, entries incl. notes); RPCs `preview_report` (download only) and `send_report` (stores a row in `public.shared_reports`, max 5/hour). Each send = explicit one-off consent; the patient can withdraw (delete) it; cascades on account deletion. Admins read them via `admin_reports()` (tab "Izveštaji pacijenata" on `/admin`). This is the ONLY way admins see identified (Tier 2) data. PDF is built client-side in `public/app/report.js` with pdfmake (lazy-loaded from cdnjs – allowed in the CSP).
- `public/admin.html` + `public/app/admin.js` / `admin.css` – separate admin page at `/admin`; the app sidebar shows an "Admin" link only when `is_admin()` is true (access itself is enforced by the DB): research dashboard + CSV export. Chart shared via `public/app/chart.js`.
  - Consent version lives in `private.current_consent_version()` **and** `CONSENT_VERSION` in rules.js – change both together (currently **1.1**; bump whenever what is collected/shared changes, and list the changes in `renderReconsent`).
  - Symptom/urgency keys are also hard-coded in the `entries_symptoms_check` / `entries_urgency_check` constraints.
- Auth: Supabase email+password (PKCE); Google via Supabase provider when `GOOGLE_LOGIN = true`.
- Reminders: browser notifications while the app tab is open (no push server in the demo).
- Gamification details chosen by us (not in the original spec, confirm with owner/sponsor): level names + XP thresholds, 5 badges (no badge for research opt-in – consent must not be incentivised). Sponsor rewards currently removed (see Key Product Rules).
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
