import type { WidgetAnchor } from '../api/types';
import {
  cleanStyle,
  fill,
  lookup,
  parseCondition,
  parseMarkup,
  parsePath,
  parseTemplate,
  safeUrl,
  scopeCss,
  test,
  WIDGET_ANCHORS,
  WIDGET_NAME,
  widgetClass,
  type Condition,
  type MarkupNode,
  type Path,
  type PlainData,
  type Scope,
  type TemplatePart,
  type WidgetWire,
} from './markup';

/** A widget's markup made ready to build: text and elements with their bindings. */
type Tpl =
  | { text: TemplatePart[] }
  | { tag: string; attrs: [string, TemplatePart[]][]; cond: Condition | null; each: Path | null; action: string | null; children: Tpl[] };

/** A game's widget as a screen builds it: its markup checked and compiled, its CSS scoped to it. */
export interface CompiledWidget {
  name: string;
  nodes: Tpl[];
  css: string;
  at: WidgetAnchor;
  modal: boolean;
}

/** Most copies one `data-each` makes. */
const MAX_ITEMS = 500;

/** Attributes that are on or off: a binding that comes out empty, `false` or `0` leaves them off. */
const BOOLEAN = new Set(['hidden', 'disabled', 'reversed']);

/** A definition from the host, checked here again (a screen trusts nothing a server sends); null if it's no widget. */
export function compileWidget(name: string, wire: WidgetWire): CompiledWidget | null {
  if (!WIDGET_NAME.test(name) || typeof wire?.html !== 'string') return null;
  return {
    name,
    nodes: parseMarkup(wire.html).nodes.map(compile),
    css: typeof wire.css === 'string' ? scopeCss(wire.css, { widget: name }) : '',
    at: wire.at && WIDGET_ANCHORS.includes(wire.at) ? wire.at : 'top-left',
    modal: wire.modal === true,
  };
}

function compile(n: MarkupNode): Tpl {
  if (typeof n === 'string') return { text: parseTemplate(n) };
  let cond: Condition | null = null;
  let each: Path | null = null;
  let action: string | null = null;
  const attrs: [string, TemplatePart[]][] = [];
  for (const [k, v] of Object.entries(n.attrs)) {
    // A condition or list it can't read shows nothing, rather than everything.
    if (k === 'data-if') cond = parseCondition(v) ?? { not: false, left: { value: false } };
    else if (k === 'data-each') each = parsePath(v) ?? [''];
    else {
      if (k === 'data-action') action = v;
      attrs.push([k, parseTemplate(v)]);
    }
  }
  return { tag: n.tag, attrs, cond, each, action, children: n.children.map(compile) };
}

const fixed = (parts: TemplatePart[]) => parts.every((p) => typeof p === 'string');

/**
 * One widget on a screen: its elements, built from the compiled markup with `createElement` and
 * `textContent` (never parsed as HTML), and kept in step with its data: `update` after the data
 * changes re-reads every binding and touches only what came out different.
 */
export class WidgetView {
  readonly root: HTMLElement;
  private updaters: (() => void)[] = [];

  constructor(
    readonly def: CompiledWidget,
    /** What it shows (merge changes in, then `update`). */
    readonly data: PlainData,
    private onAction: (action: string, value: string) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = `gw ${widgetClass(def.name)}`;
    const scope: Scope = { data };
    for (const n of def.nodes) this.build(n, this.root, scope, this.updaters);
    this.update();
  }

  update() {
    for (const u of this.updaters) u();
  }

  private build(n: Tpl, parent: Node, scope: Scope, ups: (() => void)[]) {
    if ('text' in n) {
      const t = document.createTextNode('');
      parent.appendChild(t);
      if (fixed(n.text)) t.data = n.text.join('');
      else {
        let last = '';
        ups.push(() => {
          const s = fill(n.text, scope);
          if (s !== last) t.data = last = s;
        });
      }
      return;
    }
    if (n.each) {
      // A copy per item, each with the item to look names up in, before a marker where the list goes.
      const mark = document.createComment('each');
      parent.appendChild(mark);
      const one: Tpl = { ...n, each: null };
      const path = n.each;
      const copies: { nodes: Node[]; scope: Scope; ups: (() => void)[] }[] = [];
      ups.push(() => {
        const list = lookup(path, scope);
        const items = Array.isArray(list) ? list.slice(0, MAX_ITEMS) : [];
        while (copies.length > items.length) for (const x of copies.pop()!.nodes) x.parentNode?.removeChild(x);
        for (let i = 0; i < items.length; i++) {
          let c = copies[i];
          if (!c) {
            const s: Scope = { data: scope.data, item: items[i], index: i, up: scope };
            const frag = document.createDocumentFragment();
            const u: (() => void)[] = [];
            this.build(one, frag, s, u);
            c = { nodes: [...frag.childNodes], scope: s, ups: u };
            mark.parentNode!.insertBefore(frag, mark);
            copies.push(c);
          }
          c.scope.item = items[i];
          for (const f of c.ups) f();
        }
      });
      return;
    }
    // (Only allowed elements reach here: `parseMarkup` checked the tag and every attribute.)
    const el = document.createElement(n.tag);
    for (const [name, parts] of n.attrs) {
      if (fixed(parts)) {
        el.setAttribute(name, parts.join(''));
        continue;
      }
      let last: string | null = null;
      ups.push(() => {
        let v = fill(parts, scope);
        if (v === last) return;
        last = v;
        // Filled in from data: checked again as it is now.
        if (name === 'style') v = cleanStyle(v);
        else if (name === 'src' && !safeUrl(v)) v = '';
        if (BOOLEAN.has(name) && (v === '' || v === 'false' || v === '0')) el.removeAttribute(name);
        else el.setAttribute(name, v);
      });
    }
    if (n.action) {
      const action = n.action;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onAction(action, el.getAttribute('data-value') ?? '');
      });
      // A controller's menu highlight lands on buttons, and on this.
      if (n.tag !== 'button') el.setAttribute('data-pad', '');
    }
    if (n.cond) {
      const cond = n.cond;
      ups.push(() => {
        const on = test(cond, scope);
        if (el.hidden === on) el.hidden = !on;
      });
    }
    parent.appendChild(el);
    for (const c of n.children) this.build(c, el, scope, ups);
  }
}
