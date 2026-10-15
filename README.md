# okay-ts

okay-core's effects in TypeScript: a program of effects is DATA, its effects a ROW in its type (a union), handlers
VALUES not tied to it, the rest `k` data too — and INTERCEPTORS for control and audit: a sensitive effect handled only
under its audit, the types refusing anything else; an observer of every operation of every effect.

```ts
import { Reader, State, eff, of } from "okay-ts"

const Config = Reader("Config", of<number>())
const Counter = State("Counter", of<number>())

const program = eff(function* () {
  const n = yield* Config.ask()
  yield* Counter.modify((s) => s + n)
  const s = yield* Counter.get()
  return s * 2
})
// program: Eff<number, Reader<"Config", number> | State<"Counter", number>, boolean>

program.handle(Config.value(5)).handle(Counter.from(1)).run() // [6, 12]
```

`run()` exists only when the row is empty: an effect not handled is a type error. No dependencies; Node 26 runs the
sources as they are (`npm test`), `tsc` checks them (`npm run check`, the `@ts-expect-error`s included).

## Effects are values

An effect is a tag: a NAME (its identity at run time — two readers of numbers are two effects) and a TYPE in a row
(`Reader<"Config", number>`). The standard ones — `Reader`, `State`, `Writer`, `Throws`, `Choose` — and one's own:

```ts
const Pay = effect("Pay", {
  transfer: op<[to: string, amount: number], string>(),
  balance: op<[], number>(),
}, { sensitive: true })

yield* Pay.transfer("acct", 100) // Eff<string, Effect<"Pay", …, "sensitive">>
```

Handlers, three forms as okay-core's: `answering` (each operation answered in place), `stateful` (a state, each path's
own as it was where its rest was taken), `deep` / `deepMany` (each operation given its rest `k`). For the standard
effects ready ones: `Config.value(v)`, `Counter.from(s0)`, `Log.collect()`, `Err.either()`, `Choice.all()`,
`Choice.first()`. A handler is a function of a program to a program: `p.handle(h)`.

## Two ways to write a program: a generator, and data

**A generator** (`eff(function* () { … yield* p … })`) is the idiom of TypeScript, and the program's rest is the
generator's own state: resumed ONCE at most. Its type says so: `Eff<A, E, boolean>`.

**Data** — `pure`, `flatMap`, `map`, and `Do`, a for over programs whose scope is immutable — can be resumed any number
of times: `Eff<A, E, true>`.

```ts
const paths = Do.bind("b", () => Choice.flip())
  .bind("i", () => Choice.among([1, 2]))
  .do(({ i }) => Counter.modify((s) => s + i))
  .bind("s", () => Counter.get())
  .map(({ b, s }) => [b, s] as const)
  .handle(Choice.all())
```

A handler that resumes `k` many times (`all`, `first`, `deepMany`) takes a program of data only: a generator given to
it is a type error (and, forced by a cast, an error at run time — `ResumedTwice`, saying to write that part as
data). No replay: a generator stays what it is. The two mix: a generator `yield*`s a program of data with its choice
handled inside it.

## Control and audit: interceptors

- An effect declared `{ sensitive: true }` is handled ONLY under its audit: any handler made for it (`answering`,
  `stateful`, `deep`) takes `Audited<Pay>`, never `Pay` — a program performing `Pay` with no audit keeps `Pay` in its
  row: no `run`.
- `audit(Pay, clauses)`: each operation through a clause — its arguments and `pass`, the only way to perform
  `Audited<Pay>` — whose program is the operation's value: passed on as it is or changed, recorded, refused (an error
  raised). Its own operations (the trail, the error) go outside it.
- `intercept(Log, clauses)`: the same for a plain effect, for a part of a program: `pass` reaches the handler further
  out.
- `observe({ before, after })`: every operation of every effect on its way out of a part of a program, its answer each
  time the rest gets it (a choice resumed twice: two answers); refusing one — an error raised in `before`. A sensitive
  effect passing it is passed on audited: the observer is its audit.
