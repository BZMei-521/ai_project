import React, { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { searchDirectorCommands, type DirectorCommand } from "./directorDeskCommands";

export type CommandPaletteCloseOptions = {
  restoreFocus?: boolean;
};

export type CommandPaletteProps = {
  open: boolean;
  commands: readonly DirectorCommand[];
  onClose: (options?: CommandPaletteCloseOptions) => void;
};

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusOnCloseRef = useRef(true);
  const instanceId = useId().replace(/:/g, "");
  const listboxId = `director-command-results-${instanceId}`;
  const results = useMemo(
    () => searchDirectorCommands(commands, query),
    [commands, query]
  );
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, results.length - 1));
  const optionId = (command: DirectorCommand) => (
    `${listboxId}-option-${command.id.replace(/[^a-zA-Z0-9_-]+/g, "-")}`
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    if (open) {
      restoreFocusOnCloseRef.current = true;
      const activeElement = document.activeElement;
      previousFocusRef.current = typeof HTMLElement !== "undefined" && activeElement instanceof HTMLElement
        ? activeElement
        : null;
      queueMicrotask(() => inputRef.current?.focus());
      return;
    }

    if (restoreFocusOnCloseRef.current) previousFocusRef.current?.focus();
    previousFocusRef.current = null;
    restoreFocusOnCloseRef.current = true;
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [open, query]);

  const close = (restoreFocus = true) => {
    restoreFocusOnCloseRef.current = restoreFocus;
    onClose({ restoreFocus });
  };
  const invoke = (command: DirectorCommand | undefined) => {
    if (!command) return;
    close(false);
    queueMicrotask(() => command.run());
  };

  const closeFromBackdrop = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) close();
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
      if (event.target !== inputRef.current) return;
      event.preventDefault();
      invoke(results[safeActiveIndex]);
    }
  };

  if (!open) return null;

  return (
    <div className="director-command-backdrop" data-director-command-backdrop onPointerDown={closeFromBackdrop}>
      <div role="dialog" aria-modal={true} aria-label="命令面板" data-director-command-palette ref={dialogRef} onKeyDown={handleKeyDown}>
        <label>
          <span className="sr-only">搜索命令</span>
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-label="搜索命令"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={true}
            aria-activedescendant={results.length > 0 ? optionId(results[safeActiveIndex]) : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div id={listboxId} role="listbox" aria-label="命令结果">
          {results.map((command, index) => (
            <button
              key={command.id}
              id={optionId(command)}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === safeActiveIndex}
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
        <button type="button" aria-label="关闭命令面板" onClick={() => close()}>关闭</button>
      </div>
    </div>
  );
}
