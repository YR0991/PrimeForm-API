# 01 — Admin-dashboard

## Scope

- `PrimeForm-backed/routes/adminRoutes.js` (GET /api/admin/users)
- `PrimeForm-backed/services/reportService.js` (getDashboardStats)
- `PrimeForm/src/pages/admin/AdminPage.vue` (master roster, system load)
- `PrimeForm/src/stores` (adminStore: totalUsers, systemCapacity)

---

## Wat de code doet

1. **Master list data source:** GET /api/admin/users. Haalt alle users op: db.collection('users').get(). Per doc: id, userId, profile, profileComplete, role, teamId, email (data.email ?? profile.email), adminNotes, createdAt, updatedAt. Geen filter op role; alle users.
2. **Berekening "System Load":** Niet in backend. Frontend: systemLoadPercent = (adminStore.totalUsers / adminStore.systemCapacity) * 100. systemCapacity en totalUsers komen uit adminStore (fetchAllData of gelijkwaardig). "System Load" = percentage van capaciteit (aantal users t.o.v. geconfigureerd maximum).
3. **Enrichment voor status dots:** Per user wordt reportService.getDashboardStats({ db, admin, uid: u.id }) aangeroepen. acwr = stats.acwr (indien finite); directive = afgeleid: acwr > 1.5 → REST, > 1.3 → RECOVER, 0.8–1.3 → PUSH, anders MAINTAIN. Response: users array met extra velden acwr, directive.
4. **Admin UI:** Master roster toont users; status dots uit acwr/directive. System load tegel toont systemLoadPercent (0% als systemCapacity 0).

---

## Bewijs

**1) Users + enrichment**
```javascript
// PrimeForm-backed/routes/adminRoutes.js
const usersSnapshot = await db.collection('users').get();
const users = usersSnapshot.docs.map((doc) => ({ id: doc.id, profile: data.profile || null, ... }));
const enriched = await Promise.all(
  users.map(async (u) => {
    const stats = await report.getDashboardStats({ db, admin, uid: u.id });
    const acwr = stats?.acwr != null && Number.isFinite(stats.acwr) ? stats.acwr : null;
    const directive = acwr != null ? (acwr > 1.5 ? 'REST' : acwr > 1.3 ? 'RECOVER' : ...) : null;
    return { ...u, acwr, directive };
  })
);
```

**2) System Load (frontend)**
```javascript
// PrimeForm/src/pages/admin/AdminPage.vue
const systemLoadPercent = vueComputed(() => {
  if (!systemCapacity.value) return 0
  return (adminStore.totalUsers / systemCapacity.value) * 100
})
```

**3) Template**
```html
{{ systemLoadPercent.toFixed(0) }}%
```

---

## Data-contracten

| Veld | API | Frontend |
|------|-----|----------|
| id, profile, profileComplete, role, teamId, email, adminNotes, acwr, directive | GET /api/admin/users | adminStore, master roster, status dots |
| totalUsers, systemCapacity | adminStore (bron onbekend in dit bestand) | systemLoadPercent |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P1 | GET /api/admin/users haalt alle users en roept per user getDashboardStats aan. | N+1; bij veel users traag en Firestore-cost. | Batch of cached stats; of pagination. |
| P2 | systemCapacity bron niet in adminRoutes; waarschijnlijk env of aparte config. | Blind spot voor beheer. | Documenteer waar systemCapacity vandaan komt. |

---

## Blind Spots

- Waar adminStore.totalUsers en systemCapacity worden gezet (welke API of env): niet in adminRoutes.
- Of master list gefilterd wordt (bijv. alleen atleten): code toont alle users.
