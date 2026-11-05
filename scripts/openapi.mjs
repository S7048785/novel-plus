#!/usr/bin/env node
/**
 * `pnpm openapi` 的实现：OpenAPI 规范 → TypeScript 请求层。
 *
 * 之所以不是一行 `openapi-ts`，是因为生成链有个前置条件：后端必须在跑。
 * 拿不到规范时 openapi-ts 不会报错，它会生成一份空的 types.gen.ts —— 一份空产物
 * 比没有产物更糟（代码里 import 的东西全变成 unknown，报错点还离现场很远）。
 *
 * 所以这里的契约是「先探测、再生成、最后校验」：
 *   1. 探测 OPENAPI_URL（默认取 packages/shared 里的后端端口），连不上直接失败并提示怎么起后端；
 *   2. 探测到的内容必须真的是 OpenAPI 规范（有 openapi 字段和 paths），否则不生成；
 *   3. 生成完再确认产物非空。
 * 任何一步不满足都以非 0 退出，绝不产出空文件。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from '@novel-plus/shared'

/** 端口只有一个出处：packages/shared（和 server / admin 读的是同一份）。 */
const DEFAULT_URL = `http://localhost:${config.ports.server}/openapi.json`
const PROBE_TIMEOUT_MS = 5000
/** 产物小于这个字节数就认为生成失败（正常产物 10KB 以上）。 */
const MIN_ARTIFACT_BYTES = 1024

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifact = path.join(repoRoot, 'admin', 'src', 'api', 'generated', 'types.gen.ts')
const url = process.env.OPENAPI_URL ?? DEFAULT_URL

function fail(message, hint) {
  console.error(`\n✗ ${message}`)
  if (hint) console.error(`  ${hint}`)
  process.exit(1)
}

let spec
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
  if (!res.ok) {
    fail(
      `${url} 返回 HTTP ${res.status}`,
      '后端起来了但规范接口不可用：检查 Swagger 是否挂在 /openapi.json、有没有被全局守卫拦掉。',
    )
  }
  spec = await res.json()
} catch (error) {
  const reason = error.name === 'TimeoutError' ? `超过 ${PROBE_TIMEOUT_MS}ms 无响应` : (error.cause?.code ?? error.message)
  fail(
    `连不上 ${url}（${reason}）`,
    '请先另开一个终端跑 `pnpm dev:server`，等它打印出监听端口后再执行 pnpm openapi。',
  )
}

if (typeof spec !== 'object' || spec === null || typeof spec.openapi !== 'string' || typeof spec.paths !== 'object') {
  fail(`${url} 返回的不是 OpenAPI 规范`, '可能拿到的是登录页/错误页。已中止，不生成任何文件。')
}

const pathCount = Object.keys(spec.paths ?? {}).length
if (pathCount === 0) {
  fail('规范里一个 path 都没有', '接口没被 Nest 扫描到？已中止，不生成空产物。')
}
console.log(`✓ 规范可用：OpenAPI ${spec.openapi}，${pathCount} 个 path`)

const isWindows = process.platform === 'win32'
const generate = spawnSync(isWindows ? 'pnpm.cmd' : 'pnpm', ['--filter', 'admin', 'openapi'], {
  cwd: repoRoot,
  stdio: 'inherit',
  // Windows 下 pnpm 是 .cmd，Node 18+ 起必须经 shell 才能执行（否则 EINVAL）。
  shell: isWindows,
})
if (generate.status !== 0) {
  fail(`生成失败（openapi-ts 退出码 ${generate.status}）`, '看上面的 openapi-ts 输出定位问题。')
}

if (!existsSync(artifact)) {
  fail(`产物没生成：${path.relative(repoRoot, artifact)}`, '检查 admin/openapi-ts.config.ts 的 output.path。')
}
const size = statSync(artifact).size
if (size < MIN_ARTIFACT_BYTES) {
  fail(`产物异常偏小：${size} 字节`, `${path.relative(repoRoot, artifact)} 可能是空的，删掉后重跑。`)
}

console.log(`✓ 已生成 ${path.relative(repoRoot, artifact)}（${size} 字节）`)
