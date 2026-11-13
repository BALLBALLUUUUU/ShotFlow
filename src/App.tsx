import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Download, FileDown, FolderOpen, Moon, Plus, Redo2, Save, Sun, Undo2, Users } from 'lucide-react';
import {
  HashRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type NavigateFunction,
} from 'react-router-dom';
import { serializeProject } from '@/domain/project';
import { openProjectFile, saveProjectFile } from '@/store/storage';
import { exportPackage, authorKey } from '@/store/projectActions';
import SharePanel from '@/components/SharePanel';
import { consumeSampleUpgradeNotice, ensureLibrary, persistProject, setCurrentProject } from '@/store/projectLibrary';
import { useProjectStore } from '@/store/useProjectStore';
import { bindCloudEvents, useCloud } from '@/store/cloudStore';
import { initCloudSync } from '@/store/cloudSync';
import { useTheme } from '@/store/themeStore';
import CloudConflictDialog from '@/components/CloudConflictDialog';
import ShotTablePage from '@/routes/ShotTablePage';
import StoryboardPage from '@/routes/StoryboardPage';
import PlanPage from '@/routes/PlanPage';
import RundownPage from '@/routes/RundownPage';
import PeoplePage from '@/routes/PeoplePage';
import ProjectsPage from '@/routes/ProjectsPage';
import ExportPage from '@/routes/ExportPage';

const TABS = [
  { to: '/people', label: '人员' },
  { to: '/shots', label: '分镜制作' },
  { to: '/storyboard', label: '故事板' },
  { to: '/plan', label: '拍摄计划' },
  { to: '/rundown', label: 'Rundown · 通告' },
];

/** 文件动作抽成模块级函数，工具栏按钮与 macOS 原生菜单共用同一份逻辑 */
async function openAction(): Promise<void> {
  const result = await openProjectFile();
  if (!result) return;
  useProjectStore.getState().loadFromText(result.text, result.filePath);
  await setCurrentProject(useProjectStore.getState().project.id);
}

async function saveAction(): Promise<void> {
  const { project, filePath, markSaved } = useProjectStore.getState();
  const result = await saveProjectFile(serializeProject(project), filePath, project.name);
  if (result) markSaved(result.filePath);
}

/** 统一导出为 .shotflow 项目包（图片独立成资源），同事可直接导入 */
async function exportAction(): Promise<void> {
  const { project, setToast } = useProjectStore.getState();
  try {
    const result = await exportPackage(project, authorKey());
    setToast(`已导出 ${result.fileName}（含 ${result.assetCount} 张图片资源）`);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : '导出失败';
    if (message !== '已取消导出') setToast(message);
  }
}

/**
 * 项目库集成：启动时恢复上次项目（旧版 autosave 自动迁移），
 * 之后每次编辑按项目落到项目库，并响应原生菜单。
 */
