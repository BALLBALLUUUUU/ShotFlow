import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import appLogo from '@/assets/logo.png';
import { useCloud } from '@/store/cloudStore';
import {
  decideUpdate,
  DEFAULT_UPDATE_REPO,
  parseRepoRef,
  pickManifest,
  platformFrom,
  releasesUrl,
  type UpdateDecision,
} from '@/domain/update';

const REPO_KEY = 'shotflow.update.repo.v1';

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest'; version: string }
  | { kind: 'newer'; decision: UpdateDecision }
  | { kind: 'error'; message: string };

interface Props {
  onClose: () => void;
}

function readRepo(): string {
  try {
    return window.localStorage.getItem(REPO_KEY) ?? DEFAULT_UPDATE_REPO;
  } catch {
    return DEFAULT_UPDATE_REPO;
  }
}

function writeRepo(value: string): void {
  try {
    if (value) window.localStorage.setItem(REPO_KEY, value);
    else window.localStorage.removeItem(REPO_KEY);
  } catch {
    // 存储不可用时只影响「记住仓库地址」，不影响检查本身
  }
}

function platformLabel(): string {
  const ua = navigator.userAgent;
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS · 桌面端';
  if (/Windows/i.test(ua)) return 'Windows · 桌面端';
  return '浏览器预览';
}

