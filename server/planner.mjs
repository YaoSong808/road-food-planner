const DEFAULTS = Object.freeze({
  arrivalBufferMinutes: 10,
  maxRouteDetourMinutes: 15,
  parkingMinutes: 5,
  walkMinutes: 4,
  queueMinutes: 8,
  uncertaintyMinutes: 5,
});

const MEAL_MINUTES = Object.freeze({
  takeaway: 8,
  snack: 10,
  quick_meal: 20,
  sit_down: 45,
});

const HARD_DEADLINE_PATTERN = /flight|airport|train|rail|class|exam|interview|doctor|hospital|appointment|must|飞机|机场|高铁|火车|上课|考试|面试|就医|医院|预约|必须|赶时间/i;

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegative(value, fallback = 0) {
  return Math.max(0, finiteNumber(value, fallback));
}

function minutesBetween(start, end) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error("departAt and arriveBy must be valid ISO-8601 date-time strings");
  }
  const minutes = (endMs - startMs) / 60000;
  if (minutes <= 0) throw new Error("arriveBy must be later than departAt");
  return minutes;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finiteNumber(value, 0)));
}

function cuisineMatch(candidate, preferences = []) {
  if (!preferences.length) return 0.6;
  const haystack = [candidate.name, ...(candidate.tags || [])].join(" ").toLowerCase();
  return preferences.some((item) => haystack.includes(String(item).toLowerCase())) ? 1 : 0.25;
}

function convenienceScore(candidate) {
  const access = nonNegative(candidate.parkingMinutes, DEFAULTS.parkingMinutes)
    + nonNegative(candidate.walkMinutes, DEFAULTS.walkMinutes)
    + nonNegative(candidate.queueMinutes, DEFAULTS.queueMinutes);
  return clamp01(1 - access / 45);
}

function reasonForRejection({ openState, dietaryStatus, routeDetourMinutes, maxRouteDetourMinutes, stopImpactMinutes, slackMinutes }) {
  if (openState === "closed") return "餐厅在计划到店时间预计已关门";
  if (dietaryStatus === "conflict") return "餐厅信息与本次饮食硬限制冲突";
  if (dietaryStatus === "unverified_strict") return "无法核实严重过敏或饮食安全要求";
  if (routeDetourMinutes > maxRouteDetourMinutes) {
    return `路线额外绕行 ${Math.round(routeDetourMinutes)} 分钟，超过 ${Math.round(maxRouteDetourMinutes)} 分钟上限`;
  }
  if (stopImpactMinutes > slackMinutes) {
    return `预计占用 ${Math.round(stopImpactMinutes)} 分钟，但行程只有 ${Math.max(0, Math.round(slackMinutes))} 分钟余量`;
  }
  return "不满足本次行程的硬约束";
}

