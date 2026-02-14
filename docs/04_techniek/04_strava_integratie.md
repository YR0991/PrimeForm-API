# 04 — Strava-integratie

## Scope

- `PrimeForm-backed/routes/stravaRoutes.js`, `stravaWebhookRoutes.js`
- `PrimeForm-backed/services/stravaService.js`, `stravaWebhookService.js`, `stravaFallbackJob.js`
- `PrimeForm-backed/services/reportService.js`, `calculationService.js` (prime_load)
- `PrimeForm/src/stores/dashboard.js`, `IndexPage.vue` (Strava status, Sync nu)

---

## Wat de code doet

1. **Webhook:** GET /webhooks/strava: Strava subscription verification (hub.mode, hub.verify_token, hub.challenge); response 200 + { "hub.challenge": challenge } bij juiste STRAVA_VERIFY_TOKEN. POST /webhooks/strava: accepteert JSON, retourneert direct 200; verwerkt async via handleStravaWebhookEvent (alleen object_type === 'activity'; vindt uid via strava.athleteId; bij create/update: fetch /api/v3/activities/{id}, upsert users/{uid}/activities/{id} met source 'strava', ingestion.source 'webhook'; bij delete: deleted: true). 429: stravaBackoffUntil (15 min) + stravaLastError op user; volgende events skippen fetch tijdens backoff.
2. **Polling:** Geen polling-loop. Legacy: GET /api/strava/sync/:uid (56 dagen, geen rate limit). Webhook-first: POST /api/strava/sync-now (rate limit 1 per 10 min per user, after lastStravaSyncedAt), en fallback job (elke 6u + eerste na 1 min) voor users met strava.connected en stravaLastWebhookAt ouder dan 12u, met respect voor backoff.
3. **Ingestion:** Webhook en sync schrijven naar users/{uid}/activities; doc id = Strava activity id. Velden o.a. source ('strava' of ingested_from 'manual_sync'), strava_id, name, type, start_date, moving_time, elapsed_time, distance, suffer_score, etc. prime_load wordt niet in ingestion opgeslagen; reportService/dailyBriefService berekenen prime_load uit raw load + cycleService.getPhaseForDate + calculatePrimeLoad (Luteal tax, readiness).
4. **Belasting/prime_load:** calculationService.calculateActivityLoad (suffer_score of TRIMP of RPE-fallback) → calculatePrimeLoad (phase, readiness). reportService getDashboardStats haalt activities (subcollectie + root activities), past prime_load toe, sommeert 7d/28d, calculateACWR → acwr. Strava-activiteiten krijgen prime_load alleen in die aggregatie, niet in Firestore activity-doc bij webhook.

---

## Bewijs

**1) Webhook POST → async handler**
```javascript
// PrimeForm-backed/routes/stravaWebhookRoutes.js
router.post('/', (req, res) => {
  res.status(200).end();
  setImmediate(() => {
    handleStravaWebhookEvent({ db, admin, payload }).catch((err) => { ... });
  });
});
```

**2) 429 backoff**
```javascript
// PrimeForm-backed/services/stravaWebhookService.js
if (err.status === 429) {
  const backoffUntilMs = Date.now() + BACKOFF_MS;
  await updateUserWebhookMeta(aspect_type, 'Strava 429', backoffUntilMs);
}
```

**3) prime_load niet in webhook doc**
```javascript
// PrimeForm-backed/services/stravaWebhookService.js — buildActivityDoc
return {
  source: 'strava',
  strava_id: raw.id, ...
  suffer_score: raw.suffer_score != null ? Number(raw.suffer_score) : null,
  // no prime_load
};
```
reportService: `const primeLoad = calculatePrimeLoad(rawLoad, phase, readinessScore, avgHr, maxHr);` per activity in memory.

---

## Data-contracten

| Locatie | Geschreven door | Belangrijke velden |
|---------|-----------------|--------------------|
| users/{uid} | Webhook, sync-now, fallback | stravaLastWebhookAt, stravaLastWebhookEvent, stravaLastError, stravaBackoffUntil, lastStravaSyncedAt, lastSyncNowAt |
| users/{uid}/activities/{stravaId} | Webhook, sync | source, strava_id, name, type, start_date, moving_time, distance, suffer_score, ingestion (webhook) of ingested_from (manual_sync) |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | Fallback job draait op alle users met strava.connected; geen batch limit. | Bij veel users mogelijk rate limit of traagheid. | Batch size of rate limit per run. |
| P1 | Firestore index strava.athleteId vereist voor webhook lookup; niet in code aangemaakt. | Query faalt zonder index. | Documenteer of createIndex in deploy. |
| P2 | sync-now rate limit op lastSyncNowAt; geen server-side lock. | Theoretische race bij dubbele request. | Idempotency key of transaction. |

---

## Blind Spots

- Of root collection `activities` (manual sessions) en users/{uid}/activities samen in één report-query komen: reportService getLast56DaysActivities + getRootActivities56 — bevestigd merge in getDashboardStats; exacte contract voor manual vs Strava niet hier herhaald.
- Strava OAuth refresh: ensureValidToken in stravaService; waar expiresAt vandaan komt (Strava token response) niet geaudit.
