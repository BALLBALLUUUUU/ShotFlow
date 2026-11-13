import { SCHEMA_VERSION } from './types';
import type {
  ColumnDef,
  ColumnSchema,
  ImageAsset,
  Notice,
  NoticeStatus,
  Person,
  PersonRole,
  Project,
  ProjectSettings,
  RundownItem,
  RundownKind,
  Scene,
  ShootingDay,
  Shot,
} from './types';
import { createColumnSchema } from './schema';
import { createEmptyExportInfo, normalizeExportInfo } from './exportInfo';
import { normalizeTag } from './tags';
import { SAMPLE_FRAMES } from './sampleFrames';
import { PERSON_ROLES } from './people';

export class ProjectParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectParseError';
  }
}

/**
 * 示例项目「一杯手冲的时间」的内容版本。
 * 每次给示例补充内容（图片、备注、声音、场景预期等）都 +1，
 * 旧示例会在启动时自动按最新版本重建，避免用户看到残缺的旧示例。
 */
export const SAMPLE_REVISION = 5;

/** 示例项目的片名，用于识别旧版示例（用户自建项目一般不会同名） */
export const SAMPLE_PROJECT_TITLE = '一杯手冲的时间';

/** 示例项目的固定项目名，旧文件没有版本号时靠它 + 片名识别 */
export const SAMPLE_PROJECT_NAME = '示例 · 咖啡馆短片';

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function arrayOf<T>(value: unknown, normalize: (raw: Raw) => T): T[] {
  return Array.isArray(value) ? value.filter(isRecord).map(normalize) : [];
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const DEFAULT_SETTINGS: ProjectSettings = {
  theme: 'light',
  storyboardColumns: 5,
  storyboardFields: ['shotSize', 'content', 'durationSec'],
  rundownView: 'rundown',
};

export function createShot(shotNo: number, sceneId: string | null = null, sortIndex = shotNo - 1): Shot {
  const timestamp = now();
  return {
    id: newId('shot'),
    sceneId,
    shotNo,
    sortIndex,
    frame: null,
    reference: null,
    shotSize: '',
    durationSec: 0,
    content: '',
    notes: '',
    sceneExpectation: '',
    sound: '',
    cameraAngle: '',
    cameraMove: '',
    cameraBody: '',
    focalLength: '',
    custom: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createEmptyProject(name = '未命名项目'): Project {
  const timestamp = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('proj'),
    name,
    title: '',
    client: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    columnSchema: createColumnSchema('professional'),
    scenes: [],
    shots: [],
    people: [],
    tag: null,
    days: [],
    rundown: [],
    notices: [],
    settings: { ...DEFAULT_SETTINGS, storyboardFields: [...DEFAULT_SETTINGS.storyboardFields] },
    exportInfo: createEmptyExportInfo(),
  };
}

/** 每个镜头除图片位外的全部字段都有内容，可直接当拍摄脚本执行 */
interface SampleShotSpec {
  size: string;
  seconds: number;
  content: string;
  notes: string;
  expectation: string;
  sound: string;
  angle: string;
  move: string;
  body: string;
  focal: string;
}

/**
 * 与截图一致：10 个镜头的咖啡手冲短片脚本。
 * 镜号 / 景别 / 时长 / 内容沿用原有示意，其余列补成可执行的拍摄信息：
 * 备注写道具与连戏风险，场景预期写构图与光线，声音写同期与音乐进点。
 */
export function createSampleProject(): Project {
  const project = createEmptyProject(SAMPLE_PROJECT_NAME);
  project.title = SAMPLE_PROJECT_TITLE;
  project.client = '个人创作';
  Object.assign(project.exportInfo, {
    director: '球球',
    cinematographer: '陈默（DP）',
    producer: '个人创作',
    client: '个人创作',
    shootDate: '2026-11-20',
    location: '杭州 · 转塘「拾光」咖啡馆（内景）',
    version: 'V1.0',
    notes: '60 秒咖啡手冲短片 · 10 镜 2 场 · 4K 50p · 16:9 · 暖调 3200–4300K',
  });
  project.exportInfo.custom = [
    { id: newId('info'), label: '片长', value: '58 秒（不含片头片尾字幕）' },
    { id: newId('info'), label: '画幅 / 帧率', value: '16:9 · 4K 50p；镜 6 以 100fps 拍摄，后期降速 50%' },
    { id: newId('info'), label: '灯光', value: '李工 · 3200K 柔光箱主光 + 侧逆光勾蒸汽 + 黑旗压暗背景' },
    { id: newId('info'), label: '录音', value: '王工 · 同期环境底噪与器具声，音乐后期贴' },
    { id: newId('info'), label: '美术 / 道具', value: '电子秤、18g 单一产地豆、手冲壶、滤杯、分享壶、同款杯 ×2、杯垫' },
    { id: newId('info'), label: '音乐', value: '钢琴单音起 → 弦乐铺底收，需可商用授权曲' },
    { id: newId('info'), label: '剪辑备注', value: '镜 6 升格接镜 7 光斑匹配转场；镜 10 渐暗 1.5s 后进片尾字幕' },
  ];

  const sceneA: Scene = {
    id: newId('scene'),
    sceneNo: '1',
    interior: '内',
    dayNight: '日',
    location: '咖啡馆吧台',
    synopsis: '清晨备场：磨豆、称粉、注水萃取，完成一杯手冲',
  };
  const sceneB: Scene = {
    id: newId('scene'),
    sceneNo: '2',
    interior: '内',
    dayNight: '日',
    location: '靠窗座位',
    synopsis: '端杯落座，第一口之前的停顿与眼神收尾',
  };
  project.scenes = [sceneA, sceneB];

  const specs: SampleShotSpec[] = [
    {
      size: '特写', seconds: 4, content: '磨豆机启动，咖啡豆落入研磨仓',
      notes: '道具：18g 单一产地豆、磨豆机刻度归零；开拍前空转一次确认出粉口干净；备用一条「豆子落入手持量杯」。',
      expectation: '暗色背景 + 侧逆光勾豆粒轮廓，浅景深只留磨豆机与豆罐，暖棕 3200K。',
      sound: '同期磨豆机启动「咔」+ 豆粒落仓声，无音乐，起幅留 0.5s 静音。',
      angle: '平视略俯 15°', move: '固定',
      body: 'A 机 · 主机 + 三脚架（S-Log3 / 4K 50p）', focal: '100mm 微距',
    },
    {
      size: '中景', seconds: 6, content: '手部特写：称量 18g 咖啡粉',
      notes: '电子秤归零实拍，18.0g 数字必须看清；袖口与镜 8 连戏；备一条俯拍秤面的备用镜。',
      expectation: '台面顶俯构图，柔光箱顶光打匀，秤屏与粉堆同框，米白台面留白 1/3。',
      sound: '秤按键「滴」+ 轻勺碰壁声；音乐自本镜末尾淡入钢琴单音。',
      angle: '顶俯 90°', move: '缓慢推',
      body: 'A 机 · 俯拍横臂 + 监视器', focal: '50mm',
    },
    {
      size: '全景', seconds: 8, content: '吧台全景，主角进入画面',
      notes: '场 1 定场镜；主角从左入画走到吧台内侧，走位贴地标；吧台器物按镜 2 位置复原，避免穿帮。',
      expectation: '交代吧台—窗—座位空间关系，自然晨光，右下留字幕安全区。',
      sound: '环境底噪（轻语、杯碟碰撞）+ 脚步声；音乐保持低音量。',
      angle: '平视', move: '缓慢拉',
      body: 'A 机 · 三脚架 + 液压云台', focal: '35mm',
    },
    {
      size: '近景', seconds: 4, content: '热水注入滤杯，蒸汽升起',
      notes: '水温 92℃，先闷蒸 30s 再拍注水；蒸汽需逆光才可见，备黑旗遮背景；壶嘴别入画过深，防烫。',
      expectation: '侧逆光穿透蒸汽，水线清晰，背景压暗一档，暖白高光不过曝。',
      sound: '注水声为主，环境音压 -6dB；音乐维持低音量。',
      angle: '侧拍略俯 30°', move: '固定',
      body: 'A 机 · 三脚架', focal: '85mm',
    },
    {
      size: '中近景', seconds: 6, content: '主角注视萃取液面',
      notes: '眼神方向对准滤杯中心，不看镜头；蒸汽与镜 4 连戏；表情僵时改拍过肩备用镜。',
      expectation: '人物占右 1/3，左侧虚化滤杯，暖调肤色，柔和眼神光。',
      sound: '环境音为主，只留极轻水声；音乐单音重复。',
      angle: '过肩 45°', move: '固定',
      body: 'A 机 · 肩托 / 手持稳定器', focal: '50mm',
    },
    {
      size: '特写', seconds: 8, content: '咖啡液滴入分享壶',
      notes: '液面高度与镜 9 杯中量连戏；最后一滴用滴管补；玻璃反光避开灯位，备偏振镜。',
      expectation: '琥珀色液柱对焦，壶身轮廓光，深色背景；100fps 拍摄，后期降速 50%。',
      sound: '滴落声节奏化，音乐在本镜推到第一小节，为场 2 转场铺垫。',
      angle: '平视略仰 10°', move: '微推',
      body: 'B 机 · 高速机位（100fps）+ 滑轨', focal: '100mm 微距',
    },
    {
      size: '全景', seconds: 4, content: '靠窗座位全景，阳光斜射',
      notes: '场 2 定场镜；窗光方向须与场 1 一致（同为上午顺光）；窗帘飘动用风扇控；桌面杯具贴标记。',
      expectation: '逆光斜射形成光斑，暖金色调，主角剪影居左 1/3。',
      sound: '环境音切到更安静的座位区，音乐转弦乐铺底。',
      angle: '平视', move: '缓慢摇（由窗摇向座位）',
      body: 'A 机 · 三脚架 + 云台', focal: '35mm',
    },
    {
      size: '中景', seconds: 6, content: '主角端起杯子',
      notes: '手型与镜 2 一致（同袖口、不戴表）；杯沿液面不晃，动作放慢 1.5 倍；备一条带杯垫起手的。',
      expectation: '侧光勾手部轮廓，杯身透出琥珀色，背景窗光虚化成光斑。',
      sound: '杯底离桌轻响 + 布料摩擦；音乐保持。',
      angle: '侧拍平视', move: '固定',
      body: 'A 机 · 三脚架', focal: '85mm',
    },
    {
      size: '近景', seconds: 8, content: '杯沿贴近嘴唇，停顿',
      notes: '停顿 2 秒别眨眼；杯中液量与镜 6 连戏；蒸汽要可见，开拍前续热水；备一条闭眼闻香。',
      expectation: '唇与杯沿对焦，眼神虚化，暖调高光柔和不刺眼，轻微手持起伏给呼吸感。',
      sound: '全片最静处：环境音 -12dB，音乐留一个长音，去掉同期杂声。',
      angle: '正面略俯 20°', move: '固定',
      body: 'A 机 · 手持稳定器', focal: '85mm',
    },
    {
      size: '特写', seconds: 4, content: '眼神特写，画面渐暗',
      notes: '收尾镜；渐暗后期做 1.5s 曲线，现场拍足 6s 余量；眼神光保留到最后一帧。',
      expectation: '瞳孔与窗光反光点清晰，背景全暗，色温降一档收束情绪。',
      sound: '音乐收在单音 + 1s 环境留白；片尾 LOGO 音单独录。',
      angle: '平视', move: '缓慢推',
      body: 'A 机 · 三脚架 + 微距导轨', focal: '100mm 微距',
    },
  ];

  project.shots = specs.map((spec, index) => {
    const shot = createShot(index + 1, index < 6 ? sceneA.id : sceneB.id, index);
    shot.shotSize = spec.size;
    shot.durationSec = spec.seconds;
    shot.content = spec.content;
    shot.notes = spec.notes;
    shot.sceneExpectation = spec.expectation;
    shot.sound = spec.sound;
    shot.cameraAngle = spec.angle;
    shot.cameraMove = spec.move;
    shot.cameraBody = spec.body;
    shot.focalLength = spec.focal;
    const framePath = SAMPLE_FRAMES[index];
    if (framePath) {
      shot.frame = {
        id: `img_sample_${String(index + 1).padStart(2, '0')}`,
        path: framePath,
        kind: 'upload',
        updatedAt: project.createdAt,
      };
    }
    return shot;
  });

  /** 人员库：拍摄计划页从这里一键勾选，不用每次手打「导演 球球」 */
  project.people = [
    { id: newId('pp'), name: '球球', role: 'director', title: '导演 / 剪辑', phone: '138 0000 0000', note: '兼剧本与后期调色，习惯提前 30 分钟到场', active: true },
    { id: newId('pp'), name: '陈默', role: 'camera', title: 'DP / 掌机', phone: '', note: '带 A 机与 35 / 85mm 定焦', active: true },
    { id: newId('pp'), name: '李工', role: 'lighting', title: '灯光师', phone: '', note: '负责 3200K 柔光箱与黑旗，自带灯腿', active: true },
    { id: newId('pp'), name: '王工', role: 'sound', title: '同期录音', phone: '', note: '挑杆 + 无线小蜜蜂各一套，含备用电池', active: true },
    { id: newId('pp'), name: '周周', role: 'producer', title: '制片 / 场务', phone: '', note: '场地对接、餐饮、器材运输与停车', active: true },
    { id: newId('pp'), name: '阿岚', role: 'actor', title: '饰 主角', phone: '', note: '浅色上衣自备，勿戴手表（连戏）', active: true },
  ];

  const day: ShootingDay = {
    id: newId('day'),
    date: '2026-11-20',
    location: '杭州 · 转塘「拾光」咖啡馆（内景）',
    startTime: '08:00',
    endTime: '18:00',
    crew: ['导演 球球', '摄影 陈默', '灯光 李工', '录音 王工', '制片 周周'],
    actors: ['演员 阿岚'],
    equipment: [
      'A 机 · 4K 50p 主机 + 三脚架云台',
      'B 机 · 100fps 高速机位 + 滑轨',
      '35 / 50 / 85 / 100mm 定焦组 + 微距',
      '3200K 柔光箱、黑旗、偏振镜、反光板',
      '手冲器具全套、电子秤、同款杯 ×2',
      '同期录音麦 + 挑杆 + 备用电池',
    ],
    shotIds: project.shots.map((shot) => shot.id),
    note: '提前 30 分钟进场布光；窗光方向全片统一为上午顺光；热水与备用豆各备一份。',
  };
  project.days = [day];

  /**
   * 全天 22 个环节、5 个分组，按真实拍摄节奏排：
   * 准备 → 第 1 场（吧台）→ 第 2 场（靠窗）→ 午餐与备份 → 补拍与收工。
   * 10 个镜头全部落到具体环节上，时间轴 08:00–15:10，留了 7 分钟缓冲。
   */
  const rawItems: Array<Pick<RundownItem, 'group' | 'title' | 'kind' | 'durationMin' | 'owner' | 'camera' | 'shotIds' | 'content' | 'fixedStart' | 'note'>> = [
    // 准备
    { group: '准备', title: '进场与器材落位', kind: 'setup', durationMin: 20, owner: '制片 周周 / 摄影 陈默', camera: 'A / B 机位', shotIds: [], fixedStart: '08:00', content: '器材清点、机位落位、电源与监看接通', note: '磨豆机单独一路电，避免跳闸带走监视器' },
    { group: '准备', title: '吧台布光与机位标记', kind: 'setup', durationMin: 25, owner: '灯光 李工', camera: 'A / B 机位', shotIds: [], fixedStart: null, content: '3200K 柔光箱主光 + 侧逆光，先打镜 4 的蒸汽逆光，地标贴好', note: '黑旗压暗背景，玻璃壶位避开灯影' },
    { group: '准备', title: '试拍与白平衡校准', kind: 'setup', durationMin: 15, owner: '摄影 陈默', camera: 'A 机', shotIds: [], fixedStart: null, content: '按镜 2、镜 4 各试一条，确认 S-Log3 曝光与 3200K 白平衡', note: '曝光以秤面高光不溢出为准，试拍条留档' },
    // 第 1 场 · 吧台
    { group: '第 1 场 · 吧台', title: '演员定妆与走位', kind: 'setup', durationMin: 15, owner: '导演 球球', camera: '—', shotIds: [], fixedStart: null, content: '袖口、手型确认；走位贴地标，从左入画到吧台内侧', note: '勿戴手表；上衣与镜 8 保持一致' },
    { group: '第 1 场 · 吧台', title: '镜 1 · 磨豆（特写）', kind: 'shoot', durationMin: 12, owner: '导演 / 摄影', camera: 'A 机 · 三脚架', shotIds: [project.shots[0]!.id], fixedStart: null, content: '磨豆机启动，咖啡豆落入研磨仓', note: '备用一条「豆子落入手持量杯」' },
    { group: '第 1 场 · 吧台', title: '镜 2 · 称粉（顶俯）', kind: 'shoot', durationMin: 12, owner: '导演 / 摄影', camera: 'A 机 · 俯拍横臂', shotIds: [project.shots[1]!.id], fixedStart: null, content: '称量 18g，秤屏数字必须看清', note: '备用一条俯拍秤面，方便后期挑' },
    { group: '第 1 场 · 吧台', title: '镜 3 · 吧台全景（定场）', kind: 'shoot', durationMin: 15, owner: '导演 / 摄影', camera: 'A 机 · 液压云台', shotIds: [project.shots[2]!.id], fixedStart: null, content: '主角进入画面，交代吧台—窗—座位空间', note: '器物按镜 2 位置复原，避免穿帮' },
    { group: '第 1 场 · 吧台', title: '镜 4 · 注水与蒸汽', kind: 'shoot', durationMin: 20, owner: '导演 / 摄影', camera: 'A 机 · 三脚架', shotIds: [project.shots[3]!.id], fixedStart: null, content: '92℃ 注水，蒸汽须逆光可见', note: '先闷蒸 30s 再拍；壶嘴别入画过深' },
    { group: '第 1 场 · 吧台', title: '镜 5 · 注视萃取液面', kind: 'shoot', durationMin: 15, owner: '导演 / 摄影', camera: 'A 机 · 肩托', shotIds: [project.shots[4]!.id], fixedStart: null, content: '眼神对准滤杯中心，不看镜头', note: '表情僵时改拍过肩备用镜' },
    { group: '第 1 场 · 吧台', title: '镜 6 · 滴滤升格 100fps', kind: 'shoot', durationMin: 25, owner: '摄影 陈默', camera: 'B 机 · 滑轨', shotIds: [project.shots[5]!.id], fixedStart: null, content: '咖啡液滴入分享壶，100fps 拍摄后期降速 50%', note: '最后一滴用滴管补；液面与镜 9 连戏' },
    { group: '第 1 场 · 吧台', title: '场次一素材回看', kind: 'custom', durationMin: 12, owner: '导演 / 场记', camera: '监视器', shotIds: [], fixedStart: null, content: '核对镜 1–6 是否过条，当场标记补拍项', note: '有问题的当场记，别拖到场 2' },
    // 第 2 场 · 靠窗
    { group: '第 2 场 · 靠窗', title: '转场与灯位调整', kind: 'move', durationMin: 20, owner: '全组', camera: 'A / B 机位', shotIds: [], fixedStart: null, content: '移动灯位与机位，复原桌面杯具位置', note: '先移机位再移灯；窗光方向与场 1 一致' },
    { group: '第 2 场 · 靠窗', title: '镜 7 · 窗边定场', kind: 'shoot', durationMin: 12, owner: '导演 / 摄影', camera: 'A 机 · 三脚架', shotIds: [project.shots[6]!.id], fixedStart: null, content: '靠窗座位全景，阳光斜射形成光斑', note: '赶窗光，先拍这条再补细节' },
    { group: '第 2 场 · 靠窗', title: '镜 8 · 端杯', kind: 'shoot', durationMin: 15, owner: '导演 / 摄影', camera: 'A 机 · 三脚架', shotIds: [project.shots[7]!.id], fixedStart: null, content: '主角端起杯子，动作放慢 1.5 倍', note: '手型与镜 2 一致；备一条带杯垫起手' },
    { group: '第 2 场 · 靠窗', title: '镜 9 · 杯沿停顿', kind: 'shoot', durationMin: 18, owner: '导演 / 摄影', camera: 'A 机 · 手持稳定器', shotIds: [project.shots[8]!.id], fixedStart: null, content: '杯沿贴近嘴唇，停顿 2 秒', note: '开拍前续热水，蒸汽要可见' },
    { group: '第 2 场 · 靠窗', title: '镜 10 · 眼神收尾', kind: 'shoot', durationMin: 12, owner: '导演 / 摄影', camera: 'A 机 · 微距导轨', shotIds: [project.shots[9]!.id], fixedStart: null, content: '眼神特写，画面渐暗', note: '现场拍足 6s 余量，渐暗后期做 1.5s' },
    // 午餐与备份
    { group: '午餐与备份', title: '午餐与器材充电', kind: 'break', durationMin: 40, owner: '制片 周周', camera: '—', shotIds: [], fixedStart: '12:30', content: '剧组午餐，电池统一充电，素材卡换新', note: '13:10 前回到机位，别误下午场' },
    { group: '午餐与备份', title: '素材双备份', kind: 'custom', durationMin: 10, owner: '场记 / DIT', camera: '—', shotIds: [], fixedStart: null, content: '双硬盘备份上午素材，核对 10 个镜头编号', note: '备份完成前不格卡' },
    // 补拍与收工
    { group: '补拍与收工', title: '空镜与环境音补录', kind: 'shoot', durationMin: 40, owner: '录音 王工 / 摄影', camera: 'A 机', shotIds: [], fixedStart: null, content: '咖啡馆环境底噪、杯碟声、窗外街声各录 60s', note: '关空调与门铃，录 30s 纯净底噪' },
    { group: '补拍与收工', title: '备用镜补拍（镜 2 / 镜 8）', kind: 'shoot', durationMin: 40, owner: '导演 / 摄影', camera: 'A 机', shotIds: [project.shots[1]!.id, project.shots[7]!.id], fixedStart: null, content: '俯拍秤面备用条、带杯垫起手备用条', note: '只补有把握的两条，别开新机位' },
    { group: '补拍与收工', title: '场记核对与素材交接', kind: 'custom', durationMin: 15, owner: '场记', camera: '—', shotIds: [], fixedStart: null, content: '逐镜核对时长、连戏与备份编号，填拍摄记录', note: '缺镜当场列出，能补就补' },
    { group: '补拍与收工', title: '场地恢复与撤场', kind: 'wrap', durationMin: 15, owner: '全组', camera: '—', shotIds: [], fixedStart: null, content: '桌椅复位、垃圾分类、清点器材与耗材', note: '和店主当面点交，拍一张复位照片' },
  ];
  project.rundown = rawItems.map((item, index) => ({
    id: newId('rd'),
    dayId: day.id,
    order: index,
    ...item,
  }));

  project.notices = [{
    id: newId('notice'),
    dayId: day.id,
    status: 'pending',
    title: '拍摄通告 · 11/20《一杯手冲的时间》',
    publishedAt: '2026-11-18 09:00',
    crew: '导演 球球 / 摄影 陈默 / 灯光 李工 / 录音 王工 / 制片 周周',
    groups: '制片组 周周、摄影组 陈默、灯光组 李工、录音组 王工 · 全组 08:00 咖啡馆门口集合，先布光后走位',
    actors: '演员 阿岚 09:00 到组，浅色上衣自备，勿戴手表（连戏）',
    schedule: [
      '【准备】08:00–09:00 · 60 分钟',
      '08:00–08:20 进场与器材落位（制片 周周 / 摄影 陈默）',
      '08:20–08:45 吧台布光与机位标记（灯光 李工）',
      '08:45–09:00 试拍与白平衡校准（摄影 陈默）',
      '【第 1 场 · 吧台】09:00–11:06 · 126 分钟',
      '09:00–09:15 演员定妆与走位（导演 球球）',
      '09:15–09:27 镜 1 · 磨豆（特写）',
      '09:27–09:39 镜 2 · 称粉（顶俯）',
      '09:39–09:54 镜 3 · 吧台全景（定场）',
      '09:54–10:14 镜 4 · 注水与蒸汽',
      '10:14–10:29 镜 5 · 注视萃取液面',
      '10:29–10:54 镜 6 · 滴滤升格 100fps（摄影 陈默）',
      '10:54–11:06 场次一素材回看（导演 / 场记）',
      '【第 2 场 · 靠窗】11:06–12:23 · 77 分钟',
      '11:06–11:26 转场与灯位调整（全组）',
      '11:26–11:38 镜 7 · 窗边定场',
      '11:38–11:53 镜 8 · 端杯',
      '11:53–12:11 镜 9 · 杯沿停顿',
      '12:11–12:23 镜 10 · 眼神收尾',
      '【午餐与备份】12:30–13:20 · 50 分钟',
      '12:30–13:10 午餐与器材充电（制片 周周）',
      '13:10–13:20 素材双备份（场记 / DIT）',
      '【补拍与收工】13:20–15:10 · 110 分钟',
      '13:20–14:00 空镜与环境音补录（录音 王工 / 摄影）',
      '14:00–14:40 备用镜补拍（镜 2 / 镜 8）',
      '14:40–14:55 场记核对与素材交接（场记）',
      '14:55–15:10 场地恢复与撤场（全组）',
    ].join('\n'),
    note: '提前 30 分钟进场确认窗光；热水与备用豆各备一份；杯具带两套；拍摄日不换袖口服装。',
  }];

  project.sampleRevision = SAMPLE_REVISION;

  return project;
}

/** 纯序列化：不改写 updatedAt，保证「保存 → 打开」内容完全一致 */
export function serializeProject(project: Project): string {
  return JSON.stringify({ ...project, schemaVersion: SCHEMA_VERSION }, null, 2);
}

const FIELD_KINDS = new Set<string>(['text', 'textarea', 'number', 'duration', 'image', 'select']);
const PRESETS = new Set<string>(['professional', 'simple', 'custom']);

function normalizeColumnSchema(value: unknown): ColumnSchema {
  const fallback = createColumnSchema('professional');
  if (!isRecord(value)) return fallback;
  const rawColumns = Array.isArray(value.columns) ? value.columns.filter(isRecord) : [];
  if (rawColumns.length === 0) return fallback;
  const columns: ColumnDef[] = rawColumns.map((raw, index) => {
    const options = strArray(raw.options);
    return {
      id: str(raw.id, `col_${index}`),
      key: str(raw.key, `col_${index}`),
      label: str(raw.label, `列 ${index + 1}`),
      kind: typeof raw.kind === 'string' && FIELD_KINDS.has(raw.kind) ? (raw.kind as ColumnDef['kind']) : 'text',
      width: num(raw.width, 160),
      visible: bool(raw.visible, true),
      builtin: bool(raw.builtin, false),
      options: options.length > 0 ? options : undefined,
      order: num(raw.order, index),
    };
  });
  const preset = typeof value.preset === 'string' && PRESETS.has(value.preset)
    ? (value.preset as ColumnSchema['preset'])
    : 'custom';
  return { preset, columns };
}

function normalizeImageAsset(value: unknown): ImageAsset | null {
  if (!isRecord(value)) return null;
  const assetPath = str(value.path);
  if (!assetPath) return null;
  return {
    id: str(value.id, newId('img')),
    path: assetPath,
    kind: value.kind === 'draw' ? 'draw' : 'upload',
    updatedAt: str(value.updatedAt, now()),
  };
}

function normalizeScene(raw: Raw): Scene {
  const interior = raw.interior;
  const dayNight = raw.dayNight;
  return {
    id: str(raw.id, newId('scene')),
    sceneNo: str(raw.sceneNo),
    interior: interior === '内' || interior === '外' ? interior : '',
    dayNight: dayNight === '日' || dayNight === '夜' ? dayNight : '',
    location: str(raw.location),
    synopsis: str(raw.synopsis),
  };
}

function normalizeShot(raw: Raw): Shot {
  const base = createShot(num(raw.shotNo, 1), nullableString(raw.sceneId), num(raw.sortIndex, 0));
  const custom: Record<string, string | number> = {};
  if (isRecord(raw.custom)) {
    for (const [key, value] of Object.entries(raw.custom)) {
      if (typeof value === 'string' || typeof value === 'number') custom[key] = value;
    }
  }
  return {
    ...base,
    id: str(raw.id, base.id),
    frame: normalizeImageAsset(raw.frame),
    reference: normalizeImageAsset(raw.reference),
    shotSize: str(raw.shotSize),
    durationSec: num(raw.durationSec, 0),
    content: str(raw.content),
    notes: str(raw.notes),
    sceneExpectation: str(raw.sceneExpectation),
    sound: str(raw.sound),
    cameraAngle: str(raw.cameraAngle),
    cameraMove: str(raw.cameraMove),
    cameraBody: str(raw.cameraBody),
    focalLength: str(raw.focalLength),
    custom,
    createdAt: str(raw.createdAt, base.createdAt),
    updatedAt: str(raw.updatedAt, base.updatedAt),
  };
}

function normalizePerson(raw: Raw): Person {
  const role = PERSON_ROLES.includes(raw.role as PersonRole) ? (raw.role as PersonRole) : 'other';
  return {
    id: str(raw.id, newId('pp')),
    name: str(raw.name),
    role,
    title: str(raw.title),
    phone: str(raw.phone),
    note: str(raw.note),
    active: raw.active !== false,
  };
}

function normalizeDay(raw: Raw): ShootingDay {
  return {
    id: str(raw.id, newId('day')),
    date: str(raw.date),
    location: str(raw.location),
    startTime: str(raw.startTime, '08:00'),
    endTime: str(raw.endTime, '18:00'),
    crew: strArray(raw.crew),
    actors: strArray(raw.actors),
    equipment: strArray(raw.equipment),
    shotIds: strArray(raw.shotIds),
    note: str(raw.note),
  };
}

function normalizeRundownItem(raw: Raw): RundownItem {
  const kinds: RundownKind[] = ['setup', 'shoot', 'move', 'break', 'wrap', 'custom'];
  return {
    id: str(raw.id, newId('rd')),
    dayId: str(raw.dayId),
    order: num(raw.order, 0),
    kind: kinds.includes(raw.kind as RundownKind) ? (raw.kind as RundownKind) : 'custom',
    group: str(raw.group),
    title: str(raw.title),
    content: str(raw.content),
    durationMin: num(raw.durationMin, 0),
    fixedStart: nullableString(raw.fixedStart),
    owner: str(raw.owner),
    camera: str(raw.camera),
    shotIds: strArray(raw.shotIds),
    note: str(raw.note),
  };
}

function normalizeNotice(raw: Raw): Notice {
  const status: NoticeStatus = raw.status === 'expired'
    ? 'expired'
    : raw.status === 'done'
      ? 'done'
      : raw.status === 'draft'
        ? 'draft'
        : 'pending';
  return {
    id: str(raw.id, newId('notice')),
    dayId: str(raw.dayId),
    status,
    title: str(raw.title),
    publishedAt: nullableString(raw.publishedAt),
    crew: str(raw.crew),
    groups: str(raw.groups),
    actors: str(raw.actors),
    schedule: str(raw.schedule),
    note: str(raw.note),
  };
}

/** 防御性反序列化：缺失字段补默认、未知字段忽略、非法值降级，保证旧/损坏文件可用 */
export function normalizeProject(raw: Raw): Project {
  const base = createEmptyProject(str(raw.name, '未命名项目'));
  const rawSettings = isRecord(raw.settings) ? raw.settings : {};
  const settings: ProjectSettings = {
    theme: rawSettings.theme === 'dark' ? 'dark' : 'light',
    storyboardColumns: Math.min(10, Math.max(1, num(rawSettings.storyboardColumns, DEFAULT_SETTINGS.storyboardColumns))),
    storyboardFields: strArray(rawSettings.storyboardFields),
    rundownView: rawSettings.rundownView === 'notice' ? 'notice' : 'rundown',
  };
  return {
    ...base,
    id: str(raw.id, base.id),
    title: str(raw.title),
    client: str(raw.client),
    createdAt: str(raw.createdAt, base.createdAt),
    updatedAt: str(raw.updatedAt, base.updatedAt),
    columnSchema: normalizeColumnSchema(raw.columnSchema),
    scenes: arrayOf(raw.scenes, normalizeScene),
    shots: arrayOf(raw.shots, normalizeShot),
    people: arrayOf(raw.people, normalizePerson),
    tag: normalizeTag(raw.tag),
    days: arrayOf(raw.days, normalizeDay),
    rundown: arrayOf(raw.rundown, normalizeRundownItem),
    notices: arrayOf(raw.notices, normalizeNotice),
    settings,
    exportInfo: normalizeExportInfo({
      ...(isRecord(raw.exportInfo) ? raw.exportInfo : {}),
      legacyClient: str(raw.client),
    }),
    sampleRevision: typeof raw.sampleRevision === 'number' && Number.isFinite(raw.sampleRevision)
      ? raw.sampleRevision
      : undefined,
  };
}

export function deserializeProject(text: string): Project {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProjectParseError('项目文件不是合法的 JSON');
  }
  if (!isRecord(parsed)) throw new ProjectParseError('项目文件根节点必须是对象');
  if (typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > SCHEMA_VERSION) {
    throw new ProjectParseError(`项目文件版本 v${parsed.schemaVersion} 高于当前程序支持的 v${SCHEMA_VERSION}，请升级软件`);
  }
  return normalizeProject(parsed);
}
