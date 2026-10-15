// OKAY-KERNEL'S PROTOCOL: a program of another implementation — okay-core's, the kernel's reference machine (on
// Scala.js: okay-kernel's `js` module) — run here under these handlers, and a program of here run under theirs. A
// computation is a plain object: `start(host)` to its steps, `k` resumed any number of times; okay-ts's `Step`,
// `Resume` and `Answers` are the protocol's own. The effects meet by NAME: here an effect is named by its tag
// (`Config`), there by its type (`Reader[Integer]`) — `names` binds the two.

import { Cancelled, Eff, defer, perform, pure, start, type Answers, type Op, type Step } from "./eff.ts"

/** a program of any implementation, handed out */
export interface Computation<A> {
  start(host?: Answers): Step<A>
  /** its row: the names of the effects it may hand out */
  effects(): string[]
}

/** an effect's name here → its name in the kernel: `{ Config: "Reader[Integer]", Choice: "Choose" }` */
export type Names = Readonly<Record<string, string>>

function rename(op: Op, to: Names): Op {
  const e = to[op.effect]
  return e === undefined ? op : { ...op, effect: e }
}

function inverse(names: Names): Names {
  return Object.fromEntries(Object.entries(names).map(([here, there]) => [there, here]))
}

function stepOut<A>(s: Step<A>, names: Names): Step<A> {
  if (s.tag !== "yield") return s
  const k = s.k
  return {
    tag: "yield",
    op: rename(s.op, names),
    k: {
      resume: (x) => stepOut(k.resume(x), names),
      fail: (e) => stepOut(k.fail(e), names),
      cancel: () => stepOut(k.cancel(), names),
    },
  }
}

/** EXPORT: a program of here as a computation — its operations no handler here has in force handed out, named as the
 *  kernel names them; a program of data, so that its rest is resumed any number of times there */
export function toKernel<A>(p: Eff<A, any, boolean>, names: Names = {}): Computation<A> {
  return {
    start: (host) => {
      const here: Answers | undefined =
        host === undefined
          ? undefined
          : {
              answers: (effect) => host.answers(names[effect] ?? effect),
              value: (op) => host.value(rename(op, names)),
            }
      return stepOut(start(p, here), names)
    },
    effects: () => Object.values(names),
  }
}

/** IMPORT: a computation of another implementation as a program of here — each operation it hands out performed
 *  here, by the handlers in force, under the name here; its rest resumed as many times as a handler here resumes */
export function fromKernel<A, E>(c: Computation<A>, names: Names = {}): Eff<A, E> {
  const back = inverse(names)
  const drive = (s: Step<A>): Eff<A, E> => {
    switch (s.tag) {
      case "done":
        return pure(s.value)
      case "failed":
        return defer(() => {
          throw s.error
        })
      case "cancelled":
        return defer(() => {
          throw new Cancelled()
        })
      case "yield": {
        const k = s.k
        return perform<unknown, E>(rename(s.op, back)).flatMap((x) => drive(k.resume(x)))
      }
    }
  }
  return defer(() => drive(c.start()))
}
