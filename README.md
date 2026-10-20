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
├── packages/
│   └── fueld_b/       # Nutrition MCP and Hermes skill
│       ├── src/
│       │   └── db/migrations/
│       ├── tests/
│       ├── skill/SKILL.md
│       ├── .env.example
│       └── README.md
├── package.json       # Bun workspace and root development commands
├── tsconfig.json      # Shared TypeScript defaults
├── bun.lock
├── LICENSE
└── README.md
```

Capabilities live in `packages/`, with related MCP servers, Hermes skills, and supporting material kept together when they belong to the same capability. Each package remains independently runnable. Non-TypeScript components can keep their native tooling.

## Install and use a component

Each component documents its own requirements and setup. For `fueld_b`, you can install and run it from its package directory:

```sh
cd packages/fueld_b
bun install
cp .env.example .env
# Set FDC_API_KEY in .env
bun run start
```

The server speaks MCP over stdio. Configure an MCP host to launch this package over stdio and provide `FDC_API_KEY` through its environment. If an existing Hermes MCP entry points to `apps/fueld_b`, update its working directory to `packages/fueld_b` (or update its command to the new package path). This repository restructuring does not change any server registrations.

See [`packages/fueld_b/README.md`](packages/fueld_b/README.md) for the server's tools, database location, configuration, and host setup.

## Monorepo development

From the repository root:

```sh
bun install
bun run test
bun run typecheck
bun run start:fueld_b
```

Install the colocated Hermes skill from the repository root with:

```sh
mkdir -p ~/.hermes/skills/nutrition
cp packages/fueld_b/skill/SKILL.md ~/.hermes/skills/nutrition/SKILL.md
```

The workspace coordinates TypeScript packages without imposing a shared runtime or dependency model on future non-TypeScript components. Local `.env` files, SQLite data, and dependency directories are excluded from Git.

## Training plans

Connect Final Surge with `bun run training connect`: choose an existing fueld_b profile, or enter your name to create the first local profile. The CLI discovers the account ID, stores credentials in the OS credential store, and syncs workouts. No sender environment variables or manual account identifiers are required. Generic training tools are included in fueld_b; a training-only MCP is also available through `bun run start:training`. See [setup and usage](packages/fueld_b/TRAINING.md).
