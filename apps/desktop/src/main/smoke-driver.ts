import fs from "node:fs";
import path from "node:path";

export interface DesktopMainPathSmokeResult {
  ok: boolean;
  status?: string;
  tasks?: string[];
  error?: string;
}

export function isSmokeResultOk(
  value: unknown,
): value is DesktopMainPathSmokeResult & { ok: true } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as DesktopMainPathSmokeResult;
  return (
    record.ok === true &&
    typeof record.status === "string" &&
    record.status.length > 0 &&
    Array.isArray(record.tasks) &&
    record.tasks.length > 0
  );
}

type PageElement = {
  value: string;
  disabled?: boolean;
  textContent?: string | null;
  click(): void;
  dispatchEvent(event: unknown): void;
  querySelectorAll(selector: string): ArrayLike<{ textContent?: string | null }>;
};

type PageGlobals = {
  document: {
    body?: { innerText?: string };
    getElementById(id: string): PageElement | null;
    querySelector(selector: string): PageElement | null;
  };
  window: { location: { hash: string } };
  HTMLInputElement: { prototype: object };
  HTMLTextAreaElement: { prototype: object };
  Event: new (type: string, init?: { bubbles?: boolean }) => unknown;
};

/**
 * In-page driver. Must stay self-contained: Electron serializes it with Function#toString.
 */
export async function driveDesktopMainPathInPage(): Promise<DesktopMainPathSmokeResult> {
  const page = globalThis as unknown as PageGlobals;
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const bodyText = (): string => page.document.body?.innerText ?? "";

  const waitFor = async <T>(
    label: string,
    fn: () => T | undefined | null | false,
    timeoutMs = 20_000,
  ): Promise<T> => {
    const started = Date.now();
    let last: T | undefined | null | false;
    while (Date.now() - started < timeoutMs) {
      last = fn();
      if (last) {
        return last;
      }
      await sleep(50);
    }
    throw new Error(`timeout waiting for ${label}; ui=${bodyText().slice(0, 800)}`);
  };

  const setNativeValue = (el: PageElement, value: string): void => {
    const proto =
      Object.getPrototypeOf(el) === page.HTMLTextAreaElement.prototype
        ? page.HTMLTextAreaElement.prototype
        : page.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new page.Event("input", { bubbles: true }));
    el.dispatchEvent(new page.Event("change", { bubbles: true }));
  };

  try {
    if (page.window.location.hash !== "#/projects") {
      page.window.location.hash = "#/projects";
    }

    const name = await waitFor("create-name", () =>
      page.document.getElementById("wf-project-name"),
    );
    const objective = await waitFor("create-objective", () =>
      page.document.getElementById("wf-project-objective"),
    );
    setNativeValue(name, "Desktop smoke");
    setNativeValue(objective, "create then plan then confirm then start");

    const create = await waitFor("create-button", () =>
      page.document.querySelector('[data-testid="project-create"]'),
    );
    create.click();

    const bind = await waitFor("bind-workspace", () =>
      page.document.querySelector('[data-testid="project-bind-workspace"]'),
    );
    bind.click();

    const startPlanning = await waitFor("start-planning", () => {
      const button = page.document.querySelector('[data-testid="project-action-startPlanning"]');
      return button && !button.disabled ? button : null;
    });
    startPlanning.click();

    const confirm = await waitFor("confirm-plan", () => {
      const button = page.document.querySelector('[data-testid="project-action-confirmPlan"]');
      return button && !button.disabled ? button : null;
    });
    confirm.click();

    const start = await waitFor("start-project", () => {
      const button = page.document.querySelector('[data-testid="project-action-startProject"]');
      return button && !button.disabled ? button : null;
    });
    start.click();

    const status = await waitFor("running-status", () => {
      const badge = page.document.querySelector('[data-testid="project-status"]');
      const text = badge?.textContent?.trim() ?? "";
      return text === "执行中" || text === "已完成" ? text : null;
    });

    const tasks = await waitFor("published-tasks", () => {
      const text = bodyText();
      if (!text.includes("dev_alpha") || !text.includes("dev_bravo")) {
        return null;
      }
      return ["dev_alpha", "dev_bravo"];
    });

    return { ok: true, status, tasks };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function serializeDesktopMainPathSmoke(): string {
  return `(${driveDesktopMainPathInPage.toString()})()`;
}

export async function runDesktopMainPathSmoke(input: {
  executeJavaScript: (code: string) => Promise<unknown>;
  resultPath: string;
  quit: () => void;
}): Promise<void> {
  const resultPath = path.resolve(input.resultPath);
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  let payload: DesktopMainPathSmokeResult = { ok: false, error: "smoke did not run" };
  try {
    const raw = await input.executeJavaScript(serializeDesktopMainPathSmoke());
    if (isSmokeResultOk(raw)) {
      payload = raw;
    } else if (typeof raw === "object" && raw !== null) {
      payload = raw as DesktopMainPathSmokeResult;
      if (payload.ok !== false) {
        payload = { ok: false, error: `unexpected smoke payload: ${JSON.stringify(raw)}` };
      }
    } else {
      payload = { ok: false, error: `unexpected smoke payload: ${JSON.stringify(raw)}` };
    }
  } catch (error) {
    payload = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    input.quit();
  }
}
