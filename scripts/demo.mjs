import { readFile } from "node:fs/promises";
import { formatPlanText, planTripMeal } from "../server/planner.mjs";

const fixturePath = process.argv[2] || "fixtures/urgent-trip.json";
const input = JSON.parse(await readFile(fixturePath, "utf8"));
const plan = planTripMeal(input);
process.stdout.write(`${formatPlanText(plan)}\n\n${JSON.stringify(plan, null, 2)}\n`);
