#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.split("=")[1] ?? "prepare";
const target = process.argv.find((arg) => arg.startsWith("--target="))?.split("=")[1] ?? "ref-cap-10";
if (!new Set(["prepare", "export", "sync", "verify"]).has(phase)) throw new Error(`ref_cap_phase_invalid:${phase}`);
if (!new Set(["ref-cap-10", "c04-costume-conflict", "c22-shovel-panel-conflict"]).has(target)) throw new Error(`ref_cap_target_invalid:${target}`);

const debugPort = 9338;
const projectRoot = "C:\\Users\\Administrator\\Desktop\\小说\\应用项目\\影帝他总想对我图谋不轨_E01样片.sbproj";
const productionRoot = "C:\\Users\\Administrator\\Desktop\\小说\\项目\\影帝他总想对我图谋不轨_漫剧改编\\投产\\E01";
const shotPlanPath = path.join(productionRoot, "shot-plan.json");
const runPath = path.join(productionRoot, "run-manifest.json");
const snapshotPath = path.join(projectRoot, "snapshot.json");
const affectedSuffixes = target === "c04-costume-conflict" ? ["C04"] : target === "c22-shovel-panel-conflict" ? ["C22"] : ["C03", "C09", "C10", "C17", "C18", "C19", "C20", "C21", "C22", "C23"];
const rank = new Map([
  ["spatial_authority", 0], ["pose_reference", 1], ["face_identity", 2], ["body_costume", 3],
  ["prop_detail", 4], ["style_only", 5], ["lighting_only", 6], ["negative_example", 7]
]);
const keepBySuffix = {
  C04: ["hanyuan-palace-banquet", "li-baozhu-palace-banquet-costume", "wan-cui-identity", "osmanthus-wine-cup"],
  C03: ["coffin-interior", "li-baozhu-identity", "silk-lining", "bronze-nails"],
  C09: ["coffin-interior", "li-baozhu-identity", "li-baozhu-injured-finger", "hairpin-broken"],
  C10: ["coffin-interior", "li-baozhu-identity", "li-baozhu-injured-finger", "hairpin-broken"],
  C17: ["coffin-interior", "li-baozhu-identity", "bronze-nails"],
  C18: ["tomb-chamber-exterior", "li-baozhu-identity", "wei-xun-identity", "li-baozhu-injured-finger", "dagger"],
  C19: ["tomb-chamber-exterior", "li-baozhu-identity", "wei-xun-identity", "dagger"],
  C20: ["tomb-chamber-exterior", "li-baozhu-identity", "wei-xun-identity", "grave-robbing-shovel"],
  C21: ["tomb-chamber-exterior", "li-baozhu-identity", "wei-xun-identity", "grave-robbing-shovel", "phoenix-pattern-panel"],
  C22: ["tomb-chamber-exterior", "li-baozhu-identity", "wei-xun-identity", "grave-robbing-shovel", "phoenix-pattern-panel"],
  C23: ["tomb-chamber-exterior", "li-baozhu-identity", "wei-xun-identity", "li-baozhu-injured-finger", "phoenix-jade-pendant"]
};
const liDualInstruction = "Preserve 李宝珠's facial identity, hairline, hairstyle, age, and immutable facial traits from this existing sheet, and also lock the same sheet's visibly documented damaged crimson coffin ceremonial dress, body proportions, garment construction, materials, and accessories. Do not copy the contact-sheet layout, white background, alternate views, camera, pose, framing, or composition; spatial authority controls those.";
const liPalaceDualInstruction = "Use this candidate as the sole authoritative reference for Li Baozhu in the palace-banquet memory: preserve her facial identity, eyes, facial proportions, hairline, coiffure, phoenix hairpin, age, and immutable facial traits, and simultaneously lock the same sheet's pristine intact crimson Tang-inspired imperial banquet robe, clean undamaged sleeves and hem, restrained gold phoenix embroidery, formal dark-gold belt, body proportions, garment construction, materials, and accessories. Never reintroduce the torn, muddy, coffin-damaged ceremonial clothing from another period. Do not copy the white background, contact-sheet layout, alternate views, camera, pose, framing, blocking, or composition; spatial authority and the exact shot prompt control those.";
const liDamagedIdentitySha = "173cfa038014ddc96679063ff0e8f8801e85866417250f9139ca5799edb60cc3";
const liPalaceCandidateSha = "0a5c7dca006826cf96b13076451e45fd52deac70c46952bac6079d17e238df10";
const shovelSha = "fdb8843b58f01ccf739ed4c55a19c70327b6c1a704399fb6810210514e39eea6";
const phoenixPanelSha = "3ef6581d0f8d66abdb7c732186f9a9d020350e0a238bdf50c9c1044f262fdb04";
const c22PanelNonContactInstruction = "Use this provisional prop candidate only for the exact structure, material, damage state, and period details of 凤凰纹暗板. The entire phoenix-pattern panel surface must remain fully visible and unobstructed; no tool, shovel blade, hand, or other object may touch, overlap, cover, point at, or be composited onto the panel. Do not copy its white background, contact-sheet layout, camera, pose, anatomy, identity, or composition.";
const c22OriginalImagePrompt = "over-the-shoulder-insert; camera locked-off; location tomb-chamber-exterior.\nStart state: 韦训左手扶棺沿、右手持短铲，目光锁住凤凰纹暗板；李宝珠右手蜷在身前保护伤指，左手贴住胸前衣料，跟随他的视线。\nEnd-state storytelling frame: 韦训身体只前倾半步，右手短铲保持朝下且不接触暗板、左手仍扶棺沿，低声确认凤凰胎；李宝珠双手保持原位，眼神从暗板转向他的短铲。\nDialogue context: 凤凰胎，果然在这座墓里。\nCharacters: 李宝珠、韦训. Props: coffin、grave-robbing-shovel、phoenix-pattern-panel.\nOne cinematic 16:9 Chinese 3D donghua storyboard frame; no text, caption, watermark, contact-sheet grid, duplicate subject, extra limb, or identity drift.";
const c22ClarifiedImagePrompt = "over-the-shoulder-insert; camera locked-off; location tomb-chamber-exterior.\nStart state: 韦训左手扶棺沿、右手持短铲，目光锁住凤凰纹暗板；李宝珠右手蜷在身前保护伤指，左手贴住胸前衣料，跟随他的视线。\nEnd-state storytelling frame: 韦训身体只前倾半步，右手仍向下持短铲，但短铲整体位于画外并远离暗板；暗板表面必须完整、无遮挡，绝无工具、铲刃、手或其他物体接触、重叠、覆盖或指向暗板。左手仍扶棺沿，低声确认凤凰胎；李宝珠双手保持原位，眼神从暗板转向画外短铲所在方向。\nDialogue context: 凤凰胎，果然在这座墓里。\nCharacters: 李宝珠、韦训. Visible-frame props: coffin、phoenix-pattern-panel. The grave-robbing shovel remains in story continuity but is entirely outside the visible frame.\nOne cinematic 16:9 Chinese 3D donghua storyboard frame; no text, caption, watermark, contact-sheet grid, duplicate subject, extra limb, or identity drift.";
const removalReasons = {
  "li-baozhu-coffin-damaged-ceremonial-dress": "Removed as a duplicate: the existing Li Baozhu identity sheet visibly contains the same damaged coffin costume and now carries a dual identity/costume instruction.",
  coffin: "Removed because the selected spatial-authority sheet already fixes the visible coffin geometry/material in this shot.",
  "hairpin-intact": "Removed because the storytelling end frame shows the already-broken hairpin; the intact state is no longer visible.",
  "wei-xun-identity": "Removed only where Wei Xun remains outside the coffin/off the visible frame; his voice/action stays in the unchanged prompt.",
  "bronze-nails": "Removed where the nail is not a separately readable end-frame detail and the spatial sheet already includes coffin hardware.",
  "grave-robbing-shovel": "Removed where the final extreme close-up is on the pendant/hand and the shovel is not a readable key subject.",
  "phoenix-pattern-panel": "Removed where the final extreme close-up is on the pendant/hand and the panel is not a readable key subject."
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (value) => String(value || "").replace(/^\\\\\?\\/, "").replaceAll("/", "\\").toLowerCase();
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const suffixOf = (shotId) => shotId.slice(-3);

async function pageWebSocketUrl() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = pages.find((item) => item.type === "page" && String(item.url).includes("localhost:5173"));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("ref_cap_cdp_page_missing");
}

