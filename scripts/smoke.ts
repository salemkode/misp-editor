import { parse } from "../src/core/parser/parser";
import { loadProgram, step, restoreSnapshot } from "../src/core/runtime/runtime";

function runProgram(source: string, maxSteps = 200): void {
  const { program, errors } = parse(source);
  if (errors.length > 0 || !program) {
    console.log("PARSE ERRORS:");
    for (const e of errors) console.log(`  line ${e.line + 1}: ${e.message}`);
    return;
  }

  let state = loadProgram(program);
  console.log(`Loaded ${program.instructions.length} instructions. entry=${program.entryIndex}`);
  console.log("labels:", program.labels);

  let steps = 0;
  while (state.status !== "finished" && state.status !== "error" && steps < maxSteps) {
    if (state.currentInstructionIndex === null) break;
    const before = state.registers.$t0;
    const result = step(state);
    state = result.nextState;
    const t = result.trace;
    console.log(
      `[${steps}] ${t.instruction.raw.padEnd(28)} | t0=${state.registers.$t0} t1=${state.registers.$t1} v0=${state.registers.$v0} | ${t.explanation}`,
    );
    steps++;
  }

  console.log("\nfinal status:", state.status);
  console.log("console output:", JSON.stringify(state.consoleOutput.join("")));
  if (state.status === "error" && state.error) {
    console.log("error:", state.error.message, "at line", state.error.sourceLine);
  }
  console.log("history length:", state.history.length);
}

console.log("=== TEST 1: arithmetic + memory + print ===");
runProgram(`
.data
  x: .word 5
  msg: .asciiz "result="
.text
main:
  li   $t0, 5
  li   $t1, 7
  add  $t2, $t0, $t1
  sw   $t2, x
  lw   $t3, x
  li   $v0, 4
  la   $a0, msg
  syscall
  li   $v0, 1
  move $a0, $t3
  syscall
  li   $v0, 10
  syscall
`);

console.log("\n=== TEST 2: loop with branch ===");
runProgram(`
.text
main:
  li   $t0, 0
  li   $t1, 5
  li   $t2, 0
loop:
  beq  $t2, $t1, done
  add  $t0, $t0, $t2
  addi $t2, $t2, 1
  j    loop
done:
  li   $v0, 1
  move $a0, $t0
  syscall
  li   $v0, 10
  syscall
`);

console.log("\n=== TEST 3: function call jal/jr ===");
runProgram(`
.text
main:
  li   $a0, 10
  jal  double
  move $t0, $v0
  li   $v0, 1
  move $a0, $t0
  syscall
  li   $v0, 10
  syscall
double:
  add  $v0, $a0, $a0
  jr   $ra
`);

console.log("\n=== TEST 4: history + time travel ===");
{
  const { program, errors } = parse(`
.text
main:
  li   $t0, 1
  li   $t1, 2
  add  $t2, $t0, $t1
`);
  if (errors.length || !program) { console.log("parse failed"); }
  else {
    let st = loadProgram(program);
    const steps: number[] = [];
    for (let i = 0; i < 3; i++) { st = step(st).nextState; steps.push(st.registers.$t2); }
    console.log("after 3 steps: t2 =", st.registers.$t2, "history =", st.history.length, "stepCount =", st.stepCount);

    // step back: should revert the add (t2 back to 0)
    const prev = st.history[st.history.length - 1];
    const back = restoreSnapshot(st, prev);
    back.history = st.history.slice(0, -1);
    back.stepCount = back.history.length;
    console.log("after stepBack: t2 =", back.registers.$t2, "history =", back.history.length, "stepCount =", back.stepCount);

    // re-step: should produce t2=3 again
    const reStepped = step(back).nextState;
    console.log("after re-step:  t2 =", reStepped.registers.$t2, "history =", reStepped.history.length, "stepCount =", reStepped.stepCount);

    // jump back to step 1 (after first li)
    const target = reStepped.history[1];
    const jumped = restoreSnapshot(reStepped, target);
    jumped.history = reStepped.history.slice(0, 1);
    jumped.stepCount = 1;
    console.log("after goToStep(1): t0 =", jumped.registers.$t0, "t1 =", jumped.registers.$t1, "t2 =", jumped.registers.$t2, "history =", jumped.history.length, "stepCount =", jumped.stepCount);
  }
}
