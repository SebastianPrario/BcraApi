# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Backend API for BCRA (Central Bank of Argentina) entity monitoring and alerts. Users can subscribe to receive email notifications when the credit status of a company (identified by CUIT) changes. The system periodically checks BCRA status and sends alerts via email.

## Common Development Commands

**Development**
- `npm run start:dev` — Run in watch mode (recompiles on file changes)
- `npm run start:debug` — Run with debugger on port 9229
- `npm run start` — Run once (requires rebuild after changes)
- `npm run build` — Compile TypeScript to JavaScript in `dist/` directory

**Testing**
- `npm test` — Run all unit tests matching `*.spec.ts`
- `npm run test:watch` — Run tests in watch mode
- `npm run test:cov` — Run tests with coverage report
- `npm run test:debug` — Debug tests with Node inspector
- `npm run test:e2e` — Run E2E tests from `test/` directory

**Code Quality**
- `npm run lint` — Run ESLint with auto-fix on `src/` and `test/`
- `npm run format` — Format code with Prettier

**Production**
- `npm run build` then `npm run start:prod` — Build and run compiled code

## High-Level Architecture

The application follows NestJS modular architecture with three main layers:

### **Modules**
- **AppModule** — Root module that imports and configures all submodules, database, and external services
- **BcraModule** — Handles API calls to BCRA for entity status and rejected checks data; provides caching and retry logic
- **AlertsModule** — Manages user alert subscriptions and sends email notifications

### **Database Layer (TypeORM)**
- Entity: `Alert` (email, cuit, lastStatus, lastCheckedAt)
- PostgreSQL configured via `DATABASE_URL` environment variable
- `synchronize: true` in development (auto-creates tables)

### **External Integrations**
- **BCRA API** — Two endpoints:
  - `API_URL_ENTIDADES` — Entity debt status
  - `API_URL_CHEQUESRECHAZADOS` — Rejected checks
- **Email** — Nodemailer with Gmail SMTP (configurable via env)
- **Scheduled Tasks** — NestJS `@Cron` decorator runs weekly status checks (see `AlertsService.handleCron`)

### **Cross-Cutting Concerns**
- **Validation** — Global `ValidationPipe` with whitelist, transform, and forbid unknown properties
- **Interceptors** — `CuitValidatorInterceptor` validates CUIT format in BCRA requests
- **Filters** — `BcraExceptionFilter` handles BCRA-specific errors gracefully
- **Guards** — `SecurityTokenGuard` protects alert subscription endpoint with token in header

## Key Implementation Details

**BcraService** — Manages BCRA API integration:
- Simple in-memory cache (TTL: 5 minutes) per CUIT to reduce API calls
- Retry logic with exponential backoff and jitter for 429 (rate limit) and transient errors
- Parallel fetching of status and cheques data
- Handles both 404 (not found) and other errors appropriately

**AlertsService** — Manages subscriptions and notifications:
- Prevents duplicate subscriptions (same email with different CUIT raises error)
- Weekly cron checks all subscriptions for status changes
- Sends HTML-formatted emails via Nodemailer
- Detects changes by normalizing and comparing entity lists (accounts for order/type differences)

## Environment Setup

Create `.env` in the root:
```
PORT=3001
DATABASE_URL=postgres://user:password@localhost:5432/dbname
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your-email@gmail.com
MAIL_PASS=your-app-password
API_URL_ENTIDADES=https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/
API_URL_CHEQUESRECHAZADOS=https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/ChequesRechazados/
THIS_APP_URL=https://your-domain.com
FRONTEND_TOKEN=your-security-token
```

**Local Database** — Requires PostgreSQL running. Connection string format: `postgres://user:password@host:port/database`

## Testing Strategy

- **Unit tests** — Service logic, mocked database and external APIs (`*.spec.ts` files)
- **E2E tests** — HTTP endpoints against real or test database (in `test/jest-e2e.json`)
- Run single test: `npm test -- alerts.service` (matches filename)
- Run with coverage: `npm run test:cov` (output in `coverage/` directory)

## File Structure

```
src/
├── app.module.ts          # Root module configuration
├── app.controller.ts      # Health check endpoint
├── main.ts                # Entry point, validation pipe setup
├── bcra/
│   ├── bcra.module.ts
│   ├── bcra.service.ts    # BCRA API integration, caching, retries
│   ├── bcra.controller.ts # GET /bcra/status/:cuit, /cheques/:cuit
│   ├── interceptors/      # CUIT validation
│   └── filters/           # Exception handling
├── alerts/
│   ├── alerts.module.ts
│   ├── alerts.service.ts  # Subscription, cron jobs, emails
│   ├── alerts.controller.ts
│   ├── entities/          # Alert model
│   └── dto/               # SubscribeDto
└── auth/
    └── security-token.guard.ts # Token validation for protected endpoints
```

## Build & Deployment

- **Compilation** — `npm run build` outputs to `dist/`
- **Runtime** — `npm run start:prod` runs `node dist/main`
- **Docker-ready** — Node.js 18+ with npm/yarn
