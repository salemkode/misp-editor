import { For, Show } from "solid-js";
import { controller } from "~/state/runtimeStore";
import type { NumberFormat } from "~/core/int32";
import { canStep } from "./runtimeState";

export function Controls() {
  const status = () => controller.state.runtime.status;

  return (
    <div class="controls">
      <div class="controls-group">
        <button
          class="btn btn-primary"
          classList={{ active: controller.state.isRunning }}
          onClick={() => controller.toggleRun()}
          disabled={status() === "finished" || status() === "error"}
          title={controller.state.isRunning ? "Pause" : "Run"}
        >
          {controller.state.isRunning ? "❚❚ Pause" : "▶ Run"}
        </button>
        <button class="btn" onClick={() => controller.step()} disabled={!canStep()} title="Step forward one instruction">
          ⏵ Step
        </button>
        <button class="btn" onClick={() => controller.stepBack()} disabled={controller.state.runtime.history.length === 0} title="Step backward">
          ⏴ Back
        </button>
        <button class="btn" onClick={() => controller.reset()} title="Reset program">
          ↺ Reset
        </button>
        <button class="btn" onClick={() => controller.load()} title="Re-parse and reload">
          ⟳ Load
        </button>
      </div>

      <div class="controls-group">
        <label class="speed">
          <span>Speed</span>
          <input
            type="range"
            min="0"
            max="1000"
            step="50"
            value={1050 - controller.state.stepDelayMs}
            onInput={(e) => controller.setStepDelay(1050 - Number(e.currentTarget.value))}
          />
        </label>
      </div>

      <div class="controls-group">
        <span class="format-label">View</span>
        <For each={["dec", "hex", "bin"] as NumberFormat[]}>
          {(fmt) => (
            <button
              class="btn btn-toggle"
              classList={{ active: controller.state.numberFormat === fmt }}
              onClick={() => controller.setNumberFormat(fmt)}
            >
              {fmt === "dec" ? "Dec" : fmt === "hex" ? "Hex" : "Bin"}
            </button>
          )}
        </For>
      </div>

      <div class="controls-group status-pill" classList={{
        running: status() === "running" || controller.state.isRunning,
        finished: status() === "finished",
        error: status() === "error",
        ready: status() === "ready" || status() === "paused",
      }}>
        <Show when={controller.state.parseErrors.length > 0}>
          <span class="status-parse-error" title={`${controller.state.parseErrors.length} parse error(s)`}>
            ✗ {controller.state.parseErrors.length} error{controller.state.parseErrors.length > 1 ? "s" : ""}
          </span>
        </Show>
        <span class="status-label">{status()}</span>
        <span class="step-count">step {controller.state.runtime.stepCount}</span>
      </div>
    </div>
  );
}
