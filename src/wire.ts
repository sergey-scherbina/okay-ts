// THE OKAY WIRE (okay's specs/remote-foreign.md, specs/polyglot-one-wire.md): okay-ts as a FAR SIDE of okay, the Scala
// platform. A host — okay's `ForeignWorker`, over pipes, or its `ForeignServer` this side connects to — drives:
// `program` starts one of these programs; each operation no handler here answers goes to the host as `perform`, with
// an id for its rest, kept here; the host runs it under its own handlers (a callback in Scala: an audit, a policy, a
// bank) and `continue`s that rest — the same one any number of times (a choice resumed twice); `forget` drops a run's
// rests. One JSON line each way; the far side says hello first.

import { connect as tcp, type Socket } from "node:net"
import { createInterface } from "node:readline"

import { Eff, start, type Op, type Resume, type Step } from "./eff.ts"

/** the wire's shim version, the one okay's hosts speak */
export const SHIM = 9

/** the programs a host may start, by name: `fn` is `module:name` or `name` */
export type Programs = Readonly<Record<string, (...args: any[]) => Eff<unknown, any, boolean>>>

export interface FarSideOptions {
  /** an operation's name on the wire — a callback's name in the host. By default `Effect.op` (`Pay.transfer`) */
  readonly name?: (op: Op) => string
}

const EXACT = 2 ** 53

/** a value as okay's wire writes it: a record a `dict`, a big integer a string of digits */
export function enc(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === "boolean" || typeof v === "string") return v
  if (typeof v === "number") {
    if (Number.isNaN(v)) return { t: "nan" }
    if (Number.isInteger(v) && Math.abs(v) >= EXACT) return { t: "int", v: BigInt(v).toString() }
    return v
  }
  if (typeof v === "bigint") return v > -BigInt(EXACT) && v < BigInt(EXACT) ? Number(v) : { t: "int", v: v.toString() }
  if (v instanceof Uint8Array) return { t: "bytes", b64: Buffer.from(v).toString("base64") }
  if (Array.isArray(v)) return v.map(enc)
  if (typeof v === "object") return { t: "dict", kv: Object.entries(v).map(([k, x]) => [k, enc(x)]) }
  throw new TypeError(`okay-ts: cannot put a ${typeof v} on the wire`)
}

/** a value read off okay's wire */
export function dec(v: any): unknown {
  if (Array.isArray(v)) return v.map(dec)
  if (v !== null && typeof v === "object") {
    switch (v.t) {
      case "nan":
        return NaN
      case "f":
        return v.v
      case "int":
        return BigInt(v.v)
      case "bytes":
        return new Uint8Array(Buffer.from(v.b64, "base64"))
      case "dict":
        return Object.fromEntries(v.kv.map(([k, x]: [string, unknown]) => [k, dec(x)]))
      case "na":
        return null
      default:
        throw new TypeError(`okay-ts: a tagged value this side does not read: ${String(v.t)}`)
    }
  }
  return v
}

/** a failure as the host reads it: a condition by name */
function condition(id: unknown, e: any): object {
  return { id, condition: { kind: e?.name ?? "Error", message: String(e?.message ?? e) } }
}

/** an error the host raised where an operation was performed: thrown into the program there */
export class HostCondition extends Error {
  readonly kind: string
  constructor(kind: string, message: string) {
    super(message)
    this.name = kind
    this.kind = kind
  }
}

/**
 * THE FAR SIDE: one request of the host in, its answer out. Holds each run's rests by id until the host forgets the
 * run. A program's operations no handler here answers are the host's; a program of data's rest is resumed any number
 * of times, a generator's once (resumed twice: a condition, `ResumedTwice`).
 */
export class FarSide {
  private readonly runs = new Map<number, Map<number, Resume<unknown>>>()
  private next = 0
  private readonly programs: Programs
  private readonly name: (op: Op) => string

  constructor(programs: Programs, opts: FarSideOptions = {}) {
    this.programs = programs
    this.name = opts.name ?? ((op) => `${op.effect}.${op.name}`)
  }

  /** the first line: who this is, what it speaks — JSON lines only */
  hello(): object {
    return { shim: SHIM, python: `okay-ts ${process.version}`, speaks: { format: ["json"], compress: [], frames: [] } }
  }

