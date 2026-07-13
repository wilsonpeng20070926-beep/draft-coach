import type { WebContents } from "electron";

const PRODUCTION_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://ddragon.leagueoflegends.com",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const DEVELOPMENT_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://ddragon.leagueoflegends.com",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export interface ElectronSecurityOptions {
  developmentRenderer?: boolean;
}

export function installElectronSecurityGuards(
  webContents: WebContents,
  options: ElectronSecurityOptions = {},
): void {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event) => event.preventDefault());
  webContents.on("will-attach-webview", (event) => event.preventDefault());

  webContents.session.setPermissionCheckHandler(() => false);
  webContents.session.setPermissionRequestHandler(
    (_requestingWebContents, _permission, callback) => callback(false),
  );

  const contentSecurityPolicy = options.developmentRenderer
    ? DEVELOPMENT_CONTENT_SECURITY_POLICY
    : PRODUCTION_CONTENT_SECURITY_POLICY;

  webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (
      details.resourceType !== "mainFrame" ||
      details.webContentsId !== webContents.id
    ) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy],
      },
    });
  });
}