class CdpClient {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
  }
  async send(method, params = {}) {
    const id = ++this.id;
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const response = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "ref_cap_ui_eval_failed");
    return response.result?.value;
  }
  close() { this.ws?.close(); }
}

const uiScript = (body, input) => `(async () => { const input = ${JSON.stringify(input)}; ${body} })()`;

function desiredBindings(shot) {
  const suffix = suffixOf(shot.id);
  const keep = target === "c22-shovel-panel-conflict" && suffix === "C22"
    ? ["tomb-chamber-exterior", "li-baozhu-identity", "wei-xun-identity", "phoenix-pattern-panel"]
    : keepBySuffix[suffix];
  if (!keep) throw new Error(`ref_cap_keep_plan_missing:${shot.id}`);
  const bindings = shot.codexReferenceBindings || [];
  const selected = keep.map((assetId) => {
    const found = bindings.find((item) => item.assetId === assetId);
    if (!found) throw new Error(`ref_cap_binding_missing:${shot.id}:${assetId}`);
    if (found.assetId === "li-baozhu-identity") return { ...found, instruction: liDualInstruction };
    if (found.assetId === "li-baozhu-palace-banquet-costume") return { ...found, usage: "face_identity", instruction: liPalaceDualInstruction };
    if (target === "c22-shovel-panel-conflict" && found.assetId === "phoenix-pattern-panel") return { ...found, instruction: c22PanelNonContactInstruction };
    return { ...found };
  });
  if (selected.length > 5 || selected.length < 1) throw new Error(`ref_cap_count_invalid:${shot.id}:${selected.length}`);
  if (selected[0]?.usage !== "spatial_authority" || !selected.some((item) => item.usage === "face_identity" || item.usage === "body_costume")) throw new Error(`ref_cap_required_usage_missing:${shot.id}`);
  for (let index = 1; index < selected.length; index += 1) if (rank.get(selected[index - 1].usage) > rank.get(selected[index].usage)) throw new Error(`ref_cap_order_invalid:${shot.id}`);
  return selected;
}

