import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { installElectronSecurityGuards } from "../src/main/security/electronSecurity";

describe("Electron security boundary", () => {
  it("denies popups, navigation, webviews, and runtime permissions", () => {
    const listeners = new Map<string, (event: { preventDefault(): void }) => void>();
    let windowOpenHandler: () => { action: string } = () => {
      throw new Error("window-open handler was not installed");
    };
    let permissionCheckHandler: () => boolean = () => {
      throw new Error("permission-check handler was not installed");
    };
    let permissionRequestHandler:
      (_webContents: unknown, _permission: string, callback: (allowed: boolean) => void) => void =
      () => {
        throw new Error("permission-request handler was not installed");
      };
    let headersReceivedHandler: (
      details: {
        resourceType: string;
        webContentsId: number;
        responseHeaders: Record<string, string[]>;
      },
      callback: (result: { responseHeaders?: Record<string, string[]> }) => void,
    ) => void = () => {
      throw new Error("headers-received handler was not installed");
    };

    const webContents = {
      id: 7,
      setWindowOpenHandler(handler: () => { action: string }) {
        windowOpenHandler = handler;
      },
      on(event: string, listener: (event: { preventDefault(): void }) => void) {
        listeners.set(event, listener);
        return this;
      },
      session: {
        setPermissionCheckHandler(handler: () => boolean) {
          permissionCheckHandler = handler;
        },
        setPermissionRequestHandler(
          handler: (
            webContents: unknown,
            permission: string,
            callback: (allowed: boolean) => void,
          ) => void,
        ) {
          permissionRequestHandler = handler;
        },
        webRequest: {
          onHeadersReceived(handler: typeof headersReceivedHandler) {
            headersReceivedHandler = handler;
          },
        },
      },
    } as unknown as Parameters<typeof installElectronSecurityGuards>[0];

    installElectronSecurityGuards(webContents);

    expect(windowOpenHandler()).toEqual({ action: "deny" });
    expect(permissionCheckHandler()).toBe(false);

    const permissionCallback = vi.fn();
    permissionRequestHandler({}, "camera", permissionCallback);
    expect(permissionCallback).toHaveBeenCalledWith(false);

    for (const eventName of ["will-navigate", "will-attach-webview"]) {
      const event = { preventDefault: vi.fn() };
      listeners.get(eventName)?.(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }

    let responseHeaders: Record<string, string[]> | undefined;
    headersReceivedHandler(
      { resourceType: "mainFrame", webContentsId: 7, responseHeaders: {} },
      (result) => {
        responseHeaders = result.responseHeaders;
      },
    );

    const policy = responseHeaders?.["Content-Security-Policy"]?.[0] ?? "";
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain("unsafe-eval");
  });

  it("keeps the packaged renderer sandboxed and does not expose raw LCU sessions", async () => {
    const [mainSource, ipcSource, preloadSource] = await Promise.all([
      readFile(join(process.cwd(), "src/main/index.ts"), "utf8"),
      readFile(join(process.cwd(), "src/main/ipc.ts"), "utf8"),
      readFile(join(process.cwd(), "src/main/preload.ts"), "utf8"),
    ]);

    expect(mainSource).toContain("contextIsolation: true");
    expect(mainSource).toContain("nodeIntegration: false");
    expect(mainSource).toContain("sandbox: true");
    expect(mainSource).toContain("!app.isPackaged && process.env.ELECTRON_RENDERER_URL");
    expect(`${ipcSource}\n${preloadSource}`).not.toContain("champSelectSession");
  });
});
