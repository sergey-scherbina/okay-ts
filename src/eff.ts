// A PROGRAM OF EFFECTS IS DATA: `Eff<A, E, M>` — of value `A`, its effects `E` a union of effect types (its row), `M`
// whether its rest may be resumed many times (`true`: data all through) or once at most (`boolean`: a generator in
// it). Immutable nodes, run by the machine below; a handler's rest `k` data too.

/** an operation: of its effect (by name — the effect's identity at run time), its name, its arguments */
export interface Op {
  readonly effect: string
  readonly name: string
  readonly args: readonly unknown[]
  /** of a sensitive effect: handled only under its audit */
  readonly sensitive?: boolean
}

const PURE = 0
const FLATMAP = 1
const PERFORM = 2
const HANDLE = 3
const GEN = 4
const RESUME = 5
const DEFER = 6
const MAP = 7

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
    return new Eff(MAP, this, f)
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

// THE MACHINE: a node and a stack of frames, persistent — a rest is a part of it, kept, re-laid any number of times.
// Two modes: a node to run (`cur`), or a value going back to the frame on top (`cur` null, `v` the value)

const F_BIND = 0
const F_MAP = 1
const F_GEN = 2
const F_HAND = 3

/** a generator's state: where it is — a rest of it taken earlier and resumed again finds it moved on */
class GenState {
  readonly it: Generator<Eff<unknown, unknown, boolean>, unknown, unknown>
  at = 0
  constructor(it: Generator<Eff<unknown, unknown, boolean>, unknown, unknown>) {
    this.it = it
  }
}

/** a frame: what is done with the value coming back — `f` a function (BIND, MAP), a generator (GEN), a handler (HAND:
 *  `h` its handler, `s` its state, `at` unused) */
class Frame {
  readonly t: number
  readonly f: unknown
  readonly s: unknown
  readonly at: number
  readonly next: Frame | null
  constructor(t: number, f: unknown, s: unknown, at: number, next: Frame | null) {
    this.t = t
    this.f = f
    this.s = s
    this.at = at
    this.next = next
  }
}

/** the frames from `from` down to `upto` (not it), laid again on `base`, in their order */
function relay(from: Frame | null, upto: Frame, base: Frame | null): Frame | null {
  const part: Frame[] = []
  for (let f = from; f !== upto; f = f!.next) part.push(f!)
  let s = base
  for (let i = part.length - 1; i >= 0; i--) {
    const f = part[i]!
    s = new Frame(f.t, f.f, f.s, f.at, s)
  }
  return s
}

/** a rest: the frames from `from` down to its handler's frame, the handler's state when it was taken */
class Rest {
  readonly from: Frame | null
  readonly hand: Frame
  constructor(from: Frame | null, hand: Frame) {
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

type Node = Eff<unknown, unknown, boolean>

/** a program run to its value, every effect handled */
export function run<A>(p: Eff<A, never, boolean>): A {
  let cur: Node | null = p
  let v: unknown = undefined
  let stack: Frame | null = null
  for (;;) {
    if (cur === null) {
      if (stack === null) return v as A
      const f: Frame = stack
      switch (f.t) {
        case F_BIND:
          stack = f.next
          cur = (f.f as (a: unknown) => Node)(v)
          break
        case F_MAP:
          stack = f.next
          v = (f.f as (a: unknown) => unknown)(v)
          break
        case F_GEN: {
          const g = f.f as GenState
          if (f.at !== g.at) throw new ResumedTwice("a generator's rest")
          g.at++
          const r = g.it.next(v)
          if (r.done) {
            stack = f.next
            v = r.value
          } else {
            stack = new Frame(F_GEN, g, undefined, g.at, f.next)
            cur = r.value
          }
          break
        }
        default:
          stack = f.next
          cur = (f.f as Impl).ret(v, f.s)
      }
      continue
    }
    switch (cur.tag) {
      case PURE:
        v = cur.x
        cur = null
        break
      case FLATMAP:
        stack = new Frame(F_BIND, cur.y, undefined, 0, stack)
        cur = cur.x as Node
        break
      case MAP:
        stack = new Frame(F_MAP, cur.y, undefined, 0, stack)
        cur = cur.x as Node
        break
      case DEFER:
        cur = (cur.x as () => Node)()
        break
      case GEN: {
        const g = new GenState((cur.x as () => Generator<Node, unknown, unknown>)())
        const r = g.it.next()
        g.at++
        if (r.done) {
          v = r.value
          cur = null
        } else {
          stack = new Frame(F_GEN, g, undefined, g.at, stack)
          cur = r.value
        }
        break
      }
      case HANDLE: {
        const h = cur.y as Impl
        stack = new Frame(F_HAND, h, h.init, 0, stack)
        cur = cur.x as Node
        break
      }
      case PERFORM: {
        const op = cur.x as Op
        let f: Frame | null = stack
        while (f !== null && !(f.t === F_HAND && ((f.f as Impl).effect === op.effect || (f.f as Impl).effect === null)))
          f = f.next
        if (f === null) throw new Unhandled(op)
        const hand: Frame = f
        const h = hand.f as Impl
        if (h.kind === ANSWER) {
          v = h.value!(op, hand.s)
          cur = null
        } else if (h.kind === STATE) {
          const [x, s2] = h.step!(op, hand.s)
          stack = relay(stack, hand, new Frame(F_HAND, h, s2, 0, hand.next))
          v = x
          cur = null
        } else {
          const rest = new Rest(stack, hand)
          let resumed = 0
          const k = (x: unknown): Node => {
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
        stack = relay(rest.from, rest.hand, new Frame(F_HAND, rest.hand.f, rest.hand.s, 0, stack))
        v = cur.y
        cur = null
        break
      }
      default:
        throw new Error(`okay: not a node: ${cur.tag}`)
    }
  }
}