async function formalOpenAndHydrate(client) {
  const opened = await client.eval(uiScript(`
    const compact = (value) => String(value || "").replace(/\\s+/g, "").trim();
    const recoveryHeading = [...document.querySelectorAll("p,h1,h2,h3")].find((item) => compact(item.textContent).includes("检测到上次异常退出"));
    const recoveryRoot = recoveryHeading?.closest("section,dialog,.modal,.overlay,div");
    const recoveryClose = [...(recoveryRoot?.querySelectorAll("button") || [])].find((item) => compact(item.textContent) === "关闭");
    if (recoveryClose) recoveryClose.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true }));
    let openProject = null;
    const commandDeadline = Date.now() + 5000;
    while (Date.now() < commandDeadline && !openProject) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      openProject = [...document.querySelectorAll("button")].find((item) => compact(item.textContent) === "打开项目");
    }
    if (!openProject) return { ok: false, reason: "open_project_command_missing" };
    openProject.click();
    let dialog = null;
    const dialogDeadline = Date.now() + 5000;
    while (Date.now() < dialogDeadline && !dialog) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      dialog = [...document.querySelectorAll(".dialog-panel")].find((item) => compact(item.querySelector("h2")?.textContent) === "输入已有.sbproj路径");
    }
    if (!dialog) return { ok: false, reason: "open_project_dialog_missing" };
    const inputElement = dialog.querySelector("input");
    const openButton = [...dialog.querySelectorAll("button")].find((item) => compact(item.textContent) === "打开");
    if (!inputElement || !openButton) return { ok: false, reason: "open_project_controls_missing" };
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(inputElement, input.projectRoot);
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    inputElement.dispatchEvent(new Event("change", { bubbles: true }));
    openButton.click();
    const closeDeadline = Date.now() + 15000;
    while (Date.now() < closeDeadline && document.querySelector(".dialog-panel")) await new Promise((resolve) => setTimeout(resolve, 100));
    const loaded = await window.__TAURI_INTERNALS__.invoke("load_current_project");
    const storeModule = await import("/src/modules/storyboard-core/store.ts");
    storeModule.useStoryboardStore.getState().hydrateFromSnapshot(loaded);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const state = storeModule.useStoryboardStore.getState();
    return { ok: true, projectId: state.project?.id || "", shotCount: state.shots?.length || 0, taskCount: state.generationTasks?.length || 0 };
  `, { projectRoot }));
  if (!opened.ok || opened.projectId !== "yingdi-e01-sample" || opened.shotCount !== 23) throw new Error(`ref_cap_formal_open_failed:${JSON.stringify(opened)}`);
  return opened;
}

async function navigateToCodexPanel(client) {
  const result = await client.eval(`(async () => {
    const compact = (value) => String(value || "").replace(/\\s+/g, "").trim();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true }));
    let advanced = null;
    const commandDeadline = Date.now() + 5000;
    while (Date.now() < commandDeadline && !advanced) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      advanced = [...document.querySelectorAll("button")].find((item) => compact(item.textContent) === "高级工具");
    }
    if (!advanced) return { ok: false, reason: "advanced_tools_missing" };
    advanced.click();
    let pipeline = null;
    const quickbarDeadline = Date.now() + 5000;
    while (Date.now() < quickbarDeadline && !pipeline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      pipeline = document.querySelector('.director-advanced-drawer button[title="生成流水线"]');
    }
    if (!pipeline) return { ok: false, reason: "pipeline_button_missing" };
    const drawer = () => document.querySelector(".director-advanced-drawer .aux-drawer");
    if (!(drawer()?.classList.contains("open") && compact(drawer()?.querySelector("h2")?.textContent) === "生成流水线")) pipeline.click();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const option = drawer()?.querySelector('option[value="codex_task_package"]');
      if (option) {
        const select = option.closest("select");
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "codex_task_package");
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { ok: true, mode: select.value };
      }
    }
    return { ok: false, reason: "codex_panel_timeout" };
  })()`);
  if (!result.ok || result.mode !== "codex_task_package") throw new Error(`ref_cap_navigation_failed:${JSON.stringify(result)}`);
  return result;
}

async function selectShot(client, index, shotId) {
  const result = await client.eval(uiScript(`
    const cards = [...document.querySelectorAll(".preview-shot-card")];
    const card = cards[input.index];
    if (!card) return { ok: false, count: cards.length };
    card.click();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const storeModule = await import("/src/modules/storyboard-core/store.ts");
    return { ok: storeModule.useStoryboardStore.getState().selectedShotId === input.shotId, selected: storeModule.useStoryboardStore.getState().selectedShotId };
  `, { index, shotId }));
  if (!result.ok) throw new Error(`ref_cap_shot_select_failed:${shotId}:${JSON.stringify(result)}`);
}

