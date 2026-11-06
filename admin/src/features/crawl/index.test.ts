import { PiniaColada } from '@pinia/colada'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, provide } from 'vue'

import { mediaQueryInjectionKey } from '@/injection'

import SourcePage from '@/views/crawl/source/index.vue'

/**
 * 书源管理页的冒烟测试：列表能渲染、新增抽屉能打开、行内开关能提交。
 *
 * 值得留的理由（两条都是运行时才暴露、编译期抓不到的）：
 * 1. 页面挂在 `views/crawl/source/index.vue`，靠 router 的 import.meta.glob 解析——
 *    glob 匹配不到**不会报错**，只会在运行时 404。这条用例直接 import 页面，
 *    能挡住「component 路径写错」这类问题（配合菜单注册一起用）；
 * 2. 行内启用开关只提交 `{ enabled }`（PATCH），不是整份配置——写错会把规则体清空。
 */
enableAutoUnmount(afterEach)

/**
 * vi.mock 的 factory 会被提升到文件顶部，不能引用普通顶层变量（会报
 * "Cannot access before initialization"）。所以这里用 vi.hoisted 把
 * mock 工厂要用到的夹具一起提到提升区，而不是把它们写成普通 const。
 */
const { SOURCE_ROW, patchSource, probeSource, replaceSource } = vi.hoisted(() => ({
  SOURCE_ROW: {
    id: 7,
    sourceName: '测试书源',
    sourceUrl: 'https://example.com',
    enabled: true,
    status: 0,
    createdAt: '2026-11-06T10:00:00.000Z',
    updatedAt: '2026-11-06T10:00:00.000Z',
  },
  patchSource: vi.fn().mockResolvedValue({ id: 7 }),
  probeSource: vi.fn(),
  replaceSource: vi.fn(),
}))

/** 默认探测结果：站点正常、utf-8。个别用例会覆盖它 */
const PROBE_OK = {
  ok: true,
  status: 200,
  costMs: 321,
  finalUrl: 'https://example.com/',
  bodyBytes: 40960,
  charset: 'utf-8',
  title: '示例站点',
}

beforeEach(() => {
  probeSource.mockReset()
  probeSource.mockResolvedValue(PROBE_OK)
  replaceSource.mockReset()
  replaceSource.mockResolvedValue({ id: 7 })
})

vi.mock('@/api', () => ({
  getAdminBookSources: vi.fn().mockResolvedValue({
    list: [SOURCE_ROW],
    total: 1,
    page: 1,
    pageSize: 10,
  }),
  // 详情带一个非默认编码：用来验证「没有输入框之后，编辑保存不会把它弄丢」；
  // 同时带 searchUrl / header：用来验证它们被并进同一个配置 JSON 而不是各自的表单字段
  getAdminBookSource: vi.fn().mockResolvedValue({
    id: 7,
    bookSourceName: '测试书源',
    bookSourceUrl: 'https://example.com',
    charset: 'gbk',
    searchUrl: 'https://example.com/search?q={{key}}',
    header: '{"User-Agent":"test-agent"}',
    enabled: true,
    status: 0,
  }),
  createAdminBookSource: vi.fn(),
  updateAdminBookSource: (...args: unknown[]) => patchSource(...args),
  replaceAdminBookSource: (...args: unknown[]) => replaceSource(...args),
  deleteAdminBookSource: vi.fn(),
  deleteAdminBookSources: vi.fn(),
  testAdminBookSource: vi.fn(),
  probeAdminBookSourceUrl: (...args: unknown[]) => probeSource(...args),
}))

const Host = defineComponent({
  setup() {
    provide(mediaQueryInjectionKey, {
      isMaxSm: computed(() => false),
      isMaxMd: computed(() => false),
      isMaxLg: computed(() => false),
      isMaxXl: computed(() => false),
      isMax2Xl: computed(() => false),
    })

    // NMessageProvider 是 useMessage() 的前提（删除/开关的提示语用到）
    return () => h(NMessageProvider, null, { default: () => h(SourcePage) })
  },
})

