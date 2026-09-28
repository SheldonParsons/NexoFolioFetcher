import type { EvidenceContext, EvidenceOptions } from './context'

// Serialized into MAIN: no module-level runtime dependencies or framework internals.
// All traversal is local, budgeted and operation-triggered; HTTP never scans DOM.
export function installPageSampler(options: EvidenceOptions) {
  type Tracker = { context: () => EvidenceContext; subscribe: (fn: (type: string, target?: Element, trusted?: boolean) => void) => () => void; accepting: () => boolean }
  type Budget = { nodes: number; chars: number; options: number; issues: Set<string> }
  const host = window as unknown as Record<string, unknown>
  const slot = '__nexofolio_evidence_sampler_v1__'
  try { (host[slot] as { stop?: () => void })?.stop?.() } catch {}
  const candidate = host.__asynctest_page_capture_v2__ as Tracker | undefined
  if (!candidate?.context || !candidate.subscribe) return false
  const tracker = candidate
  let stopped = false
  const elementIds = new WeakMap<Element, string>()
  const formSelector = 'form,[role="form"],[role="search"],.el-form,.ant-form,.ivu-form,.n-form,.arco-form'
  const dialogSelector = 'dialog,[role="dialog"],.el-dialog,.el-drawer,.ant-modal,.ant-drawer,.ivu-modal,.n-dialog,.arco-modal'
  const panelSelector = '[role="tabpanel"],[role="region"],section,fieldset,[data-panel],.el-card,.ant-card'
  const fieldSelector = '.el-form-item,.ant-form-item,.ivu-form-item,.n-form-item,.arco-form-item,.form-group,[data-field]'
  const comboSelector = '.el-select,.ant-select,.ivu-select,.n-base-selection,.arco-select,[role="combobox"]'
  const optionSelector = '[role="option"],.el-select-dropdown__item,.ant-select-item-option,.ivu-select-item,.arco-select-option'
  const controlSelector = `input,textarea,select,button,[role="button"],[role="checkbox"],[role="radio"],[role="switch"],${comboSelector}`
  const limitations = ['SYNC_EVENT_SCOPE_ONLY', 'ASYNC_REQUEST_CORRELATION_UNAVAILABLE', 'PRE_HANDLER_STATE_ONLY']
  const budget = (): Budget => ({ nodes: 2000, chars: 24576, options: 100, issues: new Set() })
  const encoder = new TextEncoder()
  const clip = (value: string, max: number, b: Budget) => {
    const kept = value.slice(0, Math.min(max, b.chars))
    b.chars -= kept.length
    if (kept.length < value.length) b.issues.add('UI_VALUE_OR_TEXT_TRUNCATED')
    return kept
  }
  const visible = (element: Element) => {
    if (closest(element, '[hidden],[aria-hidden="true"]')) return false
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.visibility !== 'hidden' && style.display !== 'none'
  }
  function walk(root: Element, b: Budget, visit: (element: Element) => boolean | void) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      if (b.nodes-- <= 0) { b.issues.add('LOCAL_NODE_LIMIT'); return }
      if (visit(node as Element) === false) return
    }
  }
  function text(element: Element | null, max: number, b: Budget) {
    if (!element) return ''
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node: Node | null, result = '', count = 0
    while ((node = walker.nextNode())) {
      if (b.nodes-- <= 0 || ++count > 64) { b.issues.add('LOCAL_NODE_LIMIT'); break }
      const value = node.nodeValue || ''
      result += value.slice(0, Math.max(0, max + 1 - result.length))
      if (result.length > max) break
    }
    return clip(result.trim(), max, b)
  }
  function closest(element: Element, selector: string) {
    let current: Element | null = element
    for (let depth = 0; current && depth <= 6; depth++, current = current.parentElement) {
      if (current.matches(selector)) return current
    }
    return null
  }
  function rootForbidden(element: Element) {
    return element === document.body || element === document.documentElement || element.matches('main,[role="main"],#app,#root,#__next,#__nuxt')
  }
  function normalize(element: Element) {
    if (element instanceof HTMLSelectElement) return element
    return closest(element, comboSelector) || element
  }
  function trackBranch(root: Element, element: Element, fields: Set<Element>, actions: Set<Element>) {
    let branch = element
    for (let depth = 0; branch.parentElement && branch.parentElement !== root && depth < 6; depth++) branch = branch.parentElement
    if (branch.parentElement !== root) return
    if (element.matches('input:not([type="hidden"]),textarea,select,[role="combobox"],.el-select,.ant-select')) fields.add(branch)
    if (element.matches('button,[role="button"],.el-button,.ant-btn')) actions.add(branch)
  }
  function findContainer(target: Element, b: Budget): Element | null {
    const form = 'form' in target && target.form instanceof HTMLFormElement ? target.form : null
    const explicit = form || closest(target, formSelector)
    const dialog = closest(target, dialogSelector)
    const panel = closest(target, panelSelector)
    if (panel && explicit?.contains(panel) && !rootForbidden(panel) && (!dialog || dialog.contains(panel))) { b.issues.add('LOCAL_PANEL_ONLY'); return panel }
    if (explicit && !rootForbidden(explicit) && (!dialog || dialog.contains(explicit))) { b.issues.add('RELATED_FORM_ONLY'); return explicit }
    if (dialog && !rootForbidden(dialog)) {
      const forms: Element[] = [], panels: Element[] = [], fieldBranches = new Set<Element>(), actionBranches = new Set<Element>()
      walk(dialog, b, element => {
        if (!visible(element)) return
        trackBranch(dialog, element, fieldBranches, actionBranches)
        if (element.matches(formSelector) && visible(element) && !forms.some(form => form.contains(element))) forms.push(element)
        if (element.matches(panelSelector) && visible(element) && !panels.some(panel => panel.contains(element))) panels.push(element)
        if (forms.length > 1 || panels.length > 1) return false
      })
      if (forms.length > 1 || panels.length > 1 || [...fieldBranches].filter(branch => actionBranches.has(branch)).length > 1 || b.issues.has('LOCAL_NODE_LIMIT')) { b.issues.add('RELATED_CONTAINER_AMBIGUOUS'); return null }
      if (forms.length === 1) { b.issues.add('DIALOG_FORM_ONLY'); return forms[0]! }
      if (panels.length === 1) { b.issues.add('DIALOG_LOCAL_ONLY'); return panels[0]! }
      b.issues.add('DIALOG_LOCAL_ONLY'); return dialog
    }
    // Fallback: nearest small ancestor with actual fields AND labels/field groups.
    // Never infer the entire application/page as the form, nor include result tables.
    let ancestor = target.parentElement
    for (let depth = 0; ancestor && depth < 6; depth++, ancestor = ancestor.parentElement) {
      // An unmarked body-level shell is still a page root, even without #app.
      if (rootForbidden(ancestor) || ancestor.parentElement === document.body || ancestor.parentElement === document.documentElement) break
      const rect = ancestor.getBoundingClientRect()
      if (rect.width > innerWidth * 1.5 || rect.height > innerHeight * 2) continue
      let fields = 0, labels = 0, groups = 0, foreign = false
      const fieldBranches = new Set<Element>(), actionBranches = new Set<Element>()
      walk(ancestor, b, element => {
        if (!visible(element)) return
        trackBranch(ancestor!, element, fieldBranches, actionBranches)
        if (element.matches(panelSelector) && !element.contains(target)) { foreign = true; return false }
        if (element.matches('table,[role="grid"],nav,[role="navigation"]') || element.matches(formSelector) || element.matches(dialogSelector)) { foreign = true; return false }
        if (element.matches('input:not([type="hidden"]),textarea,select,[role="combobox"]') && visible(element)) fields++
        if (element.matches('label,[aria-labelledby]') && visible(element)) labels++
        if (element.matches(fieldSelector)) groups++
      })
      if ([...fieldBranches].filter(branch => actionBranches.has(branch)).length > 1) foreign = true
      if (b.issues.has('LOCAL_NODE_LIMIT')) return null
      if (!foreign && fields > 0 && (labels > 0 || groups > 0)) { b.issues.add('LOCAL_CONTAINER_HEURISTIC'); return ancestor }
      if (foreign) { b.issues.add('RELATED_CONTAINER_AMBIGUOUS'); return null }
      if (ancestor === panel) break
    }
    return null
  }
  function describe(element: Element, b: Budget) {
    const rect = element.getBoundingClientRect()
    const combo = element.matches(comboSelector) && !(element instanceof HTMLSelectElement)
    const inner: Element[] = []
    if (combo) walk(element, b, child => { inner.push(child); if (inner.length >= 160) { b.issues.add('CONTROL_NODE_LIMIT'); return false } })
    const native = element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ? element : inner.find(child => child instanceof HTMLInputElement)
    const labels = native && 'labels' in native ? (native as HTMLInputElement).labels : null
    let label = element.getAttribute('aria-label') || native?.getAttribute('aria-label') || ''
    const labelIds = (element.getAttribute('aria-labelledby') || native?.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).slice(0, 4)
    if (!label && labelIds.length) label = labelIds.map(id => text(document.getElementById(id), 160, b)).join(' ')
    if (!label && labels?.length) label = text(labels[0]!, 160, b)
    if (!label) {
      const field = closest(element, fieldSelector), found: Element[] = []
      if (field) walk(field, b, child => {
        if (child.matches('label,.el-form-item__label,.ant-form-item-label,.ivu-form-item-label,.n-form-item-label,.arco-form-item-label') && !found.some(parent => parent.contains(child))) found.push(child)
        if (found.length > 1) return false
      })
      if (found.length === 1) label = text(found[0]!, 160, b)
      else if (found.length > 1) b.issues.add('CONTROL_LABEL_AMBIGUOUS')
    }
    label ||= element.getAttribute('placeholder') || native?.getAttribute('placeholder') || ''
    if (!label && !element.matches(`${formSelector},${dialogSelector}`) && !combo) label = text(element, 160, b)
    if (!elementIds.has(element)) elementIds.set(element, crypto.randomUUID())
    const result: Record<string, unknown> = { element_id: elementIds.get(element), tag: element.tagName.toLowerCase(), role: element.getAttribute('role') || (combo ? 'combobox' : null), name: element.getAttribute('name') || native?.getAttribute('name') || null, label: clip(label, 160, b),
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
    if (!combo && element instanceof HTMLInputElement) {
      if (element.type !== 'file') result.value = clip(element.value, 2048, b)
      else { result.value_unavailable = 'file'; b.issues.add('FILE_VALUE_UNAVAILABLE') }
      if (element.type === 'checkbox' || element.type === 'radio') result.checked = element.checked
    } else if (element instanceof HTMLTextAreaElement) result.value = clip(element.value, 2048, b)
    else if (element instanceof HTMLSelectElement) {
      const selected: Record<string, unknown>[] = []
      for (let i = 0; i < element.selectedOptions.length && i < 100; i++) {
        if (b.options <= 0) { b.issues.add('OPTION_LIMIT'); break }
        b.options--
        const option = element.selectedOptions[i]!
        selected.push({ value: clip(option.value, 2048, b), text: clip(option.text, 512, b), selected: true })
      }
      result.value = element.multiple ? selected.map(option => option.value) : clip(element.value, 2048, b)
      result.selected_options = selected
      if (element.selectedOptions.length > 100) b.issues.add('OPTION_LIMIT')
    } else if (!combo) {
      if (element.hasAttribute('data-value')) result.value = clip(element.getAttribute('data-value')!, 2048, b)
      else if (['true', 'false'].includes(element.getAttribute('aria-checked') || '')) result.checked = element.getAttribute('aria-checked') === 'true'
      else if (element.hasAttribute('aria-valuenow')) result.value = clip(element.getAttribute('aria-valuenow')!, 2048, b)
    }
    const selected: Record<string, unknown>[] = [], observed: Record<string, unknown>[] = []
    const popupIds = new Set<string>()
    for (const owner of [element, ...inner]) {
      for (const attribute of ['aria-controls', 'aria-owns']) {
        for (const id of (owner.getAttribute(attribute) || '').split(/\s+/).filter(Boolean).slice(0, 4)) popupIds.add(id)
      }
    }
    for (const id of [...popupIds].slice(0, 4)) {
      const popup = document.getElementById(id)
      if (!popup) continue
      // Only explicitly owned listboxes/dropdowns. No global visible-popup guessing.
      if (!popup.matches('[role="listbox"],.el-select-dropdown,.el-select-dropdown__list,.el-select-dropdown__wrap,.ant-select-dropdown,.ant-select-item-group-list,.ivu-select-dropdown,.arco-select-dropdown')) continue
      walk(popup, b, option => {
        if (!option.matches(optionSelector)) return
        const isSelected = option.getAttribute('aria-selected') === 'true' || option.matches('.is-selected,.selected,.ant-select-item-option-selected,.ivu-select-item-selected,.arco-select-option-selected')
        if (!isSelected && (!visible(popup) || !visible(option))) return
        if (b.options <= 0) { b.issues.add('OPTION_LIMIT'); return false }
        b.options--
        const entry: Record<string, unknown> = { text: text(option, 512, b), selected: isSelected }
        if (option.hasAttribute('data-value')) entry.value = clip(option.getAttribute('data-value')!, 2048, b)
        if (isSelected) selected.push(entry)
        observed.push(entry)
        if (observed.length >= 100) { b.issues.add('OPTION_LIMIT'); return false }
      })
      if (observed.length >= 100) break
    }
    if (combo) {
      if (element.hasAttribute('data-value')) result.value = clip(element.getAttribute('data-value')!, 2048, b)
      else {
        const hidden = inner.filter(child => child instanceof HTMLInputElement && child.type === 'hidden' && child.hasAttribute('name')) as HTMLInputElement[]
        if (hidden.length === 1) result.value = clip(hidden[0]!.value, 2048, b)
        else if (selected.length === 1 && 'value' in selected[0]!) result.value = selected[0]!.value
        else b.issues.add('CUSTOM_CONTROL_VALUE_UNKNOWN')
      }
      // Selected labels are useful even when the framework keeps IDs only in JS.
      if (!selected.length) {
        const display = inner.filter(child => child.matches('.el-select__tags-text,.ant-select-selection-item,.ant-select-selection-selected-value,.ivu-select-selected-value,.arco-select-view-value')
          || ('value' in result && result.value !== '' && child.matches('.el-select__placeholder:not(.is-transparent),.n-base-selection-label')))
        for (const item of display.slice(0, 100)) if (visible(item)) {
          if (b.options <= 0) { b.issues.add('OPTION_LIMIT'); break }
          b.options--; selected.push({ text: text(item, 512, b), selected: true })
        }
        // Element UI 2 uses a readonly input for the displayed selected label.
        if (!selected.length && 'value' in result && native instanceof HTMLInputElement && native.readOnly && native.value) {
          if (b.options > 0) { b.options--; selected.push({ text: clip(native.value, 512, b), selected: true }) }
          else b.issues.add('OPTION_LIMIT')
        }
      }
      if (selected.length === 1 && 'value' in result && !('value' in selected[0]!)) selected[0]!.value = result.value
      result.selected_options = selected
      b.issues.add('CUSTOM_OPTIONS_PARTIAL')
    }
    if (observed.length) result.visible_options = observed
    // Keep closed-control selected labels even when a visible popup exposes other options.
    if (combo && selected.length && observed.length) result.visible_options = [...observed, ...selected.filter(item => !observed.includes(item))].slice(0, 100)
    return result
  }
  const send = (kind: string, data: Record<string, unknown>, observedAt = Date.now()) => {
    if (stopped || !tracker.accepting() || document.visibilityState === 'hidden') return
    if (kind === 'ui_snapshot' && Array.isArray(data.controls)) {
      while (encoder.encode(JSON.stringify(data)).byteLength > 128 * 1024 && data.controls.length) {
        data.controls.pop(); data.truncated = true
        if (!(data.limitations as string[]).includes('SAMPLE_BYTE_LIMIT')) (data.limitations as string[]).push('SAMPLE_BYTE_LIMIT')
      }
    }
    window.postMessage({ direction: 'fetcher-evidence-v3', nonce: options.nonce,
      sample: { kind, context: tracker.context(), observed_at_ms: observedAt, data } }, '*')
  }
  function snapshot(target: Element, type: string, trusted: boolean) {
    const b = budget(), container = findContainer(target, b)
    const shown: Element[] = [], seen = new Set<Element>()
    let truncated = false
    const add = (raw: Element) => {
      if (!raw.matches(controlSelector)) return
      const element = normalize(raw)
      if (seen.has(element) || (container && !container.contains(element))) return
      seen.add(element)
      if (!visible(element)) return
      if (shown.length >= 80) { truncated = true; return false }
      shown.push(element)
    }
    if (container) {
      walk(container, b, add)
      if (container instanceof HTMLFormElement) {
        for (let i = 0; i < container.elements.length; i++) {
          if (b.nodes-- <= 0) { b.issues.add('LOCAL_NODE_LIMIT'); break }
          const element = container.elements[i]!
          // Explicit form= links are allowed outside the form, without ancestor expansion.
          if (!container.contains(element) && element.matches(controlSelector) && visible(element) && !seen.has(element)) {
            if (shown.length >= 80) { truncated = true; break }
            seen.add(element); shown.push(element)
          }
        }
      }
    } else if (visible(target)) shown.push(normalize(target))
    const controls = shown.map(element => describe(element, b))
    send('ui_snapshot', { controls, truncated: truncated || b.issues.has('LOCAL_NODE_LIMIT'), trusted, limitations: [...limitations,
      ...(trusted ? [] : ['PROGRAMMATIC_EVENT']),
      ...(container ? [] : ['RELATED_FORM_UNAVAILABLE', 'TARGET_ONLY']),
      ...b.issues,
      ...(type === 'click' ? ['CLICK_INTENT_NOT_INFERRED'] : [])] })
  }
  const unsubscribe = tracker.subscribe((type, raw, trusted) => {
    if (type === 'stop') { stop(); return }
    if (type === 'route') { send('page_context', { title: document.title, reason: 'route', limitations: ['SCREENSHOT_CAPTURE_DISABLED', 'ASYNC_REQUEST_CORRELATION_UNAVAILABLE'] }); return }
    if (!['click', 'change', 'submit'].includes(type) || !raw) return
    try {
      const target = normalize(raw)
      if (!visible(target)) return
      const observedAt = Date.now(), b = budget(), description = describe(target, b)
      send('interaction', { type, trusted: trusted === true, target: description, limitations: [...limitations, ...b.issues] }, observedAt)
      if (type === 'submit' || (type === 'click' && target.matches('button,input[type="submit"],input[type="button"],input[type="image"],[role="button"],.el-button,.ant-btn,.ivu-btn,.n-button,.arco-btn'))) snapshot(target, type, trusted === true)
    } catch { send('page_context', { title: document.title, limitations: ['DOM_SAMPLE_FAILED'] }) }
  })
  function stop() {
    if (stopped) return
    stopped = true; unsubscribe()
    if (host[slot] === controller) delete host[slot]
  }
  const controller = { stop, nonce: options.nonce }
  host[slot] = controller
  send('page_context', { title: document.title, reason: 'load', limitations: ['SCREENSHOT_CAPTURE_DISABLED', 'ASYNC_REQUEST_CORRELATION_UNAVAILABLE'] })
  return true
}
