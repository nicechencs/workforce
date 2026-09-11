import { isOrchestrationMode, type OrchestrationMode } from "@workforce/protocol";

import type { CapabilitiesDto } from "./dto.js";
import { AppError } from "./errors.js";

export function parseStartOrchestrationMode(
  value: string | undefined,
): OrchestrationMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isOrchestrationMode(value)) {
    throw new AppError("validation_failed", "orchestrationMode must be workflow_bound or direct", {
      fields: ["orchestrationMode"],
    });
  }
  return value;
}

export function assertStartOrchestrationAllowed(
  mode: OrchestrationMode | undefined,
  capabilities: CapabilitiesDto,
): void {
  if (mode === undefined || mode === "workflow_bound") {
    return;
  }
  if (mode === "direct" && capabilities.orchestration?.direct !== true) {
    throw new AppError("unsupported_capability", "orchestrationMode.direct is unsupported", {
      fields: ["orchestrationMode"],
    });
  }
}