function mountPage() {
  return mount(Host, {
    global: { plugins: [createPinia(), PiniaColada] },
    attachTo: document.body,
  })
}

/** 打开「新增书源」抽屉并填好站点地址，返回页面 wrapper */
async function openCreateWithUrl(url: string) {
  const wrapper = mountPage()
  await flushPromises()

  // 抽屉 teleport 到 body，wrapper.find 穿不过去，得直接操作 DOM
  wrapper.findAll('button').find((item) => item.text().includes('新增书源'))!.trigger('click')
  await flushPromises()

  const urlInput = document.body.querySelector<HTMLInputElement>(
    '.n-drawer input[placeholder*="站点根地址"]',
  )
  // 地址没填时「检测站点」是禁用的，所以先填再点（这本身也是要验证的行为）
  await new DOMWrapper(urlInput!).setValue(url)
  await flushPromises()

  return wrapper
}

async function clickProbe() {
  const button = Array.from(document.body.querySelectorAll('button')).find((item) =>
    item.textContent?.includes('检测站点'),
  )
  return new DOMWrapper(button!).trigger('click')
}

function charsetInput() {
  return document.body.querySelector<HTMLInputElement>(
    '.n-drawer input[placeholder*="GBK 站点填 gbk"]',
  )
}

/** 找抽屉底部的「确定」按钮 */
function confirmButton() {
  return Array.from(document.body.querySelectorAll('.n-drawer button')).find((item) =>
    item.textContent?.includes('确定'),
  )
}

