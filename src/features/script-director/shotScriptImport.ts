import type { ImportedShotScriptItem } from "../../modules/storyboard-core/store";
import type { ShotTransition } from "../../modules/storyboard-core/types";
// @ts-ignore JavaScript runtime intentionally has no declaration file.
import { parseShotScriptText as runtimeParseShotScriptText } from "./shotScriptImportRuntime.mjs";

export type ShotScriptImportIssue = { code: string; path: string; message: string };
export type NormalizedShotScript = {
  projectTitle: string;
  shots: ImportedShotScriptItem[];
  transitions: ShotTransition[];
};
export type ShotScriptImportResult =
  | { ok: true; value: NormalizedShotScript }
  | { ok: false; issues: ShotScriptImportIssue[] };

export const parseShotScriptText = runtimeParseShotScriptText as (
  source: string,
  context: { fps: number; sequenceId: string }
) => ShotScriptImportResult;
