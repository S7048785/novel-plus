import { describe, expect, it } from 'vitest'

import { buildSourcePayload, checkConfigJson, extractConfig, textOrUndefined } from './source-config'

import type { BookSourceDetail } from '@novel-plus/shared/dto'

/**
 * 配置编解码的纯函数测试。
 *
 * 这些规则原来埋在 SourceFormModal 里，只能靠挂载组件、点按钮、看 mock 收到的参数间接验证；
 * 抽出来之后可以直接对着数据断言。覆盖的都是「错了不会报错、只会静默丢数据」的情况。
 */
const detail: BookSourceDetail = {
  id: 7,
  bookSourceName: '测试书源',
  bookSourceUrl: 'https://example.com',
  charset: 'gbk',
  enabled: true,
  enabledExplore: false,
  status: 0,
  searchUrl: 'https://example.com/search?q={{key}}',
  header: '{"User-Agent":"test-agent"}',
  ruleSearch: { bookList: '.book-list' },
}

describe('extractConfig', () => {
  it('排除表单管的字段，只留采集配置', () => {
    const config = extractConfig(detail)

    expect(config.searchUrl).toBe('https://example.com/search?q={{key}}')
    expect(config.ruleSearch).toEqual({ bookList: '.book-list' })

    // 这几个由表单维护，出现在 JSON 里会和表单打架
    for (const key of ['id', 'status', 'bookSourceName', 'bookSourceUrl', 'charset', 'enabled', 'enabledExplore']) {
      expect(config).not.toHaveProperty(key)
    }
  })

  it('schema 已不再声明的透传字段照样带出来（删表单字段 ≠ 清数据）', () => {
    // bookSourceGroup 已从 schema 删除，但存量 json 里还可能有
    const legacy = { ...detail, bookSourceGroup: '笔趣阁系' } as BookSourceDetail

    expect(extractConfig(legacy).bookSourceGroup).toBe('笔趣阁系')
  })

  it('header 字符串转成对象，方便在 JSON 里读写', () => {
    expect(extractConfig(detail).header).toEqual({ 'User-Agent': 'test-agent' })
  })

  it('header 不是合法 JSON 对象时保持原字符串', () => {
    const odd = { ...detail, header: 'User-Agent: test' } as BookSourceDetail

    expect(extractConfig(odd).header).toBe('User-Agent: test')
  })

  it('空字符串与空规则对象不写进配置，避免 JSON 里一堆噪音', () => {
    const empty = {
      ...detail,
      exploreUrl: '',
      jsLib: undefined,
      ruleToc: {},
    } as BookSourceDetail

    const config = extractConfig(empty)

    expect(config).not.toHaveProperty('exploreUrl')
    expect(config).not.toHaveProperty('jsLib')
    expect(config).not.toHaveProperty('ruleToc')
  })
})

describe('buildSourcePayload', () => {
  const base = {
    name: '  新书源  ',
    url: ' https://new.example.com ',
    charset: 'gbk',
    enabled: true,
    enabledExplore: false,
    configJson: '{}',
  }

  it('表单字段优先：JSON 里写了同名键直接丢掉', () => {
    const payload = buildSourcePayload({
      ...base,
      configJson: JSON.stringify({
        bookSourceName: 'JSON 里被我改坏了',
        enabled: false,
        searchUrl: 'https://new.example.com/search',
      }),
    })

    // 名称/开关以表单为准，否则「表单里改了没生效」这种问题只能读代码才能解释
    expect(payload.bookSourceName).toBe('新书源')
    expect(payload.enabled).toBe(true)
    // 采集配置正常带上
    expect(payload.searchUrl).toBe('https://new.example.com/search')
  })

  it('header 从对象转回后端期望的字符串', () => {
    const payload = buildSourcePayload({
      ...base,
      configJson: JSON.stringify({ header: { 'User-Agent': 'ua' } }),
    })

    expect(payload.header).toBe('{"User-Agent":"ua"}')
  })

  it('地址与名称会 trim，空编码转成 undefined（不传）', () => {
    const payload = buildSourcePayload({ ...base, charset: '  ' })

    expect(payload.bookSourceUrl).toBe('https://new.example.com')
    expect(payload.charset).toBeUndefined()
  })
})

describe('checkConfigJson', () => {
  it('对象合法，空文本也合法（表示不配采集配置）', () => {
    expect(checkConfigJson('{}')).toBe('')
    expect(checkConfigJson('   ')).toBe('')
  })

  it('数组、字符串、数字都不是合法配置', () => {
    for (const text of ['[]', '"text"', '123', 'null']) {
      expect(checkConfigJson(text)).not.toBe('')
    }
  })

  it('语法错误时把原因带出来', () => {
    expect(checkConfigJson('{ "a": }')).toContain('JSON 格式错误')
  })
})

describe('textOrUndefined', () => {
  it('空白串转 undefined，其余 trim', () => {
    expect(textOrUndefined('   ')).toBeUndefined()
    expect(textOrUndefined('  gbk ')).toBe('gbk')
  })
})
