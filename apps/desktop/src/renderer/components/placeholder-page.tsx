import type { ReactNode } from "react";

export function PlaceholderPage(props: { title: string }): ReactNode {
  return (
    <section className="wf-card" aria-label="页面开发中">
      <h1 className="wf-page-title">{props.title}</h1>
      <p className="wf-placeholder-copy">页面开发中</p>
    </section>
  );
}
