import { MipsEditor } from "~/editor/MipsEditor";
import { Controls } from "~/visual/Controls";
import { RegisterPanel } from "~/visual/RegisterPanel";
import { MemoryPanel } from "~/visual/MemoryPanel";
import { ConsolePanel } from "~/visual/ConsolePanel";
import { TracePanel } from "~/visual/TracePanel";
import { SplitView } from "~/visual/SplitView";
import { controller } from "~/state/runtimeStore";

function EditorPane() {
  return (
    <div class="panel editor-panel">
      <div class="panel-header">
        <span>source</span>
        <span class="panel-sub">
          {controller.state.runtime.program?.instructions.length ?? 0} instructions
        </span>
      </div>
      <MipsEditor />
    </div>
  );
}

export function PlaygroundPage() {
  return (
    <div class="playground">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">misp</span>
          <span class="brand-tag">visual MIPS editor</span>
        </div>
        <div class="topbar-status">
          {controller.state.runtime.program?.instructions.length ?? 0} instructions ·{" "}
          {Object.keys(controller.state.runtime.program?.labels ?? {}).length} labels
        </div>
      </header>

      <Controls />

      <main class="workspace">
        <SplitView
          direction="vertical"
          storageKey="main"
          defaultSize={62}
          first={
            <SplitView
              direction="horizontal"
              storageKey="top"
              defaultSize={58}
              first={<EditorPane />}
              second={
                <SplitView
                  direction="vertical"
                  storageKey="right"
                  defaultSize={45}
                  first={<RegisterPanel />}
                  second={<TracePanel />}
                />
              }
            />
          }
          second={
            <SplitView
              direction="horizontal"
              storageKey="bottom"
              defaultSize={50}
              first={<ConsolePanel />}
              second={<MemoryPanel />}
            />
          }
        />
      </main>
    </div>
  );
}
