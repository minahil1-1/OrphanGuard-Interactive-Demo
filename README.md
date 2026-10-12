# OrphanGuard Interactive Demo

A reconstructed OrphanGuard pitch demo with synthetic, in-memory sample data and no connected AI model.

This working copy may differ from the version deployed on Railway. Adding files to this repository does not update that deployment.

## Run locally

```bash
npm ci
npm start
```

Open http://127.0.0.1:3000/ for the pitch overview, or http://127.0.0.1:3000/?preview=1 for the interactive dashboard.

Local runs listen on 127.0.0.1 by default. When Railway sets RAILWAY_ENVIRONMENT, the server listens on 0.0.0.0 and uses the provided PORT.

## Demo scope

- All facility, child, visitor, alert, location, and event records are illustrative sample data.
- Changes are stored in memory and disappear when the server restarts.
- No trained AI model, camera, messaging account, or official reporting service is connected.
- The dashboard's sign-in screen is a demonstration gate, not secure authentication.
- Do not enter real or sensitive information.

The project uses Express and WebSockets. Environment files, uploaded records, local database files, and node_modules are excluded from version control.
