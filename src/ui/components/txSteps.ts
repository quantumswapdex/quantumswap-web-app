/**
 * User-driven multi-step transaction dialog. For compound actions (approve +
 * swap, dual approvals + add liquidity, LP approval + remove, ...) the view
 * supplies an ordered list of steps; the user must click the action button for
 * each one, which invokes the wallet extension. Each step shows a numbered
 * status indicator and the dialog only advances after the on-chain receipt
 * confirms. The (x) header button (from openModal) always closes.
 */

import { el } from "../dom";
import { openModal } from "./modal";

export interface TxStep {
  /** Descriptive label, e.g. "Approve WQ", "Swap", "Create pair". */
  label: string;
  /**
   * Perform this step's on-chain action. Call `onAccepted(hash)` immediately
   * after the extension accepts the transaction (sendTx resolves) so the
   * dialog can switch to the "confirming" spinner while the receipt is polled.
   * Resolve on success, reject on failure (user rejection, revert, timeout).
   */
  run: (onAccepted: (hash: string) => void) => Promise<void>;
}

type StepStatus = "pending" | "active" | "signing" | "confirming" | "done" | "failed";

export function openTxStepsDialog(opts: {
  title: string;
  /** Build the step list (may read allowances, fetch a deadline, etc.). */
  buildSteps: () => Promise<TxStep[]>;
  /** Fired when the dialog closes (X, OK, Close, or Escape). */
  onClose?: () => void;
}): void {
  const handle = openModal({ title: opts.title, body: [], dismissable: true, onClose: opts.onClose });

  let steps: TxStep[] = [];
  let statuses: StepStatus[] = [];
  let currentIndex = 0;
  let running = false;
  let prepared = false;
  let buildError: string | null = null;
  let lastError: string | null = null;

  function errText(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return "Unknown error";
  }

  function stepRow(num: number, label: string, state: StepStatus): HTMLElement {
    const badge = el("span", { class: "tx-badge" });
    if (state === "done") {
      badge.textContent = "\u2713";
    } else if (state === "failed") {
      badge.textContent = "\u2715";
    } else if (state === "confirming") {
      badge.appendChild(el("span", { class: "tx-spinner" }));
    } else {
      badge.textContent = String(num);
    }
    return el("li", { class: `tx-step s-${state}` }, badge, el("span", { class: "tx-label" }, label));
  }

  function actionButton(): HTMLElement {
    const allDone = currentIndex >= steps.length;
    const curState: StepStatus | "done-all" = allDone ? "done-all" : statuses[currentIndex];
    if (allDone) {
      return el("button", { class: "dlg-cta", on: { click: () => handle.close() } }, "OK");
    }
    if (curState === "failed") {
      return el("button", { class: "dlg-cta", on: { click: () => handle.close() } }, "Close");
    }
    if (curState === "signing") {
      return el("button", { class: "dlg-cta", disabled: true }, "Waiting for extension...");
    }
    if (curState === "confirming") {
      return el("button", { class: "dlg-cta", disabled: true }, el("span", { class: "tx-spinner" }), " Confirming...");
    }
    return el("button", { class: "dlg-cta", on: { click: () => void runCurrent() } }, steps[currentIndex].label);
  }

  function render(): void {
    if (buildError !== null) {
      handle.setBody(
        el("div", { class: "dd-status", style: { color: "var(--red, #f87171)" } }, buildError),
        el("button", { class: "dlg-cta", on: { click: () => handle.close() } }, "Close"),
      );
      return;
    }
    if (!prepared) {
      handle.setBody(el("div", { class: "dd-status" }, "Preparing steps..."));
      return;
    }
    if (steps.length === 0) {
      handle.setBody(
        el("div", { class: "dd-status" }, "No steps required."),
        el("button", { class: "dlg-cta", on: { click: () => handle.close() } }, "OK"),
      );
      return;
    }

    const list = el("ol", { class: "tx-step-list" });
    steps.forEach((s, i) => list.appendChild(stepRow(i + 1, s.label, statuses[i])));

    const curState = statuses[currentIndex];
    const body: (Node | string)[] = [list];
    if (currentIndex < steps.length && curState === "failed") {
      body.push(el("div", { class: "dd-status", style: { color: "var(--red, #f87171)" } }, lastError ?? "Step failed."));
    }
    body.push(actionButton());
    handle.setBody(...body);
  }

  async function runCurrent(): Promise<void> {
    if (running || currentIndex >= steps.length) return;
    running = true;
    statuses[currentIndex] = "signing";
    lastError = null;
    render();
    try {
      await steps[currentIndex].run((/* _hash */) => {
        statuses[currentIndex] = "confirming";
        render();
      });
      statuses[currentIndex] = "done";
      currentIndex++;
      if (currentIndex < steps.length) statuses[currentIndex] = "active";
    } catch (err) {
      lastError = errText(err);
      statuses[currentIndex] = "failed";
    } finally {
      running = false;
      render();
    }
  }

  render(); // "Preparing steps..."
  void (async () => {
    try {
      const built = await opts.buildSteps();
      steps = built;
      statuses = built.map(() => "pending" as StepStatus);
      if (statuses.length > 0) statuses[0] = "active";
      prepared = true;
    } catch (err) {
      buildError = errText(err);
      prepared = true;
    }
    render();
  })();
}
