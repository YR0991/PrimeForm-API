# PrimeForm Fitness App

A fitness app for female athletes with menstrual cycle tracking capabilities.

## Features

- Calculate if a user is in the Luteal phase based on their last period date
- Support for custom cycle lengths (default: 28 days)
- Full PrimeForm logic for daily training recommendations (REST, RECOVER, MAINTAIN, PUSH)
- Red Flags calculation based on sleep, RHR, and HRV
- Luteal phase correction for RHR baseline
- Save check-in data to Firestore for tracking and analysis

## Environment variables (required for full functionality)

| Variable | Description |
|----------|-------------|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | JSON string of Firebase service account (e.g. on Render) or use local `firebase-key.json` |
| `STRAVA_CLIENT_ID` | Strava OAuth application ID |
| `STRAVA_CLIENT_SECRET` | Strava OAuth secret |
| `STRAVA_REDIRECT_URI` | OAuth callback URL (e.g. `https://your-api.com/auth/strava/callback`) |
| `STRAVA_VERIFY_TOKEN` | Secret string for webhook subscription verification (you choose it) |
| `STRAVA_WEBHOOK_CALLBACK_URL` | Full URL for Strava webhook (e.g. `https://your-api.com/webhooks/strava`) |

Optional: `FRONTEND_APP_URL`, `OPENAI_API_KEY`, SMTP vars for emails, etc.

### Strava Webhook subscription (near real-time activities)

1. Set `STRAVA_VERIFY_TOKEN` and `STRAVA_WEBHOOK_CALLBACK_URL` in your environment. The callback URL must be the exact path where the backend serves the webhook (e.g. `https://your-backend.onrender.com/webhooks/strava`).
2. Create the subscription (one per app) via Strava’s API:
   ```bash
   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
     -F "client_id=YOUR_CLIENT_ID" \
     -F "client_secret=YOUR_CLIENT_SECRET" \
     -F "callback_url=STRAVA_WEBHOOK_CALLBACK_URL" \
     -F "verify_token=STRAVA_VERIFY_TOKEN"
   ```
3. Strava will send a GET request to your callback URL with `hub.mode`, `hub.verify_token`, and `hub.challenge`. The backend responds with `200` and `{ "hub.challenge": "<challenge>" }` to complete verification.
4. After that, Strava will POST activity create/update/delete events to the same URL. Activities are written to `users/{uid}/activities/{activity_id}` (uid resolved via `strava.athleteId`). Ensure Firestore has an index on `users` for `strava.athleteId` if the lookup query fails.

