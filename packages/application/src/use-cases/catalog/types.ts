import type {
  TeamDefinitionStatus,
  TeamMemberDto,
  WorkerDraftDto,
  WorkerDto,
  WorkflowDefinitionStatus,
  WorkflowGraphEdgeDto,
  WorkflowGraphNodeDto,
  WorkflowStepDto,
} from "@workforce/protocol";

export interface WorkflowDefinitionRecord {
  id: string;
  name: string;
  description: string;
  status: WorkflowDefinitionStatus;
  stateRevision: number;
  definitionRevision: number;
  activeVersionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowVersionRecord {
  id: string;
  workflowId: string;
  version: string;
  status: WorkflowDefinitionStatus;
  immutable: boolean;
  stateRevision: number;
  entry?: string;
  steps: WorkflowStepDto[];
  nodes: WorkflowGraphNodeDto[];
  edges: WorkflowGraphEdgeDto[];
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamDefinitionRecord {
  id: string;
  name: string;
  description: string;
  status: TeamDefinitionStatus;
  stateRevision: number;
  definitionRevision: number;
  activeVersionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamVersionRecord {
  id: string;
  teamId: string;
  version: string;
  status: TeamDefinitionStatus;
  immutable: boolean;
  stateRevision: number;
  members: TeamMemberDto[];
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedWorker {
  worker: WorkerDto;
  draft: WorkerDraftDto;
}