- The trail is an effect: `Audit.record(line)`, handled by `Audit.trail()` — a test reads it as a value, production
  sends it anywhere.

```ts
const guarded = (limit: number) =>
  audit(Pay, {
    transfer: (to, amount, pass) => {
      const account = to.trim().toUpperCase()
      if (amount > limit) {
        const why = `refused: ${amount} to ${masked(account)} over the limit ${limit}`
        return Audit.record(why).flatMap(() => Err.raise(why))
      }
      return pass.transfer(account, amount)
        .flatMap((receipt) => Audit.record(`transfer ${amount} to ${masked(account)} → ${receipt}`).map(() => receipt))
    },
    balance: (pass) => pass.balance().flatMap((b) => Audit.record(`balance → ${b}`).map(() => b)),
  })

const [trail, result] = payments.handle(guarded(1000)).handle(bank(1000)).handle(Err.either()).handle(Audit.trail()).run()
// "transfer 100 to ****1234 → ok:ACCT-1234:100", "balance → 900", "refused: 5000 to ****T-77 over the limit 1000"
```

What the types guarantee holds for code without casts: TypeScript's types are erased, and `as any` or a hand-made
`perform` of an audited operation passes them. At run time a sensitive operation reaches only a handler of its audited
name.

## Waiting on the world, and the steps underneath

`wait(promise)` (or `wait(() => promise)`): an operation of `Async` whose value is the promise's; `p.runPromise()`
awaits each — a program whose row is `Async` alone, the rest handled. A rejection is thrown WHERE the operation is: a
generator's `try`/`catch` around the `yield*` catches it, as an exception of the program's own functions. Cancelled
(`runPromise({ signal })`, an `AbortSignal`): its generators' `finally` run — performing effects of their own if they
do — and the promise rejects with `Cancelled`.

```ts
const p = eff(function* () {
  try {
    const user = yield* wait(() => fetchUser(id))
    yield* Log.tell(`got ${user.name}`)
    return user
  } finally {
    yield* Log.tell("done")
  }
})
await p.handle(Log.collect()).runPromise({ signal })
```

Underneath, okay-kernel's protocol: `start(p, host?)` runs a program to its first `Step` — `done`, `yield` (an operation
no handler of it has in force, and its rest `k`: `resume(x)`, `fail(e)`, `cancel()`, any number of times), `failed` (an
exception not caught, as data), `cancelled`. Before handing an operation out it asks the `host` to answer it in place
(`Answers`: no rest taken). `run` and `runPromise` are drivers over it.

## With Scala: okay-kernel's protocol

okay-ts speaks okay-kernel's protocol natively — its `Step`, `Resume`, `Answers` are the protocol's — and okay-kernel's
`js` module (Scala.js, `sbt kernelJs/fastLinkJS`) exports it from Scala to JavaScript: a computation a plain object
`{ start(host), effects() }`. So a program of the kernel's — its reference machine, okay-core's on Scala.js — runs here
under okay-ts's handlers, and a program of here there under the kernel's; a rest resumed many times across the border.

```ts
import { exampleAskChoose, underReaderAll } from "okay-kernel-js"

const names = { Config: "Reader[Integer]", Choice: "Choose" }   // here by name, there by type

fromKernel<number, Reader<"Config", number> | Choose<"Choice">>(exampleAskChoose(), names)
  .handle(Config.value(4)).handle(Choice.all()).run()            // [40, 50]: Scala's choice, every path here

underReaderAll(toKernel(p, names), 5)                            // an okay-ts program under Scala's reader and all
```

