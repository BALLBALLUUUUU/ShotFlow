const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app:version'),
  setTheme: (dark) => ipcRenderer.send('theme:set', Boolean(dark)),
  checkUpdate: (repo) => ipcRenderer.invoke('update:check', repo),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (payload) => ipcRenderer.invoke('project:save', payload),
  exportFile: (payload) => ipcRenderer.invoke('project:export', payload),
  loadAutosave: () => ipcRenderer.invoke('project:loadAutosave'),
  writeAutosave: (text) => ipcRenderer.invoke('project:writeAutosave', text),
  clearAutosave: () => ipcRenderer.invoke('project:clearAutosave'),
  libraryLoadIndex: () => ipcRenderer.invoke('library:loadIndex'),
  librarySaveIndex: (text) => ipcRenderer.invoke('library:saveIndex', text),
  libraryReadProject: (id) => ipcRenderer.invoke('library:readProject', id),
  libraryWriteProject: (payload) => ipcRenderer.invoke('library:writeProject', payload),
  libraryDeleteProject: (id) => ipcRenderer.invoke('library:deleteProject', id),
  packageImport: () => ipcRenderer.invoke('package:import'),
  packageExport: (payload) => ipcRenderer.invoke('package:export', payload),
  pdfExport: (payload) => ipcRenderer.invoke('pdf:export', payload),
  documentExport: (payload) => ipcRenderer.invoke('document:export', payload),
  shareChooseDir: () => ipcRenderer.invoke('share:chooseDir'),
  shareReadIndex: (dir) => ipcRenderer.invoke('share:readIndex', dir),
  shareWriteIndex: (payload) => ipcRenderer.invoke('share:writeIndex', payload),
  shareReadPackage: (payload) => ipcRenderer.invoke('share:readPackage', payload),
  shareWritePackage: (payload) => ipcRenderer.invoke('share:writePackage', payload),
  cloudCall: (method, params, options) => ipcRenderer.invoke('cloud:call', {
    method,
    params,
    timeout: options && Number.isFinite(options.timeout) ? options.timeout : undefined,
  }),
  cloudConfigGet: () => ipcRenderer.invoke('cloud:config:get'),
  cloudConfigSet: (payload) => ipcRenderer.invoke('cloud:config:set', payload),
  cloudSession: () => ipcRenderer.invoke('cloud:session'),
  cloudLogin: () => ipcRenderer.invoke('cloud:login'),
  cloudLogout: () => ipcRenderer.invoke('cloud:logout'),
  onCloudEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('cloud:event', listener);
    return () => ipcRenderer.removeListener('cloud:event', listener);
  },
  onMenuAction: (handler) => {
    const listener = (_event, action) => handler(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
});
