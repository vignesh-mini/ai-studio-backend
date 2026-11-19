# AI Studio – backend

NestJS API gateway for the AI Studio mobile app. The app sends every AI request here with
the user's JWT; the gateway validates it, applies plan limits, picks the provider and
streams the result back. **Provider API keys live only in this server's `.env`.**

## Status

| Phase | Area | State |
| --- | --- | --- |
| 2 | Auth (email + JWT with rotating refresh tokens), profile, model catalogue, usage | Done |
| 3 | Chat via Gemini, Groq, OpenRouter, Mistral, with SSE streaming, Auto routing, saved history and model switching | Done |
| 4–6 | Image, video, documents, voice | Planned (the app still serves these from mock data) |

## Setup

1. **Database:** create a free PostgreSQL project on [Neon](https://neon.tech) or
   [Supabase](https://supabase.com) and copy its connection strings.
2. **Environment:** `cp .env.example .env`, then fill in:
   - `DATABASE_URL` (pooled) and `DIRECT_URL` (direct)
   - `JWT_ACCESS_SECRET`: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   - at least one provider key: `GEMINI_API_KEY` ([AI Studio](https://aistudio.google.com/apikey))
     or `GROQ_API_KEY` ([Groq console](https://console.groq.com/keys))
3. **Install, migrate, seed and run:**

```sh
yarn install
yarn db:migrate --name init   # creates the tables
yarn db:seed                  # loads providers + model catalogue
yarn start:dev                # http://localhost:3000/api/v1
```

Check it with `curl http://localhost:3000/api/v1/health`, which should return `{"status":"ok"}`.

Models whose provider has no key are reported as unavailable and hidden in the app,
so you can start with just one key.

## API (`/api/v1`)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/health` | – | Liveness |
| POST | `/auth/register`, `/auth/login` | – | `{ user, accessToken, refreshToken }` |
| POST | `/auth/refresh` | – | Rotates the refresh token |
| POST | `/auth/google`, `/auth/apple` | – | 501 until social sign-in is added |
| GET | `/models` | JWT | Catalogue with `available` flags |
| POST | `/chat/messages` | JWT | SSE stream: `token` events, then `done` (or `error`) |
| GET | `/chat/conversations` | JWT | Latest 100 conversations |
| GET | `/chat/conversations/:id/messages` | JWT | |
| DELETE | `/chat/conversations/:id` | JWT | |
| GET | `/usage` | JWT | Today's usage and limits |
| GET / DELETE | `/profile`, `/profile/data` | JWT | Profile and delete-my-data |

## Structure

```
src/
├── auth/         register/login/refresh, global JWT guard, @Public, @CurrentUser
├── users/        profile + delete my data
├── models/       catalogue from ai_models / ai_providers, availability from .env keys
├── ai-gateway/   OpenAI-compatible streaming adapter, Auto router, model resolution
├── chat/         SSE endpoint, history sync, context building, conversation APIs
├── usage/        daily quotas and usage logs
├── prisma/       PrismaService
└── config/       env validation, limits
prisma/
├── schema.prisma
└── seed.ts       providers + models (edit provider model names here)
```

## Tests

```sh
yarn test       # unit tests: SSE parser, Auto router, context building
yarn test:e2e   # boots the app with a stubbed database: guards, validation, routes
yarn lint
```
