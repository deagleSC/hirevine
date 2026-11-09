import { describe, expect, it } from "vitest";

import { decideRoute, matchesPath, safeNextPath } from "./routing";

const manager = { app: "manager" as const, publicPaths: [] };
const candidate = { app: "candidate" as const, publicPaths: ["/", "/jobs", "/a", "/privacy"] };

describe("matchesPath", () => {
  it("matches exact paths and sub-paths, not prefixes of words", () => {
    expect(matchesPath("/jobs", "/jobs")).toBe(true);
    expect(matchesPath("/jobs/123", "/jobs")).toBe(true);
    expect(matchesPath("/jobseekers", "/jobs")).toBe(false);
    expect(matchesPath("/", "/")).toBe(true);
    expect(matchesPath("/anything", "/")).toBe(false);
  });
});

describe("decideRoute", () => {
  it("sends signed-out users to sign in, keeping where they were going", () => {
    expect(decideRoute({ ...manager, pathname: "/jobs/new", signedIn: false, role: null })).toEqual({
      type: "sign-in",
      next: "/jobs/new",
    });
  });

  it("lets signed-out users see auth pages and public pages", () => {
    expect(decideRoute({ ...manager, pathname: "/sign-in", signedIn: false, role: null }).type).toBe("next");
    expect(decideRoute({ ...candidate, pathname: "/jobs/42", signedIn: false, role: null }).type).toBe("next");
    expect(decideRoute({ ...candidate, pathname: "/", signedIn: false, role: null }).type).toBe("next");
  });

  it("keeps candidate-only pages private", () => {
    expect(decideRoute({ ...candidate, pathname: "/applications", signedIn: false, role: null }).type).toBe(
      "sign-in",
    );
  });

  it("redirects a user with the other role to the other app", () => {
    expect(decideRoute({ ...manager, pathname: "/", signedIn: true, role: "candidate" })).toEqual({
      type: "other-app",
    });
    expect(decideRoute({ ...candidate, pathname: "/jobs", signedIn: true, role: "manager" })).toEqual({
      type: "other-app",
    });
  });

  it("sends signed-in users away from the auth pages", () => {
    expect(decideRoute({ ...manager, pathname: "/sign-in", signedIn: true, role: "manager" }).type).toBe("home");
  });

  it("lets signed-in users with no role metadata through, so the profile can be completed", () => {
    expect(decideRoute({ ...manager, pathname: "/", signedIn: true, role: undefined }).type).toBe("next");
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/jobs/1?tab=a")).toBe("/jobs/1?tab=a");
  });
  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeNextPath("https://evil.test")).toBe("/");
    expect(safeNextPath("//evil.test")).toBe("/");
    expect(safeNextPath("/\\evil.test")).toBe("/");
    expect(safeNextPath(null, "/applications")).toBe("/applications");
  });
});
