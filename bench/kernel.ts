// okay-core's KernelBenchmark lanes (okay-rs: benches/kernel.rs), the same programs, the same n, in okay-ts — the
// kernels compared on one machine. A lane as JMH's AverageTime: warm-up, then rounds of a second, µs per run.
// `node bench/kernel.ts [lane…]`

import {
  Choose,
  Do,
  Eff,
  Reader,
  State,
  Throws,
  Writer,
  answering,
  deep,
  defer,
  eff,
  effect,
  of,
  op,
  pure,
} from "../src/index.ts"

const N = 1000

const Tick = effect("Tick", { value: op<[i: number], number>() })
const skips = Array.from({ length: 16 }, (_, i) => effect(`Skip${i}`, { value: op<[i: number], number>() }))

// pure: isEven / isOdd over binds
const isEvenP = (i: number): Eff<boolean> => (i === 0 ? pure(true) : pure(undefined).flatMap(() => isOddP(i - 1)))
const isOddP = (i: number): Eff<boolean> => (i === 0 ? pure(false) : pure(undefined).flatMap(() => isEvenP(i - 1)))

// the ticking lanes
type T = ReturnType<typeof Tick.value> extends Eff<any, infer E> ? E : never
const isEven = (i: number): Eff<boolean, T> => (i === 0 ? pure(true) : Tick.value(i).flatMap(() => isOdd(i - 1)))
const isOdd = (i: number): Eff<boolean, T> => (i === 0 ? pure(false) : Tick.value(i).flatMap(() => isEven(i - 1)))
const ticking = answering(Tick, { value: (i) => i })
const tickingK = deep(Tick, (a: boolean) => pure(a), { value: (i, k) => k(i) })
const skipping = skips.map((s) => answering(s, { value: (i) => i }))
const under16 = (p: Eff<boolean, any>): Eff<boolean, any> => skipping.reduce((q, h) => q.handle(h as any) as any, p)

const answered = () => isEven(N).handle(ticking).run()
const general = () => isEven(N).handle(tickingK).run()
const forwarded = () => (isEven(N).handle(skipping[0] as any) as Eff<boolean, T>).handle(ticking).run()
const forwardedK = () => (isEven(N).handle(skipping[0] as any) as Eff<boolean, T>).handle(tickingK).run()
const forwarded16 = () => (under16(isEven(N)) as Eff<boolean, T>).handle(ticking).run()
const forwardedK16 = () => (under16(isEven(N)) as Eff<boolean, T>).handle(tickingK).run()

// reads
const Ask = Reader("Ask", of<number>())
const asks = (i: number, acc: number): Eff<number, ReturnType<typeof Ask.ask> extends Eff<any, infer E> ? E : never> =>
  i === 0 ? pure(acc) : Ask.ask().flatMap((v) => asks(i - 1, acc + v))
const reads = () => asks(N, 0).handle(Ask.value(1)).run()

// writer: the log in the handler, answered in place
const Tell = effect("Tell", { put: op<[i: number], void>() })
type W = ReturnType<typeof Tell.put> extends Eff<any, infer E> ? E : never
const telling = (i: number): Eff<void, W> => (i === 0 ? pure(undefined) : Tell.put(i).flatMap(() => telling(i - 1)))
const writer = () => {
  const log: number[] = []
  telling(N).handle(answering(Tell, { put: (i) => void log.push(i) })).run()
  return log.length
}

// state: in a cell, and a handler's state (each path of a k its own)
const St = State("St", of<number>())
type S = ReturnType<typeof St.get> extends Eff<any, infer E> ? E : never
const counting = (i: number): Eff<number, S> =>
  i === 0 ? St.get() : St.get().flatMap((x) => St.put(x + 1)).flatMap(() => counting(i - 1))
const stateCell = () => {
  let s = 0
  return counting(N)
    .handle(answering(St, { get: () => s, put: (x) => void (s = x) }))
    .run()
}
const state = () => counting(N).handle(St.from(0)).run()[0]
const Rd = Reader("Rd", of<number>())
const Wr = Writer("Wr", of<number>())
const stateDeep = () => counting(N).handle(St.from(0)).handle(Rd.value(0)).handle(Wr.collect()).run()[1][0]

