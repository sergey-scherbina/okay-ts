// okay-core's TestIntercept (okay-rs: tests/intercept.rs), the same programs and trails: a sensitive effect handled only
// under its audit — passed on changed, told masked, refused over the limit; a plain one intercepted for a part of the
// program; an observer seeing every operation of every effect, and its answer each time the rest gets it

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  Audit,
  Choose,
  Reader,
  State,
  Throws,
  Writer,
  answering,
  audit,
  eff,
  effect,
  intercept,
  observe,
  of,
  op,
  pure,
  stateful,
} from "../src/index.ts"

// A SENSITIVE EFFECT: payments

const Pay = effect(
  "Pay",
  {
    /** money sent to an account: a receipt */
    transfer: op<[to: string, amount: number], string>(),
    /** the balance */
    balance: op<[], number>(),
  },
  { sensitive: true },
)

const Err = Throws("Err", of<string>())

/** the bank: a balance, each transfer taken from it */
const bank = (funds: number) =>
  stateful(Pay, funds, {
    transfer: (b, to, amount) => [`ok:${to}:${amount}`, b - amount],
    balance: (b) => [b, b],
  })

/** an account as the trail shows it: its last four */
const masked = (account: string) => `****${account.slice(-4)}`

/** THE AUDIT OF PAYMENTS: over the limit refused, raised; the account written one way (changed before it is passed
 *  on); each transfer told, its account masked, with its receipt; the balance told with its value */
const guarded = (limit: number) =>
  audit(Pay, {
    transfer: (to, amount, pass) => {
      const account = to.trim().toUpperCase()
      if (amount > limit) {
        const why = `refused: ${amount} to ${masked(account)} over the limit ${limit}`
        return Audit.record(why).flatMap(() => Err.raise(why))
      }
      return pass
        .transfer(account, amount)
        .flatMap((receipt) => Audit.record(`transfer ${amount} to ${masked(account)} → ${receipt}`).map(() => receipt))
    },
    balance: (pass) => pass.balance().flatMap((b) => Audit.record(`balance → ${b}`).map(() => b)),
  })

const payments = eff(function* () {
  yield* Pay.transfer(" acct-1234 ", 100)
  const b = yield* Pay.balance()
  yield* Pay.transfer("acct-77", 5000)
  return b
})

test("a sensitive effect under its audit: passed on changed, told masked, refused over the limit", () => {
  const [trail, result] = payments
    .handle(guarded(1000))
    .handle(bank(1000))
    .handle(Err.either())
    .handle(Audit.trail())
    .run()
  assert.deepEqual(trail, [
    "transfer 100 to ****1234 → ok:ACCT-1234:100",
    "balance → 900",
    "refused: 5000 to ****T-77 over the limit 1000",
  ])
  assert.deepEqual(result, { ok: false, error: "refused: 5000 to ****T-77 over the limit 1000" })
})

test("what does not compile: a sensitive effect with no audit, a plain interceptor of it, an audit of a plain one", () => {
  const Log = Writer("Log", of<string>())
  const unaudited = () =>
    // @ts-expect-error — `Pay` not audited: the bank takes only `Audited<Pay>`, `Pay` stays in the row, no `run`
    payments.handle(bank(1000)).run()
  // @ts-expect-error — a sensitive effect is not intercepted as a plain one
  const plain = () => intercept(Pay, { transfer: (to, n, pass) => pass.transfer(to, n), balance: (pass) => pass.balance() })
  // @ts-expect-error — nor a plain one audited
  const notSensitive = () => audit(Log, { tell: (w, pass) => pass.tell(w) })
  // and a bank answering in place is the same: `Audited<Pay>` only
  const inPlace = answering(Pay, { transfer: (to, n) => `ok:${to}:${n}`, balance: () => 0 })
  const unauditedInPlace = () =>
    // @ts-expect-error
    payments.handle(inPlace).run()
  void [unaudited, plain, notSensitive, unauditedInPlace]
  assert.throws(() => (payments.handle(bank(1000)) as any).run(), /no handler of Pay/)
})

test("a plain effect intercepted for a part of the program: its own operation reaches the handler", () => {
  const Log = Writer("Log", of<string>())
  const shouting = intercept(Log, { tell: (w, pass) => pass.tell(w.toUpperCase()) })
  const p = Log.tell("a").flatMap(() => Log.tell("b").handle(shouting))
  assert.deepEqual(p.handle(Log.collect()).run(), [["a", "B"], undefined])
})

const show = (x: unknown) => (typeof x === "string" ? JSON.stringify(x) : String(x))

/** an observer telling every operation and its answer to the trail */
const telling = observe({
  before: (op) => Audit.record(`${op.effect} ${op.describe}`),
  after: (_, answer) => Audit.record(`  → ${show(answer)}`),
})

const Config = Reader("Config", of<number>())
const Counter = State("Counter", of<number>())

test("an observer sees every operation of every effect on its way out, and its answer; the sensitive ones audited", () => {
  const p = eff(function* () {
    const n = yield* Config.ask()
    yield* Counter.modify((s) => s + n)
    const s = yield* Counter.get()
    return yield* Pay.transfer("acct", s)
  })
  const [trail, [, [, receipt]]] = p
    .handle(telling)
    .handle(Config.value(5))
    .handle(Counter.from(1))
    .handle(bank(100))
    .handle(Audit.trail())
    .run()
  assert.equal(receipt, "ok:acct:6")
  assert.deepEqual(trail, [
    "Config ask()", "  → 5",
    "Counter get()", "  → 1",
    "Counter put(6)", "  → undefined",
    "Counter get()", "  → 6",
    'Pay transfer("acct", 6)', '  → "ok:acct:6"',
  ])
})

test("an observer refusing a sensitive effect: a read-only run", () => {
  const readOnly = observe({
    before: (op) => {
      if (!op.sensitive) return pure(undefined)
      const why = `read-only: ${op.describe} refused`
      return Audit.record(why).flatMap(() => Err.raise(why))
    },
  })
  const p = Config.ask().flatMap((n) => Pay.transfer("acct", n))
  const [trail, result] = p
    .handle(readOnly)
    .handle(Config.value(5))
    .handle(bank(100))
    .handle(Err.either())
    .handle(Audit.trail())
    .run()
  assert.deepEqual(trail, ['read-only: transfer("acct", 5) refused'])
  assert.deepEqual(result, { ok: false, error: 'read-only: transfer("acct", 5) refused' })
})

test("an answer told each time the rest gets it: a choice resumed twice, two answers", () => {
  const Choice = Choose("Choice")
  const [trail, paths] = Choice.flip().handle(telling).handle(Choice.all()).handle(Audit.trail()).run()
  assert.deepEqual(paths, [true, false])
  assert.deepEqual(trail, ["Choice among(2)", "  → 0", "  → 1"])
})
