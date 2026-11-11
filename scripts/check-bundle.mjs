#!/usr/bin/env node
// Performance budget (frontend plan §11): reads `next build` output on stdin and fails when any
// route's First Load JS, or the JS shared by all routes, is over budget.
//   pnpm --filter @hirevine/manager build | node scripts/check-bundle.mjs --route 550 --shared 110
import { readFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((a) => a.trim().split(/\s+/)));
const routeBudget = Number(args.route ?? 300);
const sharedBudget = Number(args.shared ?? 110);
const out = readFileSync(0, "utf8");
process.stdout.write(out);

const kb = (s) => (s.endsWith("MB") ? parseFloat(s) * 1024 : s.endsWith("kB") ? parseFloat(s) : parseFloat(s) / 1024);
const routes = [...out.matchAll(/^[┌├└]\s+[○ƒ●]\s+(\S+)\s+[\d.]+\s*(?:B|kB|MB)\s+([\d.]+\s*(?:B|kB|MB))/gm)].map((m) => ({
  route: m[1],
  firstLoad: kb(m[2].replace(/\s+/g, "")),
}));
const shared = out.match(/First Load JS shared by all\s+([\d.]+\s*(?:B|kB|MB))/);
if (!routes.length || !shared) {
  console.error("check-bundle: could not find the route table in the build output");
  process.exit(1);
}
const sharedKb = kb(shared[1].replace(/\s+/g, ""));
const over = routes.filter((r) => r.firstLoad > routeBudget);
console.log(`\nBundle budget: routes ≤ ${routeBudget} kB (largest ${Math.max(...routes.map((r) => r.firstLoad))} kB), shared ≤ ${sharedBudget} kB (${sharedKb} kB)`);
if (over.length || sharedKb > sharedBudget) {
  for (const r of over) console.error(`  over budget: ${r.route} ${r.firstLoad} kB`);
  if (sharedKb > sharedBudget) console.error(`  shared JS ${sharedKb} kB is over ${sharedBudget} kB`);
  process.exit(1);
}
