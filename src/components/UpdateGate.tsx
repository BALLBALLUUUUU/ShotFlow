/**
 * 启动更新闸门。
 *
 * 「检查中」先给一个极简启动页，避免旧界面闪一下再被盖住；
 * 「必须更新」是全屏页，没有关闭按钮、Esc 也不响应 —— 想继续用就只能更新。
 * 检查失败时这里不渲染，直接把应用放出去（断网不能等于软件报废）。
 */
import { useEffect, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCw,
  ShieldCheck,
} from 'lucide-react';
import appLogo from '@/assets/logo.png';
import { formatBytes } from '@/domain/update';
import { useUpdate } from '@/store/updateStore';

function Splash() {
  return (
    <div className="update-splash" role="status" aria-live="polite">
      <img className="update-splash-logo" src={appLogo} alt="" width={54} height={54} />
      <div className="update-splash-name">ShotFlow</div>
      <div className="update-splash-bar" aria-hidden="true"><span /></div>
      <p>正在检查版本…</p>
    </div>
  );
}

export default function UpdateGate({ children }: { children: ReactNode }) {
  const phase = useUpdate((state) => state.phase);
  const decision = useUpdate((state) => state.decision);
  const checkError = useUpdate((state) => state.checkError);
  const checking = useUpdate((state) => state.checking);
  const downloading = useUpdate((state) => state.downloading);
  const installing = useUpdate((state) => state.installing);
  const progress = useUpdate((state) => state.progress);
  const saved = useUpdate((state) => state.saved);
  const actionError = useUpdate((state) => state.actionError);
  const recheck = useUpdate((state) => state.recheck);
  const download = useUpdate((state) => state.download);
  const install = useUpdate((state) => state.install);
  const openPage = useUpdate((state) => state.openPage);
  const restart = useUpdate((state) => state.restart);

  // 锁住时同步主进程：菜单只剩退出，刷新与开发者工具快捷键也被拦掉
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.setUpdateGate) return;
    void api.setUpdateGate(phase === 'blocked');
    return () => {
      void api.setUpdateGate(false);
    };
  }, [phase]);

  if (phase === 'checking') return <Splash />;
  if (phase !== 'blocked' || !decision) return <>{children}</>;

  const size = formatBytes(decision.downloadSize || saved?.size || 0);
  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0));

  return (
    <div className="update-gate" role="dialog" aria-modal="true" aria-label="需要更新后才能使用">
      <div className="update-card">
        <div className="update-ribbon">
          <AlertTriangle size={14} />
          <span>旧版本已停用，更新后才能继续使用</span>
        </div>

        <div className="update-card-body">
          <div className="update-brand">
            <img src={appLogo} alt="" width={38} height={38} />
            <div>
              <strong>ShotFlow</strong>
              <span>拍摄前期工作台</span>
            </div>
          </div>

          <h1 className="update-title">发现新版本</h1>
          <div className="update-version-row">
            <span className="update-version old">v{decision.current}</span>
            <ArrowRight size={16} />
            <span className="update-version next">v{decision.latest}</span>
            {decision.publishedAt ? (
              <span className="update-date">{decision.publishedAt.slice(0, 10)}</span>
            ) : null}
          </div>

          <div className="update-notes">
            <h2>更新内容</h2>
            <div className="update-notes-body">
              {decision.notes.trim() || '本次更新包含功能改进与问题修复。'}
            </div>
          </div>

          {downloading ? (
            <div className="update-progress">
              <div className="update-progress-bar"><span style={{ width: `${percent}%` }} /></div>
              <div className="update-progress-meta">
                <span>正在下载更新包…</span>
                <span className="mono">{percent}%</span>
              </div>
            </div>
          ) : null}

          {!downloading && saved ? (
            <div className="update-ready">
              <ShieldCheck size={16} />
              <div>
                <strong>安装包已下载完成</strong>
                <span className="mono">{saved.filePath}</span>
              </div>
            </div>
          ) : null}

          {installing ? (
            <div className="update-steps">
              <strong>最后一步</strong>
              <ol>
                <li>把 ShotFlow 拖进「应用程序」文件夹，覆盖旧版本</li>
                <li>回到这里点「重启应用」，确认版本号已更新</li>
              </ol>
            </div>
          ) : null}

          {actionError ? (
            <p className="update-error"><AlertTriangle size={13} />{actionError}</p>
          ) : null}

          <div className="update-actions">
            {saved || installing ? (
              installing ? (
                <>
                  <button className="btn primary update-main-btn" type="button" onClick={() => void restart()}>
                    <RotateCw size={15} />
                    重启应用
                  </button>
                  <button className="btn ghost" type="button" onClick={() => void install()}>
                    <Download size={15} />
                    重新打开安装包
                  </button>
                </>
              ) : (
                <>
                  <button className="btn primary update-main-btn" type="button" onClick={() => void install()}>
                    <Download size={15} />
                    打开安装包安装
                  </button>
                  <button className="btn ghost" type="button" onClick={() => void openPage()}>
                    <ExternalLink size={15} />
                    打开发布页
                  </button>
                </>
              )
            ) : (
              <>
                <button
                  className="btn primary update-main-btn"
                  type="button"
                  disabled={downloading || !decision.canDownload}
                  onClick={() => void download()}
                >
                  {downloading ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
                  {decision.canDownload
                    ? `下载更新${size ? `（${size}）` : ''}`
                    : '当前平台暂无安装包'}
                </button>
                <button className="btn ghost" type="button" onClick={() => void openPage()}>
                  <ExternalLink size={15} />
                  打开发布页
                </button>
              </>
            )}
          </div>

          {saved && !installing ? (
            <ol className="update-install-steps">
              <li>点「打开安装包」，把 ShotFlow 拖进「应用程序」覆盖旧版本</li>
              <li>回到这里点「重启应用」，确认版本号已经是 v{decision.latest}</li>
            </ol>
          ) : null}

          <div className="update-foot">
            <span>更新只替换应用本体，本机项目库与云端备份不受影响</span>
            <button
              className="update-link"
              type="button"
              disabled={checking}
              onClick={() => void recheck()}
            >
              {checking ? <Loader2 className="spin" size={12} /> : <RefreshCw size={12} />}
              {checking ? '正在重新检查' : '重新检查'}
            </button>
          </div>
          {checkError ? <p className="update-hint">{checkError}</p> : null}
        </div>
      </div>
    </div>
  );
}
