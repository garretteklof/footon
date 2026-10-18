---
name: nutrition
description: >
  Conversational food logging, USDA nutrient analysis, meal tracking,
  and personalized nutrition insights using the fueld_b MCP server.
  Use when users describe meals, log food, ask about dietary intake,
  review nutrients, or discuss fueling and nutrition goals.
metadata:
  hermes:
    tags: [nutrition, food, diet, macros, micronutrients, fueling]
    category: health
---

# Nutrition

Provide frictionless, accurate, personalized nutrition tracking through
the `fueld_b` MCP server.

## Principles

- Minimize friction. Food logging should feel like a conversation.
- Prefer reasonable estimates over unnecessary clarification.
- Never present estimated quantities as measured facts.
- Use MCP tools for nutrient calculations and persistence.
- Never invent nutritional values.
- Never equate missing nutrient data with zero.
- Keep each user's nutrition history separate.
- Resolve the sender identity before using nutrition history or logging.
- Do not duplicate information already stored in `fueld_b`.
- Be concise by default; provide detailed analysis when requested.

## Food Logging

Before nutrition operations, call `resolve_identity` with the current
platform and the stable sender identifier supplied by Hermes. Use
`imessage` for iMessage and `hermex` for Hermex. Pass `externalId` exactly
as provided; do not use a display name or guess from conversation text.
Use the returned `userId` for food logging, summaries, corrections,
deletions, and timezone settings. Reuse that resolved user for the same
sender instead of asking who is logging each time.

If the resolver returns `created: true`, it created a new independent
profile for this previously unknown sender. Never attach that sender to
another user's profile based on a name, phone contact label, or message
content. To share history across iMessage and Hermex, call `link_identity`
with the existing user's `userId` and the other platform's verified
sender identifier, and only after the user confirms both identities are
theirs. Link the other identity before it has been resolved separately;
the MCP does not silently reassign identities already mapped to another
profile. If it has already been resolved to a separate profile, explain
that the histories remain separate; this server does not merge profiles.

If Hermes does not provide a stable sender identifier in the current
context, ask for the needed identity once rather than guessing or asking
which user should own every food entry.

When a user describes food they consumed, determine whether they intend
to log it.

Examples:

- "I had oatmeal and two eggs for breakfast."
- "Just ate a banana."
- "Log 200g of salmon."
- "Had another glass of milk."

For clear logging intent:

1. Identify individual foods and quantities.
2. Search USDA through `fueld_b`.
3. Select the most appropriate food records.
4. Calculate nutrients using the MCP.
5. Log consumption to the appropriate user's account.
6. Confirm briefly with calories and macronutrients.

Do not ask for confirmation before routine logging unless the entry is
substantially ambiguous or potentially incorrect.

For informational questions such as "How much protein is in salmon?",
provide nutritional information without logging anything.

## Food Identification

Prioritize:

1. Exact food and preparation matches.
2. Appropriate generic USDA equivalents.
3. Reasonable substitutions when exact matches are unavailable.

Consider:

- Raw versus cooked weight.
- Cooking method.
- Added oils, butter, sauces, and condiments.
- Branded versus generic products.
- Serving sizes and edible portions.

Do not silently substitute substantially different foods.

When a food cannot be identified reliably, explain the uncertainty
and request clarification if necessary.

## Portion Estimation

Use explicit quantities whenever provided.

Examples:

- 200 g cooked rice
- Two large eggs
- One cup of 2% milk
- One medium banana

When quantities are unspecified, estimate typical portions using
available context.

Clearly distinguish estimates from measured amounts.

Do not repeatedly ask users for precise measurements when a reasonable
estimate would suffice.

Ask for clarification when uncertainty would materially affect the
nutritional calculation.

For photos, treat portion estimates as approximate.

## Meal Handling

Support conversational descriptions of entire meals.

Example:

"I had three eggs, two slices of toast, and a banana."

Identify and log the individual components.

Preserve meal context when supported by the MCP.

Avoid creating duplicate entries when a user repeats or clarifies
a previous message.

### Corrections

Interpret corrections as modifications to existing entries.

Example:

"Actually, it was four eggs."

Find the original entry in the user's nutrition summary and use its
exact `id` as `entryId` with `update_entry`. Keep the correct `userId`.
Use `quantityG` for a corrected amount in grams and `consumedAt` for a
corrected time. A quantity or time correction preserves the entry's
stored nutrient snapshot; do not fetch USDA again for those corrections.

Change `fdcId` only when the user explicitly identifies a different food
or approves a proposed selection. Select the exact USDA result first and
pass its FDC ID. Never silently replace a food with another record. The
explicitly selected record supplies the corrected entry's new nutrient
snapshot.

