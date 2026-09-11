import type { ReactNode } from "react";

import { Card, EmptyState } from "./ui.js";

export function PlaceholderPage(props: { title: string }): ReactNode {
  return (
    <section className="wf-page" aria-label="页面开发中">
      <Card>
        <EmptyState title={props.title}>页面开发中。</EmptyState>
      </Card>
    </section>
  );
}
