import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { planTripMeal } from "../server/planner.mjs";

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
}

test("urgent trip rejects a popular but time-infeasible stop", async () => {
  const plan = planTripMeal(await fixture("urgent-trip.json"));
  assert.equal(plan.computed.tripMode, "urgent");
  assert.equal(plan.computed.slackMinutes, 20);
  assert.ok(plan.recommendations.some((item) => item.id === "start-noodle"));
  assert.equal(plan.rejected.find((item) => item.id === "route-hotpot")?.feasible, false);
});

test("leisure trip can rank a specialty experience above the fastest stop", async () => {
  const plan = planTripMeal(await fixture("leisure-trip.json"));
  assert.equal(plan.computed.tripMode, "leisure");
  assert.equal(plan.recommendations[0].id, "local-specialty");
  assert.ok(plan.recommendations[0].remainingBufferMinutes >= 0);
});

test("a direct trip already beyond its safe budget is marked at risk", () => {
  const plan = planTripMeal({
    origin: "A",
    destination: "B",
    departAt: "2026-09-15T10:00:00+08:00",
    arriveBy: "2026-09-15T11:00:00+08:00",
    directTravelMinutes: 58,
    arrivalBufferMinutes: 10,
    candidateRestaurants: [],
  });
  assert.equal(plan.status, "direct_trip_at_risk");
  assert.equal(plan.computed.canArriveOnTime, false);
});

test("invalid time windows fail instead of producing a recommendation", () => {
  assert.throws(() => planTripMeal({
    origin: "A",
    destination: "B",
    departAt: "2026-09-15T11:00:00+08:00",
    arriveBy: "2026-09-15T10:00:00+08:00",
    directTravelMinutes: 20,
    candidateRestaurants: [],
  }), /arriveBy must be later/);
});

test("severe allergy requirements reject unverified candidates", () => {
  const plan = planTripMeal({
    origin: "A",
    destination: "B",
    departAt: "2026-09-15T10:00:00+08:00",
    arriveBy: "2026-09-15T12:00:00+08:00",
    directTravelMinutes: 60,
    dietaryRestrictions: ["花生过敏"],
    candidateRestaurants: [{ name: "信息不完整的餐厅", routeViaMinutes: 62, openState: "open" }],
  });
  assert.equal(plan.recommendations.length, 0);
  assert.equal(plan.rejected[0].dietaryStatus, "unverified_strict");
});

test("route detour cap is enforced independently of total slack", () => {
  const plan = planTripMeal({
    origin: "A",
    destination: "B",
    departAt: "2026-09-15T08:00:00+08:00",
    arriveBy: "2026-09-15T13:00:00+08:00",
    directTravelMinutes: 90,
    maxRouteDetourMinutes: 5,
    candidateRestaurants: [{
      name: "很远但用餐很快的店",
      routeViaMinutes: 100,
      parkingMinutes: 0,
      walkMinutes: 0,
      queueMinutes: 0,
      mealMinutes: 5,
      openState: "open",
    }],
  });
  assert.equal(plan.recommendations.length, 0);
  assert.match(plan.rejected[0].rejectionReason, /超过 5 分钟上限/);
});

test("closed restaurants are rejected even when time-feasible", () => {
  const plan = planTripMeal({
    origin: "A",
    destination: "B",
    departAt: "2026-09-15T08:00:00+08:00",
    arriveBy: "2026-09-15T11:00:00+08:00",
    directTravelMinutes: 60,
    candidateRestaurants: [{ name: "已关门餐厅", routeViaMinutes: 62, openState: "closed" }],
  });
  assert.equal(plan.recommendations.length, 0);
  assert.match(plan.rejected[0].rejectionReason, /已关门/);
});

test("non-severe dietary preferences remain visible as unverified", () => {
  const plan = planTripMeal({
    origin: "A",
    destination: "B",
    departAt: "2026-09-15T08:00:00+08:00",
    arriveBy: "2026-09-15T11:00:00+08:00",
    directTravelMinutes: 60,
    dietaryRestrictions: ["素食"],
    candidateRestaurants: [{ name: "候选餐厅", routeViaMinutes: 62, openState: "open" }],
  });
  assert.equal(plan.recommendations[0].dietaryStatus, "unverified");
  assert.equal(plan.assumptions.dietaryVerificationRequired, true);
});
