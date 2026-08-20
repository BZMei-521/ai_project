import React from "react";

export type EmptyStateProps = {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
};

export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <section data-empty-state>
      <h2>{title}</h2>
      <p>{description}</p>
      <button type="button" onClick={onAction}>{actionLabel}</button>
    </section>
  );
}