async function fillReferenceControls(client, references) {
  const prepared = await client.eval(uiScript(`
    const root = [...document.querySelectorAll(".director-advanced-drawer .aux-drawer.open [data-codex-task-package]")].find((item) => !item.closest("[hidden]"));
    if (!root) return { ok: false, reason: "codex_panel_missing" };
    const text = (node) => String(node?.textContent || "").trim();
    const referenceCards = () => [...root.querySelectorAll(".comfy-asset-mode-card")].filter((card) => /^参考图\\s+\\d+$/.test(text(card.querySelector("strong"))));
    while (referenceCards().length > 1) {
      const cards = referenceCards();
      const remove = [...cards[cards.length - 1].querySelectorAll("button")].find((item) => text(item) === "移除");
      if (!remove || remove.disabled) return { ok: false, reason: "reference_remove_failed", count: cards.length };
      remove.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const add = [...root.querySelectorAll("button")].find((item) => text(item).includes("添加参考图"));
    while (referenceCards().length < input.references.length) {
      if (!add || add.disabled) return { ok: false, reason: "reference_add_failed", count: referenceCards().length };
      add.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const cards = referenceCards();
    const setValue = (element, value) => {
      const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      if (!(element instanceof HTMLSelectElement)) element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    for (let index = 0; index < cards.length; index += 1) {
      const reference = input.references[index];
      setValue(cards[index].querySelector("input"), reference.sourcePath);
      setValue(cards[index].querySelector("select"), reference.usage);
      setValue(cards[index].querySelector("textarea"), reference.instruction);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const actual = referenceCards().map((card) => ({ sourcePath: card.querySelector("input")?.value || "", usage: card.querySelector("select")?.value || "", instruction: card.querySelector("textarea")?.value || "" }));
    const expected = input.references.map(({ sourcePath, usage, instruction }) => ({ sourcePath, usage, instruction }));
    return { ok: JSON.stringify(actual) === JSON.stringify(expected), count: actual.length, actual };
  `, { references }));
  if (!prepared.ok) throw new Error(`ref_cap_reference_ui_failed:${JSON.stringify(prepared)}`);
  return prepared;
}

async function editShotPromptThroughUi(client, shotTitle, expectedBefore, nextPrompt) {
  const result = await client.eval(uiScript(`
    const drawer = document.querySelector(".director-advanced-drawer .aux-drawer.open");
    const text = (node) => String(node?.textContent || "").replace(/\\s+/g, " ").trim();
    const statePanel = [...drawer.querySelectorAll("details")].find((item) => text(item.querySelector(":scope > summary")).startsWith("镜头状态（"));
    if (!statePanel) return { ok: false, reason: "shot_state_panel_missing" };
    statePanel.open = true;
    const editorToggle = [...statePanel.querySelectorAll("label")].find((item) => text(item).includes("显示镜头参数编辑"))?.querySelector('input[type="checkbox"]');
    if (!editorToggle) return { ok: false, reason: "shot_editor_toggle_missing" };
    if (!editorToggle.checked) editorToggle.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const card = [...statePanel.querySelectorAll(".comfy-shot-list > li")].find((item) => text(item).includes(input.shotTitle));
    if (!card) return { ok: false, reason: "shot_card_missing", titles: [...statePanel.querySelectorAll(".comfy-shot-list > li")].map((item) => text(item).slice(0, 120)) };
    const parameterDetails = [...card.querySelectorAll("details")].find((item) => text(item.querySelector(":scope > summary")) === "镜头参数");
    if (!parameterDetails) return { ok: false, reason: "shot_parameter_details_missing", cardText: text(card).slice(0, 1000) };
    parameterDetails.open = true;
    const promptLabel = [...parameterDetails.querySelectorAll("label")].find((item) => text(item).startsWith("Prompt") && !text(item).startsWith("视频 Prompt"));
    const prompt = promptLabel?.querySelector("textarea");
    if (!prompt) return { ok: false, reason: "shot_prompt_control_missing" };
    if (prompt.value !== input.expectedBefore && prompt.value !== input.nextPrompt) return { ok: false, reason: "shot_prompt_unexpected_before", actual: prompt.value };
    if (prompt.value !== input.nextPrompt) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(prompt, input.nextPrompt);
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
      prompt.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return { ok: prompt.value === input.nextPrompt, before: input.expectedBefore, after: prompt.value };
  `, { shotTitle, expectedBefore, nextPrompt }));
  if (!result.ok) throw new Error(`c22_shot_prompt_ui_edit_failed:${JSON.stringify(result)}`);
  return result;
}

async function cancelOldTask(client, jobId) {
  const result = await client.eval(uiScript(`
    const root = [...document.querySelectorAll(".director-advanced-drawer .aux-drawer.open [data-codex-task-package]")].find((item) => !item.closest("[hidden]"));
    const text = (node) => String(node?.textContent || "").trim();
    const taskButton = [...root.querySelectorAll(".comfy-asset-diagnostic-list button")].find((item) => text(item).startsWith(input.jobId + " · "));
    if (!taskButton) return { ok: false, reason: "old_task_button_missing", buttons: [...root.querySelectorAll(".comfy-asset-diagnostic-list button")].map(text) };
    taskButton.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (text(taskButton).includes(" · cancelled · ")) return { ok: true, state: "cancelled", already: true };
    const cancel = [...root.querySelectorAll("button")].find((item) => text(item) === "取消任务");
    if (!cancel) return { ok: false, reason: "cancel_button_missing", selectedText: text(taskButton) };
    cancel.click();
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const current = [...root.querySelectorAll(".comfy-asset-diagnostic-list button")].find((item) => text(item).startsWith(input.jobId + " · "));
      if (current && text(current).includes(" · cancelled · ")) return { ok: true, state: "cancelled", already: false };
    }
    return {
      ok: false,
      reason: "cancel_timeout",
      messages: [...root.querySelectorAll(".timeline-meta")].map(text),
      taskTexts: [...root.querySelectorAll(".comfy-asset-diagnostic-list button")].map(text),
      details: [...root.querySelectorAll(".comfy-asset-diagnostic-grid div")].map(text),
      cancelDisabled: cancel.disabled
    };
  `, { jobId }));
  if (!result.ok) throw new Error(`ref_cap_cancel_failed:${jobId}:${JSON.stringify(result)}`);
  return result;
}

