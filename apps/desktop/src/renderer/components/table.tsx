import type { ReactNode, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "./cn.js";

export function Table(
  props: TableHTMLAttributes<HTMLTableElement> & {
    testId?: string | undefined;
    children: ReactNode;
  },
): ReactNode {
  const { className, testId, children, ...rest } = props;
  return (
    <div className="wf-table-wrap">
      <table {...rest} data-testid={testId} className={cn("wf-table", className)}>
        {children}
      </table>
    </div>
  );
}

export function THead(props: { children: ReactNode }): ReactNode {
  return <thead className="wf-thead">{props.children}</thead>;
}

export function TBody(props: { children: ReactNode }): ReactNode {
  return <tbody>{props.children}</tbody>;
}

export function TR(props: { children: ReactNode; testId?: string | undefined }): ReactNode {
  return (
    <tr className="wf-tr" data-testid={props.testId}>
      {props.children}
    </tr>
  );
}

export function TH(
  props: ThHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode | undefined },
): ReactNode {
  const { className, children, ...rest } = props;
  return (
    <th {...rest} className={cn("wf-th", className)}>
      {children}
    </th>
  );
}

export function TD(
  props: TdHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode | undefined },
): ReactNode {
  const { className, children, ...rest } = props;
  return (
    <td {...rest} className={cn("wf-td", className)}>
      {children}
    </td>
  );
}

export function Skeleton(props: {
  lines?: number | undefined;
  className?: string | undefined;
}): ReactNode {
  const lines = props.lines ?? 3;
  return (
    <div className={cn("wf-skeleton-stack", props.className)} role="status" aria-label="加载中">
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="wf-skeleton" />
      ))}
    </div>
  );
}
