// THE OKAY WIRE, okay-ts the far side: a host's requests (okay-py's wire.txt, the protocol's transcript) and the
// answers — a program started, its operations the host's, a rest continued twice, a condition thrown where the
// operation is, a run forgotten; values as okay's wire writes them; the same over TCP to a host that accepts

import assert from "node:assert/strict"
import { createServer } from "node:net"
import { createInterface } from "node:readline"
import { test } from "node:test"

import { Do, FarSide, Reader, connect, dec, eff, effect, enc, of, op, pure } from "../src/index.ts"

/** the conformance programs' effect: a choice the HOST makes, an element of the list answered */
const Conf = effect("conf", {
  choose: op<[xs: number[]], number>(),
  price_of: op<[sku: string], number>(),
  discount: op<[amount: number], number>(),
})
const wireName = { name: (o: { name: string }) => o.name }

/** pairs: two choices of the host's, their sum — a program of data, its rests resumed any number of times */
const pairs = () =>
  Do.bind("x", () => Conf.choose([1, 2]))
    .bind("y", () => Conf.choose([10, 20]))
    .map(({ x, y }) => x + y)

test("hello: the shim, JSON lines only", () => {
  assert.deepEqual(new FarSide({}).hello(), {
    shim: 9,
    python: `okay-ts ${process.version}`,
    speaks: { format: ["json"], compress: [], frames: [] },
  })
})

test("a program started; each operation the host's; a rest continued twice — multi-shot across the wire", () => {
  const far = new FarSide({ pairs }, wireName)
  assert.deepEqual(far.serve({ id: 6, op: "program", run: 1, fn: "t:pairs", args: [], callbacks: ["choose"] }), {
    id: 6,
    ok: { perform: "choose", args: [[1, 2]], k: 1 },
  })
  assert.deepEqual(far.serve({ id: 7, op: "continue", run: 1, k: 1, answer: 1 }), {
    id: 7,
    ok: { perform: "choose", args: [[10, 20]], k: 2 },
  })
  assert.deepEqual(far.serve({ id: 8, op: "continue", run: 1, k: 2, answer: 10 }), { id: 8, ok: { done: 11 } })
  assert.deepEqual(far.serve({ id: 9, op: "continue", run: 1, k: 2, answer: 20 }), { id: 9, ok: { done: 21 } })
  assert.deepEqual(far.serve({ id: 10, op: "continue", run: 1, k: 1, answer: 2 }), {
    id: 10,
    ok: { perform: "choose", args: [[10, 20]], k: 3 },
  })
  assert.deepEqual(far.serve({ id: 11, op: "forget", run: 1 }), { id: 11, ok: null })
  const gone = far.serve({ id: 12, op: "continue", run: 1, k: 3, answer: 10 }) as any
  assert.match(gone.condition.message, /not held here/)
})

test("a program's own effects handled here, the rest the host's — under the host's callbacks", () => {
  const Config = Reader("Config", of<number>())
  const total = (sku: string, qty: number) =>
    eff(function* () {
      const price = yield* Conf.price_of(sku)
      const extra = yield* Config.ask()
      return yield* Conf.discount(price * qty + extra)
    }).handle(Config.value(1))
  const far = new FarSide({ total }, wireName)
  assert.deepEqual(far.serve({ id: 1, op: "program", run: 2, fn: "m:total", args: ["tea", 3] }), {
    id: 1,
    ok: { perform: "price_of", args: ["tea"], k: 1 },
  })
  assert.deepEqual(far.serve({ id: 2, op: "continue", run: 2, k: 1, answer: 4 }), {
    id: 2,
    ok: { perform: "discount", args: [13], k: 2 },
  })
  assert.deepEqual(far.serve({ id: 3, op: "continue", run: 2, k: 2, answer: 6.5 }), { id: 3, ok: { done: 6.5 } })
})

test("a condition from the host thrown where the operation is: the generator's catch", () => {
  const careful = () =>
    eff(function* () {
      try {
        return yield* Conf.price_of("tea")
      } catch (e) {
        return `${(e as Error).name}: ${(e as Error).message}`
      }
    })
  const far = new FarSide({ careful }, wireName)
  far.serve({ id: 1, op: "program", run: 3, fn: "careful", args: [] })
  assert.deepEqual(far.serve({ id: 2, op: "continue", run: 3, k: 1, condition: { kind: "Refused", message: "over the limit" } }), {
    id: 2,
    ok: { done: "Refused: over the limit" },
  })
})

test("a failure is a condition by name, and the far side lives on; a generator's rest continued twice, refused", () => {
  const boom = () =>
    pure(0).map(() => {
      throw new TypeError("typescript says no")
    })
  const once = () => eff(function* () {
    return yield* Conf.choose([1, 2])
  })
  const far = new FarSide({ boom, once }, wireName)
  assert.deepEqual(far.serve({ id: 1, op: "program", run: 4, fn: "boom", args: [] }), {
    id: 1,
    condition: { kind: "TypeError", message: "typescript says no" },
  })
  far.serve({ id: 2, op: "program", run: 5, fn: "once", args: [] })
  assert.deepEqual(far.serve({ id: 3, op: "continue", run: 5, k: 1, answer: 1 }), { id: 3, ok: { done: 1 } })
  const again = far.serve({ id: 4, op: "continue", run: 5, k: 1, answer: 2 }) as any
  assert.equal(again.condition.kind, "Error")
  assert.match(again.condition.message, /resumed a second time/)
})

test("values as okay's wire writes them: a record a dict, a big integer digits", () => {
  const v = { sku: "tea", qty: 3, tags: ["a"], big: 2n ** 60n, none: null }
  const w = enc(v)
  assert.deepEqual(w, {
    t: "dict",
    kv: [["sku", "tea"], ["qty", 3], ["tags", ["a"]], ["big", { t: "int", v: (2n ** 60n).toString() }], ["none", null]],
  })
  assert.deepEqual(dec(w), v)
})

test("connected over TCP to a host that accepts: its hello first, then the host drives", async () => {
  const seen: unknown[] = []
  const server = createServer((socket) => {
    const rl = createInterface({ input: socket })
    let n = 0
    rl.on("line", (line) => {
      seen.push(JSON.parse(line))
      n += 1
      if (n === 1) socket.write(JSON.stringify({ id: 1, op: "program", run: 1, fn: "pairs", args: [] }) + "\n")
      else if (n === 2) socket.write(JSON.stringify({ id: 2, op: "continue", run: 1, k: 1, answer: 2 }) + "\n")
      else if (n === 3) socket.write(JSON.stringify({ id: 3, op: "continue", run: 1, k: 2, answer: 20 }) + "\n")
      else socket.end()
    })
  })
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  const port = (server.address() as { port: number }).port
  await connect({ port }, { pairs }, wireName)
  server.close()
  assert.equal((seen[0] as any).shim, 9)
  assert.deepEqual(seen.slice(1), [
    { id: 1, ok: { perform: "choose", args: [[1, 2]], k: 1 } },
    { id: 2, ok: { perform: "choose", args: [[10, 20]], k: 2 } },
    { id: 3, ok: { done: 22 } },
  ])
})
