# AEO Platform

A web-based chatbot and admin dashboard for AEO (Answer Engine Optimization) — powered by an LLM with real-time backend visibility.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/aeo-chat run dev` — run the frontend (port auto-assigned)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY` — set via Replit AI Integrations (requires phone verification)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite (wouter, TanStack Query, Recharts, shadcn/ui)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- LLM: OpenAI via Replit AI Integrations (gpt-5.4, streaming SSE)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for API contracts
- `lib/db/src/schema/` — Drizzle schema (conversations, messages, backend_logs)
- `artifacts/api-server/src/routes/` — Express route handlers
  - `openai.ts` — chat routes with streaming SSE
  - `dashboard.ts` — analytics aggregation
  - `backend-logs.ts` — LLM call log retrieval
- `artifacts/aeo-chat/src/` — React frontend
  - `pages/chat.tsx` — chatbot UI with SSE streaming
  - `pages/dashboard.tsx` — analytics dashboard with Recharts
  - `pages/backend.tsx` — backend activity log view

## Architecture decisions

- SSE streaming for chat responses — Orval can't generate typed hooks for SSE, so the chat page uses raw fetch + ReadableStream
- Lazy OpenAI client loading — server starts without crashing if AI integration env vars aren't set; returns a friendly error in the chat stream instead
- Backend logs stored in DB — every LLM call writes a row to `backend_logs` with model, tokens, latency, and status
- Dashboard stats computed in SQL — aggregations run at query time, no caching layer needed at this scale

## Product

- **Chat** — Start conversations with the LLM AEO assistant. Messages stream in real time. Each response shows token count and latency.
- **Dashboard** — View total conversations, messages, tokens used, average response time, and a 14-day volume chart.
- **Backend Logs** — See every LLM API call with model name, token usage, response time, and success/error status.

## User preferences

- Web-based admin panel for connecting to LLM AEO workflows

## Gotchas

- AI chat requires phone verification on Replit to activate `AI_INTEGRATIONS_OPENAI_BASE_URL`/`AI_INTEGRATIONS_OPENAI_API_KEY`. Until verified, the chat stream returns a friendly error message.
- Run codegen after every OpenAPI spec change: `pnpm --filter @workspace/api-spec run codegen`
- Run DB push after schema changes: `pnpm --filter @workspace/db run push`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
