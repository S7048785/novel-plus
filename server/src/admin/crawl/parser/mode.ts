/**
 * 解析方式（对齐 reader-rust 的 ParseMode）
 */
export enum ParseMode {
  Css = 'Css',
  XPath = 'XPath',
  JsonPath = 'JsonPath',
  Regex = 'Regex',
  Js = 'Js',
}

/**
 * 从规则字符串识别解析方式（复刻 reader-rust detect_mode）
 */
export function detectMode(rule: string, content: string): ParseMode {
  const r = rule.trim();

  // 显式前缀（大小写不敏感）
  if (r.startsWith('@css:') || r.startsWith('@CSS:')) return ParseMode.Css;
  if (r.startsWith('@xpath:') || r.startsWith('@XPath:') || r.startsWith('@XPATH:')) {
    return ParseMode.XPath;
  }
  if (r.startsWith('@json:') || r.startsWith('@Json:') || r.startsWith('@JSON:')) {
    return ParseMode.JsonPath;
  }
  if (r.startsWith('@regex:') || r.startsWith('@Regex:')) return ParseMode.Regex;
  if (r.startsWith('js:') || r.startsWith('@js:') || r.startsWith('<js>')) {
    return ParseMode.Js;
  }

  // 规则前缀自动检测
  if (r.startsWith('/') || r.startsWith('./')) return ParseMode.XPath;
  if (r.startsWith('$.') || r.startsWith('$[')) return ParseMode.JsonPath;
  if (r.startsWith(':')) return ParseMode.Regex;

  // content 自动检测：合法 JSON 时按 JSONPath 处理
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return ParseMode.JsonPath;
    } catch {
      // 不是合法 JSON，走默认
    }
  }

  return ParseMode.Css;
}

/**
 * 剥离模式前缀（复刻 reader-rust strip_mode_prefix）
 */
export function stripModePrefix(rule: string): string {
  const r = rule.trim();

  // <js>...</js>
  if (r.startsWith('<js>') && r.endsWith('</js>')) {
    return r.slice(4, -5);
  }

  const prefixes = [
    '@css:',
    '@CSS:',
    '@xpath:',
    '@XPath:',
    '@XPATH:',
    '@json:',
    '@Json:',
    '@JSON:',
    '@regex:',
    '@Regex:',
    '@js:',
    'js:',
  ];
  for (const prefix of prefixes) {
    if (r.startsWith(prefix)) {
      return r.slice(prefix.length);
    }
  }
  return r;
}
