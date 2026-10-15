// WAITING ON THE WORLD: an operation whose value is a promise's (`wait`), `runPromise` awaiting it; a rejection thrown
// where the operation is — a generator's try/catch catches it; a cancellation running the generators' `finally`.
// And the steps underneath (okay-kernel's protocol): a program started, its yields, a host answering in place

import assert from "node:assert/strict"
import { test } from "node:test"

import { Cancelled, Choose, Do, Reader, Unhandled, Writer, eff, of, start, wait } from "../src/index.ts"

const sleep = <A>(ms: number, a: A) => new Promise<A>((ok) => setTimeout(() => ok(a), ms))
const Config = Reader("Config", of<number>())
const Log = Writer("Log", of<string>())

test("a program waiting on promises, its other effects handled", async () => {
  const p = eff(function* () {
    const base = yield* Config.ask()
    const a = yield* wait(sleep(5, 1))
    yield* Log.tell(`a ${a}`)
    const b = yield* wait(() => sleep(5, 2))
    return base + a + b
  })
  assert.deepEqual(await p.handle(Config.value(10)).handle(Log.collect()).runPromise(), [["a 1"], 13])
})

test("a rejection thrown where the operation is: the generator's catch", async () => {
  const p = eff(function* () {
    try {
      yield* wait(Promise.reject(new Error("down")))
      return "not here"
    } catch (e) {
      yield* Log.tell(`caught ${(e as Error).message}`)
      return "recovered"
    }
  })
  assert.deepEqual(await p.handle(Log.collect()).runPromise(), [["caught down"], "recovered"])
})

test("a rejection not caught: runPromise rejects with it", async () => {
  const p = eff(function* () {
    yield* wait(Promise.reject(new Error("down")))
    return 1
  })
  await assert.rejects(p.runPromise(), /down/)
})

test("an exception of a program's own function: a failure, the generator's catch too", () => {
  const p = eff(function* () {
    try {
      return yield* Config.ask().map((n) => {
        if (n > 1) throw new Error(`too big: ${n}`)
        return n
      })
    } catch (e) {
      return -1
    }
  })
  assert.equal(p.handle(Config.value(5)).run(), -1)
})

test("cancelled while it waits: its finally run — its own effects too — the promise rejected with Cancelled", async () => {
  let cleaned = false
  const p = eff(function* () {
    try {
      yield* Log.tell("start")
      yield* wait(sleep(10_000, 0))
      return "not here"
    } finally {
      yield* Log.tell("cleaned")
      cleaned = true
    }
  })
  const abort = new AbortController()
  setTimeout(() => abort.abort(), 10)
  await assert.rejects(p.handle(Log.collect()).runPromise({ signal: abort.signal }), Cancelled)
  assert.ok(cleaned)
})

test("every path waiting: a choice of data over promises", async () => {
  const Choice = Choose("Choice")
  const p = Do.bind("x", () => Choice.among([1, 2, 3]))
    .bind("y", ({ x }) => wait(sleep(1, x * 10)))
    .map(({ x, y }) => x + y)
    .handle(Choice.all())
  assert.deepEqual(await p.runPromise(), [11, 22, 33])
})

test("the steps: an operation with no handler handed out, its rest resumed — twice", () => {
  const p = Config.ask().map((n) => n * 2)
  const s = start(p)
  assert.equal(s.tag, "yield")
  if (s.tag !== "yield") return
  assert.deepEqual([s.op.effect, s.op.name], ["Config", "ask"])
  assert.deepEqual(s.k.resume(5), { tag: "done", value: 10 })
  assert.deepEqual(s.k.resume(7), { tag: "done", value: 14 })
})

test("a host answering in place: no rest taken", () => {
  const p = Config.ask().flatMap((a) => Config.ask().map((b) => a + b))
  let asked = 0
  const s = start(p, { answers: (e) => e === "Config", value: () => ++asked })
  assert.deepEqual(s, { tag: "done", value: 3 })
})

test("run of a program with an operation no one handles (the types forced): Unhandled", () => {
  assert.throws(() => (Config.ask() as any).run(), Unhandled)
})
