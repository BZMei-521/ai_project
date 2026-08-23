#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [key, inlineValue] = token.split("=", 2);
    const name = key.slice(2);
    if (inlineValue !== undefined) {
      output[name] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      output[name] = next;
      index += 1;
      continue;
    }
    output[name] = "1";
  }
  return output;
}

function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "y";
}

function stripAnsi(input) {
  return String(input ?? "").replace(/\x1B\[[0-9;]*m/g, "");
}

async function getPageWebSocketUrl(debugPort, pageUrlContains) {
  const endpoint = `http://127.0.0.1:${debugPort}/json/list`;
  const startedAt = Date.now();
  const timeoutMs = 20_000;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        const pages = await response.json();
        const page =
          pages.find(
            (item) =>
              item &&
              item.type === "page" &&
              typeof item.webSocketDebuggerUrl === "string" &&
              String(item.url || "").includes(pageUrlContains)
          ) ??
          pages.find(
            (item) => item && item.type === "page" && typeof item.webSocketDebuggerUrl === "string"
          );
        if (page?.webSocketDebuggerUrl) {
          return String(page.webSocketDebuggerUrl);
        }
      }
    } catch {
      // Retry until timeout.
    }
    await sleep(400);
  }
  throw new Error(`Unable to resolve CDP page endpoint via ${endpoint}`);
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
  }

  async connect() {
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data || "{}"));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
    };
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
  }

  async send(method, params = {}) {
    if (!this.ws) throw new Error("CDP websocket is not connected");
    const id = ++this.nextId;
    const payload = { id, method, params };
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  async evaluateValue(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true
    });
    if (result?.exceptionDetails) {
      const description =
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        "Runtime.evaluate failed";
      throw new Error(description);
    }
    return result?.result?.value;
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // Ignore close errors.
    }
    this.ws = null;
    this.pending.clear();
  }
}