describe('书源管理页', () => {
  it('列表渲染出书源名称与站点地址', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('测试书源')
    expect(wrapper.text()).toContain('https://example.com')
    // 运行状态是「可用」（status 0），不是把 enabled 直接当状态显示
    expect(wrapper.text()).toContain('可用')
  })

  it('点「新增书源」能打开抽屉并渲染表单', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const button = wrapper.findAll('button').find((item) => item.text().includes('新增书源'))
    expect(button).toBeTruthy()

    await button!.trigger('click')
    await flushPromises()

    expect(document.body.querySelectorAll('.n-drawer')).toHaveLength(1)
    expect(document.body.textContent).toContain('书源名称')
    expect(document.body.textContent).toContain('站点地址')
    // 采集配置的 JSON 文本域也在（不是把它藏到另一个抽屉里）
    expect(document.body.textContent).toContain('配置 JSON')
    // 「分组」字段已移除，别再冒出来
    expect(document.body.textContent).not.toContain('分组')
  })

  it('切换行内启用开关只提交 { enabled }，不整份覆盖配置', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const toggle = wrapper.find('.n-switch')
    expect(toggle.exists()).toBe(true)

    await toggle.trigger('click')
    await flushPromises()

    expect(patchSource).toHaveBeenCalledWith(7, { enabled: false })
  })

  it('操作列只剩测试与删除，编辑入口移到首列', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const rowButtons = Array.from(
      document.body.querySelectorAll('.n-data-table-tbody button'),
    ).map((item) => item.textContent?.trim())

    expect(rowButtons).toContain('测试')
    expect(rowButtons).toContain('删除')
    // 「编辑」按钮已移除；写在这里是为了防止重构时又加回去
    expect(rowButtons).not.toContain('编辑')

    // 首列（书源名称）可点，且带原生 title 方便看全名
    const nameCell = wrapper.find('span[title="测试书源"]')
    expect(nameCell.exists()).toBe(true)

    await nameCell.trigger('click')
    await flushPromises()

    expect(document.body.querySelectorAll('.n-drawer')).toHaveLength(1)
    expect(document.body.textContent).toContain('编辑书源')
  })

  it('点「一键测试」打开弹窗，逐条展示检测结果', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const button = wrapper.findAll('button').find((item) => item.text().includes('一键测试'))
    expect(button).toBeTruthy()

    await button!.trigger('click')
    await flushPromises()

    // 弹窗标题、进度与汇总
    expect(document.body.textContent).toContain('一键测试站点')
    expect(document.body.textContent).toContain('1 / 1')
    // 结果用的是编辑抽屉里那一套 alert（SourceProbeAlert），所以文案与单条检测一致
    expect(document.body.textContent).toContain('可访问')
    expect(document.body.textContent).toContain('示例站点')
    // 跑完后才能重新点
    expect(document.body.textContent).toContain('重新测试')
  })

  it('填了地址点「检测站点」能展示探测结果', async () => {
    await openCreateWithUrl('https://example.com')

    await clickProbe()
    await flushPromises()

    expect(document.body.textContent).toContain('可访问')
    expect(document.body.textContent).toContain('示例站点')
    // 「可访问」必须带着状态码，否则看不出站点是真通还是假通
    expect(document.body.textContent).toContain('200')
  })

  it('编码没有输入框，识别结果只在探测提示里显示', async () => {
    probeSource.mockResolvedValue({
      ...PROBE_OK,
      finalUrl: 'https://gbk.example.com/',
      charset: 'gbk',
      title: '七步阁',
    })

    await openCreateWithUrl('https://gbk.example.com')
    await clickProbe()
    await flushPromises()

    // 默认 utf-8 不往后端传，交给它按 meta / content-type 嗅探
    expect(probeSource).toHaveBeenCalledWith({
      url: 'https://gbk.example.com',
      charset: undefined,
    })

    // 识别结果要让人看得见（不然用户不知道系统按什么编码解的码）
    expect(document.body.textContent).toContain('站点编码 gbk')
    // 但不能再是一个可编辑的输入框
    expect(charsetInput()).toBeNull()
  })

  it('编辑时采集配置并进同一个 JSON：searchUrl 在内，header 显示成对象', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('span[title="测试书源"]').trigger('click')
    await flushPromises()

    // 抽屉里只有一个 textarea（配置 JSON），不再有独立的搜索地址 / 请求头输入框
    const textareas = document.body.querySelectorAll<HTMLTextAreaElement>('.n-drawer textarea')
    expect(textareas).toHaveLength(1)

    const config = JSON.parse(textareas[0]!.value) as Record<string, unknown>
    expect(config.searchUrl).toBe('https://example.com/search?q={{key}}')
    // header 后端存的是字符串，展示成对象才可读
    expect(config.header).toEqual({ 'User-Agent': 'test-agent' })
  })

  it('编辑非 utf-8 书源后保存，编码与 header 都不会丢', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('span[title="测试书源"]').trigger('click')
    await flushPromises()

    // 详情到达后表单被回填（没有这一步，下面的「确定」会卡在必填校验上）
    const nameInput = document.body.querySelector<HTMLInputElement>(
      '.n-drawer input[placeholder^="必填"]',
    )
    expect(nameInput?.value).toBe('测试书源')

    await new DOMWrapper(confirmButton()!).trigger('click')
    await flushPromises()

    // useReplaceSource 内部把 { id, data } 拆成了两个实参，所以这里是 (id, data)
    const [id, data] = replaceSource.mock.calls[0] as [number, Record<string, unknown>]

    expect(id).toBe(7)
    // 隐藏字段漏提交 = 把 gbk 悄悄改成 utf-8，GBK 站的正文与搜索词当场乱码
    expect(data.charset).toBe('gbk')
    // header 在 JSON 里是对象，落库要转回后端期望的字符串
    expect(data.header).toBe('{"User-Agent":"test-agent"}')
    // 表单管的字段不能被 JSON 里的同名键覆盖（这里 JSON 里没有，属于防御性断言）
    expect(data.bookSourceName).toBe('测试书源')
  })
})
