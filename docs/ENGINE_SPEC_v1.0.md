# Engine Specificatie v1.0

Autoritatieve specificatie van de status-engine. Alleen geverifieerd gedrag (code + life simulations 01–15). Referentie: `statusEngine.computeStatus`, `cycleService`, `dailyBriefService`.

---

## 1. Doel en uitvoer

**Doel:** Eén eenduidig advies (tag) per dag op basis van load (ACWR), readiness, rode vlaggen, cyclusfase en ziekte. Gebruikt door daily brief en save-checkin.

**Uitvoer:**
- **tag:** `REST` | `RECOVER` | `MAINTAIN` | `PUSH`
- **signal:** `RED` (REST/RECOVER), `ORANGE` (MAINTAIN), `GREEN` (PUSH)
- **reasons:** array Nederlandse strings (basis + override + ACWR-grens indien toegepast)

De daily brief levert daarnaast cyclePhase/phaseDay (alleen bij cycleConfidence HIGH), acwrBand, en AI-tekst; die vallen buiten deze spec.

---

## 2. Bron van waarheid en datacontract

- **Status/tag:** Enige bron is `PrimeForm-backed/services/statusEngine.js` → `computeStatus()`. Geen andere code mag tag/signal afleiden voor brief of check-in.
- **Cyclus:** Canoniek veld `profile.cycleData.lastPeriodDate` (ISO-date). Legacy `lastPeriod` is gemigreerd en mag niet terugkomen.
- **Auth:** User-endpoints: `Authorization: Bearer <Firebase ID token>`; identiteit = `req.user.uid`. Admin: custom claim `admin: true`; break-glass uit in productie.
- **Firestore:** Input voor de engine komt uit profile, dailyLogs (56d), activities; zie simulations/fixtures voor het contract.

---

## 3. Beslispijplijn (volgorde en tie-breakers)

Volgorde in `computeStatus()`:

1. **isSick** → direct **RECOVER**, reden "Ziek/geblesseerd – Herstel voorop." (stopt verdere logica).
2. **Basisstatus** uit readiness, redFlags, cyclePhase via `cycleService.determineRecommendation`:  
   - readiness ≤ 3 of redFlags ≥ 2 → **REST**  
   - redFlags === 1 of (readiness 4–6 + Luteal) → **RECOVER**  
   - readiness ≥ 8, redFlags 0, Folliculair → **PUSH**  
   - anders → **MAINTAIN**
3. **Lethargy-override:** Luteal + readiness 4–6 + HRV > 105% baseline → **MAINTAIN** (overschrijft basis RECOVER).
4. **Elite-override:** Menstruaal dag 1–3 + readiness ≥ 8 + HRV ≥ 98% (of null) → **PUSH**.
5. **ACWR-clamp:** Resultaat van 2–4 wordt geklemd op ACWR-grenzen (zie §5).
6. **Option B:** Als acwr null/niet eindig en tag === PUSH → **MAINTAIN** + reden `NO_ACWR_NO_PUSH`.

Tie-breakers: isSick wint altijd. ACWR-plafond/plaat wint over PUSH. Overrides (Lethargy/Elite) worden vóór de clamp toegepast; de clamp kan PUSH alsnog naar RECOVER/MAINTAIN zetten.

---

## 4. Cyclus en anticonceptie (Route B; confidence; wat v1 wel/niet doet)

- **contraceptionMode (Route B):** `NATURAL` | `HBC_OTHER` | `COPPER_IUD` | `HBC_LNG_IUD` | `UNKNOWN`. Bron: `profile.cycleData.contraceptionMode` (of legacy string `contraception`).
- **cycleConfidence:** Alleen **NATURAL + lastPeriodDate** → HIGH. Alle andere modi (inclusief COPPER_IUD, HBC_LNG_IUD) → LOW. NATURAL zonder lastPeriodDate → LOW (of MED in logica; effect: geen phase).
- **Gating:** Bij LOW worden cyclePhase en phaseDay **niet** aan computeStatus doorgegeven. Lethargy- en Elite-overrides draaien dan niet (phase/phaseDay zijn null).
- **v1 modelleert:** Fase uit lastPeriodDate + gemiddelde cyclustijd; Luteal-tax op load; twee cycle-overrides (Lethargy, Elite) alleen bij HIGH confidence.
- **v1 modelleert niet:** Fase-predictie bij HBC/COPPER; onderscheid tussen koper- vs hormonaal-IUD voor load; HRV-patrooncorrectie; MED als aparte UI-beslissing.

---

## 5. Load- en ACWR-regels (incl. Option B)

