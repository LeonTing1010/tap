/**
 * Tap handle — 25 operations (8 core + 17 built-in) as RPC calls.
 *
 * Each method is a thin wrapper that sends an RPC message to the runtime
 * via the provided `send` function. The runtime does the actual work.
 *
 * Wire method names use dot notation matching MCP tool names exactly:
 *   tap.eval, tap.click, tap.nav, etc.
 * One name everywhere — no conversion.
 */

export type RpcSend = (
  type: string,
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Shared HTML-AAM role resolution snippet — inlined into eval expressions.
 * Used by inspect.a11y, forge captureFingerprint, doctor checkFingerprint, and tap.find.
 * Lives in page.ts because all consumers already import from here.
 * Must be self-contained JavaScript (no closures, no imports).
 */
export const SEMANTIC_ROLE_SNIPPET: string = `
const ROLE={nav:'navigation',main:'main',aside:'complementary',article:'article',
  button:'button',textarea:'textbox',ul:'list',ol:'list',li:'listitem',table:'table',
  tr:'row',td:'cell',th:'columnheader',h1:'heading',h2:'heading',h3:'heading',
  h4:'heading',h5:'heading',h6:'heading',select:'combobox',output:'status',
  progress:'progressbar',hr:'separator',dialog:'dialog',details:'group',
  figure:'figure',figcaption:'caption',fieldset:'group',menu:'list',search:'search'}
const INPUT_ROLE={button:'button',submit:'button',reset:'button',image:'button',
  checkbox:'checkbox',radio:'radio',range:'slider',number:'spinbutton',
  search:'searchbox',text:'textbox',email:'textbox',url:'textbox',tel:'textbox'}
function resolveRole(el){
  const explicit=el.getAttribute('role')
  if(explicit)return explicit
  const tag=el.tagName.toLowerCase()
  if(tag==='a')return el.hasAttribute('href')?'link':null
  if(tag==='input')return INPUT_ROLE[el.type]||'textbox'
  if(tag==='img')return el.getAttribute('alt')===''?'presentation':'img'
  if(tag==='header'||tag==='footer'){
    const sec=el.closest('article,aside,main,nav,section')
    return sec?null:(tag==='header'?'banner':'contentinfo')
  }
  if((tag==='form'||tag==='section')&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby'))return null
  if(tag==='form')return 'form'
  if(tag==='section')return 'region'
  return ROLE[tag]||null
}
function headingLevel(el){
  const m=el.tagName.match(/^H([1-6])$/)
  return m?m[1]:(el.getAttribute('aria-level')||null)
}
`;

export interface Tap {
  // Core (8) — every runtime must implement these
  eval(expression: string, ...args: unknown[]): Promise<unknown>;
  pointer(x: number, y: number, action: string, opts?: Record<string, unknown>): Promise<unknown>;
  keyboard(key: string, action: string, mods?: number): Promise<unknown>;
  nav(url: string): Promise<unknown>;
  wait(ms: number): Promise<unknown>;
  screenshot(opts?: Record<string, unknown>): Promise<unknown>;
  run(site: string, name: string, args?: Record<string, unknown>): Promise<unknown>;
  capabilities(): Promise<unknown>;
  // Built-in (17)
  click(target: string): Promise<unknown>;
  type(selector: string, text: string): Promise<unknown>;
  fill(selector: string, text: string): Promise<unknown>;
  hover(selector: string): Promise<unknown>;
  scroll(selector: string): Promise<unknown>;
  pressKey(key: string, mods?: number): Promise<unknown>;
  select(selector: string, value: string): Promise<unknown>;
  upload(selector: string, files: string): Promise<unknown>;
  dialog(accept?: boolean, text?: string): Promise<unknown>;
  fetch(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  find(query: string, role?: string): Promise<unknown>;
  cookies(): Promise<unknown>;
  download(url: string): Promise<unknown>;
  waitFor(selector: string, ms?: number): Promise<unknown>;
  waitForNetwork(ms?: number, idle?: number): Promise<unknown>;
  ssrState(name?: string): Promise<unknown>;
  storage(type?: string): Promise<unknown>;
  copyAll(): Promise<unknown>;
  extract(selector: string, fields: Record<string, string>): Promise<Record<string, string>[]>;
  // parseXML — declarative XML extraction, see src/xml.ts for the full spec.
  // Runs entirely in Deno (no tab, no DOMParser, no eval). Use this instead
  // of eval(fn, xml) for RSS-style taps that parse their own fetched XML,
  // which otherwise fails in MCP mode because the session tab is not
  // scriptable on first use.
  parseXML(text: string, spec: Record<string, unknown>): Promise<Record<string, string>[]>;
  // pipe — declarative composition DSL, see src/pipe.ts for the full spec.
  // Takes a Pipe data structure ({ steps, return }) and runs it with DAG
  // scheduling, $ref binding, run-scoped cache, and clear step-id errors.
  // Assigned at runtime by executor.ts when tapDirs is available.
  pipe?(pipe: unknown): Promise<unknown>;
}

export function createTapHandle(send: RpcSend): Tap {
  return {
    // Core (8) — abstract names, each runtime translates to native API
    eval: (expression, ...args) => {
      // Taps may pass a function (for extension-native eval) — convert to IIFE string
      const expr = typeof expression === "function"
        ? `(${String(expression)})(${args.map(a => JSON.stringify(a)).join(",")})`
        : String(expression);
      return send("tool", "tap.eval", { expression: expr });
    },
    pointer: (x, y, action, opts) =>
      send("tool", "tap.pointer", { x, y, action, ...opts }),
    keyboard: (key, action, mods) =>
      send("tool", "tap.keyboard", { key, action, modifiers: mods }),
    nav: (url) => send("tool", "tap.nav", { url }),
    wait: (ms) => send("tool", "tap.wait", { ms }),
    screenshot: (opts) => send("tool", "tap.screenshot", { ...opts }),
    run: () => { throw new Error("tap.run() must be wired by executor"); },
    capabilities: () => send("tool", "tap.capabilities", {}),
    // Built-in (17)
    click: (target) => send("tool", "tap.click", { target }),
    type: (selector, text) => send("tool", "tap.type", { selector, text }),
    fill: (selector, text) => send("tool", "tap.fill", { selector, text }),
    hover: (selector) => send("tool", "tap.hover", { selector }),
    scroll: (selector) => send("tool", "tap.scroll", { selector }),
    pressKey: (key, mods) =>
      send("tool", "tap.pressKey", { key, modifiers: mods }),
    select: (selector, value) =>
      send("tool", "tap.select", { selector, value }),
    upload: (selector, files) =>
      send("tool", "tap.upload", { selector, files }),
    dialog: (accept, text) =>
      send("tool", "tap.dialog", { accept, prompt_text: text }),
    fetch: (url, opts) => send("tool", "tap.fetch", { url, ...opts }),
    find: (query, role) => send("tool", "tap.find", { query, role }),
    cookies: () => send("tool", "tap.cookies", {}),
    download: (url) => send("tool", "tap.download", { url }),
    waitFor: (selector, ms) => send("tool", "tap.waitFor", { selector, ms }),
    waitForNetwork: (ms, idle) =>
      send("tool", "tap.waitForNetwork", { ms, idle }),
    ssrState: (name) => send("tool", "tap.ssrState", { name }),
    storage: (type) => send("tool", "tap.storage", { type }),
    copyAll: () => send("tool", "tap.copyAll", {}),
    extract: (selector, fields) =>
      send("tool", "tap.extract", { selector, fields }) as Promise<Record<string, string>[]>,
    parseXML: (text, spec) =>
      send("tool", "tap.parseXML", { text, ...spec }) as Promise<Record<string, string>[]>,
  };
}
