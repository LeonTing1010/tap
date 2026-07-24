// tap-deep.js — the SHARED semantic resolver (getByRole/getByText-class), the
// single source of truth injected into ANY DOM-bearing substrate. Extracted
// from background.js (2026-07-21) so the extension SW, every peer, and every
// test consume ONE file instead of regex-extracting a 4000-line service worker.
// The install fn is self-contained: execFunc stringifies it and injects it into
// the page, where it sets globalThis.__tapDeep. Do not add module-scope refs —
// its .toString() must stay self-contained for injection.

const TAP_DEEP_INSTALL = () => {
  if (globalThis.__tapDeep) return
  // Recursive descent through OPEN shadow roots — collect every match for `sel` at
  // the root document AND inside each nested element.shadowRoot (top-down, document
  // order). Closed roots (.shadowRoot === null) stay invisible; only upload's CDP
  // pierce:true path reaches those.
  const deep = (sel, root) => {
    const acc = []
    const walk = (node) => {
      if (!node || !node.querySelectorAll) return
      acc.push(...node.querySelectorAll(sel))
      for (const el of node.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot)
    }
    walk(root || document)
    return acc
  }
  const all = (sel, root) => {
    const parts = String(sel).split(' >> ')
    let roots = [root || document]
    for (let i = 0; i < parts.length; i++) {
      const out = []
      for (const r of roots) if (r && r.querySelectorAll) out.push(...r.querySelectorAll(parts[i].trim()))
      if (i === parts.length - 1) {
        // A plain selector (no explicit ' >> ') that matched NOTHING in the light DOM
        // auto-descends OPEN shadow roots. Fires ONLY on a 0-match, so every existing
        // light-DOM tap stays byte-identical (replay determinism preserved), while
        // whole-page shadow SPAs (微信小店 等 qiankun / web-component consoles) resolve
        // without hand-authoring a ' >> ' host chain.
        if (!out.length && parts.length === 1) return deep(parts[0].trim(), root || document)
        return out
      }
      roots = out.map((e) => e.shadowRoot).filter(Boolean)
      if (!roots.length) return []
    }
    return []
  }
  const control = (n, d) => {
    if (!n || d > 4) return null
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)) return n
    const root = n.shadowRoot || n
    const hit = root.querySelector && root.querySelector('input, textarea, select')
    if (hit) return hit
    for (const h of (root.querySelectorAll ? root.querySelectorAll('*') : [])) {
      if (h.shadowRoot) { const r = control(h, d + 1); if (r) return r }
    }
    return null
  }
  // Resolve a target — bare selector STRING or a TargetResolver OBJECT
  // { selector, visible?, nth?, text?, inViewport?, within? } — to the ONE
  // chosen element (ADR 2026-07-08-target-resolver + within amendment
  // 2026-07-12-target-resolver-within). A string keeps the historic
  // "first match, prefer a visible one" contract; a resolver object applies
  // the explicit predicate in order: within (scope subtree) → role/name →
  // visible (default true) → text → inViewport → nth (0-based; negatives
  // count from the end, -1 = last = newest in append-ordered chat/list UIs).
  // Out-of-range → null (no silent first-match — the whole point).
  // `within` is itself a Target, resolved recursively; the outer query runs
  // inside the resolved element's subtree. This expresses the relational
  // queries ("the 删除 button INSIDE the card whose text includes X") that
  // previously forced the eval-marker dance: an op:eval stamping
  // data-tap-* attributes + a follow-up op:input clicking the marker — a
  // two-op TOCTOU that a React/Vue re-render between the ops silently
  // broke. within resolves relationally IN ONE OP at act time.
  // Single source of truth for element
  // selection across the selector-bearing write handlers + op:wait resolver;
  // clickResolver keeps its own inline bare-string path (the visible-click
  // test injects getComputedStyle into IT) but routes the OBJECT path here.
  const vis = (e) => {
    if (!e) return false
    const s = (typeof getComputedStyle === 'function') ? getComputedStyle(e) : null
    if (s && (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0')) return false
    const r = e.getBoundingClientRect ? e.getBoundingClientRect() : { width: 1, height: 1 }
    return r.width > 0 && r.height > 0
  }
  const inView = (e) => {
    const r = e.getBoundingClientRect ? e.getBoundingClientRect() : null
    if (!r) return true
    const vh = (typeof innerHeight === 'number') ? innerHeight : 1e9
    const vw = (typeof innerWidth === 'number') ? innerWidth : 1e9
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw
  }
  // topmost: does this element actually RECEIVE a pointer event at its
  // center? Hit-test via elementFromPoint on the element's own root (a
  // ShadowRoot supports elementFromPoint, so shadow content hit-tests
  // against its local tree instead of resolving to the host). Accepted when
  // the hit IS the candidate, is inside it (label/span inside a button), or
  // contains it (the candidate is a wrapper). Kills the stacked-dialog trap
  // (2026-07-23 wxamp dogfood): SPAs that keep every dialog mounted leave N
  // same-class buttons "visible" — only the top of the stack is
  // interactable. Off-viewport centers pass (nothing to hit-test there; the
  // click op scrolls before taking coordinates).
  const topAt = (e) => {
    if (!e.getBoundingClientRect) return true
    const r = e.getBoundingClientRect()
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2
    const vh = (typeof innerHeight === 'number') ? innerHeight : 1e9
    const vw = (typeof innerWidth === 'number') ? innerWidth : 1e9
    if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) return true
    let root = (e.getRootNode && e.getRootNode()) || document
    if (!root.elementFromPoint) root = document
    if (!root.elementFromPoint) return true
    const hit = root.elementFromPoint(cx, cy)
    if (!hit) return false
    return hit === e || (e.contains && e.contains(hit)) || (hit.contains && hit.contains(e))
  }
  // Pragmatic in-page getByRole (ADR 2026-07-08-target-resolver-ax): explicit
  // role= wins, else a common-subset implicit-role map. Not the full CDP AX
  // tree, but stable enough to survive the class/DOM churn that breaks CSS
  // selectors across React re-renders.
  const implicitRole = (el) => {
    if (!el || !el.getAttribute) return ''
    const explicit = el.getAttribute('role')
    if (explicit && explicit.trim()) return explicit.trim().toLowerCase().split(/\s+/)[0]
    const tag = (el.tagName || '').toLowerCase()
    switch (tag) {
      case 'a': case 'area': return el.hasAttribute && el.hasAttribute('href') ? 'link' : ''
      case 'button': case 'summary': return 'button'
      case 'select': return el.multiple ? 'listbox' : 'combobox'
      case 'textarea': return 'textbox'
      case 'img': return 'img'
      case 'nav': return 'navigation'
      case 'main': return 'main'
      case 'header': return 'banner'
      case 'footer': return 'contentinfo'
      case 'aside': return 'complementary'
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading'
      case 'input': {
        const t = ((el.getAttribute('type') || 'text')).toLowerCase()
        if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return 'button'
        if (t === 'checkbox') return 'checkbox'
        if (t === 'radio') return 'radio'
        if (t === 'range') return 'slider'
        if (t === 'number') return 'spinbutton'
        if (t === 'search') return 'searchbox'
        return 'textbox'
      }
      default: return ''
    }
  }
  // Accessible name: aria-label → aria-labelledby → <label> → alt/title → text.
  const accName = (el) => {
    if (!el || !el.getAttribute) return ''
    const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim()
    const lb = el.getAttribute('aria-labelledby')
    const doc = (el.ownerDocument || (typeof document !== 'undefined' ? document : null))
    if (lb && doc && doc.getElementById) {
      const txt = lb.trim().split(/\s+/).map((id) => { const n = doc.getElementById(id); return n ? (n.textContent || '') : '' }).join(' ').trim()
      if (txt) return txt
    }
    if (el.id && doc && doc.querySelector) {
      try { const esc = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(el.id) : el.id; const lab = doc.querySelector('label[for="' + esc + '"]'); if (lab && (lab.textContent || '').trim()) return lab.textContent.trim() } catch (_) {}
    }
    const wrap = el.closest && el.closest('label'); if (wrap && (wrap.textContent || '').trim()) return wrap.textContent.trim()
    const alt = el.getAttribute('alt'); if (alt && alt.trim()) return alt.trim()
    const title = el.getAttribute('title'); if (title && title.trim()) return title.trim()
    return (el.textContent || '').trim()
  }
  const ROLE_CANDIDATES = 'a,area,button,summary,input,select,textarea,img,nav,main,header,footer,aside,h1,h2,h3,h4,h5,h6,[role],[aria-label],[tabindex],[onclick]'
  // The object-target filter pipeline, returning the FULL filtered list —
  // pick indexes it (nth); pickVoted needs its LENGTH for the uniqueness
  // gate. Candidacy: selector matches, else the common-role set when a
  // semantic predicate (role/name) is declared. (name-only resolvers are
  // lint-illegal, so extending candidacy to `name` is unobservable for
  // legal plans — it exists for pickVoted's stripped semantic witness.)
  const resolveList = (target, root) => {
    const wantRole = target.role ? String(target.role).trim().toLowerCase() : ''
    let list = target.selector
      ? all(target.selector, root)
      : ((wantRole || target.name) ? all(ROLE_CANDIDATES, root) : [])
    if (wantRole) list = list.filter((e) => implicitRole(e) === wantRole)
    if (target.name) {
      const nm = String(target.name).trim().toLowerCase()
      list = list.filter((e) => accName(e).toLowerCase().includes(nm))
    }
    if (target.visible !== false) list = list.filter(vis)
    if (target.text) {
      const tx = String(target.text).trim()
      list = list.filter((e) => (e.textContent || '').trim().includes(tx))
    }
    if (target.inViewport) list = list.filter(inView)
    if (target.topmost) list = list.filter(topAt)
    return list
  }
  const pick = (target, root, depth) => {
    const isObj = target && typeof target === 'object'
    if (isObj && target.within) {
      // Scope: resolve the within Target first, then run the outer query
      // inside its subtree. Depth-capped defensively (JSON can't cycle,
      // but a pathological deep nest shouldn't stack-overflow the page).
      if ((depth || 0) > 8) return null
      const scope = pick(target.within, root, (depth || 0) + 1)
      if (!scope) return null
      root = scope
    }
    if (!isObj) {
      const list = all(target, root)
      let el = list[0] || null
      if (el && !vis(el)) { for (const e of list) { if (vis(e)) { el = e; break } } }
      return el
    }
    const list = resolveList(target, root)
    let idx = (typeof target.nth === 'number') ? target.nth : 0
    if (idx < 0) idx = list.length + idx
    return list[idx] || null
  }
  // Witness voting on a conjunctive MISS (ADR 2026-07-17-reference-
  // metabolism): a resolver declaring BOTH witness classes (structural
  // `selector` + semantic `role`/`name`) already paid for redundancy —
  // when one class drifts, the survivor may still uniquely name the
  // author's intent. Rule: absence ≠ veto; dissent = veto; uniqueness
  // required. The survivor resolves iff it matches EXACTLY ONE element
  // AND the other class matches ZERO. Fires only on a pick miss with
  // nth ∈ {undefined, 0} — hits are byte-identical to pick. Returns
  // { el, witness? }; a fallback resolution carries witness =
  // { resolved_by, missing } which handlers ride into _tap_anomalies
  // (never silent — the early drift warning IS the point).
  const pickVoted = (target, root) => {
    const hit = pick(target, root)
    const isObj = target && typeof target === 'object'
    if (hit || !isObj) return { el: hit }
    const nthOk = target.nth === undefined || target.nth === 0
    if (!target.selector || !(target.role || target.name) || !nthOk) return { el: null }
    let scope = root
    if (target.within) {
      scope = pick(target.within, root, 1)
      if (!scope) return { el: null }
    }
    const base = {
      ...(target.text ? { text: target.text } : {}),
      ...(target.visible !== undefined ? { visible: target.visible } : {}),
      ...(target.inViewport ? { inViewport: target.inViewport } : {}),
    }
    const semList = resolveList({
      ...base,
      ...(target.role ? { role: target.role } : {}),
      ...(target.name ? { name: target.name } : {}),
    }, scope)
    const structList = resolveList({ ...base, selector: target.selector }, scope)
    if (semList.length === 1 && structList.length === 0) {
      return { el: semList[0], witness: { resolved_by: 'semantic', missing: 'selector' } }
    }
    if (structList.length === 1 && semList.length === 0) {
      return { el: structList[0], witness: { resolved_by: 'selector', missing: 'semantic' } }
    }
    return { el: null }
  }
  // Why a miss happened, in the resolver's own vocabulary (2026-07-20).
  //
  // A bare `selector_not_found` conflates two very different worlds:
  //   (a) the selector matched NOTHING — wrong selector, or wrong frame;
  //   (b) the selector matched fine and a LATER filter emptied the list —
  //       most often `visible`, because the node is real but collapsed
  //       (inactive wizard step, closed accordion, un-mounted tab panel).
  // (b) reported as (a) sends the reader hunting for a selector bug that
  // does not exist. Worse, the generic hint says "prefix with the iframe
  // selector" even when the caller already did — actively misleading.
  //
  // diag() replays the SAME pipeline as resolveList, recording the survivor
  // count at each stage, and names the first stage that reached zero plus a
  // concrete reason for the leading casualty. Read-only; runs only on a miss.
  // Outer guard: a diagnosis is a courtesy on a path that has ALREADY
  // failed. If any probe throws (hostile getters, detached nodes, exotic
  // custom elements), degrade to a bare string — never convert a resolver
  // miss into an unrelated exception the caller has to debug instead.
  const diag = (target, root) => {
    try { return diagInner(target, root) } catch (_e) { return 'diagnosis unavailable' }
  }
  const diagInner = (target, root) => {
    const r = root || document
    if (!target || typeof target !== 'object') {
      const n = all(String(target), r).length
      return n === 0 ? 'no element matched' : 'matched ' + n + ' but none was visible'
    }
    const wantRole = target.role ? String(target.role).trim().toLowerCase() : ''
    let list = target.selector
      ? all(target.selector, r)
      : ((wantRole || target.name) ? all(ROLE_CANDIDATES, r) : [])
    const started = list.length
    if (started === 0) {
      return target.selector
        ? 'selector matched 0 elements'
        : 'no candidates for role/name'
    }
    const stages = []
    const step = (label, fn) => {
      if (list.length === 0) return
      const before = list
      list = list.filter(fn)
      if (list.length !== before.length) stages.push(label + ' ' + before.length + '→' + list.length)
      if (list.length === 0 && before.length > 0) {
        // Name the leading casualty concretely — "0×0 box" reads very
        // differently from "wrong accessible name".
        const e = before[0]
        try {
          if (label === 'visible') {
            const b = e.getBoundingClientRect()
            const s = (typeof getComputedStyle === 'function') ? getComputedStyle(e) : null
            stages.push('first casualty: ' + Math.round(b.width) + '×' + Math.round(b.height) + ' box' +
              (s && s.display === 'none' ? ', display:none' : '') +
              (s && s.visibility === 'hidden' ? ', visibility:hidden' : '') +
              (e.offsetParent ? '' : ', offsetParent=null'))
          } else if (label === 'name') {
            stages.push('first casualty name: "' + String(accName(e) || '').slice(0, 40) + '"')
          } else if (label === 'role') {
            stages.push('first casualty role: ' + implicitRole(e))
          }
        } catch (_e) { /* diagnosis must never throw */ }
      }
    }
    if (wantRole) step('role', (e) => implicitRole(e) === wantRole)
    if (target.name) {
      const nm = String(target.name).trim().toLowerCase()
      step('name', (e) => accName(e).toLowerCase().includes(nm))
    }
    if (target.visible !== false) step('visible', vis)
    if (target.text) {
      const tx = String(target.text).trim()
      step('text', (e) => (e.textContent || '').trim().includes(tx))
    }
    if (target.inViewport) step('inViewport', inView)
    if (target.topmost) step('topmost', topAt)
    if (list.length > 0) {
      const idx = (typeof target.nth === 'number') ? target.nth : 0
      return 'matched ' + list.length + ' but nth=' + idx + ' is out of range'
    }
    return 'matched ' + started + ', 0 survived [' + stages.join('; ') + ']'
  }
  globalThis.__tapDeep = { all, control, pick, pickVoted, implicitRole, accName, diag, vis, topAt }
}

export { TAP_DEEP_INSTALL }