To view or delete the subscription: `GET` or `DELETE https://www.strava.com/api/v3/push_subscriptions` (see [Strava Webhooks](https://developers.strava.com/docs/webhooks/)).

## Setup

1. Install dependencies:
```bash
npm install
```

2. Firebase Configuration:
   - Ensure `firebase-key.json` is present in the project root
   - This file contains the Firebase service account credentials
   - The server will automatically initialize Firebase Admin on startup

3. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

The server will run on `http://localhost:3000`

## Render deploy

The repo root contains a Render blueprint (`render.yaml`). The service uses `rootDir: PrimeForm-backed`; build and start run in this directory. Tests run before start (build command includes `npm test`).

- **Build:** `npm ci && npm test`
- **Start:** `npm start`

If `POST /api/admin/users/:uid/strava/sync-now` returns 500, check Render service logs for `errStack` (logged by admin routes). Logs are redacted (PII/tokens); `errStack` is still emitted for debugging. Use the stacktrace to locate the root cause.

## API Endpoints

### POST `/api/check-luteal-phase`

Check if a user is currently in the Luteal phase of their menstrual cycle.

**Request Body:**
```json
{
  "lastPeriodDate": "2024-01-15",
  "cycleLength": 28
}
```

- `lastPeriodDate` (required): Date of last period in YYYY-MM-DD format
- `cycleLength` (optional): Average cycle length in days (default: 28, range: 21-35)

**Response:**
```json
{
  "success": true,
  "data": {
    "isInLutealPhase": true,
    "currentCycleDay": 18,
    "daysSinceLastPeriod": 17,
    "phaseName": "Luteal",
    "cycleLength": 28,
    "lutealPhaseRange": {
      "start": 15,
      "end": 28
    }
  }
}
```

### POST `/api/daily-advice`

Get daily training recommendation using full PrimeForm logic. This endpoint calculates Red Flags, applies Luteal phase correction, and determines the optimal training status.

**Request Body:**
```json
{
  "lastPeriodDate": "2024-01-15",
  "cycleLength": 28,
  "sleep": 7.5,
  "rhr": 58,
  "rhrBaseline": 55,
  "hrv": 45,
  "hrvBaseline": 50,
  "readiness": 7
}
```

- `lastPeriodDate` (required): Date of last period in YYYY-MM-DD format
- `cycleLength` (optional): Average cycle length in days (default: 28, range: 21-35)
- `sleep` (required): Sleep hours (e.g., 7.5)
- `rhr` (required): Current resting heart rate (bpm)
- `rhrBaseline` (required): Baseline resting heart rate (bpm)
- `hrv` (required): Current HRV value
- `hrvBaseline` (required): Baseline HRV value
- `readiness` (required): Readiness score (1-10)

**Red Flags Calculation:**
- +1 for Sleep < 5.5 hours
- +1 for RHR > baseline + 5% (with Luteal correction: baseline + 3 if in Luteal phase)
- +1 for HRV < baseline - 10%

**Decision Tree:**
- `REST`: Readiness <= 3 OR Red Flags >= 2
- `RECOVER`: (Readiness 4-6 AND Luteal) OR Red Flags == 1
- `PUSH`: Readiness >= 8 AND 0 Red Flags AND Follicular phase
- `MAINTAIN`: All other cases

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "MAINTAIN",
    "reasons": ["Geen specifieke condities voor REST, RECOVER of PUSH"],
    "cycleInfo": {
      "phase": "Follicular",
      "isLuteal": false,
      "currentCycleDay": 10
    },
    "metrics": {
      "readiness": 7,
      "redFlags": 0,
      "redFlagDetails": [],
      "sleep": 7.5,
      "rhr": {
        "current": 58,
        "baseline": 55,
        "adjustedBaseline": 55,
        "lutealCorrection": false
      },
      "hrv": {
        "current": 45,
        "baseline": 50
      }
    }
  }
}
```

### POST `/api/save-checkin`

Save athlete check-in data to Firestore collection `daily_logs`. This endpoint performs the same calculations as `/api/daily-advice` and stores the results in the database.

**Request Body:**
```json
{
  "userId": "user123",
  "lastPeriodDate": "2024-01-15",
  "cycleLength": 28,
  "sleep": 7.5,
  "rhr": 58,
  "rhrBaseline": 55,
  "hrv": 45,
  "hrvBaseline": 50,
  "readiness": 7
}
```

- `userId` (required): Unique identifier for the athlete
- `lastPeriodDate` (required): Date of last period in YYYY-MM-DD format
- `cycleLength` (optional): Average cycle length in days (default: 28, range: 21-35)
- `sleep` (required): Sleep hours (e.g., 7.5)
- `rhr` (required): Current resting heart rate (bpm)
- `rhrBaseline` (required): Baseline resting heart rate (bpm)
- `hrv` (required): Current HRV value
- `hrvBaseline` (required): Baseline HRV value
- `readiness` (required): Readiness score (1-10)

**Response:**
```json
{
  "success": true,
  "message": "Check-in data saved successfully",
  "data": {
    "id": "document-id-from-firestore",
    "userId": "user123",
    "timestamp": "2024-01-22T10:30:00.000Z",
    "date": "2024-01-22",
    "metrics": {
      "sleep": 7.5,
      "rhr": 58,
      "rhrBaseline": 55,
      "hrv": 45,
      "hrvBaseline": 50,
      "readiness": 7
    },
    "cycleInfo": {
      "lastPeriodDate": "2024-01-15",
      "cycleLength": 28,
      "phase": "Follicular",
      "isLuteal": false,
      "currentCycleDay": 8
    },
    "redFlags": {
      "count": 0,
      "reasons": [],
      "details": { ... }
    },
    "recommendation": {
      "status": "MAINTAIN",
      "reasons": ["Geen specifieke condities voor REST, RECOVER of PUSH"]
    }
  }
}
```

The data is saved to the `daily_logs` collection in Firestore with a server timestamp.

### GET `/health`

Health check endpoint.

### GET `/`

API information and available endpoints.

## Example Usage

**Check Luteal Phase:**
```bash
curl -X POST http://localhost:3000/api/check-luteal-phase \
  -H "Content-Type: application/json" \
  -d '{"lastPeriodDate": "2024-01-15"}'
```

**Get Daily Advice:**
```bash
curl -X POST http://localhost:3000/api/daily-advice \
  -H "Content-Type: application/json" \
  -d '{
    "lastPeriodDate": "2024-01-15",
    "sleep": 6.5,
    "rhr": 60,
    "rhrBaseline": 55,
    "hrv": 45,
    "hrvBaseline": 50,
    "readiness": 8
  }'
```

**Save Check-in:**
```bash
curl -X POST http://localhost:3000/api/save-checkin \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "lastPeriodDate": "2024-01-15",
    "sleep": 7.5,
    "rhr": 58,
    "rhrBaseline": 55,
    "hrv": 45,
    "hrvBaseline": 50,
    "readiness": 7
  }'
```
