/// <reference types="vite/client" />

interface ElectronBridge {
  isElectron: boolean;
  getVersion: () => Promise<string>;
  setTheme: (dark: boolean) => void;
  checkUpdate: (repo: string) => Promise<
    | {
      ok: true;
      release: {
        version: string;
        tag: string;
        url: string;
        name: string;
        notes: string;
        publishedAt: string;
      };
    }
    | { ok: false; error: string }
  >;
  openProject: () => Promise<{ canceled?: boolean; text?: string; filePath?: string }>;
  saveProject: (payload: { text: string; filePath?: string | null }) => Promise<{ canceled?: boolean; filePath?: string }>;
  exportFile: (payload: { base64: string; defaultName: string }) => Promise<{ canceled?: boolean; filePath?: string }>;
  loadAutosave: () => Promise<string | null>;
  writeAutosave: (text: string) => Promise<boolean>;
  clearAutosave: () => Promise<boolean>;
  libraryLoadIndex: () => Promise<string | null>;
  librarySaveIndex: (text: string) => Promise<boolean>;
  libraryReadProject: (id: string) => Promise<string | null>;
  libraryWriteProject: (payload: { id: string; text: string }) => Promise<boolean>;
  libraryDeleteProject: (id: string) => Promise<boolean>;
  packageImport: () => Promise<{ canceled?: boolean; base64?: string; name?: string; filePath?: string }>;
  packageExport: (payload: { base64: string; defaultName: string }) => Promise<{ canceled?: boolean; filePath?: string }>;
  pdfExport: (payload: {
    html: string;
    defaultName: string;
    pageSize: 'A4' | 'A3';
    landscape: boolean;
    footer: string;
  }) => Promise<{ canceled?: boolean; filePath?: string }>;
  documentExport: (payload: {
    base64: string;
    defaultName: string;
    extension: string;
    label: string;
  }) => Promise<{ canceled?: boolean; filePath?: string }>;
  shareChooseDir: () => Promise<{ canceled?: boolean; dir?: string }>;
  shareReadIndex: (dir: string) => Promise<string | null>;
  shareWriteIndex: (payload: { dir: string; text: string }) => Promise<boolean>;
  shareReadPackage: (payload: { dir: string; fileName: string }) => Promise<string>;
  shareWritePackage: (payload: { dir: string; fileName: string; base64: string }) => Promise<boolean>;
  cloudCall: (
    method: string,
    params?: Record<string, unknown>,
    options?: { timeout?: number },
  ) => Promise<unknown>;
  cloudConfigGet: () => Promise<{ endpoint: string; sharecode: string; defaultEndpoint: string }>;
  cloudConfigSet: (payload: { endpoint: string; sharecode?: string }) => Promise<{
    ok: boolean;
    changed?: boolean;
    error?: string;
    endpoint?: string;
    sharecode?: string;
  }>;
  cloudSession: () => Promise<CloudSessionPayload>;
  cloudLogin: () => Promise<{ started?: boolean; signedIn?: boolean; user?: CloudUser | null }>;
  cloudLogout: () => Promise<{ ok?: boolean }>;
  onCloudEvent: (handler: (payload: { event: string; data?: unknown }) => void) => () => void;
  onMenuAction: (handler: (action: string) => void) => () => void;
}

interface CloudUser {
  id: string | null;
  name: string | null;
  avatar: string | null;
}

interface CloudSessionPayload {
  signedIn?: boolean;
  user?: CloudUser | null;
  error?: string;
  offline?: boolean;
}

interface Window {
  electronAPI?: ElectronBridge;
}
