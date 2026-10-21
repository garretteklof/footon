# Garmints — Agent Instructions

## Project purpose

Garmints is a Bun-first, ESM-only TypeScript client for the unofficial Garmin Connect API. Keep the repository focused on the package's public API, authentication and token persistence, shared transport, typed domain APIs, workout construction, tests, build tooling, documentation, and legal notices.

## Architecture

- Expose one public `Garmin` class with domain API namespaces.
- Let `Garmin` own authentication state, token refresh, authenticated requests, and profile/settings caches.
- Keep OAuth2 protocols and token storage in `src/auth/`. Keep HTTP execution, retries, cookies, and response errors in `src/http/`.
- Keep Garmin operations in `src/api/`. Each domain module owns its API factory, method names, and implementations. Do not add a central registry or generic method binder.
- Give each API factory a small typed context with only the authenticated request, transfer, or profile capabilities it needs. Do not expose lifecycle methods or token state to domain APIs.
- Keep endpoint definitions and response types focused and internally cohesive.
- Keep shared response/request models in domain-specific `src/types/` modules; keep implementation-only types beside their implementation. Nutrition Connect+ method names belong to nutrition types, and user-profile response models belong to `types/userProfile.ts`.
- Keep local workout construction and exercise helpers in `src/workouts/`; keep authenticated workout API operations in `src/api/workouts.ts`, data models in `src/types/workouts.ts`, and static lookup data in `src/constants/`. Keep the exercise-cactalogue package entry separate so the root runtime bundle does not load its data.
- Keep Garmin workout lookup tables in `src/constants/workouts.ts`; keep workout request/response models in `src/types/workouts.ts`.
- Reuse the authenticated transport and retain `request<T>()` for endpoints without a named domain method.
- Keep only useful, working endpoint coverage; remove duplicate APIs, dead code, compatibility wrappers, and speculative infrastructure.
- Preserve workout construction and the exercise catalogue where they provide user value.
- Expose only intentional package entry points. Do not add CommonJS, a CLI, server, MCP integration, or application framework.

## Authentication and data safety

- Use Garmin's current DI OAuth2 authentication flow, including MFA continuation, token refresh, and persistent token storage.
- Keep credentials, session cookies, and tokens out of source, logs, tests with real values, and final reports.
- Never make live Garmin calls without explicit user authorization.
- Never create, change, or delete Garmin account data.
- Keep tests isolated with injected mocks and deterministic local fixtures.
- Do not modify unrelated systems.

## Runtime and tooling

- Use Bun for package management, scripts, builds, and `bun:test`.
- Use extensionless imports in TypeScript source. Use relative imports for modules in the same directory. Use `@/` aliases for cross-directory imports only when the specifier does not appear in emitted declarations; keep declaration-bearing imports relative so package consumers can resolve them without Garmints' private alias. Preserve `import type` and `export type` where appropriate.
- Build JavaScript only with `bun build`, using `src/index.ts` and `src/workouts/exercises.ts` as entry points, `--target node`, and `--format esm`. Use TypeScript only for typechecking and declaration generation.
- Emit declarations under `dist/types`. The generated declaration folder has a CommonJS package scope so NodeNext consumers can resolve extensionless relative declaration imports; the published runtime remains ESM-only.
- Do not add third-party JavaScript bundlers, custom import rewriters, compatibility polyfills, or build tooling that Bun and TypeScript do not need. Keep Bun output as valid ESM and verify that published declarations resolve for external NodeNext consumers.
- Publish ESM JavaScript and TypeScript declarations only.
- Support Node.js 24 and later; do not add runtime or peer dependencies without a concrete need.
- Keep TypeScript, lint, test, build, CI, and maintenance configuration minimal and justified.

## Repository and authority boundaries

- Do not run Git commands or perform any Git operation.
- Do not publish or deploy the package.
- Preserve applicable license, copyright, and third-party attribution notices; do not invent licensing terms.
- Routine cleanup and implementation choices are authorized when they stay within this project's purpose and the safety limits above. Ask only when a decision genuinely requires the user's authority.
- Update `README.md`, focused supporting documentation, and `WORKLOG.md` to match the actual public API and verified state.
- User edits are authoritative. Never recreate deliberately removed files or reverse manual changes to architecture, naming, imports, or organization. Reinspect current files before editing. If an apparent conflict arises between an earlier plan and the current repository, preserve the current state or ask for clarification.

## Verification

- Run TypeScript typecheck, ESLint, a clean ESM build with declaration generation, and the complete Bun test suite.
- Verify package entry points using the built package in Bun and supported Node.
- Clearly distinguish mocked verification from live verification. Do not claim checks that were not run.
- Inspect source, package contents, generated output, documentation, scripts, configuration, and the full repository tree for stale or unnecessary material.
