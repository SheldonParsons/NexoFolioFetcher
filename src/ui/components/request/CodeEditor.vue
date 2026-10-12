<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Annotation, Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { json } from '@codemirror/lang-json'
import AppIcon from '../AppIcon.vue'
import { formatJson } from '../../../replay/format'

const props = withDefaults(defineProps<{ modelValue: string; label: string; readonly?: boolean; disabled?: boolean; language?: string }>(), { language: 'text' })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const mount = ref<HTMLElement>(), pretty = ref(false), wrap = ref(true), notice = ref('')
let editor: EditorView | undefined, copyRevision = 0
const mode = new Compartment(), syntax = new Compartment(), wrapping = new Compartment()
const external = Annotation.define<boolean>()
const canFormat = computed(() => props.language !== 'headers' && (props.language === 'json' || /^[\s]*[\[{]/.test(props.modelValue)))
const sizeLabel = computed(() => `${(new TextEncoder().encode(props.modelValue).length / 1024).toFixed(1)} KiB`)
const display = computed(() => {
  if (props.readonly && pretty.value) { try { return formatJson(props.modelValue) } catch {} }
  return props.modelValue
})
const editable = () => [EditorState.readOnly.of(!!props.readonly || !!props.disabled), EditorView.editable.of(!props.readonly && !props.disabled)]
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '11px', color: '#333', backgroundColor: '#fff' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.75' },
  '.cm-content': { padding: '9px 0', caretColor: '#111' },
  '.cm-line': { padding: '0 10px 0 5px' },
  '.cm-gutters': { border: 'none', backgroundColor: '#fafafa', color: '#aaa', paddingRight: '4px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#f5f5f5' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#dedede' },
  '.cm-cursor': { borderLeftColor: '#333' },
  '.cm-searchMatch': { backgroundColor: '#e8e8e8', outline: '1px solid #bbb' },
  '.cm-searchMatch-selected': { backgroundColor: '#cfcfcf' },
  '.cm-foldPlaceholder': { backgroundColor: '#eee', borderColor: '#ddd', color: '#777' },
  '.cm-panels': { backgroundColor: '#f8f8f8', color: '#444', fontSize: '10px' },
  '.cm-search': { padding: '6px' },
  '.cm-textfield': { width: '110px', height: '26px', padding: '3px 5px', fontSize: '11px' },
  '.cm-button': { background: '#fff', border: '1px solid #ddd', borderRadius: '4px', fontSize: '10px' },
  '.cm-search label input': { width: 'auto', height: 'auto' },
})
onMounted(() => {
  if (!mount.value) return
  editor = new EditorView({ parent: mount.value, state: EditorState.create({ doc: display.value, extensions: [
    lineNumbers(), foldGutter(), drawSelection(), highlightActiveLine(), highlightActiveLineGutter(), history(), indentOnInput(), bracketMatching(), search({ top: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
    mode.of(editable()), syntax.of(props.language === 'json' ? json() : []), wrapping.of(EditorView.lineWrapping), theme,
    EditorView.contentAttributes.of({ 'aria-label': props.label, tabindex: '0', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
    EditorState.phrases.of({ 'Find': '查找', 'Replace': '替换', 'next': '下一项', 'previous': '上一项', 'all': '全部', 'replace': '替换', 'replace all': '全部替换', 'close': '关闭', 'match case': '区分大小写', 'regexp': '正则', 'by word': '整词' }),
    EditorView.updateListener.of(update => { if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(external))) emit('update:modelValue', update.state.doc.toString()) }),
  ] }) })
})
watch(display, value => {
  if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, annotations: external.of(true) })
})
watch(() => [props.readonly, props.disabled], () => editor?.dispatch({ effects: mode.reconfigure(editable()) }))
watch(() => props.language, language => editor?.dispatch({ effects: syntax.reconfigure(language === 'json' ? json() : []) }))
watch(wrap, value => editor?.dispatch({ effects: wrapping.reconfigure(value ? EditorView.lineWrapping : []) }))
watch(() => props.modelValue, () => { notice.value = ''; copyRevision++ })
function format() {
  try {
    const formatted = formatJson(props.modelValue)
    if (props.readonly) pretty.value = !pretty.value
    else { emit('update:modelValue', formatted); notice.value = '已格式化' }
  } catch { notice.value = '无法格式化：JSON 无效、层级过深或内容过大，已保留原文。' }
}
async function copy() {
  const revision = ++copyRevision
  try { await navigator.clipboard.writeText(display.value); if (revision === copyRevision) notice.value = '已复制' }
  catch { if (revision === copyRevision) notice.value = '复制失败，可在编辑区选中后复制。' }
}
onBeforeUnmount(() => { copyRevision++; editor?.destroy(); editor = undefined })
</script>
<template>
  <div class="code-editor">
    <div class="code-toolbar">
      <span>{{ language === 'headers' ? 'Headers' : language === 'base64' ? 'Base64' : language === 'json' ? 'JSON' : '原始文本' }}</span>
      <div class="code-actions">
        <button v-if="canFormat" type="button" :disabled="disabled" @click="format">{{ readonly && pretty ? '原文' : '格式化' }}</button>
        <button type="button" :aria-pressed="wrap" @click="wrap = !wrap">折行</button>
        <button type="button" :aria-label="language === 'headers' ? '复制 Headers' : '复制正文'" :title="language === 'headers' ? '复制 Headers' : '复制正文'" @click="copy"><AppIcon name="copy" :size="12" /></button>
      </div>
    </div>
    <div ref="mount" class="code-surface" :class="{ 'is-readonly': readonly }"></div>
    <p v-if="notice" class="code-notice" role="status">{{ notice }}</p>
    <div class="code-footnote"><span>{{ readonly ? '只读' : '本地编辑 · Tab 缩进，Esc 后 Tab 离开' }}</span><span>{{ sizeLabel }}</span></div>
  </div>
</template>
<style scoped>
.code-editor { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; border: 1px solid #e4e4e4; border-radius: 8px; overflow: hidden; }
.code-toolbar { display: flex; align-items: center; justify-content: space-between; min-height: 29px; flex-shrink: 0; padding: 3px 8px; border-bottom: 1px solid #eee; background: #fafafa; color: #888; font-size: 9px; }
.code-actions { display: flex; gap: 3px; }
.code-actions button { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 22px; padding: 2px 5px; border: 0; border-radius: 4px; background: transparent; color: #666; font-size: 10px; }
.code-actions button:hover, .code-actions button[aria-pressed='true'] { background: #eaeaea; color: #222; }
.code-surface { flex: 1; min-height: 0; overflow: hidden; }
.code-surface:focus-within { box-shadow: inset 0 0 0 1px #bbb; }
.code-footnote { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px; padding: 4px 8px; border-top: 1px solid #eee; color: #999; font-size: 9px; flex-shrink: 0; }
.code-notice { flex-shrink: 0; margin: 0; padding: 5px 8px; font-size: 10px; color: #666; background: #f7f7f7; }
.code-surface :deep(.cm-scroller) { scrollbar-width: thin; scrollbar-color: #ccc transparent; overscroll-behavior: contain; }
.code-surface :deep(.cm-search input[type='checkbox']) { accent-color: #444; }
</style>
