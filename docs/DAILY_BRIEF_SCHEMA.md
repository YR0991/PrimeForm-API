# PrimeFormDailyBrief — Payload-schema

Schema van het object dat GET `/api/daily-brief` retourneert (response body: `{ success: true, data: brief }`). Feitelijk op basis van `dailyBriefService.getDailyBrief`.

---

## Top-level velden

| Veld | Type | Beschrijving |
|------|------|--------------|
| **meta** | object | Versie- en contextinformatie (zie hieronder). |
| generatedAt | string (ISO 8601) | Moment van generatie. |
| status | object | tag, signal, oneLiner, hasBlindSpot. |
| confidence | object | grade (A/B/C), blindSpots (string[]). |
| todayDirective | object | doToday, why, stopRule, detailsMarkdown (optioneel). |
| inputs | object | acwr, recovery, cycle, activity. |
| compliance | object | checkins7dPct, checkins28dPct, missingHrvDays, missingRhrDays. |
| next48h | object | Volgende 48u-richtlijnen. |
| intake | object \| null | goal, eventDate, constraints, etc. |
| internalCost | string \| null | ELEVATED \| NORMAL \| LOW. |
| comparisons | object | hrv, rhr, cycleMatch. |

---

## Meta-blok (verplicht)

```ts
meta: {
  engineVersion: string;   // Versie advies-engine
  schemaVersion: string;   // Versie van dit brief-schema
  kbVersion: string;       // Versie knowledge base
  generatedAt: string;     // ISO 8601 timestamp
  timezone: string;        // IANA timezone voor datum-interpretatie
}
```

**Herkomst van de waarden:**

| Veld | Bron in code | Opmerking |
|------|----------------|-----------|
| **engineVersion** | `process.env.PRIMEFORM_ENGINE_VERSION` of const `'1.0.0'` | `PrimeForm-backed/services/dailyBriefService.js`: constante ENGINE_VERSION. |
| **schemaVersion** | `process.env.PRIMEFORM_BRIEF_SCHEMA_VERSION` of const `'1.0'` | Constante SCHEMA_VERSION. |
| **kbVersion** | `process.env.PRIMEFORM_KB_VERSION` of const `'1.0'` | Constante KB_VERSION. KB heeft in code geen versie; optioneel env bij deploy. |
| **generatedAt** | `new Date().toISOString()` | Binnen getDailyBrief op moment van aanroep. |
| **timezone** | Parameter `opts.timezone` van aanroeper | GET /api/daily-brief geeft `timezone: 'Europe/Amsterdam'` mee (dashboardRoutes.js). Fallback in service: `'Europe/Amsterdam'`. |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | kbVersion in code geen echte KB-versie (geen hash van knowledge/*.md). | Wijzigingen in KB niet traceerbaar in brief. | Bij loadKnowledgeBase hash of versie berekenen en als KB_VERSION gebruiken. |
| P2 | schemaVersion niet gekoppeld aan wijzigingen in brief-structuur. | Breaking changes lastig te detecteren. | Bij wijziging schema versie verhogen en in changelog zetten. |

## Blind Spots

- Of de frontend het meta-blok gebruikt (caching, debug, support): niet gecontroleerd.
- Andere consumers van GET /api/daily-brief (bijv. exports): niet in scope.
