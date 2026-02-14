# Risicoregister — Product, Techniek, Juridisch

Top 10 risico’s met severity, mitigatie en detectiesignaal (welk log/veld).

---

| # | Risico | Categorie | Severity | Mitigatie | Detectiesignaal |
|---|--------|-----------|----------|-----------|-----------------|
| 1 | **Uid niet geverifieerd:** Aanroepen gebruiken `X-User-Uid` of body userId zonder Firebase token-verificatie. | Tech | P0 | Middleware: `verifyIdToken` en vergelijk uid met token.uid. | Log: elke request met X-User-Uid; alert bij ontbreken Authorization. |
| 2 | **Admin-gate via hardcoded e-mail:** Alleen `ADMIN_EMAIL` (env/hardcoded) en header `x-admin-email` bepalen admin-rechten. | Tech | P0 | Rol in Firestore of Auth custom claims; geen e-mail als enige check. | Log: gebruik van x-admin-email; veld: adminRoutes checkAdminAuth. |
| 3 | **N+1 bij admin users:** GET /api/admin/users haalt alle users en roept per user getDashboardStats aan. | Tech | P1 | Batch/cache of aparte stats-collection; pagination. | Log: duur GET /api/admin/users; Firestore read count. |
| 4 | **Nuclear Delete laat root daily_logs staan:** Bij verwijderen user worden alleen users/{uid}/dailyLogs en users/{uid}/activities gewist; root `daily_logs` met userId niet. | Tech | P1 | Delete query: daily_logs where userId == uid; of documenteer bewust. | Log: na DELETE /api/admin/users/:uid; controle op resterende daily_logs. |
| 5 | **Intake-mail zonder idempotency:** Eerste keer profileComplete → sendNewIntakeEmail; dubbele save kan dubbele mail. | Product | P1 | Vlag intakeMailSentAt op user; alleen mailen indien nog niet verzonden. | Log: "Admin intake email sent"; veld: geen sent-flag nu. |
| 6 | **Strava-tokens in Firestore ongeëncrypteerd:** users.strava (accessToken, refreshToken) at-rest; geen encryptie in code. | Tech/Juridisch | P1 | Firestore security rules strikt; overweeg secrets manager. | Veld: users.strava; audit op leesrechten. |
| 7 | **lastPeriod vs lastPeriodDate inconsistentie:** isProfileComplete checkt cycleData.lastPeriod; cycleService gebruikt lastPeriodDate. | Product | P1 | Eén key (bijv. lastPeriodDate) of mapping in isProfileComplete. | Veld: profile.cycleData.lastPeriod / lastPeriodDate. |
| 8 | **Firestore-index strava.athleteId ontbreekt in code:** Webhook zoekt user op strava.athleteId; index niet programmatisch aangemaakt. | Tech | P2 | Index in deploy-docs of createIndex in setup. | Foutlog: Firestore "index required" bij webhook. |
| 9 | **Geen transactie bij Nuclear Delete:** Auth deleteUser en Firestore deletes niet in één transactie; bij fout kan orphan state. | Tech | P2 | Compensatie of idempotent retry; documenteer recovery. | Log: "Auth user deleted" vs "Firestore user deleted". |
| 10 | **PII in logs/errors:** Console.log en error messages kunnen userId, e-mail of profieldata bevatten. | Juridisch | P2 | Log-sanitization; geen PII in productielogs. | Grep op console.log/error met userId, email. |

---

## Severity-legenda

- **P0:** Kritiek (beveiliging/ compliance); direct aanpakken.
- **P1:** Hoog (correctheid, schaal, privacy); binnen sprint.
- **P2:** Medium (onderhoud, duidelijkheid); backlog.

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | Risico 10 niet per regel geaudit. | Mogelijk PII-lek. | Centraliseer logging; sanitize. |
| P2 | Juridisch (AVG) niet volledig; alleen technische exposure. | Juridische review nodig. | Apart compliance-doc. |

## Blind Spots

- Of er andere subcollections onder users zijn die bij delete blijven bestaan.
- Of coach-toegang (teamId) voldoende is afgeschermd tegen cross-team toegang.