- **Prime Load:** Altijd fysiologisch gecorrigeerde load (Luteal-tax in calculationService). Geen ruwe Strava suffer_score als input voor ACWR.
- **ACWR:** Acute 7d / chronische 28d (sum7 / (sum28/4)). Banden: `<0.8` | `0.8–1.3` | `1.3–1.5` | `>1.5` | `null`.
- **Grenzen in computeStatus:**  
  - acwr **> 1.5** → tag wordt **RECOVER** (spike).  
  - acwr **> 1.3** en tag PUSH → **RECOVER** (overreaching).  
  - acwr **< 0.8** en tag PUSH → **MAINTAIN** (geen PUSH in detraining).  
  - acwr **null** → geen ACWR-klem; daarna Option B: als tag nog steeds PUSH → **MAINTAIN** + `NO_ACWR_NO_PUSH`.
- **Option B:** Geen PUSH zonder berekende ACWR. Geldt in zowel daily brief als save-checkin (in de engine zelf).

---

## 6. Invarianten (max 10)

1. isSick ⇒ tag = RECOVER.
2. tag = PUSH ⇒ acwr is berekend en 0,8 ≤ acwr ≤ 1,3 (Option B + ACWR-band).
3. redFlags ≥ 2 of readiness ≤ 3 ⇒ tag = REST (voor clamp/overrides).
4. cycleConfidence LOW ⇒ phaseDay niet doorgegeven ⇒ geen Lethargy-, geen Elite-override.
5. cycleConfidence HIGH ⇒ alleen bij NATURAL + lastPeriodDate.
6. signal GREEN ⇔ tag PUSH; ORANGE ⇔ MAINTAIN; RED ⇔ REST of RECOVER.
7. ACWR > 1.5 ⇒ tag = RECOVER; ACWR > 1.3 blokkeert PUSH.
8. ACWR < 0.8 blokkeert PUSH (tag wordt ten minste MAINTAIN).
9. Red flags: zelfde drempels als cycleService.calculateRedFlags (slaap <5.5u, RHR > baseline+5%, HRV < baseline−10%; Luteal-correctie op baselines).
10. Eén bron voor tag: computeStatus(); brief en check-in gebruiken geen aparte statuslogica.

---

## 7. Bekende beperkingen en expliciete non-goals

- **COPPER_IUD:** Behandeld als LOW confidence; geen cyclusspecifieke logica. Geen onderscheid t.o.v. HBC voor fase in v1.
- **Legacy mapping:** Oude "Spiraal" zonder contraceptionMode → UNKNOWN (niet COPPER_IUD).
- **Luteal-gewichten:** Vast in code (o.a. 1.05, +0.05 bij hoge intensiteit); niet via config/env.
- **Geen HRV-patrooncorrectie:** Alleen puntmeting HRV t.o.v. baseline; geen trend- of patroonlogica.
- **Intake/KB:** Geen gewichten in adviesberekening; alleen als invoer voor context.
- **MED confidence:** Niet als aparte beslissing geëxposeerd; effect is gelijk aan LOW (geen phase).
- **Break-glass admin:** Bewust uit in productie.

---

## 8. Testbewijs (scenario → kritieke regel)

| Scenario | Bewezen regel |
|----------|----------------|
| 01 | Sweet spot ACWR + Folliculair + readiness 8 → PUSH. |
| 02 | ACWR > 1.5 → RECOVER (plafond); reasons bevatten ACWR. |
| 03 | ACWR < 0.8 + PUSH-basis → MAINTAIN (vloer). |
| 04 | Lethargy: Luteal, readiness 4–6, HRV >105% → MAINTAIN. |
| 05 | Elite: Menstruaal dag 1–3, readiness 8+, HRV ≥98% → PUSH. |
| 06 | isSick → RECOVER (hoogste prioriteit); reasons bevatten Ziek. |
| 07 | redFlags ≥ 2 → REST; reasons bevatten Red Flags. |
| 08 | Geen activiteiten → acwr null → MAINTAIN, reasons NO_ACWR_NO_PUSH (Option B). |
| 09 | Geen specifieke condities → basis MAINTAIN. |
| 10 | 1 red flag → RECOVER. |
| 11 | NATURAL + lastPeriodDate → cycleConfidence HIGH, phaseDay aanwezig. |
| 12–13 | HBC_LNG_IUD / COPPER_IUD → LOW, phaseDay afwezig; zelfde tag als 11. |
| 14 | Elite zou PUSH geven; HBC_LNG_IUD → LOW → geen Elite → MAINTAIN. |
| 15 | Lethargy zou MAINTAIN geven; COPPER_IUD → LOW → baseline MAINTAIN. |

Testrun: `npm run sim:life` (PrimeForm-backed). Expected format v1.2: tag, signal, optioneel acwrBand, cycleMode, cycleConfidence, phaseDayPresent, redFlagsMin, reasonsContains.
