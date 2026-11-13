import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { ArrowLeft, Cloud, Info, Layers, Moon, MoreHorizontal, Plus, QrCode, Search, Sun, Tag, Trash2, Users } from 'lucide-react';
import appLogo from '@/assets/logo.png';
import AboutDialog from '@/components/AboutDialog';
import CloudAccountDialog from '@/components/CloudAccountDialog';
import ProjectCardMenu from '@/components/ProjectCardMenu';
import { LIBRARY_CHANGED_EVENT } from '@/components/SharePanel';
import { useNavigate } from 'react-router-dom';
import ProjectNameDialog from '@/components/ProjectNameDialog';
import ProfileRail from '@/components/ProfileRail';
import ProfileSettings from '@/components/ProfileSettings';
import ShootReminder from '@/components/ShootReminder';
import {
  activeProjects,
  filterProjects,
  sortProjects,
  trashedProjects,
  type LibraryIndex,
  type ProjectMeta,
  type SortMode,
} from '@/domain/library';
import {
  createBlankProject,
  createDemoProject,
  duplicateProjectRecord,
  loadLibrary,
  loadProjectById,
  purgeProject,
  renameProjectRecord,
  restoreProject,
  setCurrentProject,
  setProjectTag,
  softDeleteProject,
} from '@/store/projectLibrary';
import { PROJECT_TAGS, filterByTags, groupByTags, tagColor, tagCounts, tagMeta } from '@/domain/tags';
import { useProjectStore } from '@/store/useProjectStore';
import { useCloud } from '@/store/cloudStore';
import { useTheme } from '@/store/themeStore';
import { useCloudSync } from '@/store/cloudSync';
import { cloudAccountNote, cloudFooterNote } from '@/domain/cloudStatus';
import { shootEventsFromIndex } from '@/domain/profile';
import type { Project, ProjectTag } from '@/domain/types';

type DialogState = { mode: 'new' } | { mode: 'rename'; id: string; name: string } | null;

/** 「按标签分区」是纯视图偏好，跟机器走，不写进项目文件 */
const GROUP_TAGS_KEY = 'shotflow.library.groupByTags.v1';

