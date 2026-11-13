import { useCallback, useEffect, useState } from 'react';
import { Download, FolderOpen, RefreshCw, Upload, Users, X } from 'lucide-react';
import ConflictDialog, { type ConflictChoice } from '@/components/ConflictDialog';
import { readAnyProjectFile } from '@/domain/projectPackage';
import { canPublish, type SharedEntry, type SharedIndex, type VersionRelation } from '@/domain/sharedFolder';
import type { Project } from '@/domain/types';
import { openProjectPackage } from '@/store/packageIO';
import { loadProjectById } from '@/store/projectLibrary';
import {
  authorKey,
  exportPackage,
  fetchFromShare,
  importPackage,
  loadShareState,
  portableFingerprint,
  publishRelation,
  publishToShare,
  remoteRelation,
  setAuthor,
} from '@/store/projectActions';
import * as shareIO from '@/store/shareIO';

export const LIBRARY_CHANGED_EVENT = 'shotflow:library-changed';

function notifyLibraryChanged(): void {
  window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED_EVENT));
}

function relationText(relation: VersionRelation): string {
  switch (relation) {
    case 'new': return '新项目';
    case 'identical': return '与本地一致';
    case 'local-newer': return '本地更新';
    case 'remote-newer': return '共享目录更新';
    default: return '版本不同，需确认';
  }
}

interface PendingImport {
  bytes: Uint8Array;
  name: string;
  detail: string;
}

interface Props {
  project: Project | null;
  onClose: () => void;
  onEnterProject: (project: Project) => void;
  onToast: (message: string) => void;
}

