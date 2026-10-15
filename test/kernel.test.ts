// OKAY-KERNEL'S PROTOCOL, with Scala: the kernel's reference machine on Scala.js (okay-kernel's `js` module,
// `sbt kernelJs/fastLinkJS`) — its programs run here under okay-ts's handlers, okay-ts's programs there under the
// kernel's; a rest resumed many times across the border. Skipped where the module is not built: OKAY_KERNEL_JS its
// path, else ../okay-kernel's

import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"

import { Choose, Do, Reader, ResumedTwice, State, eff, fromKernel, of, toKernel, type Computation } from "../src/index.ts"

const path =
  process.env.OKAY_KERNEL_JS ??
  resolve(import.meta.dirname, "../../okay-kernel/js/target/scala-3.9.0/okay-kernel-js-fastopt/main.js")
const built = existsSync(path)
const kernel: any = built ? await import(path) : undefined
const skip = built ? false : `okay-kernel-js not built (${path})`

const Config = Reader("Config", of<number>())
const Counter = State("Counter", of<number>())
const Choice = Choose("Choice")
const names = { Config: "Reader[Integer]", Counter: "State[Integer]", Choice: "Choose" }

test("import: a Scala program under okay-ts's handlers — a reader, every path of a choice", { skip }, () => {
  const scala: Computation<number> = kernel.exampleAskChoose()
  assert.deepEqual(scala.effects(), ["Reader[Integer]", "Choose"])
  const p = fromKernel<number, Reader<"Config", number> | Choose<"Choice">>(scala, names)
  assert.deepEqual(p.handle(Config.value(4)).handle(Choice.all()).run(), [40, 50])
})

test("import: a thousand operations across, each a state's — constant stack", { skip }, () => {
  const p = fromKernel<number, State<"Counter", number>>(kernel.exampleCount(1000), names)
  assert.deepEqual(p.handle(Counter.from(0)).run(), [1000, 1000])
})

test("export: an okay-ts program under the kernel's handlers — a reader, every path, its rest resumed there", { skip }, () => {
  const p = Do.bind("n", () => Config.ask())
    .bind("x", ({ n }) => Choice.among([n, n * 2, n * 3]))
    .map(({ x }) => x + 1)
  assert.deepEqual(kernel.underReaderAll(toKernel(p, names), 5), [6, 11, 16])
})

test("export: a state's operations answered by the kernel's state", { skip }, () => {
  const p = eff(function* () {
    for (let i = 0; i < 100; i++) yield* Counter.modify((s) => s + 2)
    return yield* Counter.get()
  })
  assert.deepEqual(kernel.underState(toKernel(p, names), 1), [201, 201])
})

test("export: a generator's rest resumed twice there — refused, as here", { skip }, () => {
  const gen = eff(function* () {
    const n = yield* Config.ask()
    return yield* Choice.among([n, n + 1])
  })
  assert.throws(() => kernel.underReaderAll(toKernel(gen, names), 1), ResumedTwice)
})

test("a round trip: a Scala program imported, exported again, run under the kernel's handlers", { skip }, () => {
  const again = toKernel(fromKernel(kernel.exampleAskChoose(), names), names)
  assert.deepEqual(kernel.underReaderAll(again, 7), [70, 80])
})
