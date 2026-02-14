# 05 — Consistentie en streaks

## Scope

- `PrimeForm-backed/services/coachService.js` (getRollingCompliance, getCurrentStreak)
- `PrimeForm-backed/services/dailyBriefService.js` (buildCompliance)
- `PrimeForm/src/components/CoachDeepDive.vue` (Consistentie-tegel, streak badge)
- Input: history_logs (array met .date YYYY-MM-DD)

---

## Wat de code doet

1. **Definitie "dag":** Unieke datum (YYYY-MM-DD). Log telt als "heeft check-in" als er een log is met die date. history_logs komt uit reportService (dailyLogs per dag); elk item heeft date. Rolling compliance: unieke datums in window.
2. **Rolling 7-dagen (coachService):** getRollingCompliance(logs). Window: vandaag + 6 dagen terug (7 dagen). uniqueDates = set van log.date in window. count = min(uniqueDates.size, 7). complianceDays = array van 7 booleans [oudste … vandaag]: true als die datum in uniqueDates zit.
3. **Streak (coachService):** getCurrentStreak(logs). datesSet = set van alle log dates. Start vandaag; while datum in set: streak++, ga 1 dag terug. Stop bij eerste ontbrekende dag. Geen maximum; "dag" = kalenderdag (server timezone bij toISOString().slice(0,10)).
4. **Brief compliance (dailyBriefService):** buildCompliance(logs28, start7). logs28 = laatste 28 dagen. checkins7dPct = (aantal logs met date >= start7) / 7 * 100; checkins28dPct = days28/28*100. missingHrvDays = 28 - withHrv; missingRhrDays = 28 - withRhr. Geen streak in brief; wel checkins7dPct, checkins28dPct.
5. **Edge cases:** Geen log vandaag → streak 0. Meerdere logszelfde dag → telt als 1 dag. Timezone: date uit log (string); window gebruikt new Date() → toISOString() (server TZ). Geen expliciete "midnight UTC" vs lokale dag.

---

## Bewijs

**1) Rolling 7d**
```javascript
// PrimeForm-backed/services/coachService.js
const windowStart = new Date(now); windowStart.setDate(windowStart.getDate() - 6);
const inWindow = (logs || []).filter((h) => { const d = (h.date || '').slice(0, 10); return d >= windowStartStr && d <= todayStr; });
const uniqueDates = new Set(inWindow.map((h) => (h.date || '').slice(0, 10)));
const complianceDays = []; for (let i = 0; i < 7; i++) {
  const d = new Date(now); d.setDate(d.getDate() - (6 - i));
  complianceDays.push(uniqueDates.has(d.toISOString().slice(0, 10)));
}
```

**2) Streak**
```javascript
// getCurrentStreak: while (true) { const dStr = d.toISOString().slice(0, 10); if (!datesSet.has(dStr)) break; streak += 1; d.setDate(d.getDate() - 1); }
```

**3) UI**
```html
<!-- CoachDeepDive.vue -->
<span class="compliance-label">Consistentie:</span>
<div class="compliance-bars"> ... v-for="(filled, idx) in (atleet?.complianceDays ?? Array(7).fill(false))" ... />
{{ atleet?.complianceLast7 ?? 0 }}/7
<span v-if="(atleet?.currentStreak ?? 0) > 7" class="streak-badge">🔥 {{ atleet.currentStreak }} DAGEN STREAK</span>
```

---

## Data-contracten

| Veld | Bron | Consument |
|------|------|-----------|
| complianceLast7, complianceDays, currentStreak | coachService.getSquadronData / getAthleteDetail (stats.history_logs) | CoachDeepDive, squadron list |
| compliance.checkins7dPct, checkins28dPct | dailyBriefService.buildCompliance | daily-brief API, atleet dashboard |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | Streak/timezone: server Date() gebruikt voor "vandaag"; bij TZ-verschil atleet vs server kan "vandaag" anders zijn. | Mogelijk 1-dag verschil. | Documenteer server TZ of gebruik atleet TZ indien beschikbaar. |
| P2 | buildCompliance: checkins28dPct = days28/28 (aantal logs, niet unieke dagen). Als meerdere logs per dag tellen die dubbel. | Percentage kan >100 niet; maar kan 7/7 en 28/28 vertekend. | Unieke datums voor 28d of documenteer "log count". |

---

## Blind Spots

- Of history_logs per dag maximaal één log heeft (geaggregeerd): reportService bouwt uit dailyLogs; meerdere logs per dag mogelijk → coachService telt unieke dates, dailyBriefService telt logs.
- Exacte weergave "CONSISTENTIE" vs "X/7" in andere talen: niet geaudit.
