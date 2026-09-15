const AMAP_BASE = "https://restapi.amap.com";

function assertOk(data, operation) {
  if (!data || String(data.status) !== "1") {
    throw new Error(`${operation} failed: ${data?.info || "unknown AMap error"}`);
  }
  return data;
}

async function getJson(path, params, { timeoutMs = 12000, fetchImpl = globalThis.fetch, baseUrl = AMAP_BASE } = {}) {
  const url = new URL(path, baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`AMap HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function parsePoint(value) {
  if (typeof value === "string" && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(value.trim())) return value.trim();
  if (value && Number.isFinite(Number(value.longitude)) && Number.isFinite(Number(value.latitude))) {
    return `${Number(value.longitude)},${Number(value.latitude)}`;
  }
  return null;
}

function sampleEvenly(points, count) {
  if (points.length <= count) return points;
  return Array.from({ length: count }, (_, index) => points[Math.round(index * (points.length - 1) / (count - 1))]);
}

function parsePolyline(path) {
  const points = [];
  for (const step of path.steps || []) {
    for (const point of String(step.polyline || "").split(";")) {
      if (point.includes(",")) points.push(point);
    }
  }
  return points;
}

function businessObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function estimateRestaurant(poi, zone, mealStyle) {
  const descriptor = `${poi.name || ""} ${poi.type || ""}`;
  const isFast = /快餐|小吃|便利店|面包|咖啡|汉堡|炸鸡|粉|面馆|饺子|包子/i.test(descriptor);
  const business = businessObject(poi.business);
  return {
    id: poi.id,
    name: poi.name,
    address: Array.isArray(poi.address) ? poi.address.join("") : poi.address,
    location: poi.location,
    zone,
    timing: zone === "destination" ? "after_arrival" : zone === "origin" ? "before_departure" : "enroute",
    openState: "unknown",
    rating: Number(business.rating) || null,
    pricePerPerson: Number(business.cost) || null,
    parkingMinutes: zone === "route" ? 6 : 4,
    walkMinutes: 3,
    queueMinutes: isFast ? 5 : 10,
    mealMinutes: mealStyle === "takeaway" ? 8 : isFast ? 16 : undefined,
    uncertaintyMinutes: 7,
    tags: String(poi.type || "").split(";").filter(Boolean),
    estimateSource: "amap_poi_plus_mvp_heuristics",
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = await mapper(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results.filter(Boolean);
}

export function createAmapClient(apiKey, options = {}) {
  if (!apiKey) throw new Error("AMAP_WEB_SERVICE_KEY is required for live planning");

  async function resolvePlace(place) {
    const coordinate = parsePoint(place);
    if (coordinate) return coordinate;
    if (typeof place !== "string" || !place.trim()) throw new Error("place must be an address or longitude/latitude");
    const data = assertOk(await getJson("/v3/geocode/geo", { key: apiKey, address: place }, options), "geocoding");
    const location = data.geocodes?.[0]?.location;
    if (!location) throw new Error(`No AMap geocode found for ${place}`);
    return location;
  }

  async function drivingRoute(origin, destination) {
    const data = assertOk(await getJson("/v5/direction/driving", {
      key: apiKey,
      origin,
      destination,
      strategy: 32,
      show_fields: "cost",
    }, options), "driving route");
    const path = data.route?.paths?.[0];
    if (!path) throw new Error("AMap returned no driving route");
    return {
      minutes: Number(path.cost?.duration || path.duration) / 60,
      distanceMeters: Number(path.distance),
      points: parsePolyline(path),
    };
  }

  async function searchAround(location, radius = 2500) {
    const data = assertOk(await getJson("/v5/place/around", {
      key: apiKey,
      location,
      radius,
      types: "050000",
      show_fields: "business",
      page_size: 10,
    }, options), "restaurant search");
    return data.pois || [];
  }

  return { resolvePlace, drivingRoute, searchAround };
}

export async function enrichLiveTrip(input, apiKey) {
  if ((input.travelMode || "driving") !== "driving") {
    throw new Error("The live MVP currently supports travelMode=driving only");
  }
  const client = createAmapClient(apiKey);
  const [originCoordinate, destinationCoordinate] = await Promise.all([
    client.resolvePlace(input.origin),
    client.resolvePlace(input.destination),
  ]);
  const direct = await client.drivingRoute(originCoordinate, destinationCoordinate);
  const routeAnchors = sampleEvenly(direct.points, 3);
  const anchors = [
    { location: originCoordinate, zone: "origin", radius: 1200 },
    ...routeAnchors.map((location) => ({ location, zone: "route", radius: 2200 })),
    { location: destinationCoordinate, zone: "destination", radius: 1200 },
  ];

  const searchGroups = await Promise.all(anchors.map(async (anchor) => ({
    anchor,
    pois: await client.searchAround(anchor.location, anchor.radius),
  })));
  const seen = new Set();
  const rawCandidates = [];
  for (const { anchor, pois } of searchGroups) {
    let addedForAnchor = 0;
    for (const poi of pois) {
      if (!poi.id || !poi.location || seen.has(poi.id)) continue;
      seen.add(poi.id);
      rawCandidates.push(estimateRestaurant(poi, anchor.zone, input.mealStyle || "quick_meal"));
      addedForAnchor += 1;
      if (addedForAnchor >= 2 || rawCandidates.length >= 10) break;
    }
    if (rawCandidates.length >= 10) break;
  }

  const candidates = await mapWithConcurrency(rawCandidates, 3, async (candidate) => {
    if (candidate.timing === "after_arrival") return { ...candidate, routeViaMinutes: direct.minutes };
    const [firstLeg, secondLeg] = await Promise.all([
      client.drivingRoute(originCoordinate, candidate.location),
      client.drivingRoute(candidate.location, destinationCoordinate),
    ]);
    return { ...candidate, originLegMinutes: firstLeg.minutes, destinationLegMinutes: secondLeg.minutes };
  });

  return {
    ...input,
    directTravelMinutes: direct.minutes,
    candidateRestaurants: candidates,
    provider: "amap",
    providerCoordinates: { origin: originCoordinate, destination: destinationCoordinate },
  };
}
