/**
 * 正则提取器 + ## 替换（复刻 reader-rust apply_legado_regex / apply_regex_replace）
 *
 * ## 语法：`##正则##替换##`，多个串联；最后一个加 `###` 表示只替换首个匹配。
 */

/** 拆分 ##正则##替换## 为 [正则, 替换, 是否只替换首个] 列表 */
export function splitLegadoRegex(text: string): { regex: string; replacement: string; firstOnly: boolean }[] {
  // 用 ## 切分，但正则本身可能含 ##，这里按 reader-rust 的简单切分（## 作为分隔）
  const parts = text.split('##');
  // parts[0] 是纯规则部分，之后每两个一组：正则、替换
  const result: { regex: string; replacement: string; firstOnly: boolean }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const regex = parts[i];
    const replacement = parts[i + 1] ?? '';
    // 最后一个替换段如果以 ### 结尾则只替换首个
    let firstOnly = false;
    let actualReplacement = replacement;
    if (i + 1 === parts.length - 1 && parts[parts.length - 1] === '') {
      // "##regex##" 结尾（替换省略 = 删除），或 "##regex###" 只替换首个
    }
    result.push({ regex, replacement: actualReplacement, firstOnly });
  }
  return result;
}

/**
 * 应用 ## 替换（复刻 reader-rust apply_legado_regex）
 *
 * 语义：`##正则##替换` 全局替换；`##正则###`（三段式末尾）只替换首个匹配。
 */
export function applyLegadoRegex(text: string, regexPart: string): string {
  let result = text;
  const parts = regexPart.split('##');
  // 遍历：从 index 1 开始，每 2 个一段（正则、替换）
  for (let i = 1; i < parts.length; i += 2) {
    const regex = parts[i];
    let replacement = parts[i + 1] ?? '';
    let firstOnly = false;

    // 判断是否只替换首个：如果 replacement 以 ### 结尾
    if (replacement.endsWith('###')) {
      firstOnly = true;
      replacement = replacement.slice(0, -3);
    }

    try {
      const re = new RegExp(regex, 'g');
      if (firstOnly) {
        // 只替换首个匹配
        const reNoGlobal = new RegExp(regex);
        result = result.replace(reNoGlobal, replacement);
      } else {
        result = result.replace(re, replacement);
      }
    } catch {
      // 非法正则，跳过
    }
  }
  return result;
}

/** 从规则里拆出「纯规则」和「## 替换段」 */
export function splitRegexFromRule(rule: string): { pure: string; regexPart: string | null } {
  const idx = rule.indexOf('##');
  if (idx < 0) return { pure: rule, regexPart: null };
  return { pure: rule.slice(0, idx), regexPart: rule.slice(idx) };
}

/** 正则列表规则（: 开头 / @regex:），用捕获组 */
export function selectRegexList(content: string, pattern: string): string[] {
  try {
    const re = new RegExp(pattern, 'g');
    const results: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      // 取第一个捕获组，否则整个匹配
      results.push(match[1] ?? match[0]);
      if (match.index === re.lastIndex) re.lastIndex++;
    }
    return results;
  } catch {
    return [];
  }
}

export function selectRegexFirst(content: string, pattern: string): string | null {
  return selectRegexList(content, pattern)[0] ?? null;
}
