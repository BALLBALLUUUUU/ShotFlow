/**
 * 开发模式启动器。
 * 某些终端环境（如 WorkBuddy 内嵌终端）会注入 ELECTRON_RUN_AS_NODE=1，
 * 导致 electron 二进制被当成 Node REPL 启动、命令行参数报 bad option。
 * 这里显式剔除该变量与 NODE_OPTIONS 后再拉起真正的 Electron 窗口。
 */
const { spawn } = require('node:child_process');
const electronBinary = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
env.VITE_DEV_SERVER_URL = env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

const child = spawn(electronBinary, ['.'], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (error) => {
  console.error('无法启动 Electron：', error.message);
  process.exit(1);
});
