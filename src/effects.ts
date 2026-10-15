// EFFECTS AS VALUES: a tag by name — the effect's identity at run time and its type in a row (`Reader<"Config",
// number>`) — with its operations and its handlers. Two readers of numbers are two effects, by their names.

import { ANSWER, DEEP, Eff, STATE, handleWith, perform, pure, type Impl, type Op } from "./eff.ts"

/** a type named where nothing else names it: `Reader("Config", of<number>())` */
export interface Of<T> {
  readonly _of?: (t: T) => T
}
export const of = <T>(): Of<T> => ({})

function op(effect: string, name: string, args: readonly unknown[]): Op {
  return { effect, name, args }
}

export function impl(effect: string | null, kind: number, many: boolean, init: unknown, parts: Partial<Impl>): Impl {
  return {
    effect,
    kind,
    many,
    init,
    ret: parts.ret ?? ((a) => pure(a)),
    ...(parts.value ? { value: parts.value } : {}),
    ...(parts.step ? { step: parts.step } : {}),
    ...(parts.clause ? { clause: parts.clause } : {}),
  }
}

/** a value taken from `Eff<unknown>` back at its type — the handler's own operation's */
const as = <T>(v: unknown): T => v as T

// READER

export interface Reader<N extends string, V> {
  readonly effect: N
  readonly kind: "Reader"
  readonly _v: (v: V) => V
}

export function Reader<const N extends string, V>(name: N, _: Of<V>) {
  type R = Reader<N, V>
  return {
    name,
    sigs: { ask: op_<[], V>() },
    _row: undefined as unknown as R,
    ask: (): Eff<V, R> => perform(op(name, "ask", [])),
    /** each ask answered `v` */
    value:
      (v: V) =>
      <A, E, M extends boolean>(p: Eff<A, E, M>): Eff<A, Exclude<E, R>, M> =>
        handleWith(p, impl(name, ANSWER, true, undefined, { value: () => v })),
  }
}

// STATE

export interface State<N extends string, S> {
  readonly effect: N
  readonly kind: "State"
  readonly _s: (s: S) => S
}

export function State<const N extends string, S>(name: N, _: Of<S>) {
  type R = State<N, S>
  const get = (): Eff<S, R> => perform(op(name, "get", []))
  const put = (s: S): Eff<void, R> => perform(op(name, "put", [s]))
  return {
    name,
    sigs: { get: op_<[], S>(), put: op_<[s: S], void>() },
    _row: undefined as unknown as R,
    get,
    put,
    modify: (f: (s: S) => S): Eff<void, R> => get().flatMap((s) => put(f(s))),
    /** a state from `s0`, each path's own as it was where its rest was taken: the last state beside the value */
    from:
      (s0: S) =>
      <A, E, M extends boolean>(p: Eff<A, E, M>): Eff<readonly [S, A], Exclude<E, R>, M> =>
        handleWith(
          p,
          impl(name, STATE, true, s0, {
            step: (o, s) => (o.name === "get" ? [s, s] : [undefined, o.args[0]]),
            ret: (a, s) => pure([s, a] as const),
          }),
        ),
  }
}

// WRITER

export interface Writer<N extends string, W> {
  readonly effect: N
  readonly kind: "Writer"
  readonly _w: (w: W) => W
}

/** a list kept backwards, shared by the paths that hold it */
type Told<W> = { readonly w: W; readonly prev: Told<W> } | null

function told<W>(t: Told<W>): W[] {
  const out: W[] = []
  for (let c = t; c !== null; c = c.prev) out.push(c.w)
  return out.reverse()
}

export function Writer<const N extends string, W>(name: N, _: Of<W>) {
  type R = Writer<N, W>
  return {
    name,
    sigs: { tell: op_<[w: W], void>() },
    _row: undefined as unknown as R,
    tell: (w: W): Eff<void, R> => perform(op(name, "tell", [w])),
    /** all that was told, in order, beside the value */
    collect:
      () =>
      <A, E, M extends boolean>(p: Eff<A, E, M>): Eff<readonly [W[], A], Exclude<E, R>, M> =>
        handleWith(
          p,
          impl(name, STATE, true, null, {
            step: (o, s) => [undefined, { w: o.args[0], prev: s as Told<W> }],
            ret: (a, s) => pure([told(s as Told<W>), a] as const),
          }),
        ),
  }
}

// THROWS

export interface Throws<N extends string, X> {
  readonly effect: N
  readonly kind: "Throws"
  readonly _x: (x: X) => X
}

export type Result<A, X> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: X }

