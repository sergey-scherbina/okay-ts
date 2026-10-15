# okay-ts — notes for agents

- TypeScript, no runtime dependencies; Node 26 runs the `.ts` sources as they are (type stripping: so
  `erasableSyntaxOnly` — no enums, no parameter properties, no namespaces). `npm test` = `node --test`, `npm run check`
  = `tsc --noEmit` (TS 7). `@ts-expect-error` lines are the compile-fail tests: each must meet its error.
- okay-core's kernel ported (`okay.one` in ~/work/my/okay-core is the specification): a program is DATA
  (`Eff<A, E, M>`), its effects a union `E`, a handler a function of a program to a program (`p.handle(h)`), the rest
  `k` data. Tests are okay-core's suites, named after them; port the next ones the same way. Keep `test/intercept.test.ts`
  in step with okay-core's TestIntercept and okay-rs's `tests/intercept.rs` (the same trails).
- `M`: `true` a program of data (its rest resumable many times), `boolean` one with a generator in it (once). A
  handler resuming many times (`all`, `first`, `deepMany`) takes `Eff<…, true>` only. The user's decision
  (2026-10-15): NO replay of generators — a generator stays one-shot; many-shot is data (`Do`, `flatMap`).
- Effects are tags by NAME (the run-time identity) and type (`Reader<"Config", number>`); a tag carries its operations'
  signatures (`sigs`) and its row type (`_row`, a phantom), so `answering`/`stateful`/`deep` work for the standard
  effects too.
- Interceptors, the point of it all: a sensitive effect's handlers take `Audited<T>` only (run-time name
  `audited:<name>`); `audit` gives its clauses `pass`, the only maker of those operations; `intercept` for plain
  ones; `observe` sees every operation (a handler for all effects, `effect: null`), passing sensitive ones on audited.
- Benchmarks: `node bench/kernel.ts [lane…]`, okay-core's KernelBenchmark lanes; run under JMH's lock
  (`/tmp/okz/tools/withlock.py`) — other sessions measure on this machine.
- Interop (next): okay-kernel's protocol (`~/work/my/okay-kernel`, docs/design.md) — its Scala.js mirror has no JS
  exports yet; a module `okay-kernel-js` would add them.
- Commits: no Co-Authored-By lines.
