import type { IntegrationRecord, IntegrationStore } from "@workforce/application";

export class MemoryIntegrationStore implements IntegrationStore {
  private readonly records: IntegrationRecord[] = [];

  async list(projectId: string, workflowVersionId: string): Promise<IntegrationRecord[]> {
    return this.records.filter(
      (record) => record.projectId === projectId && record.workflowVersionId === workflowVersionId,
    );
  }

  async put(record: IntegrationRecord): Promise<void> {
    this.records.push(structuredClone(record));
  }

  async markSuperseded(projectId: string, workflowVersionId: string): Promise<void> {
    for (const record of this.records) {
      if (record.projectId === projectId && record.workflowVersionId === workflowVersionId) {
        record.superseded = true;
      }
    }
  }

  latest(projectId: string): IntegrationRecord | undefined {
    return [...this.records]
      .reverse()
      .find((record) => record.projectId === projectId && !record.superseded);
  }
}