export function Throws<const N extends string, X>(name: N, _: Of<X>) {
  type R = Throws<N, X>
  return {
    name,
    sigs: { raise: op_<[x: X], never>() },
    _row: undefined as unknown as R,
    /** an error: the rest dropped by the handler */
    raise: (x: X): Eff<never, R> => perform(op(name, "raise", [x])),
    /** the value, or the error raised */
    either:
      () =>
      <A, E, M extends boolean>(p: Eff<A, E, M>): Eff<Result<A, X>, Exclude<E, R>, M> =>
        handleWith(
          p,
          impl(name, DEEP, false, undefined, {
            clause: (o) => pure({ ok: false, error: o.args[0] }),
            ret: (a) => pure({ ok: true, value: a }),
          }),
        ),
  }
}

// CHOOSE: its handlers resume the rest many times — a program of data only

export interface Choose<N extends string> {
  readonly effect: N
  readonly kind: "Choose"
}

export function Choose<const N extends string>(name: N) {
  type R = Choose<N>
  const pick = (n: number): Eff<number, R> => perform(op(name, "among", [n]))
  /** the paths from the `i`-th of `n`, each the rest resumed with its index: their values, in order — kept as a list
   *  of the paths' lists, shared by whatever resumes this clause again, flattened at the end */
  type Lists<A> = { readonly xs: A[]; readonly prev: Lists<A> } | null
  const paths = <A>(k: (x: unknown) => Eff<unknown, unknown, boolean>, i: number, n: number, acc: Lists<A>): Eff<A[], unknown, boolean> =>
    i >= n
      ? pure(flatten(acc))
      : k(i).flatMap((xs) => paths<A>(k, i + 1, n, { xs: xs as A[], prev: acc }))
  const flatten = <A>(acc: Lists<A>): A[] => {
    const parts: A[][] = []
    for (let c = acc; c !== null; c = c.prev) parts.push(c.xs)
    return parts.reverse().flat()
  }
  const firstOf = <A>(k: (x: unknown) => Eff<unknown, unknown, boolean>, i: number, n: number): Eff<A | undefined, unknown, boolean> =>
    i >= n ? pure(undefined) : k(i).flatMap((a) => (a === undefined ? firstOf<A>(k, i + 1, n) : pure(a as A)))
  return {
    name,
    sigs: { among: op_<[n: number], number>() },
    _row: undefined as unknown as R,
    /** one of `xs`, each in turn */
    among: <X>(xs: readonly X[]): Eff<X, R> => pick(xs.length).map((i) => xs[i]!),
    /** true, then false */
    flip: (): Eff<boolean, R> => pick(2).map((i) => i === 0),
    /** no value: this path dropped */
    fail: (): Eff<never, R> => perform(op(name, "among", [0])),
    /** every value, one per path, in order */
    all:
      () =>
      <A, E>(p: Eff<A, E, true>): Eff<A[], Exclude<E, R>, true> =>
        handleWith(
          p,
          impl(name, DEEP, true, undefined, {
            clause: (o, k) => paths<A>(k, 0, o.args[0] as number, null),
            ret: (a) => pure([a]),
          }),
        ),
    /** the first path's value not failing — the rest not run; none, `undefined` */
    first:
      () =>
      <A, E>(p: Eff<A, E, true>): Eff<A | undefined, Exclude<E, R>, true> =>
        handleWith(
          p,
          impl(name, DEEP, true, undefined, {
            clause: (o, k) => firstOf<A>(k, 0, o.args[0] as number),
            ret: (a) => pure(a),
          }),
        ),
  }
}

// AN EFFECT OF ONE'S OWN: its operations' signatures, and handlers of the three forms

/** an operation's signature: its arguments, its value */
export interface Sig<Args extends readonly unknown[], R> {
  readonly _sig?: (args: Args) => R
}
export const op_ = <Args extends readonly unknown[], R>(): Sig<Args, R> => ({})

export type Sigs = Record<string, Sig<any, any>>
export type ArgsOf<O> = O extends Sig<infer A, any> ? A : never
export type ResOf<O> = O extends Sig<any, infer R> ? R : never

/** an effect plain, or sensitive: handled only under its audit */
export type Kind = "plain" | "sensitive"

export interface Effect<N extends string, S extends Sigs, K extends Kind = "plain"> {
  readonly effect: N
  readonly kind: "Effect"
  readonly sensitivity: K
  readonly _s: (s: S) => S
}

/** a sensitive effect `T` past its audit: what the audit passes on, and the only thing its handlers take */
export interface Audited<T> {
  readonly audited: T
}

/** what a handler of `T` takes off a row: `T`, or for a sensitive one `Audited<T>` */
export type Handled<T> = T extends { readonly sensitivity: "sensitive" } ? Audited<T> : T

/** the name a handler of a tag is found by at run time */
export const keyOf = (tag: { readonly name: string; readonly sensitive?: boolean }): string =>
  tag.sensitive ? `audited:${tag.name}` : tag.name

