# Firestore Security Rules – deployen

De PrimeForm API praat met Firestore via de **Firebase Admin SDK** (server). Die omzeilt de Firestore Security Rules. De **client** (browser/app) mag geen directe toegang tot Firestore hebben; daarom staan in `firestore.rules` overal `allow read, write: if false;`.

## Eerste keer (als je nog geen project gekoppeld hebt)

Vanuit de **primeform-api** map:

```bash
cd /pad/naar/primeform-api
npx firebase login
npx firebase use --add
# Kies je Firebase-project (hetzelfde als waar de API op draait)
```

## Rules deployen

```bash
cd /pad/naar/primeform-api
npx firebase deploy --only firestore
```

Na het deployen worden client-requests door de rules geweigerd; de API blijft werken via de service account.

## Waarom deze rules?

Google zet nieuwe projecten in “Test Mode”: 30 dagen lang is Firestore vanaf het internet bereikbaar. Daarna blokkeert Firebase client-toegang tenzij je expliciet rules hebt gezet. Door overal `if false` te zetten is er geen open client-toegang meer; alleen de backend (Admin SDK) heeft toegang.
