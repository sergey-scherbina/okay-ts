// A PROGRAM OF EFFECTS IS DATA: `Eff<A, E, M>` — of value `A`, its effects `E` a union of effect types (its row), `M`
// whether its rest may be resumed many times (`true`: data all through) or once at most (`boolean`: a generator in
// it). Immutable nodes, run by the machine below; a handler's rest `k` data too.

/** an operation: of its effect (by name — the effect's identity at run time), its name, its arguments */
export interface Op {
  readonly effect: string
  readonly name: string
  readonly args: readonly unknown[]
}

const PURE = 0
const FLATMAP = 1
const PERFORM = 2
const HANDLE = 3
const GEN = 4
const RESUME = 5
const DEFER = 6

export class Eff<A, E = never, M extends boolean = true> {
  declare readonly _A: () => A
  declare readonly _E: () => E
  declare readonly _M: () => M
  readonly tag: number
  readonly x: unknown
  readonly y: unknown

  constructor(tag: number, x: unknown, y: unknown) {
    this.tag = tag
    this.x = x
    this.y = y
  }

  /** the rest given this program's value */
  flatMap<B, E2 = never, M2 extends boolean = true>(f: (a: A) => Eff<B, E2, M2>): Eff<B, E | E2, M | M2> {
    return new Eff(FLATMAP, this, f)
  }

  map<B>(f: (a: A) => B): Eff<B, E, M> {
    return new Eff(FLATMAP, this, (a: A) => pure(f(a)))
  }

  /** this program given to `h` — a handler: `p.handle(Config.value(5))` */
  handle<R>(h: (p: this) => R): R {
    return h(this)
  }

  /** its value — every effect handled: an `Eff<A, never>`, else it does not compile */
  run(this: Eff<A, never, boolean>): A {
    return run(this)
  }

  // DO: a for over programs as data — a scope of the values bound, immutable, each step a function of it

  /** `key` bound to the value of `f(scope)` */
  bind<K extends string, B, E2 = never, M2 extends boolean = true>(
    this: Eff<A & object, E, M>,
    key: Exclude<K, keyof A>,
    f: (scope: A) => Eff<B, E2, M2>,
  ): Eff<A & { readonly [k in K]: B }, E | E2, M | M2> {
    return this.flatMap((s) => f(s).map((b) => ({ ...s, [key]: b }) as A & { readonly [k in K]: B }))
  }

  /** `key` bound to a value made of the scope */
  let<K extends string, B>(
    this: Eff<A & object, E, M>,
    key: Exclude<K, keyof A>,
    f: (scope: A) => B,
  ): Eff<A & { readonly [k in K]: B }, E, M> {
    return this.map((s) => ({ ...s, [key]: f(s) }) as A & { readonly [k in K]: B })
  }

  /** a program run for its effects, its value dropped, the scope kept */
  do<E2 = never, M2 extends boolean = true>(f: (scope: A) => Eff<unknown, E2, M2>): Eff<A, E | E2, M | M2> {
    return this.flatMap((s) => f(s).map(() => s))
  }

  /** `yield*` in a generator: this program's value */
  *[Symbol.iterator](): Generator<Eff<A, E, M>, A, any> {
    return yield this
  }
}

export function pure<A>(a: A): Eff<A> {
  return new Eff(PURE, a, undefined)
}

/** a program made when it is run — a recursion's call, in constant stack */
export function defer<A, E = never, M extends boolean = true>(f: () => Eff<A, E, M>): Eff<A, E, M> {
  return new Eff(DEFER, f, undefined)
}

/** the operation `op`: its value, given by the nearest handler of its effect */
export function perform<A, E>(op: Op): Eff<A, E> {
  return new Eff(PERFORM, op, undefined)
}

/** the start of a `Do`: an empty scope */
export const Do: Eff<{}> = pure({})

/** the effects of a program: its row */
export type RowOf<P> = P extends Eff<any, infer E, any> ? E : never

/**
 * A PROGRAM WRITTEN AS A GENERATOR: `yield* p` binds a program's value. Its rest is the generator's own state — resumed
 * once at most (`M` is `boolean`): a handler resuming it many times (`all`) asks a program of data (`Do`), and does
 * not take this one
 */
export function eff<Y extends Eff<any, any, any>, A>(body: () => Generator<Y, A, any>): Eff<A, RowOf<Y>, boolean> {
  return new Eff(GEN, body, undefined)
}

// HANDLERS, as the machine sees them: a delimiter of the program's stack, for one effect or for all

export const ANSWER = 0
export const STATE = 1
export const DEEP = 2

export interface Impl {
  /** its effect's name; `null`: every effect (an observer) */
  readonly effect: string | null
  readonly kind: number
  /** a rest resumed many times allowed */
  readonly many: boolean
  readonly init: unknown
  /** the body's value, the state: the handler's program */
  ret(a: unknown, s: unknown): Eff<unknown, unknown, boolean>
  /** ANSWER: the operation's value, in place */
  value?(op: Op, s: unknown): unknown
  /** STATE: the operation's value and the state after it */
  step?(op: Op, s: unknown): readonly [unknown, unknown]
  /** DEEP: the clause, given the rest */
  clause?(op: Op, k: (x: unknown) => Eff<unknown, unknown, boolean>, s: unknown): Eff<unknown, unknown, boolean>
}

/** `p` under the handler `h` */
export function handleWith<B, E, M extends boolean>(p: Eff<unknown, unknown, boolean>, h: Impl): Eff<B, E, M> {
  return new Eff(HANDLE, p, h)
}

