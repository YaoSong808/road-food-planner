---
name: plan-enroute-meal
description: Plan where and when to eat around a trip when the user provides or implies an origin, destination, schedule, travel purpose, or detour constraint. Use for route-aware restaurant recommendations; do not use for ordinary restaurant discovery with no trip context.
---

# Plan an en-route meal

Protect the trip objective before optimizing food preference. A popular restaurant is not a valid recommendation when its total stop cost creates an unacceptable lateness risk.

## Workflow

1. Identify the origin, destination, departure time or current time, latest arrival time, travel mode, trip purpose, and any hard dietary restriction. Reuse stated or reliably available context instead of asking again.
2. If the latest arrival time is missing and timing could change the answer, ask one concise question for it. Otherwise make conservative defaults and state them.
3. Call `plan_enroute_meal` once with all known constraints. For the MVP, live map lookup supports driving trips in mainland China through AMap. Offline candidate estimates are also accepted for testing.
4. Treat the tool's feasibility result as authoritative. Never promote a rejected candidate merely because it matches cuisine or rating preferences.
5. Present no more than three choices. For each, show its meal timing, added route time, estimated total stop cost, and remaining arrival buffer.
6. If no stop is feasible, say so directly and offer an origin-side takeaway or destination-side option. Do not invent an en-route restaurant.

## Questions

Ask only for information that can change the decision. The preferred order is:

1. hard arrival deadline;
2. hard dietary restriction or allergy;
3. maximum acceptable route detour;
4. cuisine and price preference.

Ask at most one high-value follow-up at a time. When the deadline and direct travel time already show a tight trip, do not ask broad taste questions before explaining the time constraint.

## Response behavior

- Distinguish route detour from the full stop cost. The full cost also includes parking, walking, queueing, food preparation, and eating.
- Label estimates as estimates, especially queue and parking time.
- For classes, flights, trains, interviews, medical appointments, and other hard deadlines, retain the configured safety buffer.
- Treat a destination-side `after_arrival` option as eating after arrival, not as proof that there is time to eat before the event.
- Never claim a store is open unless the provider returned a known-open state. Unknown availability must be disclosed.

When modifying or auditing the decision policy, read [references/product-rules.md](references/product-rules.md).