async function persistLiveSnapshot(client, bindingPlan) {
  const result = await client.eval(uiScript(`
    const storeModule = await import("/src/modules/storyboard-core/store.ts");
    const state = storeModule.useStoryboardStore.getState();
    storeModule.useStoryboardStore.setState({
      shots: state.shots.map((shot) => input.bindingPlan[shot.id] ? { ...shot, codexReferenceBindings: input.bindingPlan[shot.id] } : shot)
    });
    const snapshot = storeModule.createStoryboardSnapshot(storeModule.useStoryboardStore.getState());
    const saveReceipt = await window.__TAURI_INTERNALS__.invoke("save_current_project", { snapshot });
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot, null, 2) + "\\n");
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    const mirror = await window.__TAURI_INTERNALS__.invoke("write_base64_file", { filePath: input.snapshotPath, base64Data: btoa(binary) });
    return {
      ok: true,
      saveReceipt,
      mirror,
      shotCounts: Object.fromEntries(snapshot.shots.filter((shot) => input.bindingPlan[shot.id]).map((shot) => [shot.id, (shot.codexReferenceBindings || []).length])),
      taskStates: snapshot.generationTasks.filter((task) => Object.hasOwn(input.bindingPlan, task.shotId)).map((task) => ({ shotId: task.shotId, id: task.id, status: task.status, stage: task.stage }))
    };
  `, { bindingPlan, snapshotPath }));
  if (!result.ok) throw new Error("ref_cap_persist_failed");
  return result;
}

async function exportCurrentShot(client, shotId) {
  const result = await client.eval(uiScript(`
    const root = [...document.querySelectorAll(".director-advanced-drawer .aux-drawer.open [data-codex-task-package]")].find((item) => !item.closest("[hidden]"));
    const text = (node) => String(node?.textContent || "").trim();
    const exportButton = [...root.querySelectorAll("button")].find((item) => text(item) === "导出 Codex 任务包");
    if (!exportButton || exportButton.disabled) return { ok: false, reason: "export_button_unavailable", rootText: text(root).slice(-2500) };
    const before = new Set([...root.querySelectorAll(".comfy-asset-diagnostic-list button")].map(text));
    exportButton.click();
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const messages = [...root.querySelectorAll(".timeline-meta")].map(text).filter((value) => value.startsWith("已导出 "));
      const taskTexts = [...root.querySelectorAll(".comfy-asset-diagnostic-list button")].map(text);
      const freshTask = taskTexts.find((value) => !before.has(value) && value.includes(" · queued · "));
      const message = messages.at(-1);
      if (message && freshTask) return { ok: true, message, task: freshTask };
      if (text(exportButton) === "导出 Codex 任务包" && Date.now() > deadline - 297000) {
        return { ok: false, reason: "export_failed", messages: [...root.querySelectorAll(".timeline-meta")].map(text), rootText: text(root).slice(-3000) };
      }
    }
    return { ok: false, reason: "export_timeout" };
  `, { shotId }));
  if (!result.ok) throw new Error(`ref_cap_export_failed:${shotId}:${JSON.stringify(result)}`);
  const match = result.message.match(/^已导出\s+([^：]+)：(.+)$/);
  if (!match) throw new Error(`ref_cap_export_message_invalid:${shotId}:${result.message}`);
  return { shotId, jobId: match[1], packagePath: match[2], taskText: result.task };
}

async function writeJsonThroughTauri(client, filePath, value) {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  const base64Data = Buffer.from(json, "utf8").toString("base64");
  return await client.eval(uiScript(`
    return await window.__TAURI_INTERNALS__.invoke("write_base64_file", { filePath: input.filePath, base64Data: input.base64Data });
  `, { filePath, base64Data }));
}

async function loadPackage(packagePath) {
  const normalizedPath = packagePath.replace(/^\\\\\?\\/, "");
  const requestBytes = await fs.readFile(path.join(normalizedPath, "request.json"));
  return { packagePath, normalizedPath, requestBytes, request: JSON.parse(requestBytes.toString("utf8")), requestDigest: sha256(requestBytes) };
}

const client = new CdpClient(await pageWebSocketUrl());
await client.connect();
await client.send("Runtime.enable");
await client.send("Page.enable");
await client.send("Page.bringToFront");