// THE MACHINE: a node and a stack of frames, persistent — a rest is a part of it, kept, re-laid any number of times

class Bind {
  readonly f: (a: unknown) => Eff<unknown, unknown, boolean>
  readonly next: Frame | null
  constructor(f: (a: unknown) => Eff<unknown, unknown, boolean>, next: Frame | null) {
    this.f = f
    this.next = next
  }
}

/** a generator's state: where it is — a rest of it taken earlier and resumed again finds it moved on */
class GenState {
  readonly it: Generator<Eff<unknown, unknown, boolean>, unknown, unknown>
  at = 0
  constructor(it: Generator<Eff<unknown, unknown, boolean>, unknown, unknown>) {
    this.it = it
  }
}

class GenFrame {
  readonly g: GenState
  readonly at: number
  readonly next: Frame | null
  constructor(g: GenState, at: number, next: Frame | null) {
    this.g = g
    this.at = at
    this.next = next
  }
}

class Hand {
  readonly h: Impl
  readonly s: unknown
  readonly next: Frame | null
  constructor(h: Impl, s: unknown, next: Frame | null) {
    this.h = h
    this.s = s
    this.next = next
  }
}

type Frame = Bind | GenFrame | Hand

function relaid(f: Frame, next: Frame | null): Frame {
  if (f instanceof Bind) return new Bind(f.f, next)
  if (f instanceof GenFrame) return new GenFrame(f.g, f.at, next)
  return new Hand(f.h, f.s, next)
}

/** the frames from `from` down to `upto` (not it), laid again on `base`, in their order */
function relay(from: Frame | null, upto: Hand, base: Frame | null): Frame | null {
  const part: Frame[] = []
  for (let f = from; f !== upto; f = f!.next) part.push(f!)
  let s = base
  for (let i = part.length - 1; i >= 0; i--) s = relaid(part[i]!, s)
  return s
}

/** a rest: the frames from `from` down to its handler, the handler's state when it was taken */
class Rest {
  readonly from: Frame | null
  readonly hand: Hand
  constructor(from: Frame | null, hand: Hand) {
    this.from = from
    this.hand = hand
  }
}

export class Unhandled extends Error {
  readonly op: Op
  constructor(op: Op) {
    super(`okay: no handler of ${op.effect} for ${op.name}(${op.args.map((a) => JSON.stringify(a)).join(", ")})`)
    this.op = op
  }
}

export class ResumedTwice extends Error {
  constructor(what: string) {
    super(
      `okay: ${what} resumed a second time — a generator's rest goes on once; ` +
        `write the part a handler resumes many times as data (Do, flatMap)`,
    )
  }
}

/** a program run to its value, every effect handled */
export function run<A>(p: Eff<A, never, boolean>): A {
  let cur: Eff<unknown, unknown, boolean> = p
  let stack: Frame | null = null
  for (;;) {
    switch (cur.tag) {
      case PURE: {
        const v = cur.x
        if (stack === null) return v as A
        const f: Frame = stack
        if (f instanceof Bind) {
          stack = f.next
          cur = f.f(v)
        } else if (f instanceof GenFrame) {
          const g = f.g
          if (f.at !== g.at) throw new ResumedTwice("a generator's rest")
          g.at++
          const r = g.it.next(v)
          if (r.done) {
            stack = f.next
            cur = pure(r.value)
          } else {
            stack = new GenFrame(g, g.at, f.next)
            cur = r.value
          }
        } else {
          stack = f.next
          cur = f.h.ret(v, f.s)
        }
        break
      }
      case FLATMAP:
        stack = new Bind(cur.y as (a: unknown) => Eff<unknown, unknown, boolean>, stack)
        cur = cur.x as Eff<unknown, unknown, boolean>
        break
      case DEFER:
        cur = (cur.x as () => Eff<unknown, unknown, boolean>)()
        break
      case GEN: {
        const g = new GenState((cur.x as () => Generator<Eff<unknown, unknown, boolean>, unknown, unknown>)())
        const r = g.it.next()
        g.at++
        if (r.done) cur = pure(r.value)
        else {
          stack = new GenFrame(g, g.at, stack)
          cur = r.value
        }
        break
      }
      case HANDLE: {
        const h = cur.y as Impl
        stack = new Hand(h, h.init, stack)
        cur = cur.x as Eff<unknown, unknown, boolean>
        break
      }
      case PERFORM: {
        const op = cur.x as Op
        let f = stack
        while (f !== null && !(f instanceof Hand && (f.h.effect === op.effect || f.h.effect === null))) f = f.next
        if (f === null) throw new Unhandled(op)
        const hand = f as Hand
        const h = hand.h
        if (h.kind === ANSWER) {
          cur = pure(h.value!(op, hand.s))
        } else if (h.kind === STATE) {
          const [v, s2] = h.step!(op, hand.s)
          stack = relay(stack, hand, new Hand(h, s2, hand.next))
          cur = pure(v)
        } else {
          const rest = new Rest(stack, hand)
          let resumed = 0
          const k = (x: unknown): Eff<unknown, unknown, boolean> => {
            if (++resumed > 1 && !h.many) throw new ResumedTwice("a rest of a handler that resumes once")
            return new Eff(RESUME, rest, x)
          }
          stack = hand.next
          cur = h.clause!(op, k, hand.s)
        }
        break
      }
      case RESUME: {
        const rest = cur.x as Rest
        stack = relay(rest.from, rest.hand, new Hand(rest.hand.h, rest.hand.s, stack))
        cur = pure(cur.y)
        break
      }
      default:
        throw new Error(`okay: not a node: ${cur.tag}`)
    }
  }
}
