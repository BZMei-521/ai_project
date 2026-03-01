import { useEffect, useRef } from "react";
import { create } from "zustand";

export type ToastLevel = "info" | "success" | "warning" | "error";
export type AppToast = { id: number; message: string; level: ToastLevel };

type ToastState = {
  toasts: AppToast[];
  pushToast: (message: string, level?: ToastLevel) => void;
  removeToast: (id: number) => void;
};

let toastSeed = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  pushToast: (message, level = "info") => {
    const id = toastSeed;
    toastSeed += 1;
    set((state) => ({
      toasts: [...state.toasts.slice(-3), { id, message, level }]
    }));
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((item) => item.id !== id)
    }))
}));

export const pushToast = (message: string, level: ToastLevel = "info") =>
  useToastStore.getState().pushToast(message, level);

export function AppToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);
  const timerMapRef = useRef<Map<number, number>>(new Map());
  const startedAtRef = useRef<Map<number, number>>(new Map());
  const remainingRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const activeIds = new Set(toasts.map((toast) => toast.id));

    for (const toast of toasts) {
      if (timerMapRef.current.has(toast.id)) continue;
      remainingRef.current.set(toast.id, 3200);
      startedAtRef.current.set(toast.id, Date.now());
      const timer = window.setTimeout(() => removeToast(toast.id), 3200);
      timerMapRef.current.set(toast.id, timer);
    }

    for (const [id, timer] of timerMapRef.current) {
      if (activeIds.has(id)) continue;
      window.clearTimeout(timer);
      timerMapRef.current.delete(id);
      startedAtRef.current.delete(id);
      remainingRef.current.delete(id);
    }

  }, [removeToast, toasts]);

  useEffect(() => {
    return () => {
      for (const timer of timerMapRef.current.values()) {
        window.clearTimeout(timer);
      }
      timerMapRef.current.clear();
      startedAtRef.current.clear();
      remainingRef.current.clear();
    };
  }, []);

  const pauseToastTimer = (id: number) => {
    const timer = timerMapRef.current.get(id);
    if (typeof timer === "number") {
      window.clearTimeout(timer);
      timerMapRef.current.delete(id);
    }
    const startedAt = startedAtRef.current.get(id);
    if (typeof startedAt === "number") {
      const previous = remainingRef.current.get(id) ?? 0;
      const elapsed = Date.now() - startedAt;
      remainingRef.current.set(id, Math.max(300, previous - elapsed));
    }
  };

  const resumeToastTimer = (id: number) => {
    if (timerMapRef.current.has(id)) return;
    const remaining = remainingRef.current.get(id) ?? 0;
    if (remaining <= 0) {
      removeToast(id);
      return;
    }
    startedAtRef.current.set(id, Date.now());
    const timer = window.setTimeout(() => removeToast(id), remaining);
    timerMapRef.current.set(id, timer);
  };

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div
          className={`toast toast-${toast.level}`}
          key={toast.id}
          onMouseEnter={() => pauseToastTimer(toast.id)}
          onMouseLeave={() => resumeToastTimer(toast.id)}
        >
          <span>{toast.message}</span>
          <button
            aria-label="关闭提示"
            className="toast-close"
            onClick={() => removeToast(toast.id)}
            type="button"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
