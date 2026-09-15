#!/usr/bin/env node
import readline from "node:readline";
import { enrichLiveTrip } from "./amap.mjs";
import { formatPlanText, planTripMeal } from "./planner.mjs";

const TOOL = {
  name: "plan_enroute_meal",
  title: "Plan an en-route meal",
  description: "Plan a time-feasible restaurant stop around a trip. Uses AMap for live driving routes when directTravelMinutes and candidateRestaurants are omitted.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["origin", "destination", "departAt", "arriveBy"],
    properties: {
      origin: { type: ["string", "object"], description: "Origin address, POI name, longitude/latitude string, or coordinate object." },
      destination: { type: ["string", "object"], description: "Destination address, POI name, longitude/latitude string, or coordinate object." },
      departAt: { type: "string", description: "ISO-8601 departure date-time with timezone." },
      arriveBy: { type: "string", description: "ISO-8601 latest acceptable arrival date-time with timezone." },
      purpose: { type: "string", description: "Trip purpose, such as class, flight, commute, leisure, or sightseeing." },
      travelMode: { type: "string", enum: ["driving"], default: "driving" },
      mealStyle: { type: "string", enum: ["takeaway", "snack", "quick_meal", "sit_down"], default: "quick_meal" },
      cuisinePreferences: { type: "array", items: { type: "string" } },
      dietaryRestrictions: { type: "array", items: { type: "string" } },
      strictDietarySafety: { type: "boolean", description: "Reject candidates whose dietary safety cannot be verified. Defaults to true for severe allergy-like restrictions." },
      arrivalBufferMinutes: { type: "number", minimum: 0, default: 10 },
      maxRouteDetourMinutes: { type: "number", minimum: 0, default: 15 },
      hardDeadline: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 5, default: 3 },
      directTravelMinutes: { type: "number", exclusiveMinimum: 0, description: "Optional offline direct-route estimate." },
      candidateRestaurants: {
        type: "array",
        description: "Optional offline candidates. When omitted, the server uses AMap live lookup.",
        items: {
          type: "object",
          required: ["name"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            address: { type: "string" },
            location: { type: "string" },
            zone: { type: "string", enum: ["origin", "route", "destination"] },
            timing: { type: "string", enum: ["before_departure", "enroute", "after_arrival"] },
            openState: { type: "string", enum: ["open", "closed", "unknown"] },
            routeViaMinutes: { type: "number", minimum: 0 },
            originLegMinutes: { type: "number", minimum: 0 },
            destinationLegMinutes: { type: "number", minimum: 0 },
            parkingMinutes: { type: "number", minimum: 0 },
            walkMinutes: { type: "number", minimum: 0 },
            queueMinutes: { type: "number", minimum: 0 },
            mealMinutes: { type: "number", minimum: 0 },
            uncertaintyMinutes: { type: "number", minimum: 0 },
            rating: { type: "number", minimum: 0, maximum: 5 },
            pricePerPerson: { type: "number", minimum: 0 },
            preferenceScore: { type: "number", minimum: 0, maximum: 1 },
            tags: { type: "array", items: { type: "string" } },
            dietaryClaims: { type: "array", items: { type: "string" } },
            dietaryConflicts: { type: "array", items: { type: "string" } }
          }
        }
      }
    }
  }
};

function resultFor(plan) {
  return { content: [{ type: "text", text: formatPlanText(plan) }], structuredContent: plan };
}

async function callTool(name, args) {
  if (name !== TOOL.name) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  const hasOfflineData = Number.isFinite(Number(args.directTravelMinutes)) && Array.isArray(args.candidateRestaurants);
  const input = hasOfflineData ? args : await enrichLiveTrip(args, process.env.AMAP_WEB_SERVICE_KEY);
  return resultFor(planTripMeal(input));
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "road-food-planner", version: "0.1.0" },
      },
    };
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: [TOOL] } };
  if (method === "tools/call") {
    const result = await callTool(params?.name, params?.arguments || {});
    return { jsonrpc: "2.0", id, result };
  }
  if (method?.startsWith("notifications/")) return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
    const response = await handle(request);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    const response = {
      jsonrpc: "2.0",
      id: request?.id ?? null,
      error: { code: error.code || -32603, message: error.message || "Internal error" },
    };
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
});

process.on("uncaughtException", (error) => {
  process.stderr.write(`road-food-planner fatal error: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
