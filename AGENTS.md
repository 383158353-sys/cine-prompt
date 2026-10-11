# Local project guidance
Preserve the existing UI and prompt logic. This app runs locally with Node.js 22+.
Use npm install, npm run dev, npm run build, npm start.
Run npm test, npm run lint, and npm run typecheck before delivery.
Keep AI credentials only in server environment variables or .env.local. Never bundle secrets or local-data.
The base44Client frontend name is a compatibility facade, not a Base44 SDK connection.
Backend functions live in server/functions; AI and persistence adapters live in server.