export default function SharePanel({ project, onClose, onEnterProject, onToast }: Props) {
  const [author, setAuthorName] = useState(authorKey);
  const [target, setTarget] = useState<shareIO.ShareTarget | null>(null);
  const [shared, setShared] = useState<SharedIndex | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [pendingPublish, setPendingPublish] = useState<{ detail: string } | null>(null);
  const [pendingFetch, setPendingFetch] = useState<{ entry: SharedEntry; detail: string } | null>(null);

  const refresh = useCallback(async () => {
    const current = await shareIO.currentShareTarget();
    setTarget(current);
    if (!current || current.needsPicker) {
      setShared(null);
      return;
    }
    try {
      const state = await loadShareState(current);
      setShared(state.index);
      setTarget(state.target);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取共享目录失败');
      setShared(null);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleChooseDir(): Promise<void> {
    await run(async () => {
      const chosen = await shareIO.chooseShareTarget();
      if (!chosen) return;
      setTarget(chosen);
      const state = await loadShareState(chosen);
      setShared(state.index);
      onToast(`共享目录已设置：${chosen.label}`);
    });
  }

  async function handleExport(): Promise<void> {
    if (!project) return;
    await run(async () => {
      const result = await exportPackage(project, author);
      onToast(`已导出 ${result.fileName}（含 ${result.assetCount} 张图片资源）`);
    });
  }

  async function doImport(bytes: Uint8Array, decision: 'replace' | 'copy' | 'cancel'): Promise<void> {
    if (decision === 'cancel') {
      setPendingImport(null);
      return;
    }
    await run(async () => {
      const result = await importPackage(bytes, { mode: decision });
      setPendingImport(null);
      notifyLibraryChanged();
      onToast(`已导入「${result.project.name}」`);
      onEnterProject(result.project);
    });
  }

  async function handleImport(): Promise<void> {
    await run(async () => {
      const file = await openProjectPackage();
      if (!file) return;
      const parsed = readAnyProjectFile(file.bytes);
      const local = await loadProjectById(parsed.project.id);
      if (!local) {
        await doImport(file.bytes, 'replace');
        return;
      }
      const same = portableFingerprint(local) === portableFingerprint(parsed.project);
      setPendingImport({
        bytes: file.bytes,
        name: file.name,
        detail: same
          ? `「${file.name}」与本地同名项目内容完全一致，导入不会产生变化。`
          : `本地已有同 ID 项目「${local.name}」（更新于 ${local.updatedAt}），导入的是「${parsed.project.name}」（更新于 ${parsed.project.updatedAt}）。请选择保留哪一份；另存副本最安全。`,
      });
    });
  }

  async function handlePublish(): Promise<void> {
    if (!project || !shared || !target) return;
    const relation = publishRelation(project, shared);
    if (!canPublish(relation)) {
      const remote = shared.projects.find((entry) => entry.projectId === project.id);
      setPendingPublish({
        detail: `共享目录里「${project.name}」有更新的版本（${remote?.author || '未署名'} 于 ${remote?.updatedAt ?? '未知时间'} 发布）。继续发布会覆盖同事的修改，建议先取回。`,
      });
      return;
    }
    await run(async () => {
      const next = await publishToShare(project, { index: shared, target }, author);
      setShared(next);
      onToast(`已发布「${project.name}」到共享目录`);
    });
  }

  async function doPublish(force: boolean): Promise<void> {
    if (!project || !shared || !target || !force) {
      setPendingPublish(null);
      return;
    }
    await run(async () => {
      const next = await publishToShare(project, { index: shared, target }, author, true);
      setShared(next);
      setPendingPublish(null);
      onToast(`已强制覆盖发布「${project.name}」`);
    });
  }

  async function handleFetch(entry: SharedEntry): Promise<void> {
    if (!shared || !target) return;
    const local = await loadProjectById(entry.projectId);
    const relation = remoteRelation(local, entry);
    if (local && relation !== 'identical') {
      setPendingFetch({
        entry,
        detail: `本地「${local.name}」与共享版本（${entry.author || '未署名'} 于 ${entry.updatedAt} 发布）不同：${relationText(relation)}。请选择保留哪一份，不会自动覆盖。`,
      });
      return;
    }
    await run(async () => {
      const loaded = await fetchFromShare(entry, { index: shared, target }, local ? { mode: 'replace' } : null);
      notifyLibraryChanged();
      onToast(`已取回「${loaded.name}」`);
      onEnterProject(loaded);
    });
  }

  async function doFetch(decision: 'replace' | 'copy' | 'cancel'): Promise<void> {
    if (!pendingFetch || !shared || !target) return;
    const { entry } = pendingFetch;
    if (decision === 'cancel') {
      setPendingFetch(null);
      return;
    }
    await run(async () => {
      const loaded = await fetchFromShare(entry, { index: shared, target }, { mode: decision });
      setPendingFetch(null);
      notifyLibraryChanged();
      onToast(`已取回「${loaded.name}」`);
      onEnterProject(loaded);
    });
  }

  const publishRelationValue = project && shared ? publishRelation(project, shared) : null;
  const importChoices: ConflictChoice[] = [
    { label: '另存为副本', description: '保留本地项目，导入的另建一份（推荐）', value: 'copy' },
    { label: '覆盖本地', description: '用导入文件替换本地同 ID 项目，不可撤销', value: 'replace', danger: true },
    { label: '取消', description: '什么都不改', value: 'cancel' },
  ];

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="drawer share-drawer" role="dialog" aria-modal="true" aria-label="共享与传输">
        <div className="drawer-head">
          <div>
            <h2><Users size={18} />共享与传输</h2>
            <p>项目包互通 · 共享目录协作</p>
          </div>
          <button className="icon-btn" type="button" aria-label="关闭" onClick={onClose}><X size={17} /></button>
        </div>

        <div className="share-body">
          {error ? <div className="library-error" role="alert">{error}</div> : null}

          <section className="share-section">
            <h3>导出者署名</h3>
            <p className="share-hint">同事在共享目录里能看到这份是谁发布的。</p>
            <input
              className="text-input"
              value={author}
              placeholder="例如：球球 / 摄影组"
              onChange={(event) => { setAuthorName(event.currentTarget.value); setAuthor(event.currentTarget.value); }}
            />
          </section>

          <section className="share-section">
            <h3>项目包（.shotflow）</h3>
            <p className="share-hint">包含完整分镜、Rundown 与独立图片资源，可发给同事或存到网盘。</p>
            <div className="share-actions">
              <button className="btn primary" type="button" disabled={!project || busy} onClick={() => void handleExport()}>
                <Download size={15} />导出当前项目包
              </button>
              <button className="btn ghost" type="button" disabled={busy} onClick={() => void handleImport()}>
                <Upload size={15} />导入项目包 / 旧 JSON
              </button>
            </div>
          </section>

          <section className="share-section">
            <div className="share-section-head">
              <h3>团队共享目录</h3>
              <button className="icon-btn small" type="button" title="刷新" onClick={() => void refresh()}><RefreshCw size={14} /></button>
            </div>
            <p className="share-hint">选择一个所有人都能访问的网络共享盘 / NAS / 网盘同步文件夹。不需要账号，也不上云。</p>
            <div className="share-dir-row">
              <span className={target ? 'share-dir set' : 'share-dir'} title={target?.label}>
                {target ? target.label : '尚未设置共享目录'}
              </span>
              <button className="btn ghost compact" type="button" disabled={busy} onClick={() => void handleChooseDir()}>
                <FolderOpen size={14} />{target ? '更换' : '选择目录'}
              </button>
            </div>

            {target && project ? (
              <div className="share-publish-row">
                <span className="share-relation">当前项目：{publishRelationValue ? relationText(publishRelationValue) : '—'}</span>
                <button className="btn ghost compact" type="button" disabled={busy} onClick={() => void handlePublish()}>
                  <Upload size={14} />发布到共享
                </button>
              </div>
            ) : null}

            {shared ? (
              <div className="share-list">
                {shared.projects.length === 0 ? (
                  <p className="share-empty">共享目录里还没有项目，点「发布到共享」创建第一份。</p>
                ) : shared.projects.map((entry) => (
                  <div className="share-item" key={entry.projectId}>
                    <div className="share-item-info">
                      <strong>{entry.name}</strong>
                      <span>{entry.shotCount} 镜头 · {entry.author || '未署名'} · {new Date(entry.updatedAt).toLocaleString('zh-CN')}</span>
                    </div>
                    <button className="btn ghost compact" type="button" disabled={busy} onClick={() => void handleFetch(entry)}>
                      取回
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="share-section share-note">
            <h3>协作规则</h3>
            <p>不做实时协同：谁改完点「发布」，其他人点「取回」。发布或取回前会比较版本，<strong>有冲突一定先问你</strong>，不会静默覆盖同事的修改。</p>
          </section>
        </div>
      </aside>

      {pendingImport ? (
        <ConflictDialog
          title="导入时检测到同名项目"
          detail={pendingImport.detail}
          choices={importChoices}
          onChoose={(value) => void doImport(pendingImport.bytes, value)}
          onClose={() => setPendingImport(null)}
        />
      ) : null}

      {pendingPublish ? (
        <ConflictDialog
          title="共享目录有更新的版本"
          detail={pendingPublish.detail}
          choices={[
            { label: '先不发布', description: '取消本次发布，去取回同事的版本', value: 'cancel' },
            { label: '仍然覆盖发布', description: '明确覆盖共享目录里的版本，不可撤销', value: 'replace', danger: true },
          ]}
          onChoose={(value) => void doPublish(value === 'replace')}
          onClose={() => setPendingPublish(null)}
        />
      ) : null}

      {pendingFetch ? (
        <ConflictDialog
          title="取回会与本地版本冲突"
          detail={pendingFetch.detail}
          choices={importChoices}
          onChoose={(value) => void doFetch(value)}
          onClose={() => setPendingFetch(null)}
        />
      ) : null}
    </div>
  );
}
