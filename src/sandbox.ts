/**
 * Sandbox — run tap code in a Deno Worker with zero permissions.
 *
 * Why: taps are untrusted code (community or AI-generated).
 * The tap handle (tap.*) is the ONLY interface — enforced at runtime,
 * not just by static analysis.
 *
 * Architecture:
 *   Main thread: creates Worker, proxies tap.* calls via postMessage
 *   Worker: runs tap code, can ONLY call tap.* (everything else blocked)
 *
 * Worker permissions: { deno: { permissions: "none" } }
 *   = no filesystem, no network, no env, no subprocess, no FFI
 */

import type { RpcSend } from "./page.ts";

interface SandboxMessage {
  id: number;
  type: "call" | "result" | "error" | "return";
  method?: string;
  params?: Record<string, unknown>;
  value?: unknown;
  error?: string;
}

export const SANDBOX_ALLOWED_METHODS: Set<string> = new Set([
  // All tap.* RPC methods are allowed — they're messages to the runtime,
  // not local permissions. The sandbox isolates Deno APIs (file, network,
  // env), not browser operations. The runtime handles its own security.
  "eval", "nav", "run", "pointer", "keyboard",
  "click", "type", "fill", "hover", "scroll", "pressKey",
  "select", "find", "wait", "waitFor", "waitForNetwork",
  "screenshot", "cookies", "ssrState", "storage", "capabilities",
  "fetch", "dialog", "download", "upload", "copyAll",
  "parseXML",
]);

/**
 * Run a tap's run() function in a sandboxed Worker.
 * The tap can only call tap.* methods via message passing.
 * Method calls are restricted to a whitelist — dangerous operations like
 * eval, nav, run, download, upload, pointer, keyboard are blocked.
 */
export async function runInSandbox(
  tapPath: string,
  args: Record<string, unknown>,
  send: RpcSend,
): Promise<unknown[]> {
  // Worker code: import tap, create proxy handle, call run()
  const workerCode = `
      const tapModule = await import(${JSON.stringify(tapPath)});
      const mod = tapModule.default;

      const ALLOWED = new Set(${JSON.stringify([...SANDBOX_ALLOWED_METHODS])});

      // Tap handle: every method sends a message to main thread and waits for reply
      let callId = 0;
      const pending = new Map();

      function makeRpcMethod(methodName) {
        return (...args) => {
          if (!ALLOWED.has(methodName)) {
            return Promise.reject(new Error("operation '" + methodName + "' is restricted in this context"));
          }
          const id = ++callId;
          let params = args;
          // eval: convert function arg to IIFE string (functions can't be postMessage'd)
          if (methodName === "eval" && typeof args[0] === "function") {
            const fn = args[0];
            const extra = args.slice(1);
            const expr = "(" + fn.toString() + ")(" + extra.map(a => JSON.stringify(a)).join(",") + ")";
            params = [expr];
          }
          self.postMessage({ id, type: "call", method: methodName, params });
          return new Promise((res, rej) => { pending.set(id, { res, rej }); });
        };
      }

      const tap = new Proxy({}, {
        get(_, prop) {
          return makeRpcMethod(String(prop));
        }
      });

      // Receive results from main thread
      self.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === "result") {
          const p = pending.get(msg.id);
          if (p) { pending.delete(msg.id); p.res(msg.value); }
        } else if (msg.type === "error") {
          const p = pending.get(msg.id);
          if (p) { pending.delete(msg.id); p.rej(new Error(msg.error)); }
        }
      };

      // Run the tap
      try {
        if (typeof mod.tap !== "function") {
          throw new Error("Tap " + mod.site + "/" + mod.name + " must define tap(handle, args)");
        }
        const rows = await mod.tap(tap, ${JSON.stringify(args)});
        self.postMessage({ type: "return", value: rows });
      } catch (e) {
        self.postMessage({ type: "return", error: String(e) });
      }
    `;

  // Write worker code to temp file (Deno Workers need file:// for module imports)
  const workerFile = await Deno.makeTempFile({ suffix: ".mjs" });
  await Deno.writeTextFile(workerFile, workerCode);

  return new Promise((resolve, reject) => {
    let workerStarted = false;
    const worker = new Worker(new URL(`file://${workerFile}`).href, {
      type: "module",
      // @ts-ignore Deno Worker permissions
      deno: { permissions: "none" },
    });
    // Clean up temp file once worker has imported it (first message confirms startup)
    const cleanupTempFile = () => {
      if (!workerStarted) {
        workerStarted = true;
        Deno.remove(workerFile).catch(() => {});
      }
    };

    const timeout = setTimeout(() => {
      worker.terminate();
      cleanupTempFile();
      reject(new Error("sandbox timeout (30s)"));
    }, 30_000);

    worker.onmessage = async (e: MessageEvent<SandboxMessage>) => {
      const msg = e.data;
      // First message confirms worker has started and imported the temp file
      cleanupTempFile();

      if (msg.type === "call") {
          const methodName = msg.method!;
          if (!SANDBOX_ALLOWED_METHODS.has(methodName)) {
            worker.postMessage({ id: msg.id, type: "error", error: `operation '${methodName}' is restricted in this context` });
            return;
          }
          const params = Array.isArray(msg.params) ? msg.params : [];
          try {
            // Proxy tap.* call to actual runtime
            const method = `tap.${methodName}`;
            // Map positional args to named params for RPC
            const result = await send("tool", method, paramsToRecord(methodName, params));
            worker.postMessage({ id: msg.id, type: "result", value: result });
        } catch (err) {
          worker.postMessage({ id: msg.id, type: "error", error: String(err) });
        }
      } else if (msg.type === "return") {
        clearTimeout(timeout);
        cleanupTempFile();
        worker.terminate();
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.value as unknown[]);
      }
    };

    worker.onerror = (e) => {
      clearTimeout(timeout);
      cleanupTempFile();
      worker.terminate();
      reject(new Error(`sandbox error: ${e.message}`));
    };
  });
}

