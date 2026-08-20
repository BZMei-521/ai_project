import React, { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { searchDirectorCommands, type DirectorCommand } from "./directorDeskCommands";

export type CommandPaletteProps = {
  open: boolean;
  commands: readonly DirectorCommand[];
  onClose: () => void;
};

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const results = useMemo(
    () => searchDirectorCommands(commands, query),
    [commands, query]
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    if (open) {
      const activeElement = document.activeElement;
      previousFocusRef.current = typeof HTMLElement !== "undefined" && activeElement instanceof HTMLElement
        ? activeElement
        : null;
      queueMicrotask(() => inputRef.current?.focus());
      return;
    }

    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [open, query]);

  const close = () => onClose();
  const invoke = (command: DirectorCommand | undefined) => {
    if (!command) return;
    command.run();
    close();
  };

  const cycleFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = typeof document === "undefined" ? null : document.activeElement;
    if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      cycleFocus(event);
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      invoke(results[activeIndex]);
    }
  };

  if (!open) return null;

  return (
    <div role="dialog" aria-modal={true} aria-label="命令面板" data-director-command-palette ref={dialogRef} onKeyDown={handleKeyDown}>
      <label>
        <span className="sr-only">搜索命令</span>
        <input
          ref={inputRef}
          type="search"
          aria-label="搜索命令"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div role="listbox" aria-label="命令结果">
        {results.map((command, index) => (
          <button
            key={command.id}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            data-danger={command.danger ? "true" : undefined}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => invoke(command)}
          >
            <span>{command.label}</span>
            {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
          </button>
        ))}
      </div>
      {results.length === 0 ? <p>未找到命令</p> : null}
      <button type="button" aria-label="关闭命令面板" onClick={close}>关闭</button>
    </div>
  );
}
