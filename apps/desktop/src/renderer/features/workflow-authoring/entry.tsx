import { Badge, Button, Card, Cluster, Muted } from "../../components/ui.js";
import { AUTHORING_PATH, CHAT_SESSION_GAP } from "./model.js";

export function WorkflowAuthoringEntry(props: { navigate: (path: string) => void }) {
  return (
    <Card title="对话生成工作流" testId="workflow-authoring-entry">
      <Badge tone="muted">Daemon 会话 · 项目范围</Badge>
      <Muted>{CHAT_SESSION_GAP}</Muted>
      <Muted>
        在聊天中描述工作流，等待结构化提案后由你确认。确认只会创建未发布草稿，不会自动发布或执行。
      </Muted>
      <Cluster>
        <Button
          testId="workflow-authoring-open"
          variant="primary"
          onClick={() => props.navigate(AUTHORING_PATH)}
        >
          打开工作流作者面
        </Button>
      </Cluster>
    </Card>
  );
}
