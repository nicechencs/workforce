import { describe, expect, it } from "vitest";

import { FEATURE_SLOTS, navItemByPath, primaryNavItems, SHELL_NAV_ITEMS } from "./nav.js";

describe("shell navigation", () => {
  it("keeps 运行记录 and 工作流 in the primary sidebar as P1", () => {
    const labels = primaryNavItems().map((item) => item.label);
    expect(labels).toEqual([
      "工作台",
      "项目",
      "AI 团队",
      "执行节点",
      "审批中心",
      "运行记录",
      "工作流",
      "设置",
    ]);

    const runs = navItemByPath("/runs");
    expect(runs?.primary).toBe(true);
    expect(runs?.priority).toBe("p1");
    expect(runs?.slot).toBe("runs");

    const workflows = navItemByPath("/workflows");
    expect(workflows?.primary).toBe(true);
    expect(workflows?.priority).toBe("p1");
    expect(workflows?.slot).toBe("workflows");
    expect(workflows?.owner).toBe("t12");
  });

  it("registers the workflows feature slot and keeps settings as P0", () => {
    expect(FEATURE_SLOTS).toContain("workflows");
    expect(FEATURE_SLOTS).toContain("runs");
    expect(SHELL_NAV_ITEMS.find((item) => item.id === "settings")?.priority).toBe("p0");
    expect(SHELL_NAV_ITEMS.filter((item) => !item.primary).map((item) => item.id)).toEqual([]);
  });
});