`names` binds an effect's name here to its type there. The vocabulary's operations meet by their cases' names
(`get`, `put`, `ask`, `tell`, `raise`, `among`, `send`); `among` is given the number of the values and answered an
index (the kernel's `Among(xs)` turned into one and back). `test/kernel.test.ts`: import, export, a thousand operations
across in constant stack, every path of a choice resumed across, a generator's rest refused there as here, a round trip
— skipped where okay-kernel-js is not built (`OKAY_KERNEL_JS`, else `../okay-kernel`'s).

## With okay, the platform: its wire

okay-ts is a FAR SIDE of okay's wire (okay's specs/remote-foreign.md): a host — okay's `ForeignWorker` over pipes, or
its `ForeignServer` (specs/foreign-server.md) this side connects to — drives. `program` starts one of these programs;
each operation no handler here answers goes to the host as `perform`, its rest kept here by id; the host runs it under
its own handlers — a Scala callback: an audit, a policy, a bank — and continues that rest, the same one as many times
as its handler resumes (a program of data: a choice made by the host, every path).

```ts
// a program here, its payments the server's: the policy and the trail on the other side of the wire
await connect({ host: "bank.internal", port: 9000 }, {
  checkout: (cart: Cart) => eff(function* () {
    const total = yield* Prices.total(cart)            // handled here
    return yield* Pay.transfer(cart.account, total)    // the host's: audited there
  }).handle(prices),
})
```

`connectWs(url, programs)` does the same over a WebSocket — in a page, or behind a proxy that passes HTTP only — to
okay's `ForeignWs` (module okay-foreign-ws). `serveStdio(programs)` serves the same over pipes, as a worker okay
starts. A host's condition (a refusal) is thrown
where the operation was performed — a generator's `try`/`catch` catches it. Values as okay's wire writes them (a record
a `dict`, a big integer digits). `test/wire.test.ts`: the transcript's requests and answers, multi-shot, a condition, a
forgotten run, over TCP.

## The machine

A node and a persistent stack of frames: a handler is a delimiter on it, a rest `k` the frames down to its handler —
kept, laid again any number of times, each time with the handlers' states as they were when it was taken. Constant
stack: a million mutual calls, 100 000 binds nested to the left. An operation answered in place (`answering`) walks to
its handler and back, nothing captured; a state (`stateful`) re-lays the frames above it; a deep one captures lazily.

## Speed

okay-core's kernel lanes (`node bench/kernel.ts`), the same programs and n as okay-core's KernelBenchmark and okay-rs's
`benches/kernel.rs`; one machine (an Apple Mac), Node 26 (V8), µs per run of the program, 2026-10-15:

| lane | Scala (okay-core, JVM) | Rust (okay-rs, the machine) | TypeScript (okay-ts) |
|---|---|---|---|
| `pure` — isEven/isOdd, 1000 binds | 3.08 | 8.50 | 11.7 |
| `answered` — an operation answered in place, each step | 5.58 | 10.81 | 27.0 |
| `general` — a `deep` handler, `k` each step | 9.44 | 36.87 | 59.2 |
| `reads` | 3.15 | 10.14 | 19.9 |
| `stateCell` / `state` | 9.34 / 12.47 | 35.48 / 42.63 | 53.1 / 63.8 |
| `throwing` — each raise under its own either | 20.23 | 88.39 | 59.5 |
| `choose` — every value of a choice among 1000 | 13.24 | 101.52 | 63.2 |
| `reads` / `state` written as generators | — | — | 46.3 / 119.8 |

A first machine, not tuned: half of `answered` is the loop itself, the rest the nodes, frames and arrays an
operation makes (7% in the collector). Generators cost twice the data: a generator's step per operation.

## Tests

okay-core's suites, the same programs and values: `test/std.test.ts` (TestStd), `test/acceptance.test.ts`
(TestAcceptance), `test/intercept.test.ts` (TestIntercept, okay-rs's `tests/intercept.rs`: the same trails),
`test/types.test.ts` (what does not compile), `test/async.test.ts` (promises, failures, cancellation, the steps).

## Next

1. The TCK on okay-ts: okay-kernel's TCK cross-built to Scala.js, run over okay-ts's `Effects` through the same module;
   values beyond numbers and strings (a codec: `Long` and `bigint`, case classes).
2. A remote handler: the operation and its answer as JSON, `k` staying here — a TypeScript program, its sensitive
   effects handled (and audited) by a server in Scala.
3. Answer-type modification (`$`, `shift0`, `PState`).