function normalizeCandidate(candidate, input, computed) {
  const mealMinutes = nonNegative(candidate.mealMinutes, MEAL_MINUTES[input.mealStyle] ?? MEAL_MINUTES.quick_meal);
  const parkingMinutes = nonNegative(candidate.parkingMinutes, DEFAULTS.parkingMinutes);
  const walkMinutes = nonNegative(candidate.walkMinutes, DEFAULTS.walkMinutes);
  const queueMinutes = nonNegative(candidate.queueMinutes, DEFAULTS.queueMinutes);
  const uncertaintyMinutes = nonNegative(candidate.uncertaintyMinutes, DEFAULTS.uncertaintyMinutes);
  const timing = candidate.timing || "enroute";

  let routeViaMinutes = finiteNumber(candidate.routeViaMinutes, NaN);
  if (!Number.isFinite(routeViaMinutes)) {
    const firstLeg = finiteNumber(candidate.originLegMinutes, NaN);
    const secondLeg = finiteNumber(candidate.destinationLegMinutes, NaN);
    if (Number.isFinite(firstLeg) && Number.isFinite(secondLeg)) routeViaMinutes = firstLeg + secondLeg;
  }
  if (!Number.isFinite(routeViaMinutes)) routeViaMinutes = computed.directTravelMinutes;

  const routeDetourMinutes = timing === "after_arrival" ? 0 : Math.max(0, routeViaMinutes - computed.directTravelMinutes);
  const serviceMinutes = parkingMinutes + walkMinutes + queueMinutes + mealMinutes;
  const stopImpactMinutes = timing === "after_arrival" ? 0 : routeDetourMinutes + serviceMinutes;
  const postArrivalMealMinutes = timing === "after_arrival" ? serviceMinutes : 0;
  const openState = candidate.openState || "unknown";
  const dietaryRestrictions = input.dietaryRestrictions || [];
  const dietaryClaims = candidate.dietaryClaims || [];
  const dietaryConflicts = candidate.dietaryConflicts || [];
  const claimText = dietaryClaims.join(" ").toLowerCase();
  const conflictText = dietaryConflicts.join(" ").toLowerCase();
  const hasConflict = dietaryRestrictions.some((item) => conflictText.includes(String(item).toLowerCase()));
  const dietaryVerified = dietaryRestrictions.length > 0
    && dietaryRestrictions.every((item) => claimText.includes(String(item).toLowerCase()));
  const strictDietarySafety = input.strictDietarySafety
    ?? dietaryRestrictions.some((item) => /allergy|allergic|celiac|anaphyl|过敏|乳糜/i.test(String(item)));
  const dietaryStatus = dietaryRestrictions.length === 0
    ? "not_applicable"
    : hasConflict
      ? "conflict"
      : dietaryVerified
        ? "verified"
        : strictDietarySafety
          ? "unverified_strict"
          : "unverified";
  const dietaryPass = !["conflict", "unverified_strict"].includes(dietaryStatus);
  const feasible = openState !== "closed" && dietaryPass && (
    timing === "after_arrival"
      ? computed.canArriveOnTime
      : routeDetourMinutes <= computed.maxRouteDetourMinutes && stopImpactMinutes <= computed.slackMinutes
  );

  const preferenceScore = candidate.preferenceScore == null
    ? cuisineMatch(candidate, input.cuisinePreferences)
    : clamp01(candidate.preferenceScore);
  const ratingScore = clamp01(nonNegative(candidate.rating, 3.5) / 5);
  const timeScore = timing === "after_arrival" ? 0.72 : clamp01(1 - stopImpactMinutes / Math.max(computed.slackMinutes, 1));
  const convenience = convenienceScore(candidate);
  const uncertaintyPenalty = clamp01(uncertaintyMinutes / 45);
  const weights = computed.tripMode === "urgent"
    ? { time: 0.55, preference: 0.2, rating: 0.15, convenience: 0.1 }
    : { time: 0.25, preference: 0.4, rating: 0.25, convenience: 0.1 };
  const score = feasible
    ? weights.time * timeScore + weights.preference * preferenceScore + weights.rating * ratingScore
      + weights.convenience * convenience - 0.08 * uncertaintyPenalty
    : -1;
  const remainingBufferMinutes = timing === "after_arrival" ? computed.slackMinutes : computed.slackMinutes - stopImpactMinutes;

  return {
    id: candidate.id || candidate.name,
    name: candidate.name || "未命名餐厅",
    address: candidate.address || null,
    location: candidate.location || null,
    zone: candidate.zone || (timing === "after_arrival" ? "destination" : "route"),
    timing,
    openState,
    rating: candidate.rating == null ? null : finiteNumber(candidate.rating, null),
    pricePerPerson: candidate.pricePerPerson == null ? null : nonNegative(candidate.pricePerPerson),
    tags: candidate.tags || [],
    dietaryClaims,
    dietaryStatus,
    routeViaMinutes: Math.round(routeViaMinutes * 10) / 10,
    routeDetourMinutes: Math.round(routeDetourMinutes * 10) / 10,
    parkingMinutes,
    walkMinutes,
    queueMinutes,
    mealMinutes,
    uncertaintyMinutes,
    serviceMinutes,
    stopImpactMinutes: Math.round(stopImpactMinutes * 10) / 10,
    postArrivalMealMinutes,
    remainingBufferMinutes: Math.round(remainingBufferMinutes * 10) / 10,
    feasible,
    score: Math.round(score * 1000) / 1000,
    rejectionReason: feasible ? null : reasonForRejection({
      openState,
      dietaryStatus,
      routeDetourMinutes,
      maxRouteDetourMinutes: computed.maxRouteDetourMinutes,
      stopImpactMinutes,
      slackMinutes: computed.slackMinutes,
    }),
    estimateSource: candidate.estimateSource || "default_or_user_input",
  };
}

