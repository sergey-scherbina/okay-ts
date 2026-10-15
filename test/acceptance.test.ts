// okay-core's TestAcceptance (its docs/one.md §4): the programs the kernel passes

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  Choose,
  Do,
  Eff,
  ResumedTwice,
  State,
  answering,
  deepMany,
  defer,
  effect,
  eff,
  of,
  op,
  pure,
} from "../src/index.ts"

const Choice = Choose("Choice")
const S = State("S", of<number>())

/** a choice among three, the state read and moved by it: the state's value after */
const counted = Do.bind("x", () => Choice.among([1, 2, 3]))
  .bind("s", () => S.get())
  .do(({ s, x }) => S.put(s + x))
  .bind("t", () => S.get())
  .map(({ t }) => t)

test("D. state outside the choice: threaded through the paths", () => {
  assert.deepEqual(counted.handle(Choice.all()).handle(S.from(0)).run(), [6, [1, 3, 6]])
})

test("D. state inside the choice: each path its own", () => {
  assert.deepEqual(counted.handle(S.from(0)).handle(Choice.all()).run(), [
    [1, 1],
    [2, 2],
    [3, 3],
  ])
})

test("D. a cell inside the choice: one for the run", () => {
  let s = 0
  const cell = answering(S, {
    get: () => s,
    put: (x) => {
      s = x
    },
  })
  assert.deepEqual(counted.handle(cell).map((t) => [s, t] as const).handle(Choice.all()).run(), [
    [1, 1],
    [3, 3],
    [6, 6],
  ])
})

test("A/D. the rests made first, resumed later and in reverse: each its state as it was when captured", () => {
  const Two = effect("Two", { pick: op<[], number>() })
  const twice = deepMany(Two, (a: number) => pure([a]), {
    pick: (k) => {
      const one = k(1)
      const two = k(2)
      return two.flatMap((r2) => one.map((r1) => r1.concat(r2)))
    },
  })
  const picked = Do.bind("s", () => S.get())
    .bind("x", () => Two.pick())
    .do(({ s, x }) => S.put(s + x))
    .bind("t", () => S.get())
    .map(({ t }) => t)
  assert.deepEqual(picked.handle(S.from(10)).map(([, t]) => t).handle(twice).run(), [11, 12])
})

test("F. flatMap and filter over 100 000 empties, in constant stack", () => {
  const xs = Array.from({ length: 100_000 }, (_, i) => i + 1)
  const p = Choice.among(xs).flatMap((x) => (x % 1000 === 0 ? pure(x) : Choice.fail()))
  assert.equal(p.handle(Choice.all()).run().length, 100)
})

test("F. binds nested to the left, 100 000, in constant stack", () => {
  let p: Eff<number> = pure(0)
  for (let i = 0; i < 100_000; i++) p = p.flatMap((x) => pure(x + 1))
  assert.equal(p.run(), 100_000)
})

test("isEven/isOdd, a million calls, mutual, each a state's operation: constant stack", () => {
  const even = (n: number): Eff<boolean, State<"S", number>> =>
    n === 0 ? pure(true) : S.modify((s) => s + 1).flatMap(() => defer(() => odd(n - 1)))
  const odd = (n: number): Eff<boolean, State<"S", number>> =>
    n === 0 ? pure(false) : S.modify((s) => s + 1).flatMap(() => defer(() => even(n - 1)))
  assert.deepEqual(even(1_000_000).handle(S.from(0)).run(), [1_000_000, true])
})

test("a generator's rest resumed twice — the types refusing it, forced: said so at run time", () => {
  const gen = eff(function* () {
    return yield* Choice.among([1, 2])
  })
  const forced = gen as unknown as Eff<number, Choose<"Choice">, true>
  assert.throws(() => forced.handle(Choice.all()).run(), ResumedTwice)
})
