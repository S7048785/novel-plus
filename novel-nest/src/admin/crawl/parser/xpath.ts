import { DOMParser } from '@xmldom/xmldom';
import { useNamespaces } from 'xpath';

/**
 * XPath 提取器（xpath + @xmldom，XPath 1.0 子集）
 *
 * 用「自闭合标签预处理 + text/xml 解析」方案，解决 @xmldom 对 HTML 自闭合标签容错差的问题。
 */
const VOID_TAGS = /<(br|img|hr|input|meta|link|wbr|source|embed|area|base|col)\b([^>]*?)>/gi;

function normalizeHtml(html: string): string {
  return html.replace(VOID_TAGS, (_, tag: string, attrs: string) => {
    const trimmed = attrs.replace(/\/\s*$/, '');
    return `<${tag}${trimmed}/>`;
  });
}

export function selectXpathText(html: string, xpathExpr: string): string[] {
  const cleaned = normalizeHtml(html);
  // 包裹单一根节点，避免多顶级元素导致 text/xml 解析失败
  const wrapped = `<root>${cleaned}</root>`;
  const doc = new DOMParser({ onError: () => {}, locator: true }).parseFromString(wrapped, 'text/xml');
  const select = useNamespaces({});

  // @xmldom 的 Document 与 DOM 的 Node 类型不兼容，用 any 桥接
  let nodes: Array<{ nodeType: number; nodeValue: string | null; textContent?: string | null }>;
  try {
    nodes = select(xpathExpr, doc as unknown as never) as never;
  } catch {
    return [];
  }

  const values: string[] = [];
  for (const node of nodes) {
    if (node.nodeType === 3) {
      // 文本节点
      const v = (node.nodeValue ?? '').trim();
      if (v) values.push(v);
    } else if (node.nodeType === 2) {
      // 属性节点
      const v = (node.nodeValue ?? '').trim();
      if (v) values.push(v);
    } else if (node.nodeType === 1) {
      // XPath 规则可能带 /text() 或 /@attr，这里取 textContent 或属性
      const v = (node.textContent ?? '').trim();
      if (v) values.push(v);
    } else {
      const v = (node.nodeValue ?? '').trim();
      if (v) values.push(v);
    }
  }
  return values;
}

export function selectXpathFirst(html: string, xpathExpr: string): string | null {
  return selectXpathText(html, xpathExpr)[0] ?? null;
}
