import { For, Show } from "solid-js";
import { controller } from "~/state/runtimeStore";
import { formatAddress } from "~/core/memory";
import { fmt } from "./runtimeState";

export function TracePanel() {
  const trace = () => controller.state.runtime.lastTrace;
  const history = () => controller.state.runtime.history;

  return (
    <div class="panel trace-panel">
      <div class="panel-header">
        <span>Execution</span>
        <span class="panel-sub">last step + timeline</span>
      </div>

      <div class="trace-section">
        <Show when={trace()} fallback={<div class="empty-hint">Press Step to execute the highlighted line.</div>}>
          {(t) => (
            <div class="trace-detail">
              <div class="trace-raw">
                <code>{t().instruction.raw}</code>
                <span class="trace-pc">pc {formatAddress(t().instruction.pcBefore)} → {formatAddress(t().instruction.pcAfter)}</span>
              </div>
              <div class="trace-explanation">{t().explanation}</div>

              <div class="trace-grid">
                <div class="trace-col">
                  <div class="trace-col-title">reads</div>
                  <For each={t().reads} fallback={<span class="muted">none</span>}>
                    {(r) => (
                      <div class="trace-item">
                        {r.type === "register" ? `${r.name} = ${fmt(r.value)}` : r.type === "immediate" ? `#${fmt(r.value)}` : `mem[${formatAddress(r.address)}] = ${fmt(r.value)}`}
                      </div>
                    )}
                  </For>
                </div>
                <div class="trace-col">
                  <div class="trace-col-title">writes</div>
                  <For each={t().writes} fallback={<span class="muted">none</span>}>
                    {(w) => (
                      <div class="trace-item">
                        {w.type === "register"
                          ? `${w.name}: ${fmt(w.oldValue)} → ${fmt(w.newValue)}`
                          : `mem[${formatAddress(w.address)}]: ${fmt(w.oldValue)} → ${fmt(w.newValue)}`}
                      </div>
                    )}
                  </For>
                </div>
              </div>

              <Show when={t().alu}>
                <div class="trace-alu">ALU {t().alu!.operation}({fmt(t().alu!.inputA)}, {fmt(t().alu!.inputB)}) = {fmt(t().alu!.result)}</div>
              </Show>

              <div class="visual-events">
                <div class="trace-col-title">visual events</div>
                <For each={t().visualEvents}>
                  {(ev) => <div class="visual-event"><span class="ev-tag">{ev.type}</span> {describeEvent(ev)}</div>}
                </For>
              </div>
            </div>
          )}
        </Show>
      </div>

      <div class="timeline">
        <div class="trace-col-title">timeline</div>
        <div class="timeline-list">
          <For each={history()} fallback={<span class="muted">no steps yet</span>}>
            {(snap, i) => (
              <button
                class="timeline-item"
                classList={{
                  current: i() === history().length - 1 && controller.state.runtime.status !== "finished",
                }}
                onClick={() => controller.goToStep(snap.stepNumber)}
                title={`Restore to step ${snap.stepNumber + 1}`}
              >
                <span class="tl-step">{snap.stepNumber + 1}</span>
                <span class="tl-raw">{snap.trace?.instruction.raw ?? "—"}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

function describeEvent(ev: { type: string; [k: string]: unknown }): string {
  switch (ev.type) {
    case "REGISTER_READ":
      return `${ev.register} = ${fmt(ev.value as number)}`;
    case "REGISTER_WRITE":
      return `${ev.register} = ${fmt(ev.value as number)}`;
    case "REGISTER_TO_ALU":
      return `${ev.from} → ALU (${fmt(ev.value as number)})`;
    case "IMMEDIATE_TO_ALU":
      return `#${fmt(ev.value as number)} → ALU`;
    case "ALU_COMPUTE":
      return `${ev.operation}(${fmt(ev.inputA as number)}, ${fmt(ev.inputB as number)}) = ${fmt(ev.result as number)}`;
    case "ALU_TO_REGISTER":
      return `ALU → ${ev.to} (${fmt(ev.value as number)})`;
    case "REGISTER_COMPARE":
      return `${ev.left} vs ${ev.right} → ${ev.result ? "true" : "false"}`;
    case "ADDRESS_CALCULATION":
      return `${ev.base}+${ev.offset} = ${formatAddress(ev.result as number)}`;
    case "MEMORY_READ":
      return `[${formatAddress(ev.address as number)}] = ${fmt(ev.value as number)}`;
    case "MEMORY_WRITE":
      return `[${formatAddress(ev.address as number)}] = ${fmt(ev.value as number)}`;
    case "MEMORY_TO_REGISTER":
      return `[${formatAddress(ev.address as number)}] → ${ev.to} (${fmt(ev.value as number)})`;
    case "REGISTER_TO_MEMORY":
      return `${ev.from} → [${formatAddress(ev.address as number)}] (${fmt(ev.value as number)})`;
    case "PC_MOVE":
      return `line ${Number(ev.fromLine) + 1} → ${Number(ev.toLine) + 1}`;
    case "BRANCH_DECISION":
      return ev.taken ? `taken → ${ev.targetLabel ?? "target"}` : "not taken";
    case "JUMP":
      return `→ ${ev.targetLabel ?? "target"}`;
    case "CONSOLE_OUTPUT":
      return `print ${JSON.stringify(ev.value)}`;
    default:
      return "";
  }
}
