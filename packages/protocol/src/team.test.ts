import { describe, expect, it } from "vitest";

import {
  isBindableTeamVersion,
  parseCreateTeamInput,
  parseTeam,
  parseTeamVersion,
  parseTeamVersionWrite,
  teamSchema,
} from "./team.js";

describe("team write DTO", () => {
  it("accepts a published preset team with nested TeamVersion members", () => {
    const team = parseTeam({
      id: "tm_software_development",
      name: "Software Development Team",
      version: "0.1.0",
      status: "published",
      protocolVersion: "0.1",
      roles: [{ id: "planner", role: "planner", version: "0.1.0" }],
      activeVersionId: "tmv_software_development_0_1_0",
      stateRevision: 1,
      versions: [
        {
          id: "tmv_software_development_0_1_0",
          teamId: "tm_software_development",
          version: "0.1.0",
          status: "published",
          immutable: true,
          members: [
            { id: "planner", role: "planner", runtimeProfileId: "mock", quantity: 1 },
            { id: "developer", role: "developer", runtimeProfileId: "mock", quantity: 2 },
          ],
        },
      ],
    });
    expect(team.status).toBe("published");
    expect(team.versions?.[0]?.members).toHaveLength(2);
    expect(isBindableTeamVersion(team.versions![0]!)).toBe(true);
    expect(parseTeamVersion(team.versions![0]!)).toEqual(team.versions![0]);
  });

  it("accepts a draft team without published versions", () => {
    const team = parseTeam({
      id: "tm_custom",
      name: "Custom",
      description: "project team",
      version: "",
      status: "draft",
      protocolVersion: "0.1",
      roles: [],
      stateRevision: 1,
      definitionRevision: 1,
      versions: [],
    });
    expect(team.status).toBe("draft");
    expect(team.versions).toEqual([]);
  });

  it("rejects marketplace or execution-mode fields", () => {
    expect(() =>
      teamSchema.parse({
        id: "tm_1",
        name: "X",
        version: "1",
        status: "draft",
        protocolVersion: "0.1",
        roles: [],
        marketplace: true,
      }),
    ).toThrow();
    expect(() => parseCreateTeamInput({ name: "X", executionMode: "direct" })).toThrow();
  });

  it("requires quantity >= 1 on TeamVersion members", () => {
    expect(() =>
      parseTeamVersionWrite({
        members: [{ role: "developer", runtimeProfileId: "mock", quantity: 0 }],
      }),
    ).toThrow();
    expect(
      parseTeamVersionWrite({
        members: [{ role: "developer", runtimeProfileId: "mock", quantity: 1 }],
      }).members,
    ).toHaveLength(1);
  });

  it("does not treat draft TeamVersion as bindable", () => {
    expect(
      isBindableTeamVersion({
        status: "draft",
        immutable: false,
      }),
    ).toBe(false);
  });
});
