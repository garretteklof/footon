# Hermarium

**A terrarium of Hermes tools.**

Hermarium is an open-source home for small, independently usable capabilities that extend Hermes workflows. Tools can live here, evolve at their own pace, and keep the runtime and dependencies that fit them.

## What belongs here

- **MCP servers** expose structured tools backed by APIs, databases, or local applications.
- **Skills** provide instructions and workflows that teach Hermes how to use tools effectively.
- **Plugins and integrations** cover extensions that do not fit either abstraction.

Components remain loosely coupled. TypeScript projects can use the Bun workspace; Python, Go, and other components can keep their native tooling. Shared packages or additional automation will be added when a real component needs them.

## Repository layout

```text
hermarium/
├── apps/
│   └── fueld_b/       # Nutrition tracking MCP server
│       ├── src/
│       │   └── db/migrations/
│       ├── tests/
│       ├── .env.example
│       └── README.md
├── package.json       # Bun workspace and root development commands
├── tsconfig.json      # Shared TypeScript defaults
├── bun.lock
├── LICENSE
└── README.md
```

Future skills can live under `skills/`; shared TypeScript libraries under `packages/`; and other extensions under `integrations/`. Those directories are added when they contain a component.

## Install and use a component

Each component documents its own requirements and setup. For `fueld_b`, you can install and run it from its package directory:

```sh
cd apps/fueld_b
bun install
cp .env.example .env
# Set FDC_API_KEY in .env
bun run start
```

The server speaks MCP over stdio. Point an MCP host at the `apps/fueld_b` package and provide `FDC_API_KEY` through its environment. If an existing Hermes MCP entry points to the app's previous location, update its working directory to `hermarium/apps/fueld_b` (or update its command to the new package path). This repository restructuring does not change any server registrations.

See [`apps/fueld_b/README.md`](apps/fueld_b/README.md) for the server's tools, database location, configuration, and host setup.

## Monorepo development

From the repository root:

```sh
bun install
bun run test
bun run typecheck
bun run start:fueld_b
```

The workspace coordinates TypeScript packages without imposing a shared runtime or dependency model on future non-TypeScript components. Local `.env` files, SQLite data, and dependency directories are excluded from Git.
