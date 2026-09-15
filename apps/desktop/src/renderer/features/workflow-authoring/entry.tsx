import { Badge, Button, Card, Cluster, Muted } from "../../components/ui.js";
import { AUTHORING_ROUTE, CHAT_SESSION_GAP } from "./model.js";

export function WorkflowAuthoringEntry(props: { navigate: (path: string) => void }) {
  return (
    <Card title="对话生成工作流" testId="workflow-authoring-entry">
      <Badge tone="muted">Daemon 会话 · 项目范围</Badge>
      <Muted>{CHAT_SESSION_GAP}</Muted>
      <Muted>
        在项目范围内描述要生成的流程，确认后只落未发布草稿。不是 Worker IM，聊完也不算执行完成。
      </Muted>
      <Cluster>
        <Button
          testId="workflow-authoring-open"
          variant="outline"
          onClick={() => props.navigate(AUTHORING_ROUTE)}
        >
          打开工作流作者面
        </Button>
      </Cluster>
    </Card>
  );
}
