/**
 * Placement scheduling is orthogonal to DAG readiness.
 *
 * Workflow `schedule()` decides which nodes are ready. A PlacementScheduler
 * decides where a ready Run executes. V0.1 ships a Local Node implementation
 * in `@workforce/application`; remote and distributed schedulers are not
 * implemented here.
 */
export interface PlacementSchedulerPort {
  kind: "local" | "remote" | "distributed";
}

export const LOCAL_PLACEMENT_SCHEDULER: PlacementSchedulerPort = { kind: "local" };
