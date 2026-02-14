# 03 — Gebruikersbeheer

## Scope

- `PrimeForm-backed/routes/adminRoutes.js` (DELETE /api/admin/users/:uid, deleteSubcollection, PATCH /api/admin/users/:id)
- Firebase Admin Auth (admin.auth().deleteUser)
- `PrimeForm/src/pages/admin/AdminPage.vue` (delete confirmatie-tekst)

---

## Wat de code doet

1. **Nuclear Delete (DELETE /api/admin/users/:uid):** (1) Firebase Auth: admin.auth().deleteUser(uid). Bij auth/user-not-found wordt gewaarschuwd maar niet gefaald. (2) Firestore: deleteSubcollection(userRef, 'dailyLogs') — batch 500, alle docs in users/{uid}/dailyLogs. deleteSubcollection(userRef, 'activities') — idem voor users/{uid}/activities. userRef.delete() — user document. Geen verwijdering van root collection daily_logs op userId; geen verwijdering van andere subcollections dan dailyLogs en activities.
2. **Veiligheid / volledigheid:** Auth wordt eerst verwijderd (daarna kan user niet meer inloggen). Subcollections in batches van 500. Geen transactie over Auth + Firestore; bij Firestore-fout na Auth-delete is user zonder account maar data mogelijk nog aanwezig. Confirmatie in frontend: "Alle Firestore-data (profiel, dailyLogs, activiteiten) en het Auth-account worden permanent verwijderd."
3. **PATCH /api/admin/users/:id:** Alleen teamId en role. updatedAt = serverTimestamp(). Geen profiel- of strava-wijziging via deze route.
4. **Admin gate:** Zie 04_techniek/02_beveiliging_auth.md. DELETE vereist checkAdminAuth (x-admin-email of body adminEmail === ADMIN_EMAIL).

---

## Bewijs

**1) Delete flow**
```javascript
// PrimeForm-backed/routes/adminRoutes.js
if (admin.apps.length > 0) {
  try { await admin.auth().deleteUser(uid); } catch (authErr) { ... }
}
await deleteSubcollection(userRef, 'dailyLogs');
await deleteSubcollection(userRef, 'activities');
await userRef.delete();
```

**2) deleteSubcollection**
```javascript
async function deleteSubcollection(userRef, subcollectionName, batchSize = 500) {
  let snapshot = await colRef.limit(batchSize).get();
  while (!snapshot.empty) {
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;
    snapshot = await colRef.limit(batchSize).get();
  }
  return deleted;
}
```

**3) Frontend confirm**
```javascript
// AdminPage.vue
message: `... Alle Firestore-data (profiel, dailyLogs, activiteiten) en het Auth-account van "..." worden permanent verwijderd.`
```

---

## Data-contracten

| Actie | Verwijderd | Niet verwijderd |
|-------|------------|------------------|
| DELETE /api/admin/users/:uid | Auth user, users/{uid} doc, users/{uid}/dailyLogs, users/{uid}/activities | daily_logs (root) docs met userId, andere subcollections indien aanwezig |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P1 | Root daily_logs met userId wordt niet gewist. | Legacy logs blijven; mogelijke PII. | Delete query daily_logs where userId == uid of documenteer bewust. |
| P2 | Geen transactie Auth + Firestore. | Bij fout na Auth-delete: orphan Auth of orphan data. | Compensatie of idempotent retry. |
| P2 | Andere subcollections (bijv. notities, exports) niet in delete. | Indien toegevoegd later, blijven bestaan. | deleteSubcollection voor elke bekende subcollection of whitelist. |

---

## Blind Spots

- Of er nog andere subcollections onder users zijn: niet in code geïnventariseerd.
- Soft delete vs hard delete: alleen hard delete aanwezig.