export default function AboutDialog({ onClose }: Props) {
  const [version, setVersion] = useState('1.0.0');
  const cloudSignedIn = useCloud((state) => state.status === 'signed-in');
  const [repoInput, setRepoInput] = useState(readRepo);
  const [state, setState] = useState<CheckState>({ kind: 'idle' });
  const repoRef = useMemo(() => parseRepoRef(repoInput), [repoInput]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getVersion) return;
    void api.getVersion().then((value) => setVersion(value)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function checkUpdate(): Promise<void> {
    const target = parseRepoRef(repoInput);
    if (!target) {
      setState({
        kind: 'error',
        message: repoInput.trim()
          ? '仓库地址要写成 owner/repo（例如 BALLBALLUUUUU/ShotFlow）'
          : '先填更新仓库，格式 owner/repo（例如 BALLBALLUUUUU/ShotFlow）',
      });
      return;
    }
    writeRepo(target.slug);
    setState({ kind: 'checking' });
    try {
      const api = window.electronAPI;
      if (api?.checkUpdate) {
        const result = await api.checkUpdate({ repo: target.slug });
        if (!result.ok) {
          setState({ kind: 'error', message: result.error });
          return;
        }
        const picked = pickManifest(result.candidates ?? [], releasesUrl(target));
        const decision = decideUpdate(
          result.current || version,
          picked?.manifest ?? null,
          platformFrom(result.platform),
        );
        if (!decision) {
          setState({ kind: 'error', message: '没有读到有效的版本清单' });
          return;
        }
        if (decision.hasUpdate) setState({ kind: 'newer', decision });
        else setState({ kind: 'latest', version: decision.latest });
        return;
      }

      // 浏览器预览：GitHub API 允许跨域，直接用 fetch
      const response = await fetch(`https://api.github.com/repos/${target.slug}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (response.status === 404) {
        setState({ kind: 'error', message: '该仓库还没有发布 Release' });
        return;
      }
      if (!response.ok) {
        setState({ kind: 'error', message: `GitHub 返回 ${response.status}` });
        return;
      }
      const data = await response.json();
      const picked = pickManifest([{ source: 'release', payload: {
        version: String(data.tag_name ?? ''),
        notes: String(data.body ?? ''),
        publishedAt: String(data.published_at ?? ''),
        page: String(data.html_url ?? ''),
        mandatory: false,
        assets: [],
      } }], releasesUrl(target));
      const decision = decideUpdate(version, picked?.manifest ?? null, platformFrom(navigator.platform));
      if (!decision) {
        setState({ kind: 'error', message: '没有读到有效的版本信息' });
        return;
      }
      if (decision.hasUpdate) setState({ kind: 'newer', decision });
      else setState({ kind: 'latest', version: decision.latest });
    } catch {
      setState({ kind: 'error', message: '无法连接更新服务器，请检查网络后重试' });
    }
  }

  const status = (() => {
    switch (state.kind) {
      case 'checking':
        return { tone: 'busy', text: '正在向 GitHub 查询最新 Release…' };
      case 'latest':
        return { tone: 'ok', text: `已是最新版本（v${state.version}）` };
      case 'newer':
        return { tone: 'new', text: `发现新版本 v${state.decision.latest}（当前 v${version}）` };
      case 'error':
        return { tone: 'bad', text: state.message };
      default:
        return {
          tone: 'hint',
          text: repoRef ? `点击右侧按钮向 github.com/${repoRef.slug} 查询最新版本` : '填写更新仓库后即可检查新版本，地址只保存在本机',
        };
    }
  })();

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="modal about-dialog" role="dialog" aria-modal="true" aria-label="关于 ShotFlow">
        <div className="about-head">
          <img className="about-logo" src={appLogo} alt="ShotFlow" width={44} height={44} />
          <div className="about-title">
            <h2>ShotFlow</h2>
            <p>分镜 · 故事板 · 拍摄计划 · Rundown</p>
          </div>
          <span className="about-version">v{version}</span>
          <button className="icon-btn" type="button" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="about-body">
          <p className="about-desc">
            本地优先的拍摄前期工作台。把分镜表、故事板、拍摄计划和 Rundown 通告串成一条线。
            {cloudSignedIn
              ? '当前已登录微信，项目会自动备份到你的云端空间，本机文件仍是主副本；'
              : '项目默认只保存在这台电脑上，不上传云端；登录微信后可备份到云端。'}
            需要带给同事时导出 <code>.shotflow</code> 项目包即可。
          </p>

          <ul className="about-points">
            <li><strong>分镜表格</strong>：自定义列、批量粘贴、虚拟滚动，几千个镜头也不卡</li>
            <li><strong>故事板与拍摄计划</strong>：卡片拖拽、放映模式、工时与档期冲突提示</li>
            <li><strong>Rundown 与通告</strong>：自动算时、按组编排、一键生成可粘贴的通告文本</li>
          </ul>

          <dl className="about-facts">
            <div><dt>开发作者</dt><dd>黄溢球</dd></div>
            <div><dt>版本号</dt><dd className="mono">v{version}</dd></div>
            <div><dt>运行环境</dt><dd>{platformLabel()}</dd></div>
            <div><dt>项目存储</dt><dd>本机项目库 · 可导出项目包共享</dd></div>
          </dl>

          <section className="about-update">
            <div className="about-update-head">
              <span>检查更新</span>
              {repoRef ? (
                <a
                  className="about-link"
                  href={releasesUrl(repoRef)}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开发布页<ExternalLink size={12} />
                </a>
              ) : (
                <span className="about-update-note">GitHub Releases</span>
              )}
            </div>

            <div className="about-update-row">
              <input
                className="text-input"
                value={repoInput}
                placeholder="owner/repo，例如 BALLBALLUUUUU/ShotFlow"
                aria-label="更新仓库"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setRepoInput(value);
                  writeRepo(value.trim());
                  setState({ kind: 'idle' });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void checkUpdate();
                }}
              />
              <button
                className="btn ghost"
                type="button"
                disabled={state.kind === 'checking'}
                onClick={() => void checkUpdate()}
              >
                {state.kind === 'checking'
                  ? <Loader2 className="spin" size={15} />
                  : <RefreshCw size={15} />}
                检查更新
              </button>
            </div>

            <p className={`about-status ${status.tone}`}>
              {status.tone === 'ok' ? <CheckCircle2 size={13} /> : null}
              <span>{status.text}</span>
              {state.kind === 'newer' ? (
                <a
                  className="about-link"
                  href={state.decision.pageUrl || `https://github.com/${DEFAULT_UPDATE_REPO}/releases`}
                  target="_blank"
                  rel="noreferrer"
                >
                  下载新版<ExternalLink size={12} />
                </a>
              ) : null}
            </p>
          </section>
        </div>

        <div className="modal-foot">
          <span className="about-foot-note">© 2026 黄溢球 · 本项目为个人自用工具</span>
          <button className="btn primary" type="button" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
