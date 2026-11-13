// ShotFlow 领域模型：与 UI 框架无关，M1~M5 全部依赖此处定义

export const SCHEMA_VERSION = 1;

export type FieldKind = 'text' | 'textarea' | 'number' | 'duration' | 'image' | 'select';

export interface ColumnDef {
  id: string;
  /** 内置字段取 Shot 上的属性名；自定义列取 custom 里的键 */
  key: string;
  label: string;
  kind: FieldKind;
  width: number;
  visible: boolean;
  /** 内置列不可删除（可隐藏） */
  builtin: boolean;
  options?: string[];
  order: number;
}

export type PresetId = 'professional' | 'simple' | 'custom';

export interface ColumnSchema {
  preset: PresetId;
  columns: ColumnDef[];
}

export interface ImageAsset {
  id: string;
  /** 项目包内相对路径 assets/xxx 或 data: URL */
  path: string;
  kind: 'upload' | 'draw';
  updatedAt: string;
}

export interface Scene {
  id: string;
  sceneNo: string;
  interior: '内' | '外' | '';
  dayNight: '日' | '夜' | '';
  location: string;
  synopsis: string;
}

/** 一个镜头 = 分镜表格的一行；字段与 15 列专业分镜表一一对应 */
export interface Shot {
  id: string;
  sceneId: string | null;
  shotNo: number;
  sortIndex: number;
  frame: ImageAsset | null;
  reference: ImageAsset | null;
  shotSize: string;
  durationSec: number;
  content: string;
  notes: string;
  sceneExpectation: string;
  sound: string;
  cameraAngle: string;
  cameraMove: string;
  cameraBody: string;
  focalLength: string;
  /** 自定义列的值，键 = ColumnDef.key */
  custom: Record<string, string | number>;
  createdAt: string;
  updatedAt: string;
}

/** 拍摄计划：按日期/场地把镜头分组 */
export interface ShootingDay {
  id: string;
  date: string;
  location: string;
  startTime: string;
  endTime: string;
  crew: string[];
  actors: string[];
  equipment: string[];
  /** 有序镜头 id，同一镜头只能归属一个计划 */
  shotIds: string[];
  note: string;
}

export type RundownKind = 'setup' | 'shoot' | 'move' | 'break' | 'wrap' | 'custom';

/** 拍摄日流程串联单条目 */
export interface RundownItem {
  id: string;
  dayId: string;
  order: number;
  kind: RundownKind;
  /**
   * 分组名：连续且同名（含大小写与空格）的环节在表格里合并为一组显示，
   * 例如「准备」「第 1 场 · 吧台」「午餐与备份」。空字符串表示未分组。
   */
  group: string;
  title: string;
  content: string;
  durationMin: number;
  /** 固定开始时间 HH:mm；为 null 时按上一环节结束时间顺延 */
  fixedStart: string | null;
  owner: string;
  camera: string;
  shotIds: string[];
  note: string;
}

/** 计算后的时间轴条目（派生数据，不落盘） */
export interface RundownSlot extends RundownItem {
  startMin: number;
  endMin: number;
  overrun: boolean;
  conflict: boolean;
}

/** 通告状态：草稿（未发布）→ 待执行 → 已完成；过期由日期推导或手动标记 */
export type NoticeStatus = 'draft' | 'pending' | 'expired' | 'done';

/** 拍摄通告：Rundown 的发布/归档视图 */
export interface Notice {
  id: string;
  dayId: string;
  status: NoticeStatus;
  title: string;
  publishedAt: string | null;
  crew: string;
  groups: string;
  actors: string;
  schedule: string;
  note: string;
}

/** 人员分组：与剧组部门一致，演员单列 */
export type PersonRole =
  | 'director'
  | 'camera'
  | 'lighting'
  | 'sound'
  | 'art'
  | 'producer'
  | 'actor'
  | 'other';

/**
 * 项目内的人员档案：一次录入，拍摄计划与通告反复调用。
 * `name` 在项目内唯一，写入拍摄日时拼成「部门 姓名」的字符串，保持旧数据兼容。
 */
export interface Person {
  id: string;
  name: string;
  role: PersonRole;
  /** 职务补充，如「DP / 掌机」「跟机员」 */
  title: string;
  phone: string;
  note: string;
  /** 是否参与本项目；停用后不出现在选人面板里，但历史拍摄日不受影响 */
  active: boolean;
}

/**
 * 项目颜色标签：用来在项目库里区分优先级，只存色 id，色值见 domain/tags.ts。
 * 跟项目文件一起走，换电脑/共享给别人时标签不会丢。
 */
export type ProjectTag = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';

export interface ProjectSettings {
  theme: 'light' | 'dark';
  storyboardColumns: number;
  storyboardFields: string[];
  rundownView: 'rundown' | 'notice';
}

/** 导出片头的一条自定义信息，例如「灯光」「录音」「美术」 */
export interface ExportCustomField {
  id: string;
  label: string;
  value: string;
}

/**
 * 导出分镜时放在文档首页的制作信息。
 * 项目名称直接使用 Project.name（与项目库、文件名保持同一来源），不在此重复存储。
 */
export interface ExportInfo {
  director: string;
  cinematographer: string;
  producer: string;
  client: string;
  shootDate: string;
  location: string;
  version: string;
  notes: string;
  custom: ExportCustomField[];
}

export type ExportFormat = 'pdf' | 'xlsx' | 'package';
export type ExportPageSize = 'A4' | 'A3';
export type ExportOrientation = 'landscape' | 'portrait';

export interface ExportOptions {
  format: ExportFormat;
  /** 需要导出的列 id；空数组表示按「当前可见列」 */
  columnIds: string[];
  includeImages: boolean;
  includeRundown: boolean;
  /** 'all' 或某个场次 id */
  sceneFilter: string;
  pageSize: ExportPageSize;
  orientation: ExportOrientation;
  /** PDF 每页重复的页脚文字 */
  footer: string;
}

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  title: string;
  client: string;
  createdAt: string;
  updatedAt: string;
  columnSchema: ColumnSchema;
  scenes: Scene[];
  shots: Shot[];
  /** 项目人员库：拍摄计划、通告从这里选人 */
  people: Person[];
  /** 颜色标签（null = 未标注）；只影响项目库展示，不参与分镜内容 */
  tag: ProjectTag | null;
  days: ShootingDay[];
  rundown: RundownItem[];
  notices: Notice[];
  settings: ProjectSettings;
  exportInfo: ExportInfo;
  /**
   * 示例项目的内建内容版本号；普通项目不写这个字段。
   * 程序升级后示例内容若有补充，启动时据此识别旧示例并重建（保留项目 id 与创建时间）。
   */
  sampleRevision?: number;
}
