import { describe, expect, it } from "vitest";

import { createCanonicalAction, parameterDigest, stableJson } from "./digest.js";

describe("parameterDigest", () => {
  it("is independent of object key order", () => {
    expect(parameterDigest({ a: 1, b: { d: 4, c: 3 } })).toBe(
      parameterDigest({ b: { c: 3, d: 4 }, a: 1 }),
    );
  });

  it("changes when a parameter value changes", () => {
    expect(parameterDigest({ path: "src/a.ts", flag: true })).not.toBe(
      parameterDigest({ path: "src/b.ts", flag: true }),
    );
  });

  it("preserves array order", () => {
    expect(parameterDigest({ argv: ["git", "push"] })).not.toBe(
      parameterDigest({ argv: ["push", "git"] }),
    );
  });

  it("treats omitted and empty params as the same canonical action digest", () => {
    expect(createCanonicalAction({ type: "run.inspect", resource: "run:1" }).digest).toBe(
      createCanonicalAction({ type: "run.inspect", resource: "run:1", params: {} }).digest,
    );
  });

  it("stableJson sorts nested keys", () => {
    expect(stableJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
  });
});
