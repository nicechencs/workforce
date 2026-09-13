import type { ReactNode } from "react";

import { Card, EmptyState } from "./ui.js";

export function PlaceholderPage(props: {
  title: string;
  description?: string | undefined;
  unwired?: boolean | undefined;
}): ReactNode {
  const description = props.description ?? (props.unwired === true ? "尚未接通。" : "页面开发中。");
  return (
    <section className="wf-page" aria-label={props.unwired === true ? "尚未接通" : "页面开发中"}>
      <Card>
        <EmptyState title={props.title}>{description}</EmptyState>
      </Card>
    </section>
  );
}
