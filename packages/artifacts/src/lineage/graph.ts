import { ArtifactError } from "../errors.js";
import type { LineageSource } from "../types.js";

export function detectLineageCycle(input: {
  outputArtifactVersionId: string;
  sources: LineageSource[];
  edges: ReadonlyMap<string, readonly LineageSource[]>;
}): void {
  const outgoing = new Map<string, string[]>();
  for (const [from, sources] of input.edges) {
    outgoing.set(
      from,
      sources.map((source) => source.artifactVersionId),
    );
  }
  const next = outgoing.get(input.outputArtifactVersionId) ?? [];
  next.push(...input.sources.map((source) => source.artifactVersionId));
  outgoing.set(input.outputArtifactVersionId, next);

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const walk = (node: string): void => {
    if (visited.has(node)) {
      return;
    }
    if (visiting.has(node)) {
      throw new ArtifactError("ARTIFACT_LINEAGE_CYCLE", `lineage cycle involving ${node}`, {
        details: { artifactVersionId: node },
      });
    }
    visiting.add(node);
    for (const child of outgoing.get(node) ?? []) {
      walk(child);
    }
    visiting.delete(node);
    visited.add(node);
  };

  walk(input.outputArtifactVersionId);
}
