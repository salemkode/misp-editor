import { For } from "solid-js";
import { REGISTER_DISPLAY } from "~/core/registers";
import { controller } from "~/state/runtimeStore";
import { fmt, recentlyReadRegisters, recentlyWrittenRegisters } from "./runtimeState";

export function RegisterPanel() {
  const registers = () => controller.state.runtime.registers;

  return (
    <div class="panel register-panel">
      <div class="panel-header">
        <span>Registers</span>
        <span class="panel-sub">hi {fmt(controller.state.runtime.hi)} · lo {fmt(controller.state.runtime.lo)} · pc {fmt(controller.state.runtime.pc)}</span>
      </div>
      <div class="register-grid">
        <For each={REGISTER_DISPLAY}>
          {(entry) => {
            const isRead = () => recentlyReadRegisters().has(entry.name);
            const isWritten = () => recentlyWrittenRegisters().has(entry.name);
            return (
              <div
                class="register-cell"
                classList={{ read: isRead(), written: isWritten(), zero: entry.name === "$zero" }}
                title={entry.description}
              >
                <span class="reg-name">{entry.name}</span>
                <span class="reg-alias">{entry.alias}</span>
                <span class="reg-value">{fmt(registers()[entry.name])}</span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
