type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getBrowserStorage(): BrowserStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function safeStorageGetItem(key: string): string | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function safeStorageSetItem(key: string, value: string): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore unavailable storage backends.
  }
}

export function safeStorageRemoveItem(key: string): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore unavailable storage backends.
  }
}
