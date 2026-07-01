import { For, Show } from "solid-js";
import { controller } from "~/state/runtimeStore";
import { fmt, recentlyWrittenAddresses } from "./runtimeState";
import { formatAddress } from "~/core/memory";

type Row = { address: number; label: string | null; value: number; region: "data" | "stack" | "heap"; recent: boolean };

export function MemoryPanel() {
  const rows = (): Row[] => {
    const runtime = controller.state.runtime;
    const program = runtime.program;
    const recent = recentlyWrittenAddresses();

    // Label addresses for display
    const labelByAddr = new Map<number, string>();
    if (program) {
      for (const [name, addr] of Object.entries(program.labels)) {
        if (addr >= program.dataBase) labelByAddr.set(addr, name);
      }
    }

    const result: Row[] = [];
    const seen = new Set<number>();

    // 1. Explicit data labels first (even if zero)
    if (program) {
      for (const entry of program.data) {
        const key = entry.address;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          address: key,
          label: entry.label,
          value: readWordDisplay(runtime, key),
          region: "data",
          recent: recent.has(key),
        });
      }
    }

    // 2. Stack words near $sp
    const sp = runtime.registers.$sp >>> 0;
    const stackTop = controller.state.runtime.memory.layout.stackBase >>> 0;
    for (let addr = sp & ~0x3; addr <= stackTop; addr += 4) {
      if (seen.has(addr)) continue;
      const word = readWordRaw(runtime, addr);
      if (word === 0 && !recent.has(addr)) continue;
      seen.add(addr);
      result.push({ address: addr, label: null, value: word, region: "stack", recent: recent.has(addr) });
    }

    // 3. Any other touched words
    for (const key of runtime.memory.bytes.keys()) {
      if (seen.has(key >>> 0)) continue;
      const region = labelByAddr.has(key) || (program && key >= program.dataBase && key < program.dataBase + 0x10000) ? "data" : "heap";
      result.push({
        address: key >>> 0,
        label: labelByAddr.get(key) ?? null,
        value: readWordRaw(runtime, key),
        region,
        recent: recent.has(key >>> 0),
      });
    }

    result.sort((a, b) => a.address - b.address);
    return result;
  };

  return (
    <div class="panel memory-panel">
      <div class="panel-header">
        <span>Memory</span>
        <span class="panel-sub">$sp {formatAddress(controller.state.runtime.registers.$sp)}</span>
      </div>
      <div class="memory-list">
        <Show when={rows().length > 0} fallback={<div class="empty-hint">No memory written yet.</div>}>
          <For each={rows()}>
            {(row) => (
              <div class="memory-row" classList={{ recent: row.recent, stack: row.region === "stack" }}>
                <span class="mem-region">{row.region[0].toUpperCase()}</span>
                <span class="mem-addr">{formatAddress(row.address)}</span>
                <Show when={row.label}>
                  <span class="mem-label">{row.label}:</span>
                </Show>
                <span class="mem-value">{fmt(row.value)}</span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

function readWordRaw(runtime: typeof controller.state.runtime, address: number): number {
  const key = (address & ~0x3) >>> 0;
  const word = runtime.memory.bytes.get(key) ?? [0, 0, 0, 0];
  return ((word[3] & 0xff) << 24) | ((word[2] & 0xff) << 16) | ((word[1] & 0xff) << 8) | (word[0] & 0xff);
}

function readWordDisplay(runtime: typeof controller.state.runtime, address: number): number {
  return readWordRaw(runtime, address) | 0;
}
