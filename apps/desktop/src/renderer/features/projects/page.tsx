import type { FeaturePageProps } from "../contract.js";
import { useWorkforceClient } from "../hooks.js";
import { ProjectDetail } from "./detail.js";
import { ProjectList } from "./list.js";
import { pageStyle } from "./ui.js";

export function ProjectsPage(props: FeaturePageProps) {
  const client = useWorkforceClient();
  const projectId = props.params.projectId;
  return (
    <main style={pageStyle}>
      {projectId ? (
        <ProjectDetail {...props} client={client} />
      ) : (
        <ProjectList {...props} client={client} />
      )}
    </main>
  );
}