If an entry cannot be identified unambiguously, ask which entry they mean
instead of changing or duplicating records.

Never treat a correction as additional consumption unless the user
explicitly indicates that.

## Nutrition Summaries

When asked about daily intake, retrieve the user's actual records
from `fueld_b`.

Summarize:

- Total calories
- Carbohydrates
- Protein
- Fat
- Fiber, when available
- Relevant micronutrients, when available

For micronutrients, prioritize:

- Iron
- Calcium
- Magnesium
- Potassium
- Sodium
- Vitamin D
- Vitamin B12
- Folate

Distinguish between:

- Nutrients measured or reported in source data.
- Nutrients estimated from food composition.
- Nutrients with incomplete coverage.

Never interpret incomplete micronutrient totals as evidence of
deficiency.

Use the user's local timezone for daily boundaries when supported.
Do not assume UTC calendar days correspond to the user's local day.

## Historical Analysis

When historical records are available, evaluate:

- Average daily calorie intake.
- Carbohydrate and protein consistency.
- Changes in intake over time.
- Differences between training and rest days.
- Recurring nutritional gaps.
- Meal timing and distribution.

Do not infer long-term dietary patterns from isolated days.

If the MCP does not expose historical queries, do not invent results.

## Athletic Nutrition

When relevant, contextualize nutrition against training demands.

Use Garmin data when available and appropriate.

Consider:

- Training duration and intensity.
- Recent training volume.
- Recovery requirements.
- Carbohydrate availability.
- Protein distribution.
- Hydration and sodium intake.
- Race preparation and fueling.

Avoid treating Garmin calorie expenditure estimates as exact.

Do not automatically prescribe calorie deficits based on estimated
exercise expenditure.

For endurance athletes, prioritize adequate energy availability
and recovery.

Treat signs of persistent underfueling, illness, or injury cautiously.
Do not diagnose medical conditions from food logs or wearable data.

## Multiple Users

Support independent nutrition histories for any number of users.

Use trusted messaging-platform identity information to determine
which nutrition account applies.

Never infer authorization solely from:

- Display names.
- Message content.
- A user ID suggested by the language model.
- Previous conversation context.

If trusted identity information is unavailable, do not perform
account-specific writes or disclose private nutrition records.

Do not link separate messaging identities without verified ownership
and appropriate authorization.

In group conversations:

- Attribute food to the actual sender.
- Do not log another participant's consumption without authorization.
- Do not disclose another user's private nutrition history without
  appropriate permission.
- Allow explicitly shared meals to be logged separately for each
  authorized participant.

A skill does not enforce authorization. The MCP or trusted messaging
integration must enforce account access.

## Data Integrity

Treat `fueld_b` as the source of truth for food consumption.

Use USDA as the nutritional reference source.

Preserve historical nutrient snapshots when logging.

Avoid duplicate entries.

Do not fabricate successful writes.

If an MCP operation fails, report the failure rather than claiming
the food was logged.

Never modify or delete historical records without clear user intent.

For a clear request to remove a logged item, identify its exact `id` from
the user's history and call `delete_entry` with that `entryId` and the
same user's `userId`. Deletion is permanent; do not delete an entry when
the target is ambiguous. Confirm only after the tool reports success.

## Communication

Keep routine interactions brief.

Example:

User: "Had two eggs and a banana."

Response:
"Logged: 2 eggs and 1 banana.
Approximately 250 kcal — 13g protein, 28g carbs, 10g fat."

Use actual MCP results rather than these illustrative values.

For detailed questions, provide more comprehensive nutritional
analysis.

Avoid repetitive disclaimers and unnecessary follow-up questions.

## Tool Usage

Use the `fueld_b` MCP server for:

- Resolving sender identities with `resolve_identity` before accessing nutrition data.
- Linking verified iMessage and Hermex identities with `link_identity` when they should share one profile.
- USDA food searches.
- Food nutrient retrieval.
- Food logging.
- Correcting existing food entries with `update_entry`.
- Deleting entries with `delete_entry` after clear user intent.
- Daily nutrition summaries.
- User identity resolution.
- Historical records, where supported.

Discover the available MCP tool names and schemas before invoking them.

Do not assume an operation exists simply because it is described
in this skill.

Use the MCP's validated inputs and outputs rather than manually
constructing SQL queries.

Do not use arbitrary shell commands to modify the nutrition database.

## Scope

This skill handles nutrition tracking and nutritional interpretation.

A broader fitness-coaching skill may coordinate:

- Garmin training data.
- Workout recommendations.
- Recovery analysis.
- Training periodization.
- Nutrition and fueling.

Keep detailed training methodology in that coaching skill rather
than duplicating it here.
