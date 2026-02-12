# PrimeForm Algoritme Specificaties — Versie 2.0
**Document Type:** Technical Requirement Specification (TRS)
**Status:** FINAL / READY FOR DEV
**Datum:** 2026-02-02

## 1. Executive Summary & Doelstelling
Het huidige algoritme (v1.0) was gebaseerd op lineaire belasting. Versie 2.0 introduceert een **Multi-Factor Fysiologisch Model**.
De kernverandering is de verschuiving van *"Hoe hard moet ik trainen?"* (Intensiteit) naar *"Welk energiesysteem moet ik belasten?"* (Modaliteit: Neuraal vs. Metabool), afhankelijk van de hormonale fase.

### Kernprincipes v2.0
1.  **Luteal Offset:** Normalisatie van HRV/RHR in de tweede cyclushelft om 'false negatives' te voorkomen.
2.  **Modaliteit Shifting:** Oestrogeen = Neurale Kracht; Progesteron = Metabole Steady State.
3.  **RED-S Watchdog:** Detectie van anovulatoire cycli (ontbreken van temperatuur/hartslag shift).
4.  **Context Overrides:** Specifieke logicatakken voor anticonceptie (o.a. Koperspiraal).

## 2. Data Input & Normalisatie (The PrimeForm Layer)
### 2.1 Variabelen
* `Raw_HRV` (rMSSD in ms)
* `Raw_RHR` (bpm)
* `Sleep_Score` (0-100 of uren)
* `Cycle_Day` (Dag 1 = start menstruatie)
* `Contraception_Type` (None, OAC, IUD-Copper, IUD-Hormonal)

### 2.2 De 'Luteal Offset' Berekening
*Trigger:* Pas toe indien `Phase == Luteal` (na bevestigde ovulatie of berekend na dag 14 bij 28-daagse cyclus).
* **Adjusted_HRV** = Raw_HRV * 1.12  (+12% Offset voor progesteron-demping)
* **Adjusted_RHR** = Raw_RHR - (Baseline_RHR_Follicular * 0.03)

## 3. Decision Matrix (Modaliteit Shifting)
Op basis van de *Adjusted* waarden:

### Fase: Folliculair / Ovulatie (Estrogen Dominant)
*Focus: Neurale Adaptatie & Kracht*
* **Green (High Adj_HRV):** MAX LOAD. Heavy lifting (1-5 RM), Plyometrics, Sprints.
* **Yellow (Baseline Adj_HRV):** HYPERTROPHY. Volume training, moderate intensity.
* **Red (Low Adj_HRV):** NEURAL REST. Technical work only, low CNS fatigue.

### Fase: Luteaal (Progesterone Dominant)
*Focus: Metabole Conditie & Steady State*
* **Green (High Adj_HRV):** ENDURANCE. Long steady state cardio, higher reps (12-15), functional bodybuilding.
* **Yellow (Baseline Adj_HRV):** AEROBIC MAINTENANCE. Zone 2 cardio, mobility flow.
* **Red (Low Adj_HRV):** ACTIVE RECOVERY. Yoga, Walking. Avoid cortisol spikes (no HIIT).

## 4. ACWR Interpretatie (Strict)

Gebruik onderstaande interpretatie van de Acute:Chronic Workload Ratio (ACWR). Deze regels zijn **leidend** voor alle AI-adviezen:

- **ACWR < 0.80 — Detraining**
  - Betekenis: Belastbaarheid daalt, risico op verlies van fitheid.
  - Toon: Benadruk dat dit een *onderbelasting* is. Waarschuw voor verlies van adaptaties.

- **ACWR 0.80 – 1.30 — THE SWEET SPOT (Progressive Overload)**
  - Betekenis: Dit is de **doelzone**. Hier vindt progressieve overload en functionele groei plaats.
  - Label dit expliciet als **POSITIEF**. Gebruik termen als:
    - "Textbook progressie"
    - "Functionele groei"
    - "Bouwfase"
  - **VERBODEN:** In deze zone mag de AI **niet** waarschuwen voor overtraining of “te veel belasting”.

- **ACWR 1.30 – 1.50 — High Warning**
  - Betekenis: Verhoogde belasting, let goed op signalen (HRV, RHR, klachten), maar nog geen rood alarm.
  - Toon: Alert, maar niet paniekerig. Adviseer slimme deloads of extra herstelmomenten.

- **ACWR > 1.50 — Danger Zone**
  - Betekenis: Hoog risico op overbelasting en blessures.
  - Toon: Duidelijk en direct. Adviseer een agressieve herstelstrategie (deload, rust, actieve herstelblokken).

## 5. Subjective vs. Objective Conflicts (Pessimist Filter)

### The Lazy Filter
* **IF** Biometrics == GREEN (High HRV / Low RHR) **AND** Subjective_Readiness <= 4:  
  * **Diagnosis:** Mental Fatigue / Low Motivation.  
  * **Advice:** "Gentle Push". Do NOT recommend total rest. Recommend a deal: *"Go for 10 mins, stop if it still sucks. Trust the data."*

### The Burnout Filter
* **IF** Biometrics == RED (Low HRV) **AND** Subjective_Readiness >= 8:  
  * **Diagnosis:** Adrenaline Override / Lack of Body Awareness.  
  * **Advice:** "Brake Check". Protect user from themselves. Force a lighter session or active recovery.

5. DE LETHARGY OVERRIDE (De 'Fake Fatigue' Regel):
   - Context: In de Luteale fase zorgt progesteron vaak voor een gevoel van lethargie (geen zin/moe), zelfs als het lichaam hersteld is.
   - Trigger: Fase = Luteaal EN Readiness = 4-6 (Matig) EN HRV > 105% van Baseline (28d).
   - Actie: Negeer het 'Recover' signaal. Adviseer 'MAINTAIN - AEROBIC FLOW'.
   - Waarom: Beweging stimuleert doorbloeding en vermindert juist de lethargie. Rust verergert het.

REGEL 6: DE ELITE OVERRIDE.
   - Trigger: Fase = Menstruation (Menstrual).
   - Conditie: Readiness >= 8 EN HRV >= (Baseline * 0.98).
   - Actie: Advies wordt 'PUSH - ELITE REBOUND'.
   - Guardrail: Waarschuw voor een mogelijke dip de volgende dag.

---

## Instructie voor het Weekrapport (Race Engineer AI)

Als je in de logdata de tag **ELITE_REBOUND** of **LETHARGY_OVERRIDE** ziet bij een dag, is de afwijking van het standaardprotocol **goedgekeurd**. De Daily AI heeft bewust een override toegepast op basis van lichaamskennis en data (hormonale rebound of hormonale lethargie). **Bekritiseer dit niet** in je weekanalyse; bevestig dat de keuze past bij de data en de fase, en bouw daarop voort in je plan.
