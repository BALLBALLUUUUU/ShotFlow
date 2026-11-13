/**
 * 云端地址设置：默认走 ShotFlow 官方云，也可以填自己应用的云桥地址。
 *
 * 为什么要把这件事做进界面：云环境是按 WorkBuddy 应用分配的，把安装包发给朋友时，
 * 数据默认落在分享者的云额度里。填自己的地址，数据就归自己的云环境。
 */
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, RotateCcw, Server } from 'lucide-react';
import {
  DEFAULT_CLOUD_ENDPOINT,
  DEFAULT_CLOUD_SHARECODE,
  cloudHostLabel,
  isDefaultCloud,
  maskSharecode,
} from '@/domain/cloudEndpoint';
import { useCloudEndpoint } from '@/store/cloudEndpoint';

type Mode = 'default' | 'custom';

export default function CloudEndpointPanel() {
  const ep = useCloudEndpoint();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('default');
  const [endpoint, setEndpoint] = useState('');
  const [sharecode, setSharecode] = useState('');
  // 用户一旦自己点过，就别再用异步读回来的旧值覆盖他的输入
  const touched = useRef(false);

  useEffect(() => {
    void useCloudEndpoint.getState().load();
  }, []);

  // 配置是异步读的：只回填一次，且不能踩掉用户已经开始的操作
  useEffect(() => {
    if (!ep.loaded || touched.current) return;
    setMode(isDefaultCloud(ep.endpoint) ? 'default' : 'custom');
    setEndpoint(ep.endpoint);
    setSharecode(ep.sharecode);
  }, [ep.loaded, ep.endpoint, ep.sharecode]);

  const custom = !isDefaultCloud(ep.endpoint);
  const busy = ep.saving || ep.probe === 'probing';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === 'default') await ep.resetToDefault();
    else await ep.save({ endpoint, sharecode });
  }

  return (
    <section className={`cloud-endpoint${custom ? ' custom' : ''}`}>
      <button
        className="cloud-endpoint-head"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Server size={13} />
        <span className="cloud-endpoint-title">云端地址</span>
        <span className="cloud-endpoint-current" title={ep.endpoint}>
          {cloudHostLabel(ep.endpoint)}
          {custom ? <em>自定义</em> : null}
        </span>
        <ChevronDown size={14} className={open ? 'flip' : undefined} />
      </button>

      {open ? (
        <form className="cloud-endpoint-body" onSubmit={submit}>
          <div className="cloud-mode" role="group" aria-label="云端类型">
            <button
              type="button"
              data-on={mode === 'default'}
              onClick={() => {
                touched.current = true;
                setMode('default');
                ep.clearProbe();
              }}
            >官方云</button>
            <button
              type="button"
              data-on={mode === 'custom'}
              onClick={() => {
                touched.current = true;
                setMode('custom');
                ep.clearProbe();
                if (!endpoint) setEndpoint(ep.endpoint);
                // 访问码是按站点发的：从官方切过来时清空，避免把官方访问码带给别人的云
                if (isDefaultCloud(ep.endpoint)) setSharecode('');
              }}
            >自定义</button>
          </div>

          {mode === 'custom' ? (
            <div className="cloud-endpoint-fields">
              <label>
                <span>云桥地址</span>
                <input
                  type="text"
                  value={endpoint}
                  spellCheck={false}
                  placeholder="https://你的应用前缀.app.workbuddy.host"
                  onChange={(event) => { setEndpoint(event.target.value); ep.clearProbe(); }}
                />
              </label>
              <label>
                <span>访问码</span>
                <input
                  type="text"
                  value={sharecode}
                  spellCheck={false}
                  placeholder="可留空；也可以直接粘贴带 sharecode 的完整链接"
                  onChange={(event) => { setSharecode(event.target.value); ep.clearProbe(); }}
                />
              </label>
            </div>
          ) : (
            <p className="cloud-endpoint-note">
              使用 ShotFlow 自带的云（{cloudHostLabel(ep.endpoint)}，访问码 {maskSharecode(ep.sharecode)}）。
              数据与额度归属这个应用的提供者。
            </p>
          )}

          <div className="cloud-endpoint-actions">
            <button className="btn primary compact" type="submit" disabled={busy}>
              {ep.saving ? '保存中…' : ep.probe === 'probing' ? '正在连接…' : '测试并保存'}
            </button>
            {custom ? (
              <button
                className="btn ghost compact"
                type="button"
                disabled={busy}
                onClick={() => {
                  touched.current = true;
                  setMode('default');
                  setEndpoint(DEFAULT_CLOUD_ENDPOINT);
                  setSharecode(DEFAULT_CLOUD_SHARECODE);
                  ep.clearProbe();
                  void ep.resetToDefault();
                }}
              >
                <RotateCcw size={12} />恢复官方云
              </button>
            ) : null}
          </div>

          {ep.error ? <p className="cloud-error">{ep.error}</p> : null}
          {ep.probe === 'ok' ? (
            <p className="cloud-endpoint-result ok">
              <Check size={12} />已连接 · {ep.probeOrigin || ep.endpoint}
            </p>
          ) : null}
          {ep.probe === 'fail' ? (
            <p className="cloud-endpoint-result fail">
              <AlertCircle size={12} />{ep.probeMessage}
            </p>
          ) : null}

          <p className="cloud-dialog-hint">
            地址必须是已部署的 ShotFlow 云桥页。切换后本机项目会备份到新云端，
            <strong>本机文件不会删除</strong>；两个云端的账号互不相通，需要重新扫码。
          </p>
        </form>
      ) : null}
    </section>
  );
}
