/**
 * 微信账号面板：未登录时就是扫码登录页，登录后是账号与同步状态。
 *
 * 为什么二维码不画在这里：微信网页授权的二维码由 open.weixin.qq.com 的官方页面渲染，
 * 跨域不能内嵌；而且 AppSecret 由平台代持，我们不能自己拼 qrconnect 地址。
 * 所以这里做成「登录页 + 一键唤起微信授权窗口」，二维码/快捷登录在微信那个窗口里。
 */
import { Cloud, LogOut, QrCode, RefreshCw, TriangleAlert, X } from 'lucide-react';
import CloudEndpointPanel from '@/components/CloudEndpointPanel';
import { cloudAccountNote, dateTimeLabel } from '@/domain/cloudStatus';
import { useCloud } from '@/store/cloudStore';
import { openConflicts, syncNow, useCloudSync } from '@/store/cloudSync';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CloudAccountDialog({ open, onClose }: Props) {
  const cloud = useCloud();
  const sync = useCloudSync();

  if (!open) return null;

  const signedIn = cloud.status === 'signed-in';
  const note = cloudAccountNote({
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

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="modal cloud-dialog" role="dialog" aria-modal="true" aria-label={signedIn ? '微信账号' : '微信扫码登录'}>
        <header className="cloud-dialog-head">
          <div>
            <h2>{signedIn ? <Cloud size={17} /> : <QrCode size={17} />}{signedIn ? '微信账号' : '微信扫码登录'}</h2>
            <p>{signedIn ? '同一个微信账号，换设备打开就能接着改' : '登录后项目在你的设备之间同步，本地文件仍是主副本'}</p>
          </div>
          <button className="icon-btn" type="button" aria-label="关闭" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="cloud-dialog-body">
          {signedIn ? (
            <>
              <div className="cloud-account">
                {cloud.user?.avatar ? (
                  <img className="cloud-account-avatar" src={cloud.user.avatar} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="cloud-account-avatar fallback">{(cloud.user?.name || '微').slice(0, 1)}</span>
                )}
                <div className="cloud-account-text">
                  <strong>{cloud.user?.name || '已登录'}</strong>
                  <span>{note}</span>
                </div>
              </div>

              <dl className="cloud-facts">
                <div><dt>云端项目</dt><dd>{sync.count > 0 ? `${sync.count} 个` : '尚未读取'}</dd></div>
                <div><dt>最近同步</dt><dd>{sync.at ? dateTimeLabel(sync.at) : '—'}</dd></div>
                <div><dt>本地优先</dt><dd>断网照常编辑，联网自动补传</dd></div>
              </dl>

              {sync.error ? <p className="cloud-error">同步失败：{sync.error}（项目仍保存在本机）</p> : null}

              <div className="cloud-dialog-actions">
                <button
                  className="btn ghost compact"
                  type="button"
                  disabled={sync.syncing || sync.resolving}
                  onClick={() => void syncNow('manual')}
                >
                  <RefreshCw size={13} className={sync.syncing ? 'spin' : undefined} />
                  {sync.syncing ? '同步中…' : '立即同步'}
                </button>
                {sync.conflicts.length > 0 ? (
                  <button className="btn ghost compact cloud-conflict-btn" type="button" onClick={() => { onClose(); openConflicts(); }}>
                    <TriangleAlert size={13} />
                    {sync.conflicts.length} 个冲突待处理
                  </button>
                ) : null}
                <button className="btn ghost compact" type="button" disabled={cloud.busy} onClick={() => void cloud.logout()}>
                  <LogOut size={13} />退出登录
                </button>
              </div>
              <p className="cloud-dialog-hint">退出登录只清掉账号状态，本机项目文件不会删除。</p>
            </>
          ) : (
            <div className="qr-login">
              <div className="qr-frame" aria-hidden="true"><QrCode size={76} strokeWidth={1.2} /></div>
              <p className="qr-frame-note">点按钮后，二维码在微信窗口里显示</p>
              <ol className="qr-steps">
                <li><span>1</span>点下面的按钮，打开微信官方授权页</li>
                <li><span>2</span>手机微信扫一扫，或直接点「快捷登录」</li>
                <li><span>3</span>确认后这个窗口会自动变成已登录</li>
              </ol>
              <button
                className="btn primary qr-login-btn"
                type="button"
                disabled={cloud.busy || cloud.status === 'unavailable'}
                onClick={() => void cloud.login()}
              >
                <QrCode size={15} />
                {cloud.busy ? '正在打开微信…' : '打开微信授权页'}
              </button>
              <p className="cloud-dialog-hint">
                {cloud.status === 'unavailable'
                  ? '现在连不上云端（可能没网）。本地项目不受影响，联网后再登录即可。'
                  : '本机装了微信会直接走「快捷登录」，不用扫码；没装微信才会显示二维码。'}
              </p>
              {cloud.error && cloud.error !== 'cloud_offline' ? (
                <p className="cloud-error">登录失败：{cloud.error}</p>
              ) : null}
            </div>
          )}

          <CloudEndpointPanel />
        </div>
      </div>
    </div>
  );
}