function useLibraryIntegration(
  navigate: NavigateFunction,
  onToggleTheme: () => void,
  onNewProject: () => void,
) {
  const project = useProjectStore((state) => state.project);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const toggleRef = useRef(onToggleTheme);
  toggleRef.current = onToggleTheme;
  const newProjectRef = useRef(onNewProject);
  newProjectRef.current = onNewProject;
  const [booting, setBooting] = useState(true);
  const [ready, setReady] = useState(false);
  // useNavigate 返回的函数在路径变化时会重建，直接放进依赖会让启动 effect 每次跳转都重跑，
  // 从而把刚打开的项目又踢回项目库。这里固定成 ref，只在挂载时初始化一次。
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  // 菜单加速键和渲染层 keydown 可能同时命中，用一个时间戳去重
  const lastHistoryAt = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      await ensureLibrary();
      if (!alive) return;
      // 启动统一停在「我的项目」：不自动打开上次项目，避免一进来就落在分镜页
      navigateRef.current('/projects');
      const notice = consumeSampleUpgradeNotice();
      if (notice) useProjectStore.getState().setToast(notice);
      setReady(true);
      setBooting(false);
    })().catch(() => {
      if (!alive) return;
      setReady(true);
      setBooting(false);
      navigateRef.current('/projects');
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || !currentProjectId) return;
    const timer = window.setTimeout(() => {
      void persistProject(project)
        .then(() => {
          // 只在内容未被后续编辑替换时清除标记，避免误清
          if (useProjectStore.getState().project === project) useProjectStore.getState().clearDirty();
        })
        .catch(() => {
          useProjectStore.getState().setToast('自动保存失败：本地存储空间不足，请先导出项目备份');
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [project, ready, currentProjectId]);

  useEffect(() => {
    // 云账号：启动时读一次状态，并订阅登录回调（扫码在独立窗口完成）
    void useCloud.getState().refresh();
    const offCloud = bindCloudEvents();
    const offSync = initCloudSync();
    return () => {
      offCloud();
      offSync();
    };
  }, []);

  // 撤销/重做：输入框里保留系统原生文本撤销，其余情况撤销项目编辑
  function applyHistory(kind: 'undo' | 'redo') {
    const active = document.activeElement as HTMLElement | null;
    const editable = Boolean(active && (
      active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable
    ));
    if (editable) {
      document.execCommand(kind);
      return;
    }
    const store = useProjectStore.getState();
    if (store.currentProjectId === null) {
      store.setToast(kind === 'undo' ? '先打开一个项目，再撤销编辑' : '先打开一个项目，再重做编辑');
      return;
    }
    if (kind === 'undo') store.undo();
    else store.redo();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const now = Date.now();
      if (now - lastHistoryAt.current < 150) return;
      lastHistoryAt.current = now;
      event.preventDefault();
      applyHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onMenuAction) return;
    return api.onMenuAction((action) => {
      if (action.startsWith('nav:')) {
        if (useProjectStore.getState().currentProjectId === null) {
          navigate('/projects');
          return;
        }
        window.location.hash = `#${action.slice(4)}`;
        return;
      }
      switch (action) {
        case 'new':
          newProjectRef.current();
          break;
        case 'sample':
          navigate('/projects');
          break;
        case 'open':
          void openAction();
          break;
        case 'save':
          void saveAction();
          break;
        case 'undo':
          lastHistoryAt.current = Date.now();
          applyHistory('undo');
          break;
        case 'redo':
          lastHistoryAt.current = Date.now();
          applyHistory('redo');
          break;
        case 'export':
          void exportAction();
          break;
        case 'export:storyboard':
          if (useProjectStore.getState().currentProjectId === null) navigate('/projects');
          else navigate('/export');
          break;
        case 'theme':
          toggleRef.current();
          break;
        case 'help':
          useProjectStore.getState().setToast('快捷键：⌘N 新建项目 · ⌘O 打开 · ⌘S 保存 · ⌘Z 撤销 · ⇧⌘Z 重做 · ⌘1~5 切换页签');
          break;
        default:
          break;
      }
    });
  }, [navigate]);

  return { booting };
}

interface ShellProps {
  dark: boolean;
  onToggleTheme: () => void;
  onOpenLibrary: () => void;
  onNewProject: () => void;
  onOpenShare: () => void;
  onOpenExport: () => void;
}

function Shell({ dark, onToggleTheme, onOpenLibrary, onNewProject, onOpenShare, onOpenExport }: ShellProps) {
  const project = useProjectStore((state) => state.project);
  const filePath = useProjectStore((state) => state.filePath);
  const toast = useProjectStore((state) => state.toast);
  const setToast = useProjectStore((state) => state.setToast);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const canUndo = useProjectStore((state) => state.past.length > 0);
  const canRedo = useProjectStore((state) => state.future.length > 0);
  const location = useLocation();
  // 分镜表格是虚拟滚动，占满剩余高度由表格自己滚；外层再滚就成了两条竖滑条
  const fitContent = location.pathname === '/shots';

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast, setToast]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn" type="button" title="返回项目库" onClick={onOpenLibrary}>
            <ChevronLeft size={18} />
          </button>
          <span className="project-name" title={filePath ?? '已自动保存到项目库'}>{project.name}</span>
          <span className="project-meta">{project.shots.length} 个镜头 · {project.days.length} 个拍摄日</span>
          <div className="history-actions">
            <button className="icon-btn" type="button" title="撤销（⌘Z）" aria-label="撤销" disabled={!canUndo} onClick={undo}>
              <Undo2 size={16} />
            </button>
            <button className="icon-btn" type="button" title="重做（⇧⌘Z）" aria-label="重做" disabled={!canRedo} onClick={redo}>
              <Redo2 size={16} />
            </button>
          </div>
        </div>

        <nav className="tabs">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className="topbar-right">
          <button className="btn ghost" type="button" onClick={onNewProject}><Plus size={15} />新建项目</button>
          <button className="btn ghost" type="button" onClick={() => void openAction()}><FolderOpen size={15} />打开</button>
          <button className="btn ghost" type="button" onClick={() => void saveAction()}><Save size={15} />保存</button>
          <button className="btn primary" type="button" onClick={onOpenExport}><FileDown size={15} />导出分镜</button>
          <button className="btn ghost" type="button" onClick={() => void exportAction()}><Download size={15} />项目包</button>
          <button className="btn ghost" type="button" onClick={onOpenShare}><Users size={15} />共享</button>
          <button className="icon-btn" type="button" onClick={onToggleTheme} title="切换主题">
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <main className={fitContent ? 'content content-fit' : 'content'}>
        <Routes>
          <Route path="/" element={<Navigate to="/shots" replace />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/shots" element={<ShotTablePage />} />
          <Route path="/storyboard" element={<StoryboardPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/rundown" element={<RundownPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="*" element={<Navigate to="/shots" replace />} />
        </Routes>
      </main>

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

function Root({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [requestCreate, setRequestCreate] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const project = useProjectStore((state) => state.project);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const openNewProject = useCallback(() => {
    setRequestCreate(true);
    navigate('/projects');
  }, [navigate]);
  const { booting } = useLibraryIntegration(navigate, onToggleTheme, openNewProject);

  const sharePanel = shareOpen ? (
    <SharePanel
      project={currentProjectId ? project : null}
      onClose={() => setShareOpen(false)}
      onToast={(message) => useProjectStore.getState().setToast(message)}
      onEnterProject={(loaded) => {
        useProjectStore.getState().setProject(loaded);
        void setCurrentProject(loaded.id);
        setShareOpen(false);
        navigate('/shots');
      }}
    />
  ) : null;

  if (booting) return <div className="boot-screen">正在打开项目库…</div>;
  if (location.pathname === '/projects') {
    return (
      <>
        <ProjectsPage
          requestCreate={requestCreate}
          onCreateRequestHandled={() => setRequestCreate(false)}
          onOpenShare={() => setShareOpen(true)}
        />
        {sharePanel}
      </>
    );
  }
  return (
    <>
      <Shell
        dark={dark}
        onToggleTheme={onToggleTheme}
        onOpenLibrary={() => navigate('/projects')}
        onNewProject={openNewProject}
        onOpenShare={() => setShareOpen(true)}
        onOpenExport={() => navigate('/export')}
      />
      {sharePanel}
    </>
  );
}

export default function App() {
  // 主题状态放在 store 里：项目库顶栏与项目页工具条都能切，且始终同步
  const dark = useTheme((state) => state.dark);
  const toggleTheme = useTheme((state) => state.toggle);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    window.electronAPI?.setTheme?.(dark);
    try {
      window.localStorage.setItem('shotflow-theme', dark ? 'dark' : 'light');
    } catch {
      // 某些 WebView 禁用 localStorage，主题切换仍可用
    }
  }, [dark]);

  return (
    <HashRouter>
      <Root dark={dark} onToggleTheme={toggleTheme} />
      {/* 冲突弹窗挂在路由外层：不管在哪一页都能看到并处理 */}
      <CloudConflictDialog />
    </HashRouter>
  );
}
