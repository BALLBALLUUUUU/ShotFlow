/**
 * 云端地址配置：存在 userData/cloud.json，主进程启动时同步读取。
 *
 * 放在主进程而不是渲染层的 localStorage，是因为云宿主窗口要在启动阶段就按对的地址加载，
 * 不能等渲染层挂载后再改，否则会先连一次默认云端、产生多余的会话与请求。
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULT_TARGET = {
  endpoint: 'https://shotflow.app.workbuddy.host',
  sharecode: '3ZR6HXGIGI',
};

function configPath() {
  return path.join(app.getPath('userData'), 'cloud.json');
}

/**
 * 只做「安全闸」：域名必须是 WorkBuddy 云服务分配的。
 * 完整的格式校验与中文提示在渲染层（src/domain/cloudEndpoint.ts），
 * 这里挡的是「有人绕过界面直接写配置文件」的情况——云桥页会拿到 preload，
 * 不能允许把任意站点塞进来。
 */
function isAllowedEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint) return false;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.pathname !== '/' && url.pathname !== '') return false;
  if (url.search || url.hash) return false;
  const host = url.hostname.toLowerCase();
  return host === 'workbuddy.host'
    || host.endsWith('.workbuddy.host')
    || host === 'workbuddy.cn'
    || host.endsWith('.workbuddy.cn');
}

function sanitize(input) {
  const source = input && typeof input === 'object' ? input : {};
  const rawEndpoint = typeof source.endpoint === 'string' ? source.endpoint.trim() : '';
  const endpoint = rawEndpoint.replace(/\/+$/, '') || DEFAULT_TARGET.endpoint;
  if (!isAllowedEndpoint(endpoint)) return { error: 'endpoint_not_allowed' };

  const rawCode = typeof source.sharecode === 'string' ? source.sharecode.trim() : '';
  const sharecode = rawCode || (endpoint === DEFAULT_TARGET.endpoint ? DEFAULT_TARGET.sharecode : '');
  if (sharecode && !/^[A-Za-z0-9_-]{4,64}$/.test(sharecode)) return { error: 'sharecode_invalid' };

  return { target: { endpoint, sharecode } };
}

function readTarget() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const result = sanitize(parsed);
    return result.target || { ...DEFAULT_TARGET };
  } catch {
    // 没配过 / 文件损坏，都退回官方云
    return { ...DEFAULT_TARGET };
  }
}

function writeTarget(input) {
  const result = sanitize(input);
  if (!result.target) return result;
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(result.target, null, 2), 'utf8');
    return { target: result.target };
  } catch (error) {
    return { error: error && error.message ? error.message : 'write_failed' };
  }
}

module.exports = { DEFAULT_TARGET, readTarget, writeTarget, sanitize, isAllowedEndpoint, configPath };
