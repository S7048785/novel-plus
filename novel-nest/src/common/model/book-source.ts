/**
 * 书源规则模型（对齐 reader-rust 的 model/rule.rs 与 book_source.rs）
 */

export interface SearchRule {
  checkKeyWord?: string;
  bookList?: string;
  name?: string;
  author?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  updateTime?: string;
  bookUrl?: string;
  coverUrl?: string;
  wordCount?: string;
}

export interface BookInfoRule {
  init?: string;
  name?: string;
  author?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  updateTime?: string;
  coverUrl?: string;
  wordCount?: string;
  tocUrl?: string;
  canReName?: string;
  downloadUrls?: string;
}

export interface TocRule {
  preUpdateJs?: string;
  init?: string;
  chapterList?: string;
  chapterName?: string;
  chapterUrl?: string;
  formatJs?: string;
  isVolume?: string;
  updateTime?: string;
  nextTocUrl?: string;
}

export interface ContentRule {
  content?: string;
  title?: string;
  nextContentUrl?: string;
  webJs?: string;
  sourceRegex?: string;
  replaceRegex?: string;
  imageStyle?: string;
  imageDecode?: string;
  payAction?: string;
}

export interface ExploreRule extends SearchRule {}

/** 书源运行状态：0=可用，1=不可用（采集失败时系统自动标记） */
export enum SourceStatus {
  /** 可用 */
  AVAILABLE = 0,
  /** 不可用 */
  UNAVAILABLE = 1,
}

/**
 * 书源配置（存 crawl_source.json 列的纯配置，无 DB 标量列）
 *
 * 这是 json 列内容的「单一事实来源」：序列化/反序列化都以此类型为准，
 * 避免 repo 里散落 as never / as unknown 断言。
 */
export interface BookSourceConfig {
  bookSourceName: string;
  bookSourceGroup?: string;
  bookSourceUrl: string;
  bookSourceType?: number;
  enabled?: boolean;
  enabledExplore?: boolean;
  /** 站点编码（默认 utf-8；gbk 站点如七步阁配 gbk），详情/目录/正文抓取时按此解码 */
  charset?: string;
  jsLib?: string;
  header?: string;
  searchUrl?: string;
  exploreUrl?: string;
  loginUrl?: string;
  ruleSearch?: SearchRule;
  ruleBookInfo?: BookInfoRule;
  ruleToc?: TocRule;
  ruleContent?: ContentRule;
  ruleExplore?: ExploreRule;
}

/**
 * 书源运行时实体 = 配置（json 列）+ DB 标量列（id / status）
 */
export interface BookSource extends BookSourceConfig {
  id?: number;
  /** 运行状态（DB 标量列，采集时用于判断是否跳过） */
  status?: SourceStatus;
}

/** 搜索结果条目 */
export interface SearchBook {
  name: string;
  author: string;
  bookUrl: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  wordCount?: string;
  latestChapter?: string;
  updateTime?: string;
}

/** 章节 */
export interface BookChapter {
  title: string;
  url: string;
  index: number;
}