// maps
const leftMaps = () => {
  let p: Eff<number> = pure(0)
  for (let i = 0; i < N; i++) p = p.map((x) => x + 1)
  return p.run()
}
const rightMaps = () => {
  const go = (i: number): Eff<number> => (i === 0 ? pure(0) : defer(() => go(i - 1)).map((x) => x + 1))
  return go(N).run()
}

// throwing: each raise under its own either
const Err = Throws("Err", of<string>())
const raising = (i: number, acc: number): Eff<number> =>
  i === 0
    ? pure(acc)
    : Err.raise("no")
        .map(() => 0)
        .handle(Err.either())
        .flatMap((e) => raising(i - 1, acc + (e.ok ? e.value : e.error.length)))
const throwing = () => raising(N, 0).run()

// choose: every value of a choice among n
const Choice = Choose("Choice")
const xs = Array.from({ length: N }, (_, i) => i)
const choose = () => Choice.among(xs).map((x) => x + 1).handle(Choice.all()).run().length

// the same, written as generators (`yield*`)
const G_reads = () =>
  eff(function* () {
    let acc = 0
    for (let i = 0; i < N; i++) acc += yield* Ask.ask()
    return acc
  })
    .handle(Ask.value(1))
    .run()
const G_state = () =>
  eff(function* () {
    for (let i = 0; i < N; i++) {
      const x = yield* St.get()
      yield* St.put(x + 1)
    }
    return yield* St.get()
  })
    .handle(St.from(0))
    .run()[1]
const D_state = () => {
  let p: Eff<number, S> = St.get()
  for (let i = 0; i < N; i++) p = Do.bind("x", () => St.get()).do(({ x }) => St.put(x + 1)).flatMap(() => St.get())
  return p.handle(St.from(0)).run()[1]
}

const lanes: [string, () => unknown][] = [
  ["pure", () => isEvenP(N).run()],
  ["answered", answered],
  ["general", general],
  ["forwarded", forwarded],
  ["forwarded16", forwarded16],
  ["forwardedK", forwardedK],
  ["forwardedK16", forwardedK16],
  ["reads", reads],
  ["writer", writer],
  ["stateCell", stateCell],
  ["state", state],
  ["stateDeep", stateDeep],
  ["leftMaps", leftMaps],
  ["rightMaps", rightMaps],
  ["throwing", throwing],
  ["choose", choose],
  ["G:reads", G_reads],
  ["G:state", G_state],
  ["D:state1", D_state],
]

// each lane's answer, the Scala lanes' own
const expect: Record<string, unknown> = {
  pure: true, answered: true, general: true, forwarded: true, forwarded16: true, forwardedK: true, forwardedK16: true,
  reads: N, writer: N, stateCell: N, state: N, stateDeep: N, leftMaps: N, rightMaps: N, throwing: 2 * N, choose: N,
  "G:reads": N, "G:state": N,
}
for (const [name, f] of lanes) {
  if (name in expect && f() !== expect[name]) throw new Error(`${name}: ${String(f())}, not ${String(expect[name])}`)
}

let sink: unknown
function lane(name: string, f: () => unknown) {
  const second = 1000
  for (let w = 0; w < 3; w++) {
    const t = performance.now()
    while (performance.now() - t < second) sink = f()
  }
  const rounds: number[] = []
  for (let r = 0; r < 5; r++) {
    let n = 0
    const t = performance.now()
    let el = 0
    while ((el = performance.now() - t) < second) {
      sink = f()
      n++
    }
    rounds.push((el * 1000) / n)
  }
  const mean = rounds.reduce((a, b) => a + b, 0) / rounds.length
  const sd = Math.sqrt(rounds.reduce((a, b) => a + (b - mean) ** 2, 0) / rounds.length)
  console.log(`${name.padEnd(14)} ${mean.toFixed(3).padStart(10)} ± ${sd.toFixed(3).padStart(7)} us/op`)
}

const only = process.argv.slice(2)
for (const [name, f] of lanes) if (only.length === 0 || only.includes(name)) lane(name, f)
void sink
