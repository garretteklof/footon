# Footon

Bun monorepo for independent nutrition and training services, composed by a local Hermes MCP application.

## Packages and skills

- [Garmin client](packages/garmin/README.md)
- [Fuel](packages/fuel/README.md) — nutrition, FoodData Central, and food logs.
- [Blocks](packages/blocks/README.md) — training plans and Final Surge.
- [MCP application](mcp/README.md) — trusted local composition for Hermes.
- [Nutrition skill](.agents/skills/nutrition/SKILL.md)
- [Training skill](.agents/skills/training/SKILL.md)

## Quick start

Install dependencies with `bun install`. Configure the MCP application, then start it with `bun run start:mcp`. The legacy `bun run start:fueld_b` command remains available for existing Hermes settings.

Run workspace checks with `bun run typecheck` and `bun run test`. The Fuel and Blocks `check` scripts run typecheck, lint, build, and tests.