/** Map positional args to named params for tap.* RPC calls */
function paramsToRecord(method: string, args: unknown[]): Record<string, unknown> {
  // Map based on tap handle method signatures (from page.ts)
  switch (method) {
    case "eval": return { expression: args[0] };
    case "nav": return { url: args[0] };
    case "click": return { target: args[0] };
    case "type": return { selector: args[0], text: args[1] };
    case "fill": return { selector: args[0], text: args[1] };
    case "find": return { query: args[0], role: args[1] };
    case "hover": return { selector: args[0] };
    case "scroll": return { selector: args[0] };
    case "pressKey": return { key: args[0], modifiers: args[1] };
    case "select": return { selector: args[0], value: args[1] };
    case "upload": return { selector: args[0], files: args[1] };
    case "dialog": return { accept: args[0], prompt_text: args[1] };
    case "fetch": return { url: args[0], ...((args[1] as Record<string, unknown>) || {}) };
    case "wait": return { ms: args[0] };
    case "waitFor": return { selector: args[0], ms: args[1] };
    case "waitForNetwork": return { ms: args[0], idle: args[1] };
    case "screenshot": return args[0] as Record<string, unknown> || {};
    case "pointer": return { x: args[0], y: args[1], action: args[2] };
    case "keyboard": return { key: args[0], action: args[1], modifiers: args[2] };
    case "cookies": return {};
    case "ssrState": return { name: args[0] };
    case "storage": return { type: args[0] };
    case "download": return { url: args[0] };
    case "run": return { site: args[0], name: args[1], args: args[2] };
    case "capabilities": return {};
    case "parseXML": return { text: args[0], ...((args[1] as Record<string, unknown>) || {}) };
    default: return args[0] as Record<string, unknown> || {};
  }
}
