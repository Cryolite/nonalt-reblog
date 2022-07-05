export {}

declare global {
    interface Window {
        nonaltReblog: {
          tabId: number | null;
          extensionId: string | null;
          activeElement: Element | null;
          preflight: boolean;
        };
    }
}