function extractFailures(logLines) {
  const failures = [];
  for (const rawLine of logLines) {
    const line = stripAnsi(rawLine);
    if (!line.includes("[ERROR]")) continue;
    const reasonIndex = line.indexOf("Error:");
    if (reasonIndex < 0) continue;

    const reason = line.slice(reasonIndex + "Error:".length).trim();
    let left = line.slice(0, reasonIndex);
    left = left.replace(/^.*\[(ERROR)\]\s*/i, "").trim();
    left = left.replace(/^.*?(?:\u751f\u6210\u5931\u8d25[:\uff1a]|\u5931\u8d25[:\uff1a]|fail(?:ed)?[:\uff1a])\s*/i, "");
    left = left.replace(/[,\uff0c]\s*$/, "").trim();
    failures.push({
      shot: left || "",
      reason: reason || ""
    });
  }
  return failures;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const debugPort = Math.max(1, Math.floor(toNumber(args.debugPort, 9222)));
  const pageUrlContains = String(args.pageUrlContains || "127.0.0.1:3210").trim();
  const pollMs = Math.max(1_000, Math.floor(toNumber(args.pollMs, 8_000)));
  const timeoutMs = Math.max(120_000, Math.floor(toNumber(args.timeoutMs, 2 * 60 * 60 * 1000)));
  const reportDir = path.resolve(String(args.reportDir || "logs"));
  const reloadBeforeTrigger = toBool(args.reloadBeforeTrigger, false);

  const wsUrl = await getPageWebSocketUrl(debugPort, pageUrlContains);
  const client = new CdpClient(wsUrl);
  await client.connect();

  const readSnapshot = async () =>
    await client.evaluateValue(`(() => {
      const TXT_REGEN_ALL = "\\u91cd\\u65b0\\u751f\\u6210\\u5168\\u90e8\\u5206\\u955c\\u56fe";
      const lines = [...document.querySelectorAll(".comfy-log-line")]
        .map((item) => String(item?.innerText || "").trim())
        .filter(Boolean);
      const regenButton = [...document.querySelectorAll("button")].find(
        (item) => String(item?.innerText || "").trim() === TXT_REGEN_ALL
      );
      return {
        lines,
        regenDisabled: regenButton ? !!regenButton.disabled : null
      };
    })()`);

  try {
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Page.bringToFront");

    if (reloadBeforeTrigger) {
      await client.send("Page.reload", { ignoreCache: true });
      await sleep(2500);
      await client.send("Page.bringToFront");
    }

    const tryTrigger = async () =>
      await client.evaluateValue(`(() => {
      const TXT_AI = "\\u751f\\u6210\\u6d41\\u6c34\\u7ebf";
      const TXT_RUNLOG = "\\u8fd0\\u884c\\u65e5\\u5fd7";
      const TXT_REGEN_ALL = "\\u91cd\\u65b0\\u751f\\u6210\\u5168\\u90e8\\u5206\\u955c\\u56fe";
      const aiTab = [...document.querySelectorAll("button")].find((item) =>
        String(item?.innerText || "").includes(TXT_AI)
      );
      if (aiTab) aiTab.click();

      const detailsNodes = [...document.querySelectorAll("details")];
      const advancedTools = detailsNodes.find((item) =>
        String(item?.className || "").includes("comfy-advanced-tools")
      );
      if (advancedTools) advancedTools.open = true;

      const runLogPanel = detailsNodes.find((item) =>
        String(item.querySelector("summary")?.innerText || "").includes(TXT_RUNLOG)
      );
      if (runLogPanel) runLogPanel.open = true;

      const regenButton = [...document.querySelectorAll("button")].find(
        (item) => String(item?.innerText || "").trim() === TXT_REGEN_ALL
      );
      if (!regenButton) {
        return { ok: false, reason: "regen_button_not_found" };
      }
      const disabled = !!regenButton.disabled;
      const triggered = !disabled;
      if (triggered) regenButton.click();
      return {
        ok: true,
        disabled,
        triggered,
        attachedToRunningJob: disabled,
        buttonText: String(regenButton.innerText || "").trim()
      };
    })()`);

    let triggerResult = null;
    const triggerDeadline = Date.now() + 30_000;
    while (Date.now() < triggerDeadline) {
      triggerResult = await tryTrigger();
      if (triggerResult?.ok) break;
      await sleep(1_000);
    }

    console.log(`[ui-regen] trigger=${JSON.stringify(triggerResult)}`);
    if (!triggerResult?.ok) {
      throw new Error(
        `Failed to trigger full storyboard regeneration: ${triggerResult?.reason || "unknown"}`
      );
    }

    const baseline = await readSnapshot();
    const allSeen = new Set(Array.isArray(baseline?.lines) ? baseline.lines : []);
    const capturedLines = [];
    let lastSnapshotLines = Array.isArray(baseline?.lines) ? baseline.lines : [];
    let sawActiveOnce = triggerResult.disabled === true;
    let completionLine = "";
    let completed = false;
    let timedOut = false;
    const startedAt = Date.now();

    while (!completed) {
      if (Date.now() - startedAt > timeoutMs) {
        timedOut = true;
        break;
      }

      const snapshot = await readSnapshot();
      const lines = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
      lastSnapshotLines = lines;

      const unseen = [];
      for (const line of lines) {
        if (allSeen.has(line)) continue;
        allSeen.add(line);
        unseen.push(line);
      }

      if (unseen.length > 0) {
        for (const line of unseen.slice().reverse()) {
          console.log(`[ui-regen] ${line}`);
          capturedLines.push(line);
          completionLine = line;
        }
      }

      const regenDisabled = snapshot?.regenDisabled;
      if (regenDisabled === true) {
        sawActiveOnce = true;
      }
      if (sawActiveOnce && regenDisabled === false) {
        completed = true;
        break;
      }

      await sleep(pollMs);
    }

    const failures = extractFailures(capturedLines);
    const summary = {
      ok: !timedOut && failures.length === 0,
      timedOut,
      completionLine,
      logLineCount: capturedLines.length,
      totalVisibleLogLineCount: lastSnapshotLines.length,
      failureCount: failures.length,
      failures
    };

    await fs.mkdir(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `ui-regenerate-report-${Date.now()}.json`);
    await fs.writeFile(
      reportPath,
      JSON.stringify(
        {
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date().toISOString(),
          debugPort,
          pageUrlContains,
          pollMs,
          timeoutMs,
          reloadBeforeTrigger,
          triggerResult,
          summary,
          logs: capturedLines
        },
        null,
        2
      ),
      "utf8"
    );

    console.log(`[ui-regen] report=${reportPath}`);
    console.log(`[ui-regen] summary=${JSON.stringify(summary)}`);

    if (timedOut) {
      process.exitCode = 124;
    } else if (failures.length > 0) {
      process.exitCode = 2;
    } else {
      process.exitCode = 0;
    }
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(`[ui-regen] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