  private find(fn: string): (...args: any[]) => Eff<unknown, any, boolean> {
    const p = this.programs[fn] ?? this.programs[fn.slice(fn.indexOf(":") + 1)]
    if (p === undefined) throw new Error(`no program '${fn}' here (${Object.keys(this.programs).join(", ")})`)
    return p
  }

  private node(run: number, s: Step<unknown>): object {
    switch (s.tag) {
      case "done":
        return { done: enc(s.value) }
      case "yield": {
        this.next += 1
        if (!this.runs.has(run)) this.runs.set(run, new Map())
        this.runs.get(run)!.set(this.next, s.k)
        return { perform: this.name(s.op), args: s.op.args.map(enc), k: this.next }
      }
      case "failed":
        throw s.error
      case "cancelled":
        throw new Error("the program was cancelled")
    }
  }

  /** one request, its answer */
  serve(req: any): object {
    const id = req.id
    try {
      switch (req.op) {
        case "program": {
          const args = (req.args ?? []).map(dec)
          return { id, ok: this.node(req.run, start(this.find(req.fn)(...args))) }
        }
        case "continue": {
          const k = this.runs.get(req.run)?.get(req.k)
          if (k === undefined) throw new Error(`the rest ${req.k} of run ${req.run} is not held here (forgotten, or another process)`)
          const s = req.condition
            ? k.fail(new HostCondition(req.condition.kind, req.condition.message))
            : k.resume(dec(req.answer))
          return { id, ok: this.node(req.run, s) }
        }
        case "forget":
          this.runs.delete(req.run)
          return { id, ok: null }
        case "call": {
          // a program run to its value here: one whose operations are all answered here
          const s = start(this.find(req.fn)(...(req.args ?? []).map(dec)))
          if (s.tag === "done") return { id, ok: enc(s.value) }
          throw new Error(`'${req.fn}' performs operations: start it with 'program'`)
        }
        default:
          throw new Error(`okay-ts does not serve '${req.op}'`)
      }
    } catch (e) {
      return condition(id, e)
    }
  }
}

function lines(input: NodeJS.ReadableStream, output: (line: string) => void, far: FarSide): Promise<void> {
  output(JSON.stringify(far.hello()))
  const rl = createInterface({ input, crlfDelay: Infinity })
  rl.on("line", (line) => {
    if (line.trim() !== "") output(JSON.stringify(far.serve(JSON.parse(line))))
  })
  return new Promise((done) => rl.on("close", () => done()))
}

/** SERVED ON PIPES: this process a worker an okay host started (`ForeignWorker.speaking(Seq("node", "worker.ts"))`) */
export function serveStdio(programs: Programs, opts: FarSideOptions = {}): Promise<void> {
  return lines(process.stdin, (l) => process.stdout.write(l + "\n"), new FarSide(programs, opts))
}

/** CONNECTED to an okay host that accepts far sides (okay's `ForeignServer`): its programs run under the host's
 *  handlers until the host closes the connection */
export function connect(at: { readonly host?: string; readonly port: number }, programs: Programs, opts: FarSideOptions = {}): Promise<void> {
  return new Promise((done, failed) => {
    const socket: Socket = tcp({ host: at.host ?? "127.0.0.1", port: at.port })
    socket.setNoDelay(true)
    socket.once("error", failed)
    socket.once("connect", () => {
      lines(socket, (l) => void socket.write(l + "\n"), new FarSide(programs, opts)).then(done, failed)
    })
  })
}

/** CONNECTED over a WebSocket to an okay host that accepts far sides there (okay's `ForeignWs`): a page's programs —
 *  or a process behind a proxy that passes HTTP only — run under the host's handlers until it closes the socket. One
 *  JSON text frame per message; the far side's hello first */
export function connectWs(url: string, programs: Programs, opts: FarSideOptions = {}): Promise<void> {
  return new Promise((done, failed) => {
    const far = new FarSide(programs, opts)
    const ws = new WebSocket(url)
    ws.onopen = () => ws.send(JSON.stringify(far.hello()))
    ws.onmessage = (e) => ws.send(JSON.stringify(far.serve(JSON.parse(String(e.data)))))
    ws.onclose = () => done()
    ws.onerror = () => failed(new Error(`okay-ts: the WebSocket to ${url} failed`))
  })
}
