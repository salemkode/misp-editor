export const DEFAULT_PROGRAM = `# misp — visual MIPS editor
# Write code, press Step/Run, watch the CPU work.
#
# Sum the integers 1..5, store the result, and print it.

  .data
result:  .word 0
prompt:  .asciiz "sum(1..5) = "

  .text
main:
  li   $t0, 0          # running total
  li   $t1, 1          # counter
  li   $t2, 5          # limit

loop:
  bgt  $t1, $t2, done  # counter > limit ?
  add  $t0, $t0, $t1   # total += counter
  addi $t1, $t1, 1     # counter++
  j    loop

done:
  sw   $t0, result     # store total in memory
  li   $v0, 4
  la   $a0, prompt
  syscall              # print prompt
  li   $v0, 1
  move $a0, $t0
  syscall              # print integer
  li   $v0, 10
  syscall              # exit
`;
