// INTERCEPTORS: control and audit of effects. A sensitive effect is handled only under its audit — each operation
// told, passed on changed, refused; a plain one intercepted for a part of a program; an observer seeing every
// operation of every effect on its way out, and each answer, as many times as the rest gets it. The trail an effect.

import { DEEP, Eff, handleWith, perform, pure, type Op } from "./eff.ts"
import {
  Writer,
  impl,
  of,
  type ArgsOf,
  type Audited,
  type ResOf,
  type Sigs,
  type Tag,
} from "./effects.ts"

/** the operations an interceptor passes on, as `P` — past an audit `Audited<T>`, the only way to them */
export type Pass<S extends Sigs, P> = {
  readonly [K in keyof S]: (...args: ArgsOf<S[K]>) => Eff<ResOf<S[K]>, P>
}

/** an interceptor's clauses: each operation's arguments and `pass`, to a program of its value */
export type Clauses<S extends Sigs, P> = {
  readonly [K in keyof S]: (...args: [...ArgsOf<S[K]>, pass: Pass<S, P>]) => Eff<ResOf<S[K]>, any, boolean>
}

type RowOfClauses<C> = { [K in keyof C]: C[K] extends (...a: any[]) => Eff<any, infer E, any> ? E : never }[keyof C]
type ShotsOfClauses<C> = { [K in keyof C]: C[K] extends (...a: any[]) => Eff<any, any, infer M> ? M : never }[keyof C]

function interceptor(name: string, sigs: Sigs, passKey: string, clauses: unknown) {
  const pass: Record<string, (...args: unknown[]) => Eff<unknown, unknown>> = {}
  for (const k of Object.keys(sigs)) pass[k] = (...args) => perform({ effect: passKey, name: k, args })
  const fs = clauses as Record<string, (...args: unknown[]) => Eff<unknown, unknown, boolean>>
  return impl(name, DEEP, true, undefined, {
    clause: (o, k) => fs[o.name]!(...o.args, pass).flatMap(k),
  })
}

/**
 * THE AUDIT OF A SENSITIVE EFFECT: each of its operations in the program goes through a clause — its arguments and
 * `pass`, its program the operation's value: passed on (`pass.transfer(…)`, as it is or changed), recorded, refused
 * (an error raised). Outside it the row has `Audited<T>`: what only `pass` performs, and only `T`'s handlers take
 */
export function audit<N extends string, S extends Sigs, T, C extends Clauses<S, Audited<T>>>(
  tag: Tag<N, S, T> & { readonly sensitive: true },
  clauses: C,
) {
  const h = interceptor(tag.name, tag.sigs, `audited:${tag.name}`, clauses)
  return <A, E, M extends boolean>(
    p: Eff<A, E, M>,
  ): Eff<A, Exclude<E, T> | RowOfClauses<C>, M | ShotsOfClauses<C>> => handleWith(p, h)
}

/**
 * A PLAIN EFFECT INTERCEPTED for a part of a program: each operation through a clause — `pass` reaching the handler
 * further out, the clause outside the part: its own operations are not intercepted again
 */
export function intercept<N extends string, S extends Sigs, T, C extends Clauses<S, T>>(
  tag: Tag<N, S, T> & { readonly sensitive?: false },
  clauses: C,
) {
  const h = interceptor(tag.name, tag.sigs, tag.name, clauses)
  return <A, E, M extends boolean>(p: Eff<A, E, M>): Eff<A, E | RowOfClauses<C>, M | ShotsOfClauses<C>> =>
    handleWith(p, h)
}

/** an operation as an observer sees it */
export interface Seen {
  /** its effect's name */
  readonly effect: string
  readonly name: string
  readonly args: readonly unknown[]
  readonly sensitive: boolean
  /** as written: `put(6)`, `transfer("acct", 6)` */
  readonly describe: string
}

const show = (x: unknown): string => (typeof x === "string" || typeof x === "object" ? JSON.stringify(x) : String(x))

function seen(o: Op): Seen {
  return {
    effect: o.effect,
    name: o.name,
    args: o.args,
    sensitive: o.sensitive === true,
    describe: `${o.name}(${o.args.map(show).join(", ")})`,
  }
}

/** every sensitive effect of a row as past an audit: an observer is one */
export type AuditedAll<E> = E extends { readonly sensitivity: "sensitive" } ? Audited<E> : E

export interface Watch<E2, M2 extends boolean> {
  /** before the operation goes on — refusing it: an error raised here */
  readonly before?: (op: Seen) => Eff<unknown, E2, M2>
  /** its answer, each time the rest gets it */
  readonly after?: (op: Seen, answer: unknown) => Eff<unknown, E2, M2>
}

/**
 * AN OBSERVER of every operation of every effect on its way out of a part of a program: `before` it goes on, `after`
 * with its answer — programs, run outside the part (their own operations not observed). A sensitive effect's operations
 * passed on as audited: the observer is their audit
 */
export function observe<E2 = never, M2 extends boolean = true>(watch: Watch<E2, M2>) {
  const none = (): Eff<unknown, unknown, boolean> => pure(undefined)
  const before: (op: Seen) => Eff<unknown, unknown, boolean> = watch.before ?? none
  const after: (op: Seen, answer: unknown) => Eff<unknown, unknown, boolean> = watch.after ?? none
  const h = impl(null, DEEP, true, undefined, {
    clause: (o, k) => {
      const s = seen(o)
      const on: Op = o.sensitive ? { effect: `audited:${o.effect}`, name: o.name, args: o.args } : o
      return before(s)
        .flatMap(() => perform<unknown, unknown>(on))
        .flatMap((answer) => after(s, answer).map(() => answer))
        .flatMap(k)
    },
  })
  return <A, E, M extends boolean>(p: Eff<A, E, M>): Eff<A, AuditedAll<E> | E2, M | M2> => handleWith(p, h)
}

// THE TRAIL: an effect — what interceptors and observers write, handled outside them

const AuditWriter = Writer("Audit", of<string>())

export const Audit = {
  ...AuditWriter,
  /** a line of the trail */
  record: AuditWriter.tell,
  /** the trail kept, in order, beside the value */
  trail: AuditWriter.collect,
}