/** what a handler is made for: an effect's name, its operations' signatures, its type in a row (`T`) */
export interface Tag<N extends string, S extends Sigs, T> {
  readonly name: N
  readonly sigs: S
  readonly sensitive?: boolean
  readonly _row?: T
}

export type EffectTag<N extends string, S extends Sigs, K extends Kind = "plain"> = Tag<N, S, Effect<N, S, K>> & {
  readonly sensitive: K extends "sensitive" ? true : false
} & {
  readonly [O in keyof S]: (...args: ArgsOf<S[O]>) => Eff<ResOf<S[O]>, Effect<N, S, K>>
}

/** an effect: its name, its operations — `effect("Pay", { transfer: op<[to: string, amount: number], string>() })` */
export function effect<const N extends string, S extends Sigs>(
  name: N,
  sigs: S,
  kind: { readonly sensitive: true },
): EffectTag<N, S, "sensitive">
export function effect<const N extends string, S extends Sigs>(name: N, sigs: S): EffectTag<N, S>
export function effect(name: string, sigs: Sigs, kind?: { readonly sensitive: true }): unknown {
  const sensitive = kind?.sensitive === true
  const ops: Record<string, unknown> = { name, sigs, sensitive }
  for (const k of Object.keys(sigs))
    ops[k] = (...args: unknown[]) => perform(sensitive ? { effect: name, name: k, args, sensitive } : op(name, k, args))
  return ops
}

/** each operation answered in place, by a function of its arguments */
export function answering<N extends string, S extends Sigs, T>(
  tag: Tag<N, S, T>,
  clauses: { readonly [K in keyof S]: (...args: ArgsOf<S[K]>) => ResOf<S[K]> },
) {
  const fs = clauses as Record<string, (...args: unknown[]) => unknown>
  const h = impl(keyOf(tag), ANSWER, true, undefined, { value: (o) => fs[o.name]!(...o.args) })
  return <A, E, M extends boolean>(p: Eff<A, E, M>): Eff<A, Exclude<E, Handled<T>>, M> => handleWith(p, h)
}

/** a state from `s0`: each operation answered by a function of it and its arguments — its value and the next state;
 *  the last state beside the value. Each path's own, as it was where its rest was taken */
export function stateful<N extends string, S extends Sigs, T, St>(
  tag: Tag<N, S, T>,
  s0: St,
  clauses: { readonly [K in keyof S]: (s: St, ...args: ArgsOf<S[K]>) => readonly [ResOf<S[K]>, St] },
) {
  const fs = clauses as Record<string, (s: unknown, ...args: unknown[]) => readonly [unknown, unknown]>
  return <A, E, M extends boolean>(p: Eff<A, E, M>): Eff<readonly [St, A], Exclude<E, Handled<T>>, M> =>
    handleWith(
      p,
      impl(keyOf(tag), STATE, true, s0, {
        step: (o, s) => fs[o.name]!(s, ...o.args),
        ret: (a, s) => pure([s, a] as const),
      }),
    )
}

type Clauses<S extends Sigs, B, E2> = {
  readonly [K in keyof S]: (
    ...args: [...ArgsOf<S[K]>, k: (x: ResOf<S[K]>) => Eff<B, E2, boolean>]
  ) => Eff<B, E2, boolean>
}

function deepOf<N extends string, S extends Sigs, T, A, B, E2>(
  tag: Tag<N, S, T>,
  many: boolean,
  ret: (a: A) => Eff<B, E2, boolean>,
  clauses: Clauses<S, B, E2>,
): Impl {
  const fs = clauses as unknown as Record<string, (...args: unknown[]) => Eff<unknown, unknown, boolean>>
  return impl(keyOf(tag), DEEP, many, undefined, {
    clause: (o, k) => fs[o.name]!(...o.args, k),
    ret: (a) => ret(as<A>(a)),
  })
}

/** each operation given its rest `k`, resumed once at most — or not: the handler's own value instead */
export function deep<N extends string, S extends Sigs, T, A, B, E2 = never>(
  tag: Tag<N, S, T>,
  ret: (a: A) => Eff<B, E2, boolean>,
  clauses: Clauses<S, B, E2>,
) {
  const h = deepOf(tag, false, ret, clauses)
  return <E, M extends boolean>(p: Eff<A, E, M>): Eff<B, Exclude<E, Handled<T>> | E2, M> => handleWith(p, h)
}

/** each operation given its rest `k`, resumed any number of times — a program of data only (`Do`, `flatMap`) */
export function deepMany<N extends string, S extends Sigs, T, A, B, E2 = never>(
  tag: Tag<N, S, T>,
  ret: (a: A) => Eff<B, E2, boolean>,
  clauses: Clauses<S, B, E2>,
) {
  const h = deepOf(tag, true, ret, clauses)
  return <E>(p: Eff<A, E, true>): Eff<B, Exclude<E, Handled<T>> | E2, true> => handleWith(p, h)
}
