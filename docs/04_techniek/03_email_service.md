# 03 — E-mail service

## Scope

- `PrimeForm-backed/server.js` (nodemailer, sendNewIntakeEmail, isProfileComplete)

---

## Wat de code doet

1. **Config:** Nodemailer createTransport met host/port/secure/auth uit env: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS; SMTP_SECURE === 'true' voor TLS. Optioneel SMTP_FROM (defaults naar SMTP_USER).
2. **Startup:** In NODE_ENV !== 'test' wordt gelogd of SMTP_* en SMTP_FROM set zijn (geen waarden).
3. **Trigger:** Bij PUT /api/profile: als `isProfileComplete(mergedProfile)` true is en de user had nog geen profileComplete, wordt `sendNewIntakeEmail(mergedProfile)` aangeroepen (fire-and-forget).
4. **Ontvanger:** Vast adres `ADMIN_EMAIL` (hardcoded in server.js).
5. **Inhoud:** Subject "Nieuwe Intake: {fullName}"; body tekst: naam, email, goal. Geen HTML template in code.

---

## Bewijs

**1) Transport**
```javascript
// PrimeForm-backed/server.js
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.example.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER || '...', pass: process.env.SMTP_PASS || '...' }
});
```

**2) Trigger**
```javascript
// PrimeForm-backed/server.js (PUT /api/profile)
if (profileComplete && !(existing.exists && existing.data()?.profileComplete === true)) {
  sendNewIntakeEmail(mergedProfile);
}
```

**3) Send**
```javascript
// PrimeForm-backed/server.js
function sendNewIntakeEmail(profile) {
  const toAddress = ADMIN_EMAIL;
  mailTransporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@primeform.nl',
    to: toAddress,
    subject: `Nieuwe Intake: ${name}`,
    text: `Nieuwe Intake: ${name} - ${email} - ${goal}`
  }).then(...).catch(...);
}
```

---

## Data-contracten

| Veld | Richting | Bron/Doel |
|------|----------|-----------|
| SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, SMTP_FROM | Env → Nodemailer | Config |
| profile.fullName, profile.email, profile.goals | Firestore/body → sendNewIntakeEmail | Mail content |
| ADMIN_EMAIL | Hardcoded | To-address |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P0 | ADMIN_EMAIL hardcoded. | Alle intakes naar één adres; niet configureerbaar. | ADMIN_EMAIL uit env. |
| P2 | Geen retry of queue bij falen. | Gemiste mail bij tijdelijke SMTP-fout. | Log + optioneel retry of queue. |
| P2 | isProfileComplete bepalend voor trigger; geen dubbele check (bijv. idempotency key). | Bij race of dubbele save mogelijk dubbele mail. | Idempotency of "already sent" flag. |

---

## Blind Spots

- Andere e-mailflows (wachtwoord reset, notificaties) niet in server.js gevonden; mogelijk alleen Firebase Auth e-mail.
- SMTP credentials: waar ze in productie staan (Render env) niet in code.
