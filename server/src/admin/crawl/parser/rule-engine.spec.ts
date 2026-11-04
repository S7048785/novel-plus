import { describe, it, expect } from 'vitest';
import { extractListFromHtml, extractListFromJson, evalFieldOnDoc, EvalContext } from './rule-engine.js';

const SEARCH_HTML = `
<ul class="book-list">
  <li>
    <h3 class="name"><a href="/book/1.html">斗破苍穹</a></h3>
    <p class="author">作者：天蚕土豆</p>
  </li>
  <li>
    <h3 class="name"><a href="/book/2.html">凡人修仙传</a></h3>
    <p class="author">作者：忘语</p>
  </li>
</ul>
`;

const DETAIL_HTML = `
<div id="info">
  <h1 class="bookname">斗破苍穹</h1>
  <p class="author">作者：天蚕土豆</p>
  <p class="intro">这是一个少年逆袭的故事</p>
</div>
`;

function docCtx(baseUrl = 'https://example.com'): EvalContext {
  return { baseUrl, variables: new Map() };
}

describe('规则引擎 - 列表提取（HTML）', () => {
  it('搜索页提取书名+作者+链接', async () => {
    const results = await extractListFromHtml(
      '.book-list li',
      {
        name: '.name@text',
        author: '.author@text',
        bookUrl: '.name a@href',
      },
      SEARCH_HTML,
      'https://example.com',
    );

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('斗破苍穹');
    expect(results[0].author).toBe('作者：天蚕土豆');
    expect(results[0].bookUrl).toBe('/book/1.html');
    expect(results[1].name).toBe('凡人修仙传');
  });

  it('字段规则带 ## 替换', async () => {
    const results = await extractListFromHtml(
      '.book-list li',
      { author: '.author@text##作者[:：]?##' },
      SEARCH_HTML,
      'https://example.com',
    );
    expect(results[0].author).toBe('天蚕土豆');
  });

  it('字段规则带 JS 后处理', async () => {
    const results = await extractListFromHtml(
      '.book-list li',
      { name: '.name@text@js:input.toUpperCase()' },
      SEARCH_HTML,
      'https://example.com',
    );
    expect(results[0].name).toBe('斗破苍穹'.toUpperCase());
  });
});

describe('规则引擎 - 详情页字段（文档级）', () => {
  it('提取书名/作者/简介', async () => {
    const ctx = docCtx();
    expect(await evalFieldOnDoc('h1.bookname@text', DETAIL_HTML, ctx)).toBe('斗破苍穹');
    expect(await evalFieldOnDoc('.author@text##作者[:：]?##', DETAIL_HTML, ctx)).toBe('天蚕土豆');
    expect(await evalFieldOnDoc('.intro@text', DETAIL_HTML, ctx)).toBe('这是一个少年逆袭的故事');
  });
});

describe('规则引擎 - 组合、倒序与容错', () => {
  const HTML = `
<ul class="list">
  <li class="item"><a href="/1.html">书一</a></li>
  <li class="item"><a href="/2.html">书二</a></li>
</ul>
<div id="content"><p>段一</p><p>段二</p></div>`;

  it('列表规则 - 前缀倒序', async () => {
    const r = await extractListFromHtml('-.item', { name: 'a@text' }, HTML, 'https://e.com');
    expect(r.map((x) => x.name)).toEqual(['书二', '书一']);
  });

  it('|| 优先于 &&（不会被后面的操作符覆盖）', async () => {
    // 正确语义：(.item && #content p) || .nope → 2 + 2 = 4 条；旧实现会退化成 2 条
    const r = await extractListFromHtml('.item&&#content p||.nope', { name: '@text' }, HTML, 'https://e.com');
    expect(r).toHaveLength(4);
  });

  it('单个字段规则出错只丢该字段，不中断整表', async () => {
    const r = await extractListFromHtml('.item', { name: 'a@text', bad: 'a[' }, HTML, 'https://e.com');
    expect(r).toHaveLength(2);
    expect(r[0].name).toBe('书一');
    expect(r[0].bad).toBeUndefined();
  });

  it('@put 前缀后可以继续取值', async () => {
    const r = await extractListFromHtml('.item', { name: '@put:{k:v}@text' }, HTML, 'https://e.com');
    expect(r[0].name).toBe('书一');
  });

  it('JSON 列表：递归下降命中数组', async () => {
    const json = '{"a":{"list":[{"name":"甲"},{"name":"乙"}]}}';
    const r = await extractListFromJson('$..list', { name: 'name' }, json, 'https://e.com');
    expect(r.map((x) => x.name)).toEqual(['甲', '乙']);
  });
});