try {
  const opened = await formalOpenAndHydrate(client);
  await navigateToCodexPanel(client);
  const formal = await client.eval(`(async () => {
    const storeModule = await import("/src/modules/storyboard-core/store.ts");
    return storeModule.createStoryboardSnapshot(storeModule.useStoryboardStore.getState());
  })()`);
  const shotPlan = await readJson(shotPlanPath);
  const shotIndexById = new Map(formal.shots.map((shot, index) => [shot.id, index]));
  const affectedShots = formal.shots.filter((shot) => affectedSuffixes.includes(suffixOf(shot.id)));
  if (affectedShots.length !== affectedSuffixes.length) throw new Error(`ref_cap_affected_shot_count:${affectedShots.length}`);
  const bindingPlan = Object.fromEntries(affectedShots.map((shot) => [shot.id, desiredBindings(shot)]));
  const oldByShot = new Map(shotPlan.shots.map((shot) => [shot.shotId, { jobId: shot.codexJobId, packagePath: shot.packagePath, requestDigest: shot.requestDigest }]));
  const evidence = { phase, opened, ui: [], oldByShot: Object.fromEntries([...oldByShot].filter(([shotId]) => bindingPlan[shotId])), bindingPlan: Object.fromEntries(Object.entries(bindingPlan).map(([shotId, refs]) => [shotId, refs.map((item) => ({ assetId: item.assetId, usage: item.usage, instruction: item.instruction }))])) };

  if (phase === "prepare") {
    for (const shot of affectedShots) {
      await selectShot(client, shotIndexById.get(shot.id), shot.id);
      const old = oldByShot.get(shot.id);
      const cancelled = await cancelOldTask(client, old.jobId);
      const promptEdit = target === "c22-shovel-panel-conflict"
        ? { skipped: true, reason: "product_shot_prompt_editor_renders_only_first_12_shots; core prompt kept byte-identical and panel binding carries non-contact clarification" }
        : null;
      const controls = await fillReferenceControls(client, bindingPlan[shot.id]);
      evidence.ui.push({ shotId: shot.id, oldJobId: old.jobId, cancelled, promptEdit, referenceCount: controls.count });
      console.log(`[ref-cap-prepare] ${shot.id} old=${old.jobId} refs=${controls.count}`);
    }
    evidence.persisted = await persistLiveSnapshot(client, bindingPlan);
    console.log(JSON.stringify({ ok: true, ...evidence }));
  }

  if (phase === "export") {
    const currentPlan = await readJson(shotPlanPath);
    const unaffectedBefore = Object.fromEntries(currentPlan.shots.filter((shot) => !bindingPlan[shot.shotId]).map((shot) => [shot.shotId, shot.requestDigest]));
    const exports = [];
    for (const shot of affectedShots) {
      await selectShot(client, shotIndexById.get(shot.id), shot.id);
      const controls = await fillReferenceControls(client, bindingPlan[shot.id]);
      const exported = await exportCurrentShot(client, shot.id);
      exports.push({ ...exported, referenceCount: controls.count });
      console.log(`[ref-cap-export] ${shot.id} new=${exported.jobId} refs=${controls.count}`);
    }
    const persisted = await persistLiveSnapshot(client, bindingPlan);
    const exportedPackages = [];
    const runtimeUrl = pathToFileURL(path.resolve("src/services/generation-providers/codexTaskPackageRuntime.mjs")).href;
    const runtime = await import(runtimeUrl);
    for (const exported of exports) {
      const pack = await loadPackage(exported.packagePath);
      const old = await loadPackage(oldByShot.get(exported.shotId).packagePath);
      if (JSON.stringify(pack.request.prompt) !== JSON.stringify(old.request.prompt)) throw new Error(`ref_cap_prompt_changed:${exported.shotId}`);
      if (pack.request.references.length !== exported.referenceCount || pack.request.references.length > 5) throw new Error(`ref_cap_export_reference_count:${exported.shotId}`);
      const compiled = runtime.compileCodexStoryboardImageSpec(pack.request).compiledPrompt;
      if (!compiled.includes("MANDATORY HARD CONSTRAINTS:") || !compiled.includes("Exact subject count:") || !compiled.includes("Camera and framing lock:")) throw new Error(`ref_cap_hard_constraints_missing:${exported.shotId}`);
      if (target === "c04-costume-conflict") {
        if (pack.request.references.length !== 4 || pack.request.references.some((reference) => reference.sha256 === liDamagedIdentitySha)) throw new Error("c04_conflicting_identity_sheet_retained");
        const palace = pack.request.references.find((reference) => reference.sha256 === liPalaceCandidateSha);
        if (!palace || palace.usage !== "face_identity" || palace.instruction !== liPalaceDualInstruction || !compiled.includes("Never reintroduce the torn, muddy, coffin-damaged ceremonial clothing")) throw new Error("c04_palace_identity_costume_binding_invalid");
      }
      if (target === "c22-shovel-panel-conflict") {
        if (pack.request.references.length !== 4 || pack.request.references.some((reference) => reference.sha256 === shovelSha) || !pack.request.references.some((reference) => reference.sha256 === phoenixPanelSha)) throw new Error("c22_reference_conflict_not_removed");
        const panel = pack.request.references.find((reference) => reference.sha256 === phoenixPanelSha);
        if (!panel || panel.instruction !== c22PanelNonContactInstruction || !compiled.includes("The entire phoenix-pattern panel surface must remain fully visible and unobstructed")) throw new Error("c22_panel_non_contact_binding_missing");
      }
      for (let index = 1; index < pack.request.references.length; index += 1) if (rank.get(pack.request.references[index - 1].usage) > rank.get(pack.request.references[index].usage)) throw new Error(`ref_cap_request_order_invalid:${exported.shotId}`);
      for (const reference of pack.request.references) {
        const bytes = await fs.readFile(path.join(pack.normalizedPath, ...reference.relativePath.split("/")));
        if (sha256(bytes) !== reference.sha256) throw new Error(`ref_cap_reference_digest:${exported.shotId}:${reference.id}`);
      }
      exportedPackages.push({ ...exported, requestDigest: pack.requestDigest, references: pack.request.references, compiledHasHardConstraints: true });
    }
    const now = new Date().toISOString();
    const exportByShot = new Map(exportedPackages.map((item) => [item.shotId, item]));
    const nextPlan = structuredClone(currentPlan);
    for (const shot of nextPlan.shots) {
      const fresh = exportByShot.get(shot.shotId);
      if (!fresh) continue;
      const prior = { jobId: shot.codexJobId, packagePath: shot.packagePath, requestDigest: shot.requestDigest, status: "cancelled", reason: target === "c04-costume-conflict" ? "superseded_after_palace_costume_identity_conflict" : target === "c22-shovel-panel-conflict" ? "superseded_after_shovel_panel_contact_conflict" : "superseded_after_builtin_imagegen_reference_cap_5", supersededAt: now, supersededByJobId: fresh.jobId };
      shot.supersededCodexJobs = [...(shot.supersededCodexJobs || []), prior];
      shot.codexJobId = fresh.jobId;
      shot.packagePath = fresh.packagePath;
      shot.requestDigest = fresh.requestDigest;
      shot.referenceAssetIds = bindingPlan[shot.shotId].map((reference) => reference.assetId);
      shot.storyboardStatus = "queued";
      shot.videoStatus = "blocked";
    }
    await writeJsonThroughTauri(client, shotPlanPath, nextPlan);
    const shotPlanBytes = Buffer.from(`${JSON.stringify(nextPlan, null, 2)}\n`, "utf8");
    const nextRun = await readJson(runPath);
    nextRun.stage = "storyboard_tasks_queued";
    nextRun.shotPlanDigest = sha256(shotPlanBytes);
    nextRun.updatedAt = now;
    await writeJsonThroughTauri(client, runPath, nextRun);
    const unaffectedAfter = Object.fromEntries(nextPlan.shots.filter((shot) => !bindingPlan[shot.shotId]).map((shot) => [shot.shotId, shot.requestDigest]));
    if (JSON.stringify(unaffectedBefore) !== JSON.stringify(unaffectedAfter)) throw new Error("ref_cap_unaffected_digest_changed");
    console.log(JSON.stringify({ ok: true, phase, opened, exports: exportedPackages.map((item) => ({ shotId: item.shotId, jobId: item.jobId, packagePath: item.packagePath, requestDigest: item.requestDigest, referenceCount: item.referenceCount })), persisted, shotPlanDigest: nextRun.shotPlanDigest, unaffectedDigestsUnchanged: Object.keys(unaffectedAfter).length }));
  }

  if (phase === "sync") {
    const plan = await readJson(shotPlanPath);
    const run = await readJson(runPath);
    const nextPlan = {
      ...plan,
      shots: plan.shots.map((shot) => bindingPlan[shot.shotId]
        ? { ...shot, referenceAssetIds: bindingPlan[shot.shotId].map((reference) => reference.assetId) }
        : shot)
    };
    await writeJsonThroughTauri(client, shotPlanPath, nextPlan);
    const shotPlanDigest = sha256(await fs.readFile(shotPlanPath));
    await writeJsonThroughTauri(client, runPath, { ...run, shotPlanDigest, updatedAt: new Date().toISOString() });
    console.log(JSON.stringify({ ok: true, phase, opened, shotPlanDigest, referenceAssetIds: Object.fromEntries(nextPlan.shots.filter((shot) => bindingPlan[shot.shotId]).map((shot) => [shot.shotId, shot.referenceAssetIds])) }));
  }

  if (phase === "verify") {
    const plan = await readJson(shotPlanPath);
    const run = await readJson(runPath);
    const live = await client.eval(`(async () => { const m = await import("/src/modules/storyboard-core/store.ts"); return m.createStoryboardSnapshot(m.useStoryboardStore.getState()); })()`);
    const active = [];
    let activeOutputFiles = 0;
    let completedActive = 0;
    if (plan.shots.length !== 23 || new Set(plan.shots.map((shot) => shot.shotId)).size !== 23 || new Set(plan.shots.map((shot) => shot.codexJobId)).size !== 23 || new Set(plan.shots.map((shot) => normalize(shot.packagePath))).size !== 23) throw new Error("ref_cap_active_mapping_not_unique");
    for (const shot of plan.shots) {
      const pack = await loadPackage(shot.packagePath);
      if (pack.request.shotId !== shot.shotId || pack.request.jobId !== shot.codexJobId || pack.requestDigest !== shot.requestDigest) throw new Error(`ref_cap_active_lineage:${shot.shotId}`);
      if (pack.request.references.length > 5 || !pack.request.references.some((item) => item.usage === "spatial_authority") || !pack.request.references.some((item) => item.usage === "face_identity" || item.usage === "body_costume")) throw new Error(`ref_cap_active_refs:${shot.shotId}`);
      for (let index = 1; index < pack.request.references.length; index += 1) if (rank.get(pack.request.references[index - 1].usage) > rank.get(pack.request.references[index].usage)) throw new Error(`ref_cap_active_ref_order:${shot.shotId}`);
      for (const reference of pack.request.references) {
        if (!reference.relativePath.startsWith("inputs/") || path.isAbsolute(reference.relativePath)) throw new Error(`ref_cap_reference_path:${shot.shotId}`);
        const inputBytes = await fs.readFile(path.join(pack.normalizedPath, reference.relativePath));
        if (sha256(inputBytes) !== reference.sha256) throw new Error(`ref_cap_reference_digest:${shot.shotId}:${reference.relativePath}`);
      }
      const outputNames = await fs.readdir(path.join(pack.normalizedPath, "outputs"));
      const completedResult = JSON.stringify(outputNames.toSorted()) === JSON.stringify(["candidate.png", "result.json"]);
      if (target === "c04-costume-conflict") {
        if (shot.shotId.endsWith("C04") && outputNames.length !== 0) throw new Error(`c04_new_package_outputs_not_empty:${outputNames.join(",")}`);
        if (!shot.shotId.endsWith("C04") && outputNames.length !== 0 && !completedResult) throw new Error(`ref_cap_active_outputs:${shot.shotId}:${outputNames.join(",")}`);
        if (/C0[1-3]$/.test(shot.shotId) && !completedResult) throw new Error(`c04_required_prior_completed_missing:${shot.shotId}`);
      } else if (target === "c22-shovel-panel-conflict") {
        if (shot.shotId.endsWith("C22") && outputNames.length !== 0) throw new Error(`c22_new_package_outputs_not_empty:${outputNames.join(",")}`);
        if (!shot.shotId.endsWith("C22") && outputNames.length !== 0 && !completedResult) throw new Error(`ref_cap_active_outputs:${shot.shotId}:${outputNames.join(",")}`);
      } else {
        const expectedOutputs = shot.shotId.endsWith("C01") ? ["candidate.png", "result.json"] : [];
        if (JSON.stringify(outputNames.toSorted()) !== JSON.stringify(expectedOutputs)) throw new Error(`ref_cap_active_outputs:${shot.shotId}:${outputNames.join(",")}`);
      }
      if (completedResult && (await readJson(path.join(pack.normalizedPath, "outputs", "result.json"))).state !== "completed") throw new Error(`ref_cap_completed_result_state:${shot.shotId}`);
      if (completedResult) completedActive += 1;
      activeOutputFiles += outputNames.length;
      active.push({ shotId: shot.shotId, jobId: shot.codexJobId, state: completedResult ? "completed_result_pending_ui_import" : "queued", refs: pack.request.references.length, outputs: outputNames });
    }
    const shotPlanBytes = await fs.readFile(shotPlanPath);
    if (target === "c22-shovel-panel-conflict" && completedActive < 21) throw new Error(`c22_completed_active_count:${completedActive}`);
    if (sha256(shotPlanBytes) !== run.shotPlanDigest) throw new Error("ref_cap_run_digest_mismatch");
    const sourceEntries = Object.entries(run.sourceDigests || {});
    if (sourceEntries.length !== 35) throw new Error(`ref_cap_source_digest_count:${sourceEntries.length}`);
    for (const [sourcePath, recorded] of sourceEntries) {
      if (sha256(await fs.readFile(sourcePath)) !== recorded.sha256) throw new Error(`ref_cap_source_digest_changed:${sourcePath}`);
    }
    const taskGroups = Object.groupBy((live.generationTasks || []).filter((task) => task.externalProvider === "codex_task_package"), (task) => task.shotId);
    for (const shotId of Object.keys(bindingPlan)) {
      const tasks = taskGroups[shotId] || [];
      const oldId = plan.shots.find((shot) => shot.shotId === shotId).supersededCodexJobs.at(-1).jobId;
      const activeId = plan.shots.find((shot) => shot.shotId === shotId).codexJobId;
      if (!tasks.some((task) => task.externalJobId === oldId && task.status === "cancelled") || !tasks.some((task) => task.externalJobId === activeId && task.status === "queued")) throw new Error(`ref_cap_task_history:${shotId}`);
    }
    const generated = live.shots.filter((shot) => String(shot.generatedImagePath || "").trim() || String(shot.generatedVideoPath || "").trim());
    const videoUnblocked = live.shots.filter((shot) => shot.videoStatus !== "blocked");
    if (generated.length || videoUnblocked.length || run.videoGeneration !== "blocked" || run.storyboardReview !== "blocked" || run.assetReview !== "pending") throw new Error("ref_cap_gate_changed");
    console.log(JSON.stringify({ ok: true, phase, opened, active, activeOutputFiles, completedActive, taskCount: live.generationTasks.length, generatedPaths: generated.length, videoUnblocked: videoUnblocked.length, run: { stage: run.stage, assetReview: run.assetReview, storyboardReview: run.storyboardReview, videoGeneration: run.videoGeneration, sourceDigests: Object.keys(run.sourceDigests || {}).length, selectedVideoWorkflow: run.selectedVideoWorkflow, selectedVideoWorkflowState: run.selectedVideoWorkflowState }, bindingCounts: Object.fromEntries(live.shots.filter((shot) => bindingPlan[shot.id]).map((shot) => [shot.id, (shot.codexReferenceBindings || []).length])) }));
  }
} finally {
  client.close();
}