interface ProjectsPageProps {
  /** 从工作区点「新建项目」进入时直接打开命名框，不依赖 URL 参数与 effect 竞态 */
  requestCreate?: boolean;
  onCreateRequestHandled?: () => void;
  onOpenShare?: () => void;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function FolderArt({ count }: { count: number }) {
  return (
    <svg className="folder-art" viewBox="0 0 100 78" width="92" height="72" aria-hidden="true">
      <path d="M2 12a6 6 0 0 1 6-6h28l9 10h47a6 6 0 0 1 6 6v6H2z" fill="#F0B93B" />
      <path d="M2 26h96a2 2 0 0 1 2 2v42a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V28a2 2 0 0 1 2-2z" fill="#FFD45C" />
      <rect x="22" y="16" width="56" height="30" rx="3" fill="#FFFDF4" opacity="0.94" />
      <rect x="28" y="21" width="20" height="14" rx="2" fill="#F2C66B" />
      <rect x="53" y="21" width="19" height="14" rx="2" fill="#EAD8A6" />
      <rect x="28" y="38" width="44" height="3" rx="1.5" fill="#E4D2AB" />
      {count > 0 ? <circle cx="84" cy="62" r="9" fill="#E9A93C" opacity="0.45" /> : null}
    </svg>
  );
}

export default function ProjectsPage({ requestCreate = false, onCreateRequestHandled, onOpenShare }: ProjectsPageProps) {
  const navigate = useNavigate();
  const [index, setIndex] = useState<LibraryIndex | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('updated');
  const [view, setView] = useState<'active' | 'trash'>('active');
  const [dialog, setDialog] = useState<DialogState>(() => (requestCreate ? { mode: 'new' } : null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  /** 选中的颜色筛选，空 = 全部；null 代表「未标注」 */
  const [tagFilter, setTagFilter] = useState<Array<ProjectTag | null>>([]);
  const [grouped, setGrouped] = useState(() => {
    try {
      return window.localStorage.getItem(GROUP_TAGS_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [menu, setMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const consumed = useRef(false);
  const cloud = useCloud();
  const sync = useCloudSync();
  const dark = useTheme((state) => state.dark);
  const toggleTheme = useTheme((state) => state.toggle);

  // 底部状态必须说真话：没登录就说只存本机；登录后只有真的同步成功才报数量
  const cloudNote = cloudFooterNote({
    signedIn: cloud.status === 'signed-in',
    name: cloud.user?.name ?? null,
    syncing: sync.syncing,
    conflicts: sync.conflicts.length,
    count: sync.count,
    uploaded: sync.uploaded,
    downloaded: sync.downloaded,
    at: sync.at,
    error: sync.error,
  });
  const signedIn = cloud.status === 'signed-in';
  const accountNote = cloudAccountNote({
    signedIn,
    name: cloud.user?.name ?? null,
    syncing: sync.syncing,
    conflicts: sync.conflicts.length,
    count: sync.count,
    uploaded: sync.uploaded,
    downloaded: sync.downloaded,
    at: sync.at,
    error: sync.error,
  });

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    void loadLibrary().then(setIndex).catch(() => setIndex({ version: 1, currentId: null, projects: [] }));
    const onChanged = () => { void loadLibrary().then(setIndex).catch(() => undefined); };
    window.addEventListener(LIBRARY_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, onChanged);
  }, []);

  // 消费一次「请求新建」标记，避免刷新/重进项目库时又弹窗
  useEffect(() => {
    if (requestCreate && !consumed.current) {
      consumed.current = true;
      onCreateRequestHandled?.();
    }
  }, [requestCreate, onCreateRequestHandled]);

  // 分区开关只影响显示，持久化到本机，换机器不带走
  useEffect(() => {
    try {
      window.localStorage.setItem(GROUP_TAGS_KEY, grouped ? '1' : '0');
    } catch {
      // localStorage 不可用时保持内存状态即可
    }
  }, [grouped]);

  const activeCount = index ? activeProjects(index).length : 0;
  const trashCount = index ? trashedProjects(index).length : 0;
  const shootDates = useMemo(
    () => [...new Set(shootEventsFromIndex(index ?? { projects: [] }).map((event) => event.date))],
    [index],
  );

  /** 搜索 + 排序后的全集：标签计数基于它，避免计数与实际列表脱节 */
  const baseList = useMemo(() => {
    if (!index) return [];
    const source = view === 'trash' ? trashedProjects(index) : activeProjects(index);
    return sortProjects(filterProjects(source, query), sort);
  }, [index, view, query, sort]);

  const counts = useMemo(() => tagCounts(baseList), [baseList]);
  // 颜色筛选只在「我的项目」生效；回收站没有筛选条，不能被隐藏条件过滤
  const tagFilterActive = view === 'active' && tagFilter.length > 0;
  const list = useMemo(
    () => (view === 'trash' ? baseList : filterByTags(baseList, tagFilter)),
    [baseList, tagFilter, view],
  );
  const sections = useMemo(() => groupByTags(list), [list]);
  const filtering = query.trim().length > 0 || tagFilterActive;
  const showSections = view === 'active' && grouped && sections.some((section) => section.tag !== null);
  const canCreateCard = view === 'active' && !filtering;
  const menuMeta = menu && index ? index.projects.find((item) => item.id === menu.id) ?? null : null;

  useEffect(() => {
    if (menu && !menuMeta) setMenu(null);
  }, [menu, menuMeta]);

  function toggleTag(tag: ProjectTag | null): void {
    setTagFilter((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
  }

  async function run(action: () => Promise<LibraryIndex>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setIndex(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  function enterWorkspace(project: Project) {
    useProjectStore.getState().setProject(project);
    void setCurrentProject(project.id);
    navigate('/shots');
  }

  async function handleCreate(name: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { project } = await createBlankProject(name);
      setDialog(null);
      enterWorkspace(project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const project = await loadProjectById(id);
      if (!project) {
        setError('项目文件不存在或已损坏');
        return;
      }
      enterWorkspace(project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '打开失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleDemo(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { project } = await createDemoProject();
      enterWorkspace(project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '载入失败');
    } finally {
      setBusy(false);
    }
  }

  function openMenu(event: ReactMouseEvent<HTMLButtonElement>, id: string): void {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu((prev) => (prev?.id === id ? null : { id, rect }));
  }

  const createCard = (
    <button className="project-card create-card" type="button" onClick={() => setDialog({ mode: 'new' })}>
      <span className="create-plus"><Plus size={26} /></span>
      <span className="project-card-name">创建新项目</span>
      <span className="project-card-time">从空白分镜开始</span>
    </button>
  );

  function renderCard(meta: ProjectMeta) {
    const color = tagColor(meta.tag);
    return (
      <div
        className={meta.tag ? 'project-card tagged' : 'project-card'}
        key={meta.id}
        role="button"
        tabIndex={0}
        style={color ? ({ ['--tag' as string]: color } as CSSProperties) : undefined}
        onClick={() => { if (view === 'active') void handleOpen(meta.id); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && view === 'active') void handleOpen(meta.id);
        }}
      >
        <button
          className={menu?.id === meta.id ? 'card-menu-btn open' : 'card-menu-btn'}
          type="button"
          title="更多操作"
          aria-label={`${meta.name} 更多操作`}
          aria-haspopup="menu"
          aria-expanded={menu?.id === meta.id}
          onClick={(event) => openMenu(event, meta.id)}
        >
          <MoreHorizontal size={16} />
        </button>
        <FolderArt count={meta.shotCount} />
        <div className="project-card-name" title={meta.name}>
          {meta.tag ? <span className="project-tag-dot" title={tagMeta(meta.tag)?.hint} /> : null}
          {meta.name}
        </div>
        <div className="project-card-time">创建 {formatTime(meta.createdAt)}</div>
        <div className="project-card-meta">{meta.shotCount} 个镜头 · {meta.dayCount} 个拍摄日</div>
      </div>
    );
  }

  const activeDialog = dialog;

  return (
    <div className="library-page">
      <header className="library-topbar">
        <div className="library-topbar-left">
          {view === 'trash' ? (
            <button
              className="library-back"
              type="button"
              title="返回我的项目"
              onClick={() => setView('active')}
            >
              <ArrowLeft size={16} />返回
            </button>
          ) : null}
          <div className="library-brand">
            <img className="library-logo" src={appLogo} alt="ShotFlow" width={38} height={38} />
            <div>
              <h1>我的项目</h1>
              <p>{view === 'trash' ? `回收站 · ${trashCount} 个项目` : `${activeCount} 个项目 · 本地离线`}</p>
            </div>
          </div>
          <div className="library-actions">
            <label className="library-search">
              <Search size={15} />
              <input
                value={query}
                placeholder="搜索项目"
                aria-label="搜索项目"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <select
              className="select-input compact"
              title="排序方式"
              value={sort}
              onChange={(event) => setSort(event.currentTarget.value as SortMode)}
            >
              <option value="updated">最近编辑</option>
              <option value="created">创建时间</option>
              <option value="name">名称</option>
            </select>
            {onOpenShare ? (
              <button className="btn ghost" type="button" onClick={onOpenShare}>
                <Users size={15} />共享与传输
              </button>
            ) : null}
            <button className="btn primary" type="button" onClick={() => setDialog({ mode: 'new' })}>
              <Plus size={15} />创建新项目
            </button>
            <button
              className={view === 'trash' ? 'btn ghost active' : 'btn ghost'}
              type="button"
              title="回收站"
              onClick={() => setView((value) => (value === 'trash' ? 'active' : 'trash'))}
            >
              <Trash2 size={15} />回收站{trashCount > 0 ? ` (${trashCount})` : ''}
            </button>
            <button className="btn ghost" type="button" onClick={() => setAboutOpen(true)}>
              <Info size={15} />关于
            </button>
          </div>
        </div>
        <div className="library-topbar-right">
        <button
          className="account-chip"
          type="button"
          title={signedIn ? '微信账号与同步' : '微信扫码登录'}
          onClick={() => setAccountOpen(true)}
        >
          {signedIn ? (
            cloud.user?.avatar ? (
              <img className="account-chip-avatar" src={cloud.user.avatar} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="account-chip-avatar fallback">{(cloud.user?.name || '微').slice(0, 1)}</span>
            )
          ) : (
            <span className="account-chip-icon"><QrCode size={18} /></span>
          )}
          <span className="profile-chip-text">
            <strong>{signedIn ? (cloud.user?.name || '微信账号') : '微信扫码登录'}</strong>
            <small>{signedIn ? accountNote : '登录后项目可跨设备同步'}</small>
          </span>
          {signedIn ? <Cloud size={15} /> : null}
        </button>
        <button
          className="theme-toggle"
          type="button"
          title={dark ? '切换到白天模式' : '切换到黑夜模式'}
          aria-label={dark ? '切换到白天模式' : '切换到黑夜模式'}
          aria-pressed={dark}
          onClick={toggleTheme}
        >
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        </div>
      </header>

      <div className="library-body">
        <main className="library-content">
          {error ? <div className="library-error" role="alert">{error}</div> : null}
          {notice ? <div className="library-notice" role="status">{notice}</div> : null}
          <ShootReminder index={index} />

          {view === 'active' && activeCount === 0 && !filtering ? (
            <div className="library-empty">
              <FolderArt count={0} />
              <h2>还没有项目</h2>
              <p>新创建的项目是<strong>完全空白</strong>的：0 个镜头、0 个场次、0 个拍摄日、0 条 Rundown，不会预置任何示例内容。</p>
              <div className="library-empty-actions">
                <button className="btn primary" type="button" onClick={() => setDialog({ mode: 'new' })}>
                  <Plus size={15} />创建第一个项目
                </button>
                <button className="btn ghost" type="button" onClick={() => void handleDemo()}>
                  载入示例项目（含 10 个镜头）
                </button>
              </div>
            </div>
          ) : null}

          {view === 'active' && baseList.length > 0 ? (
            <div className="tag-filterbar" role="group" aria-label="按颜色标签筛选">
              <span className="tag-filter-label"><Tag size={12} />颜色标签</span>
              <button
                className="tag-chip"
                type="button"
                data-active={tagFilter.length === 0}
                aria-pressed={tagFilter.length === 0}
                onClick={() => setTagFilter([])}
              >
                全部<span className="tag-chip-count">{baseList.length}</span>
              </button>
              {PROJECT_TAGS.filter((tag) => counts.counts[tag.id] > 0).map((tag) => (
                <button
                  key={tag.id}
                  className="tag-chip"
                  type="button"
                  style={{ ['--tag' as string]: tag.color } as CSSProperties}
                  data-active={tagFilter.includes(tag.id)}
                  aria-pressed={tagFilter.includes(tag.id)}
                  title={tag.hint}
                  onClick={() => toggleTag(tag.id)}
                >
                  <span className="tag-chip-dot" />{tag.name}
                  <span className="tag-chip-count">{counts.counts[tag.id]}</span>
                </button>
              ))}
              {counts.untagged > 0 ? (
                <button
                  className="tag-chip"
                  type="button"
                  data-active={tagFilter.includes(null)}
                  aria-pressed={tagFilter.includes(null)}
                  onClick={() => toggleTag(null)}
                >
                  <span className="tag-chip-dot untagged" />未标注
                  <span className="tag-chip-count">{counts.untagged}</span>
                </button>
              ) : null}
              <span className="tag-filter-spacer" />
              {counts.tagged > 0 ? (
                <button
                  className="tag-group-toggle"
                  type="button"
                  data-on={grouped}
                  aria-pressed={grouped}
                  title={grouped ? '按颜色标签分区展示，点击改为平铺' : '平铺展示，点击按颜色标签分区'}
                  onClick={() => setGrouped((value) => !value)}
                >
                  <Layers size={13} />按标签分区
                </button>
              ) : null}
            </div>
          ) : null}

          {showSections ? (
            <>
              {canCreateCard ? <div className="library-grid library-create-row">{createCard}</div> : null}
              {sections.map((section) => (
                <section className="tag-section" key={section.tag ?? 'untagged'}>
                  <header className="tag-section-head">
                    <span
                      className="tag-section-dot"
                      data-untagged={section.tag === null}
                      style={section.color ? { background: section.color } : undefined}
                    />
                    <h2>{section.name}</h2>
                    <span className="tag-section-count">{section.items.length} 个项目</span>
                    <span className="tag-section-line" />
                  </header>
                  <div className="library-grid">{section.items.map(renderCard)}</div>
                </section>
              ))}
            </>
          ) : (
            <div className="library-grid">
              {canCreateCard ? createCard : null}
              {list.map(renderCard)}
            </div>
          )}

          {view === 'trash' && list.length === 0 ? (
            <div className="trash-empty">
              <Trash2 size={24} />
              <p>{filtering ? '没有匹配的项目' : '回收站是空的'}</p>
              <span>删除的项目会先放进来，可以在这里恢复或彻底删除，不会立刻丢数据。</span>
              <button className="btn ghost" type="button" onClick={() => setView('active')}>
                <ArrowLeft size={15} />返回我的项目
              </button>
            </div>
          ) : list.length === 0 && !(view === 'active' && activeCount === 0 && !filtering) ? (
            <p className="library-nohit">
              {filtering ? '没有匹配的项目' : '没有项目'}
              {tagFilterActive ? (
                <button className="tag-filter-reset" type="button" onClick={() => setTagFilter([])}>清除标签筛选</button>
              ) : null}
            </p>
          ) : null}
        </main>

        <ProfileRail
          index={index}
          onEdit={() => setProfileOpen(true)}
          onOpenProject={(id) => { void handleOpen(id); }}
        />
      </div>

      <footer className="library-foot">
        <span>{cloudNote}</span>
        <span>{busy ? '正在处理…' : `${index?.projects.length ?? 0} 条记录`}</span>
      </footer>

      {menu && menuMeta ? (
        <ProjectCardMenu
          meta={menuMeta}
          anchor={menu.rect}
          trash={view === 'trash'}
          busy={busy}
          onClose={() => setMenu(null)}
          onTag={(tag) => { void run(() => setProjectTag(menuMeta.id, tag)); }}
          onRename={() => {
            setMenu(null);
            setDialog({ mode: 'rename', id: menuMeta.id, name: menuMeta.name });
          }}
          onDuplicate={() => {
            setMenu(null);
            void run(() => duplicateProjectRecord(menuMeta.id));
          }}
          onDelete={() => {
            setMenu(null);
            void run(() => (view === 'trash' ? purgeProject(menuMeta.id) : softDeleteProject(menuMeta.id)));
          }}
          onRestore={() => {
            setMenu(null);
            void run(() => restoreProject(menuMeta.id));
          }}
        />
      ) : null}

      {activeDialog ? (
        <ProjectNameDialog
          title={activeDialog.mode === 'new' ? '创建新项目' : '重命名项目'}
          initialName={activeDialog.mode === 'rename' ? activeDialog.name : ''}
          confirmText={activeDialog.mode === 'new' ? '创建' : '保存'}
          hint={activeDialog.mode === 'new' ? '新项目为完全空白，不会包含任何示例镜头、场次或拍摄日。' : undefined}
          onClose={() => setDialog(null)}
          onConfirm={(name) => {
            if (activeDialog.mode === 'new') void handleCreate(name);
            else void run(() => renameProjectRecord(activeDialog.id, name)).then(() => setDialog(null));
          }}
        />
      ) : null}

      <CloudAccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />

      {profileOpen ? (
        <ProfileSettings
          onClose={() => setProfileOpen(false)}
          onToast={setNotice}
          shootDates={shootDates}
        />
      ) : null}

      {aboutOpen ? <AboutDialog onClose={() => setAboutOpen(false)} /> : null}
    </div>
  );
}
