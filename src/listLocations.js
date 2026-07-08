/**
 * listLocations.js
 * Pulls all Square locations and saves them to output/locations.json.
 *
 * READ-ONLY — uses only GET endpoints. No mutations.
 * Credentials must be set in .env (never in source).
 */

import * as dotenv from "dotenv";
import { Client, Environment } from "square";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../output");
const OUTPUT_FILE = resolve(OUTPUT_DIR, "locations.json");

// Safety check — never print or log the token
if (!process.env.SQUARE_ACCESS_TOKEN) {
  console.error("❌  SQUARE_ACCESS_TOKEN is not set. Copy .env.example to .env and fill in your token.");
  process.exit(1);
}

const env = process.env.SQUARE_ENVIRONMENT === "sandbox"
  ? Environment.Sandbox
  : Environment.Production;

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: env,
});

async function main() {
  console.log(`🔗  Connecting to Square (${process.env.SQUARE_ENVIRONMENT ?? "production"})...`);

  const response = await client.locationsApi.listLocations();

  if (response.errors && response.errors.length > 0) {
    console.error("❌  Square API errors:", JSON.stringify(response.errors, null, 2));
    process.exit(1);
  }

  const locations = response.result.locations ?? [];
  console.log(`✅  Found ${locations.length} location(s).`);

  // Sanitize: strip any fields that contain sensitive/internal data we don't need
  const clean = locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    status: loc.status,
    address: loc.address ?? null,
    timezone: loc.timezone ?? null,
    phone_number: loc.phoneNumber ?? null,
    business_hours: loc.businessHours ?? null,
    coordinates: loc.coordinates ?? null,
    country: loc.country ?? null,
    currency: loc.currency ?? null,
  }));

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(clean, null, 2));
  console.log(`📄  Saved to output/locations.json (${clean.length} locations)`);
  clean.forEach((l) => console.log(`    • [${l.id}] ${l.name} — ${l.status}`));
}

main().catch((err) => {
  console.error("❌  Unexpected error:", err.message ?? err);
  process.exit(1);
});