export function planTripMeal(input) {
  if (!input || typeof input !== "object") throw new Error("input must be an object");
  if (!input.origin || !input.destination) throw new Error("origin and destination are required");

  const tripWindowMinutes = minutesBetween(input.departAt, input.arriveBy);
  const directTravelMinutes = nonNegative(input.directTravelMinutes, NaN);
  if (!Number.isFinite(directTravelMinutes) || directTravelMinutes <= 0) {
    throw new Error("directTravelMinutes must be greater than zero");
  }

  const arrivalBufferMinutes = nonNegative(input.arrivalBufferMinutes, DEFAULTS.arrivalBufferMinutes);
  const maxRouteDetourMinutes = nonNegative(input.maxRouteDetourMinutes, DEFAULTS.maxRouteDetourMinutes);
  const slackMinutes = tripWindowMinutes - directTravelMinutes - arrivalBufferMinutes;
  const hardDeadline = input.hardDeadline ?? HARD_DEADLINE_PATTERN.test(input.purpose || "");
  const tripMode = hardDeadline || slackMinutes <= 30 ? "urgent" : "leisure";
  const computed = {
    tripWindowMinutes,
    directTravelMinutes,
    arrivalBufferMinutes,
    maxRouteDetourMinutes,
    slackMinutes,
    canArriveOnTime: slackMinutes >= 0,
    hardDeadline,
    tripMode,
  };

  const evaluated = (input.candidateRestaurants || []).map((candidate) => normalizeCandidate(candidate, input, computed));
  const recommendations = evaluated
    .filter((candidate) => candidate.feasible)
    .sort((a, b) => b.score - a.score || b.remainingBufferMinutes - a.remainingBufferMinutes)
    .slice(0, Math.max(1, Math.min(5, finiteNumber(input.limit, 3))));
  const rejected = evaluated.filter((candidate) => !candidate.feasible);
  const preArrivalRecommendations = recommendations.filter((item) => item.timing !== "after_arrival");

  let status = "recommended";
  if (!computed.canArriveOnTime) status = "direct_trip_at_risk";
  else if (!preArrivalRecommendations.length && recommendations.some((item) => item.timing === "after_arrival")) status = "arrival_only";
  else if (!recommendations.length) status = "no_feasible_meal";

  return {
    status,
    origin: input.origin,
    destination: input.destination,
    departAt: input.departAt,
    arriveBy: input.arriveBy,
    purpose: input.purpose || null,
    travelMode: input.travelMode || "driving",
    mealStyle: input.mealStyle || "quick_meal",
    computed: Object.fromEntries(Object.entries(computed).map(([key, value]) => [
      key,
      typeof value === "number" ? Math.round(value * 10) / 10 : value,
    ])),
    recommendations,
    rejected,
    assumptions: {
      queueParkingAndWalkingAreEstimates: true,
      unknownOpeningStatusRequiresVerification: recommendations.some((item) => item.openState === "unknown"),
      dietaryVerificationRequired: recommendations.some((item) => item.dietaryStatus === "unverified"),
    },
  };
}

export function formatPlanText(plan) {
  const c = plan.computed;
  const lines = [`直达预计 ${Math.round(c.directTravelMinutes)} 分钟；保留 ${Math.round(c.arrivalBufferMinutes)} 分钟安全缓冲后，可支配余量为 ${Math.round(c.slackMinutes)} 分钟。`];

  if (plan.status === "direct_trip_at_risk") {
    lines.push("即使不停车也存在迟到风险，不建议安排途中就餐。请优先调整出发时间或到达后再吃。");
  } else if (plan.status === "no_feasible_meal") {
    lines.push("当前候选中没有满足时间约束的途中就餐方案。建议在起点快速取餐或到达后再吃。");
  } else if (plan.status === "arrival_only") {
    lines.push("途中停留会压缩安全余量，本次只建议到达后就餐。");
  }

  plan.recommendations.forEach((item, index) => {
    const timing = item.timing === "after_arrival" ? "到达后" : item.timing === "before_departure" ? "出发前" : "沿途";
    const availability = item.openState === "unknown" ? "；营业状态待确认" : "";
    if (item.timing === "after_arrival") {
      lines.push(`${index + 1}. ${item.name}（${timing}）：预计用餐相关耗时 ${Math.round(item.postArrivalMealMinutes)} 分钟${availability}。`);
    } else {
      lines.push(`${index + 1}. ${item.name}（${timing}）：绕路 ${Math.round(item.routeDetourMinutes)} 分钟，总停靠影响 ${Math.round(item.stopImpactMinutes)} 分钟，仍余 ${Math.round(item.remainingBufferMinutes)} 分钟${availability}。`);
    }
  });
  return lines.join("\n");
}

export const plannerDefaults = DEFAULTS;
