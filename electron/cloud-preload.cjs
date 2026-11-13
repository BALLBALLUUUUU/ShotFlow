/**
 * 托管页（正式域名）与主进程之间的消息通道。
 * 这个 preload 只挂到云桥窗口上，不接触主窗口。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shotflowCloud', {
  send: (message) => ipcRenderer.send('cloud:msg', message),
  onMessage: (handler) => {
    ipcRenderer.on('cloud:msg', (_event, message) => handler(message));
  },
});
