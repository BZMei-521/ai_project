import type { StoryboardSnapshot } from "../storyboard-core/store";
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem
} from "../platform/safeStorage";

const AUTOSAVE_KEY = "storyboard-pro/autosave/history/v1";
const SESSION_MARKER_KEY = "storyboard-pro/session-active/v1";

export type AutosaveEntry = {
  id: string;
  timestamp: number;
  snapshot: StoryboardSnapshot;
};

function readHistory(): AutosaveEntry[] {
  const raw = safeStorageGetItem(AUTOSAVE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AutosaveEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeHistory(history: AutosaveEntry[]): void {
  safeStorageSetItem(AUTOSAVE_KEY, JSON.stringify(history));
}

export function saveAutosaveSnapshot(
  snapshot: StoryboardSnapshot,
  maxVersions = 20
): void {
  const next: AutosaveEntry = {
    id: `autosave_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    timestamp: Date.now(),
    snapshot
  };
  const history = [next, ...readHistory()].slice(0, maxVersions);
  writeHistory(history);
}

export function listAutosaveSnapshots(): AutosaveEntry[] {
  return readHistory();
}

export function loadAutosaveSnapshot(): StoryboardSnapshot | null {
  const latest = readHistory()[0];
  return latest?.snapshot ?? null;
}

export function loadAutosaveSnapshotById(id: string): StoryboardSnapshot | null {
  try {
    const entry = readHistory().find((item) => item.id === id);
    return entry?.snapshot ?? null;
  } catch {
    return null;
  }
}

export function deleteAutosaveSnapshotById(id: string): void {
  const next = readHistory().filter((item) => item.id !== id);
  writeHistory(next);
}

export function clearAutosaveHistory(): void {
  safeStorageRemoveItem(AUTOSAVE_KEY);
}

export function beginSessionAndDetectUncleanExit(): boolean {
  const hadMarker = !!safeStorageGetItem(SESSION_MARKER_KEY);
  safeStorageSetItem(SESSION_MARKER_KEY, String(Date.now()));
  return hadMarker;
}

export function endSession(): void {
  safeStorageRemoveItem(SESSION_MARKER_KEY);
}
