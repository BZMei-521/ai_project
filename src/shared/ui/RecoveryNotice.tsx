import React from "react";

export type RecoveryNoticeProps = {
  stage: string;
  summary: string;
  outputState: string;
  recovery: string;
  onRetry?: () => void;
};

export function RecoveryNotice({
  stage,
  summary,
  outputState,
  recovery,
  onRetry
}: RecoveryNoticeProps) {
  return (
    <section role="alert" data-recovery-notice>
      <p>{stage}</p>
      <h2>{summary}</h2>
      <p>输出状态：{outputState}</p>
      <p>下一步：{recovery}</p>
      {onRetry ? <button type="button" onClick={onRetry}>重试</button> : null}
    </section>
  );
}
