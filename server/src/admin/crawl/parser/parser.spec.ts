import { describe, it, expect } from 'vitest';
import { detectMode, stripModePrefix, ParseMode } from './mode.js';
import { selectText, selectTextList } from './html.js';
import * as cheerio from 'cheerio';
import { selectJsonPathFirst, selectJsonPathList } from './jsonpath.js';
import { selectXpathText } from './xpath.js';
import { applyLegadoRegex, splitRegexFromRule, selectRegexList } from './regex.js';

const HTML = `
<div id="info">
  <h1 class="bookname">斗破苍穹</h1>
  <p class="author">作者：天蚕土豆</p>
</div>
<div id="list">
  <a href="/c/1.html">第一章</a>
  <a href="/c/2.html">第二章</a>
  <a href="/c/3.html">第三章</a>
  <a href="/c/4.html">第四章</a>
</div>
<div id="content"><p>第一段</p><p>第二段</p></div>
`;

const $ = cheerio.load(HTML);
const doc = $('body');

describe('detect_mode', () => {
  it('前缀识别', () => {
    expect(detectMode('@css:.a', '')).toBe(ParseMode.Css);
    expect(detectMode('@XPath://div', '')).toBe(ParseMode.XPath);
    expect(detectMode('@json:$.data', '')).toBe(ParseMode.JsonPath);
    expect(detectMode('@regex:abc', '')).toBe(ParseMode.Regex);
    expect(detectMode('js:1+1', '')).toBe(ParseMode.Js);
    expect(detectMode('<js>x</js>', '')).toBe(ParseMode.Js);
  });

  it('自动检测', () => {
    expect(detectMode('//div', '')).toBe(ParseMode.XPath);
    expect(detectMode('$.data', '')).toBe(ParseMode.JsonPath);
    expect(detectMode(':abc', '')).toBe(ParseMode.Regex);
    expect(detectMode('h1', '')).toBe(ParseMode.Css);
  });

  it('JSON content 自动检测', () => {
    expect(detectMode('data', '{"data": 1}')).toBe(ParseMode.JsonPath);
    expect(detectMode('h1', '<html></html>')).toBe(ParseMode.Css);
  });
});

describe('stripModePrefix', () => {
  it('剥离各前缀', () => {
    expect(stripModePrefix('@css:.a')).toBe('.a');
    expect(stripModePrefix('@XPath://div')).toBe('//div');
    expect(stripModePrefix('<js>x</js>')).toBe('x');
    expect(stripModePrefix('h1')).toBe('h1');
  });
});

describe('CSS 提取器', () => {
  it('@text 取值', () => {
    expect(selectText($, doc, 'h1.bookname@text')).toBe('斗破苍穹');
  });

  it('@attr 取值', () => {
    expect(selectTextList($, doc, '#list a@href')).toEqual(['/c/1.html', '/c/2.html', '/c/3.html', '/c/4.html']);
  });

  it('链式 @ 选择', () => {
    expect(selectText($, doc, '#info@h1@text')).toBe('斗破苍穹');
  });

  it('索引 .0 / .-1', () => {
    expect(selectText($, doc, '#list a.0@text')).toBe('第一章');
    expect(selectText($, doc, '#list a.-1@text')).toBe('第四章');
  });

  it('索引区间 [1:2]', () => {
    expect(selectTextList($, doc, '#list a[1:2]@text')).toEqual(['第二章', '第三章']);
  });

  it('排除索引 [!1,2]', () => {
    expect(selectTextList($, doc, '#list a[!1,2]@text')).toEqual(['第一章', '第四章']);
  });

  it('倒序 [-1:0]', () => {
    expect(selectTextList($, doc, '#list a[-1:0]@text')).toEqual(['第四章', '第三章', '第二章', '第一章']);
  });

  it('@ownText 只取直接文本', () => {
    const html = '<div class="x">直接文本<span>子文本</span></div>';
    const sub = cheerio.load(html);
    expect(selectText(sub, sub('body'), '.x@ownText')).toBe('直接文本');
  });

  it('@html 保留标签', () => {
    const r = selectText($, doc, '#content@html');
    expect(r).toContain('<p>第一段</p>');
  });
});

describe('CSS 提取器 - 索引与倒序补充', () => {
  const NESTED = `
<ul class="list">
  <li class="item"><h3><a href="/1.html">书一</a></h3></li>
  <li class="item"><h3><a href="/2.html">书二</a></h3></li>
  <li class="item"><h3><a href="/3.html">书三</a></h3></li>
</ul>`;

  it('中间索引后继续用后续选择器', () => {
    const s = cheerio.load(NESTED);
    expect(selectText(s, s('body'), '.item[1] a@text')).toBe('书二');
  });

  it('中间索引支持负数与排除', () => {
    const s = cheerio.load(NESTED);
    expect(selectText(s, s('body'), '.item[-1] a@text')).toBe('书三');
    expect(selectTextList(s, s('body'), '.item[!1] a@text')).toEqual(['书一', '书三']);
  });

  it('属性选择器不被误判为索引', () => {
    const s = cheerio.load('<div data-x="1"><a href="/1.html">A</a></div><div data-x="2"><a href="/2.html">B</a></div>');
    expect(selectText(s, s('body'), 'div[data-x="2"] a@text')).toBe('B');
    expect(selectTextList(s, s('body'), 'div[data-x] a@text')).toEqual(['A', 'B']);
  });

  it('- 前缀倒序取列表', () => {
    const s = cheerio.load(NESTED);
    expect(selectTextList(s, s('body'), '-.item a@text')).toEqual(['书三', '书二', '书一']);
    expect(selectText(s, s('body'), '-.item a@text')).toBe('书三');
  });
});

describe('JSONPath 提取器', () => {
  const JSON_TEXT = '{"data":{"bookName":"斗破","chapters":[{"name":"一"},{"name":"二"}]}}';

  it('取字段', () => {
    expect(selectJsonPathFirst(JSON_TEXT, '$.data.bookName')).toBe('斗破');
  });

  it('省略 $. 直接字段名', () => {
    expect(selectJsonPathFirst(JSON_TEXT, 'data.bookName')).toBe('斗破');
  });

  it('通配符', () => {
    expect(selectJsonPathList(JSON_TEXT, '$.data.chapters[*].name')).toEqual(['一', '二']);
  });

  it('递归下降 $.. 命中数组时展开为多条', () => {
    expect(selectJsonPathList(JSON_TEXT, '$..chapters')).toEqual(['{"name":"一"}', '{"name":"二"}']);
  });
});

describe('XPath 提取器', () => {
  it('//tag 取文本', () => {
    expect(selectXpathText(HTML, '//*[@id="content"]/p')).toEqual(['第一段', '第二段']);
  });
});

describe('正则提取器', () => {
  it('## 替换', () => {
    expect(applyLegadoRegex('作者：天蚕土豆', '##作者[:：]?##')).toBe('天蚕土豆');
  });

  it('splitRegexFromRule 拆分', () => {
    const { pure, regexPart } = splitRegexFromRule('.author@text##^作者[:：]?##');
    expect(pure).toBe('.author@text');
    expect(regexPart).toBe('##^作者[:：]?##');
  });

  it('正则列表捕获组', () => {
    const r = selectRegexList('<a href="/c/1">第一章</a><a href="/c/2">第二章</a>', 'href="([^"]+)"');
    expect(r).toEqual(['/c/1', '/c/2']);
  });
});
