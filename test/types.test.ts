// WHAT THE TYPES REFUSE — checked by `tsc` (npm run check): each `@ts-expect-error` must meet its error, else the
// check fails. At run time these tests only run what does compile

import assert from "node:assert/strict"
import { test } from "node:test"

import { Choose, Do, Eff, Reader, State, eff, of, type RowOf } from "../src/index.ts"

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false
const same = <X, Y>(_: Equal<X, Y>) => {}

const Config = Reader("Config", of<number>())
const Port = Reader("Port", of<number>())
const Counter = State("Counter", of<number>())
const Choice = Choose("Choice")

test("a row is the union of the effects used; a handler takes its own off, by name", () => {
  const p = eff(function* () {
    const a = yield* Config.ask()
    const b = yield* Port.ask()
    yield* Counter.put(a + b)
    return a + b
  })
  same<RowOf<typeof p>, Reader<"Config", number> | Reader<"Port", number> | State<"Counter", number>>(true)
  const q = p.handle(Config.value(1))
  same<RowOf<typeof q>, Reader<"Port", number> | State<"Counter", number>>(true)
  const unhandled = () =>
    // @ts-expect-error — `Port` and `Counter` not handled: no `run`
    q.run()
  void unhandled
  assert.deepEqual(q.handle(Port.value(2)).handle(Counter.from(0)).run(), [3, 3])
})

test("a handler resuming many times takes a program of data only", () => {
  const data = Do.bind("x", () => Choice.among([1, 2])).map(({ x }) => x)
  const gen = eff(function* () {
    return yield* Choice.among([1, 2])
  })
  same<typeof data, Eff<number, Choose<"Choice">, true>>(true)
  same<typeof gen, Eff<number, Choose<"Choice">, boolean>>(true)
  assert.deepEqual(data.handle(Choice.all()).run(), [1, 2])
  // @ts-expect-error — a generator's rest goes on once: `all` does not take it
  gen.handle(Choice.all())
  // and a program of data with a generator in it is one
  // @ts-expect-error
  data.flatMap(() => gen).handle(Choice.all())
})

test("a scope's names are bound once", () => {
  // @ts-expect-error — `x` bound already
  Do.bind("x", () => Config.ask()).bind("x", () => Config.ask())
})
