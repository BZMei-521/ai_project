import React, { type ReactNode } from "react";

export type ObjectInspectorDrawerProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  onClose: () => void;
};

export function ObjectInspectorDrawer({
  open,
  title,
  subtitle,
  children,
  onClose
}: ObjectInspectorDrawerProps) {
  return (
    <aside data-director-inspector data-open={open} aria-hidden={!open} aria-label={title}>
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <button type="button" aria-label="关闭检查器" onClick={onClose}>关闭</button>
      </header>
      <div data-director-inspector-content>{children ?? <p>未选择对象</p>}</div>
    </aside>
  );
}
