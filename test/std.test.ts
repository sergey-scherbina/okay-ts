// okay-core's TestStd: the standard effects, each by its handler — a program written as a generator, and as data

import assert from "node:assert/strict"
import { test } from "node:test"

import { Choose, Do, Reader, State, Throws, Writer, eff, of, pure } from "../src/index.ts"

const Config = Reader("Config", of<number>())
const Counter = State("Counter", of<number>())
const Log = Writer("Log", of<string>())
const Err = Throws("Err", of<string>())

test("reader, state, writer, throws: each by its handler, any order of the row", () => {
  const p = eff(function* () {
    const n = yield* Config.ask()
    yield* Counter.modify((s) => s + n)
    const s = yield* Counter.get()
    yield* Log.tell(`s ${s}`)
    if (s > 100) yield* Err.raise("big")
    return s * 2
  })
  assert.deepEqual(
    p.handle(Config.value(5)).handle(Counter.from(1)).handle(Log.collect()).handle(Err.either()).run(),
    { ok: true, value: [["s 6"], [6, 12]] },
  )
  assert.deepEqual(
    p.handle(Err.either()).handle(Config.value(500)).handle(Counter.from(1)).handle(Log.collect()).run(),
    [["s 501"], [501, { ok: false, error: "big" }]],
  )
})

test("the same program as data: Do", () => {
  const p = Do.bind("n", () => Config.ask())
    .do(({ n }) => Counter.modify((s) => s + n))
    .bind("s", () => Counter.get())
    .do(({ s }) => Log.tell(`s ${s}`))
    .do(({ s }) => (s > 100 ? Err.raise("big") : pure(undefined)))
    .map(({ s }) => s * 2)
  assert.deepEqual(
    p.handle(Config.value(5)).handle(Counter.from(1)).handle(Log.collect()).handle(Err.either()).run(),
    { ok: true, value: [["s 6"], [6, 12]] },
  )
})

const Choice = Choose("Choice")

test("choose: every path, a state inside each its own", () => {
  const p = Do.bind("b", () => Choice.flip())
    .bind("i", () => Choice.among([1, 2]))
    .do(({ i }) => Counter.modify((s) => s + i))
    .bind("s", () => Counter.get())
    .map(({ b, s }) => [b, s] as const)
  assert.deepEqual(p.handle(Choice.all()).handle(Counter.from(0)).run()[1], [
    [true, 1],
    [true, 3],
    [false, 4],
    [false, 6],
  ])
})

test("a generator inside a choice made of data: the choice handled inside, the generator resumed once", () => {
  const p = eff(function* () {
    const base = yield* Config.ask()
    const sums = yield* Do.bind("x", () => Choice.among([1, 2, 3]))
      .map(({ x }) => x + base)
      .handle(Choice.all())
    return sums
  })
  assert.deepEqual(p.handle(Config.value(10)).run(), [11, 12, 13])
})

test("first: the first path not failing", () => {
  const p = Choice.among([1, 2, 3, 4, 5]).flatMap((x) => (x * x < 10 ? Choice.fail() : pure(x)))
  assert.equal(p.handle(Choice.first()).run(), 4)
})
