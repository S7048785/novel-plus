import * as cheerio from 'cheerio';
import type { AnyNode, Element, Text } from 'domhandler';

/**
 * 正文入库前的统一清洗：把书源抓到的正文（HTML 片段 / 纯文本）转成 Markdown。
 *
 * 背景：不同书源的 ruleContent.content 取值后缀不同——用 @text 得到的是剥掉标签的
 * 纯文本，用 @html/@all 得到的是带 <p> 的 HTML 片段。若不在采集层统一，正文格式
 * 会跟着书源规则漂移（现在 DB 里就是 HTML 与纯文本混合）。
 *
 * 目标形态（Markdown）：
 * - 一个段落 = 一行；
 * - 段落之间用一个空行分隔（标准 Markdown 段落规则）；
 * - 段落内部的换行被压成单个空格（小说段落是连续的散文，硬换行没有排版意义）。
 *
 * 这样渲染端（markdown-it / flutter_markdown / towxml）拿到的是干净的段落流，
 * 每段一个 <p>，三端一致；将来要做段落评论时，按「空行切段」即可得到稳定段号。
 */

/**
 * 块级标签集合：这些标签在 HTML 里天然表示「一个段落/一行的边界」，
 * 清洗时把它们当作段落分隔，而不是当内联元素拼进正文。
 */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'br',
  'li',
  'blockquote',
  'section',
  'article',
  'tr',
]);

/**
 * 标题标签集合：章节标题（<h1>~<h6>）不属于正文内容——它已单独存在
 * book_chapter.title。正文容器（如笔趣阁 .con）常把标题也包进去，若不丢弃，
 * 正文首段就会混入「第x章 标题」。这里直接跳过，不并入正文。
 */
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/**
 * 判断片段里是否存在块级标签。用它区分「HTML 片段」和「纯文本」两条清洗路径：
 * 纯文本里换行本身可能就是分段，不能走 cheerio 的节点遍历（会把 <br> 语义丢掉）。
 */
function hasBlockTag(html: string): boolean {
  return /<[a-zA-Z][^>]*>/i.test(html);
}

/**
 * HTML 片段 → Markdown 段落文本。
 *
 * 做法：用 cheerio 解析，遍历块级标签，每个块级元素内部的文本合并成一行，
 * 块与块之间产生段落边界；<br> 视作块边界（换行）。返回按空行分隔的段落文本。
 */
function htmlToParagraphs(html: string): string {
  const $ = cheerio.load(html);
  const root = $.root();
  const paragraphs: string[] = [];

  // 用一个「当前段落缓冲」逐节点累积文本，遇到块级边界就 flush。
  let buffer = '';

  const flush = () => {
    const text = buffer.replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
    buffer = '';
  };

  const walk = (node: cheerio.Cheerio<AnyNode>) => {
    node.contents().each((_, child) => {
      if (child.type === 'text') {
        buffer += (child as Text).data ?? '';
        return;
      }
      if (child.type !== 'tag') return;

      const tagName = (child as Element).name?.toLowerCase() ?? '';
      const childEl = $(child);

      if (HEADING_TAGS.has(tagName)) {
        // 标题标签：先 flush 上一段，再整段丢弃（标题已存 chapter.title，不进正文）
        flush();
        return;
      }

      if (tagName === 'br') {
        // <br> 是段落内的换行 → 当段落边界
        flush();
        return;
      }

      if (BLOCK_TAGS.has(tagName)) {
        // 块级标签：先 flush 上一段，再递归处理其内部，再 flush 收尾
        flush();
        walk(childEl);
        flush();
        return;
      }

      // 内联标签：继续累积文本，递归处理内部
      walk(childEl);
    });
  };

  walk(root);
  flush();

  return paragraphs.join('\n\n');
}

/**
 * 纯文本 → Markdown 段落文本。
 *
 * 纯文本的段落边界靠换行表达，但源站的换行不可靠（可能每行一个硬换行、也可能
 * 整段挤成一行）。这里按「连续空行」切段，段内换行压成空格。
 */
function plainTextToParagraphs(text: string): string {
  const raw = text.replace(/\r\n?/g, '\n');
  const blocks = raw.split(/\n\s*\n+/);
  const paragraphs = blocks
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return paragraphs.join('\n\n');
}

/**
 * 统一入口：把采集到的正文（HTML 片段或纯文本）清洗成 Markdown 段落。
 * 空输入返回空串。
 */
export function htmlToMarkdown(content: string | null | undefined): string {
  if (!content || !content.trim()) return '';
  const source = content.trim();
  return hasBlockTag(source) ? htmlToParagraphs(source) : plainTextToParagraphs(source);
}
