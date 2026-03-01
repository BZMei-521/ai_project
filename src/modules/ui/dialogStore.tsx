import { useEffect, useState } from "react";
import { create } from "zustand";

type BaseDialog = {
  id: number;
  title: string;
  message?: string;
  confirmText: string;
  cancelText: string;
  danger?: boolean;
};

type ConfirmDialogRequest = BaseDialog & {
  kind: "confirm";
  resolve: (value: boolean) => void;
};

type PromptDialogRequest = BaseDialog & {
  kind: "prompt";
  placeholder?: string;
  defaultValue?: string;
  resolve: (value: string | null) => void;
};

type DialogRequest = ConfirmDialogRequest | PromptDialogRequest;

type DialogState = {
  request: DialogRequest | null;
  openConfirm: (options: {
    title: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  openPrompt: (options: {
    title: string;
    message?: string;
    placeholder?: string;
    defaultValue?: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }) => Promise<string | null>;
  close: () => void;
};

let dialogSeed = 1;

const useDialogStore = create<DialogState>((set) => ({
  request: null,
  openConfirm: (options) =>
    new Promise<boolean>((resolve) => {
      set({
        request: {
          id: dialogSeed += 1,
          kind: "confirm",
          title: options.title,
          message: options.message,
          confirmText: options.confirmText ?? "确定",
          cancelText: options.cancelText ?? "取消",
          danger: options.danger,
          resolve
        }
      });
    }),
  openPrompt: (options) =>
    new Promise<string | null>((resolve) => {
      set({
        request: {
          id: dialogSeed += 1,
          kind: "prompt",
          title: options.title,
          message: options.message,
          placeholder: options.placeholder,
          defaultValue: options.defaultValue ?? "",
          confirmText: options.confirmText ?? "确定",
          cancelText: options.cancelText ?? "取消",
          danger: options.danger,
          resolve
        }
      });
    }),
  close: () => set({ request: null })
}));

export const confirmDialog = (options: {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}) => useDialogStore.getState().openConfirm(options);

export const promptDialog = (options: {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}) => useDialogStore.getState().openPrompt(options);

export function AppDialogHost() {
  const request = useDialogStore((state) => state.request);
  const close = useDialogStore((state) => state.close);
  const [promptValue, setPromptValue] = useState("");

  useEffect(() => {
    if (!request) return;
    if (request.kind === "prompt") {
      setPromptValue(request.defaultValue ?? "");
    } else {
      setPromptValue("");
    }
  }, [request]);

  if (!request) return null;

  const onCancel = () => {
    if (request.kind === "confirm") {
      request.resolve(false);
    } else {
      request.resolve(null);
    }
    close();
  };

  const onConfirm = () => {
    if (request.kind === "confirm") {
      request.resolve(true);
    } else {
      request.resolve(promptValue);
    }
    close();
  };

  return (
    <section className="dialog-backdrop" onClick={onCancel}>
      <div
        className="panel dialog-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel-header">
          <h2>{request.title}</h2>
        </header>
        {request.message && <p>{request.message}</p>}
        {request.kind === "prompt" && (
          <input
            autoFocus
            onChange={(event) => setPromptValue(event.target.value)}
            placeholder={request.placeholder}
            type="text"
            value={promptValue}
          />
        )}
        <div className="timeline-actions">
          <button className="btn-ghost" onClick={onCancel} type="button">
            {request.cancelText}
          </button>
          <button
            className={request.danger ? "btn-danger" : "btn-primary"}
            onClick={onConfirm}
            type="button"
          >
            {request.confirmText}
          </button>
        </div>
      </div>
    </section>
  );
}
