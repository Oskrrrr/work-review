/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface Window {
  workReviewDesktop?: {
    platform?: string;
    isDesktop?: boolean;
    clearWpsSession?: () => Promise<{ removed?: number } | void>;
    personalWpsStatus?: () => Promise<{ available: boolean; authenticated: boolean; message?: string }>;
    personalWpsLogin?: () => Promise<{ available: boolean; authenticated: boolean; message?: string }>;
    personalWpsSearch?: (keyword?: string) => Promise<{ files: Array<{ id: string; driveId?: string; parentId?: string; name: string; size?: number; modifiedAt?: string; type?: string }> }>;
    personalWpsDownload?: (file: { id: string; driveId?: string; name?: string }) => Promise<{ name: string; bytes: Uint8Array }>;
    openExternal?: (url: string) => Promise<void>;
  };
}
