/**
 * Every path this app can emit must be a path the backend actually serves.
 *
 * The mobile twin of web/tests/services/route-inventory.test.ts, and mobile is
 * where this class of bug was worst. On 2026-10-06 `jobs.ts` called
 * `GET /jobs/me` — a route that has never existed — and sent `{ reason }` to the
 * cancel endpoint, whose schema declares `cancellation_reason` and sets
 * `extra="forbid"`, so every cancellation was a 422 naming the field. Neither was
 * caught, because nothing here checked a path against the backend's route list.
 *
 * `tests/fixtures/backend-routes.json` is generated from the backend's own
 * `app.openapi()`. When this fails, either a call is wrong or the fixture is stale:
 *
 *     cd backend && python tools/export_routes.py
 *
 * A stale fixture failing loudly is the point. A test that pings a running server
 * passes vacuously the moment nobody is running one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import inventory from "../fixtures/backend-routes.json";

const SRC = join(__dirname, "..", "..", "src");
const SERVED = new Set<string>(inventory.routes as string[]);
const API_PREFIX = "/api/v1";

interface CallSite {
  file: string;
  method: string;
  path: string;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** `/jobs/${id}/cancel` → `/jobs/{x}/cancel`, and the fixture the same way. */
function normalise(path: string): string {
  return path
    .split("?")[0]
    .replace(/\$\{[^}]*\}/g, "{x}")
    .replace(/\{[^}]*\}/g, "{x}")
    .replace(/([^/]){x}$/, "$1");
}

/**
 * Find `apiClient.get("/path")` / `.post("/path", body)` call sites.
 *
 * Mobile uses axios, so the method is part of the call rather than an options
 * field — which makes this scan simpler than web's. The trailing context is not
 * captured at all, so there is no risk of the consuming-group bug that made the
 * first version of web's scan skip two call sites in four.
 */
function collectCallSites(): CallSite[] {
  const sites: CallSite[] = [];
  const call = /apiClient\s*\.\s*(get|post|patch|put|delete)\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]+)\2/g;

  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(call)) {
      sites.push({
        file: relative(join(__dirname, "..", ".."), file).replace(/\\/g, "/"),
        method: match[1].toUpperCase(),
        path: match[3],
      });
    }
  }
  return sites;
}

const CALL_SITES = collectCallSites();

describe("every mobile apiClient path exists on the backend", () => {
  it("finds the call sites at all", () => {
    // Guards against the scan silently matching nothing after a refactor, which
    // would turn this file into a test that always passes.
    expect(CALL_SITES.length).toBeGreaterThan(4);
  });

  it("has no call site whose method+path the backend does not serve", () => {
    const servedShapes = new Set(
      [...SERVED].map((route) => {
        const [method, path] = route.split(" ");
        return `${method} ${normalise(path)}`;
      })
    );

    const unknown = CALL_SITES.filter((site) => {
      if (site.path.startsWith("http")) return false;
      const full = site.path.startsWith(API_PREFIX) ? site.path : `${API_PREFIX}${site.path}`;
      return !servedShapes.has(`${site.method} ${normalise(full)}`);
    });

    expect(
      unknown.map((s) => `${s.method} ${s.path}  (${s.file})`),
      "These calls have no matching backend route. Either the path is wrong, or " +
        "the route list changed and tests/fixtures/backend-routes.json is stale — " +
        "re-export it with: cd backend && python tools/export_routes.py"
    ).toEqual([]);
  });

  it("still reaches the identity route sign-in depends on", () => {
    // A path-existence check passes trivially if the app stops calling anything.
    const present = new Set(CALL_SITES.map((s) => `${s.method} ${s.path}`));
    expect(present.has("GET /auth/me"), "GET /auth/me is no longer called in src/").toBe(true);
  });
});
