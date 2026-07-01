import { Show, createEffect, For } from "solid-js";
import { controller } from "~/state/runtimeStore";

export function ConsolePanel() {
  let body!: HTMLPreElement;

  // auto-scroll to bottom on new output
  createEffect(() => {
    void controller.state.runtime.consoleOutput.length;
    void controller.state.runtime.consoleOutput.join("");
    queueMicrotask(() => {
      if (body) body.scrollTop = body.scrollHeight;
    });
  });

  const output = () => controller.state.runtime.consoleOutput.join("");
  const error = () => controller.state.runtime.error;
  const parseErrors = () => controller.state.parseErrors;

  return (
    <div class="panel console-panel">
      <div class="panel-header">
        <span>Console</span>
        <span class="panel-sub">syscall output</span>
      </div>
      <pre class="console-body" ref={body}>
        <Show when={output()}>
          <span class="console-out">{output()}</span>
        </Show>
        <Show when={error()}>
          <span class="console-err">
            {"\n"}runtime error: {error()?.message}
            {error()?.sourceLine !== null ? ` (line ${error()!.sourceLine! + 1})` : ""}
          </span>
        </Show>
        <Show when={parseErrors().length > 0}>
          <div class="console-parse-errors">
            <For each={parseErrors()}>
              {(e) => <div class="console-err">line {e.line + 1}: {e.message}</div>}
            </For>
          </div>
        </Show>
      </pre>
    </div>
  );
}
