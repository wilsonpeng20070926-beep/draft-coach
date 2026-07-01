import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import {
  LeagueClient,
  authenticate,
  connect,
  request,
  type Credentials,
  type LeagueWebSocket,
} from "league-connect";

export type Phase =
  | "None"
  | "Lobby"
  | "Matchmaking"
  | "ReadyCheck"
  | "ChampSelect"
  | "GameStart"
  | "InProgress"
  | "WaitingForStats"
  | "EndOfGame"
  | string;

export interface LcuAdapterEvents {
  connected: () => void;
  disconnected: () => void;
  phaseChanged: (phase: Phase) => void;
  champSelectSession: (raw: unknown) => void;
  error: (err: Error) => void;
}

type LcuAdapterEvent = keyof LcuAdapterEvents;

const AUTH_POLL_INTERVAL_MS = 2500;
const SOCKET_RECOVERY_DELAY_MS = 2000;
const execFileAsync = promisify(execFile);

export class LcuAdapter extends EventEmitter {
  private credentials: Credentials | null = null;
  private ws: LeagueWebSocket | null = null;
  private client: LeagueClient | null = null;
  private startPromise: Promise<void> | null = null;
  private socketRecoveryTimer: NodeJS.Timeout | null = null;
  private stopped = true;

  on<K extends LcuAdapterEvent>(eventName: K, listener: LcuAdapterEvents[K]): this;
  on(eventName: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.on(eventName, listener);
  }

  once<K extends LcuAdapterEvent>(eventName: K, listener: LcuAdapterEvents[K]): this;
  once(eventName: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.once(eventName, listener);
  }

  off<K extends LcuAdapterEvent>(eventName: K, listener: LcuAdapterEvents[K]): this;
  off(eventName: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.off(eventName, listener);
  }

  emit<K extends LcuAdapterEvent>(
    eventName: K,
    ...args: Parameters<LcuAdapterEvents[K]>
  ): boolean;
  emit(eventName: string | symbol, ...args: unknown[]): boolean {
    return super.emit(eventName, ...args);
  }

  async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.stopped = false;
    this.startPromise = this.connectInitialClient();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  stop(): void {
    this.stopped = true;
    this.clearSocketRecoveryTimer();
    this.cleanupSocket();
    this.client?.stop();
    this.client = null;
    this.credentials = null;
  }

  private async connectInitialClient(): Promise<void> {
    const credentials = await this.authenticateCredentials();

    if (this.stopped) {
      return;
    }

    this.credentials = credentials;
    this.emit("connected");
    this.startClientMonitor(credentials);
    await this.attachToClient(credentials);
  }

  private startClientMonitor(credentials: Credentials): void {
    this.client?.stop();
    this.client = new LeagueClient(credentials, {
      pollInterval: AUTH_POLL_INTERVAL_MS,
    });

    this.client.on("disconnect", () => {
      this.credentials = null;
      this.clearSocketRecoveryTimer();
      this.cleanupSocket();
      this.emit("disconnected");
    });

    this.client.on("connect", () => {
      if (this.stopped) {
        return;
      }

      void this.handleClientReconnect().catch((error: unknown) => {
        this.emit("error", toError(error));
        this.scheduleSocketRecovery();
      });
    });

    try {
      this.client.start();
    } catch (error) {
      this.emit("error", toError(error));
    }
  }

  private async attachToClient(credentials: Credentials): Promise<void> {
    await this.openSocket(credentials);
    await this.emitCurrentPhase(credentials);
    await this.maybeEmitCurrentSession(credentials);
  }

  private async handleClientReconnect(): Promise<void> {
    const credentials = await this.authenticateCredentials();

    if (this.stopped) {
      return;
    }

    this.credentials = credentials;
    this.emit("connected");
    await this.attachToClient(credentials);
  }

  private async authenticateCredentials(): Promise<Credentials> {
    const credentials = await authenticate({
      awaitConnection: true,
      pollInterval: AUTH_POLL_INTERVAL_MS,
    });
    const correctedCredentials = await discoverLeagueClientUxCredentials();

    return correctedCredentials
      ? {
          ...credentials,
          ...correctedCredentials,
        }
      : credentials;
  }

  private async openSocket(credentials: Credentials): Promise<void> {
    this.clearSocketRecoveryTimer();
    this.cleanupSocket();
    this.ws = await connect(credentials);

    this.ws.subscribe("/lol-champ-select/v1/session", (data) => {
      this.emit("champSelectSession", data);
    });

    this.ws.subscribe("/lol-gameflow/v1/gameflow-phase", (data) => {
      if (typeof data === "string") {
        this.emit("phaseChanged", data);
      }
    });

    this.ws.on("error", (error) => {
      this.emit("error", toError(error));
      this.scheduleSocketRecovery();
    });

    this.ws.on("close", () => {
      if (!this.stopped && this.credentials) {
        this.scheduleSocketRecovery();
      }
    });
  }

  private async emitCurrentPhase(credentials: Credentials): Promise<void> {
    const response = await request<never, Phase>(
      { method: "GET", url: "/lol-gameflow/v1/gameflow-phase" },
      credentials,
    );
    const phase = await response.json();
    this.emit("phaseChanged", phase);
  }

  private async maybeEmitCurrentSession(credentials: Credentials): Promise<void> {
    try {
      const response = await request<never, unknown>(
        { method: "GET", url: "/lol-champ-select/v1/session" },
        credentials,
      );

      if (response.ok) {
        this.emit("champSelectSession", await response.json());
      }
    } catch {
      // The endpoint returns an error outside champ select; that is an idle state.
    }
  }

  private scheduleSocketRecovery(): void {
    if (this.stopped || !this.credentials || this.socketRecoveryTimer) {
      return;
    }

    this.cleanupSocket();
    this.socketRecoveryTimer = setTimeout(() => {
      this.socketRecoveryTimer = null;

      if (!this.credentials || this.stopped) {
        return;
      }

      void this.handleClientReconnect().catch((error: unknown) => {
        this.emit("error", toError(error));
        this.scheduleSocketRecovery();
      });
    }, SOCKET_RECOVERY_DELAY_MS);
  }

  private cleanupSocket(): void {
    if (!this.ws) {
      return;
    }

    const socket = this.ws;
    this.ws = null;
    socket.removeAllListeners("error");
    socket.removeAllListeners("close");

    try {
      socket.close();
    } catch {
      // Closing an already-closed socket is harmless.
    }
  }

  private clearSocketRecoveryTimer(): void {
    if (!this.socketRecoveryTimer) {
      return;
    }

    clearTimeout(this.socketRecoveryTimer);
    this.socketRecoveryTimer = null;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

interface ProcessCredentials {
  port: number;
  password: string;
  pid: number;
}

async function discoverLeagueClientUxCredentials(): Promise<ProcessCredentials | null> {
  try {
    return process.platform === "win32"
      ? await discoverWindowsLeagueClientUxCredentials()
      : await discoverPosixLeagueClientUxCredentials();
  } catch {
    return null;
  }
}

async function discoverPosixLeagueClientUxCredentials(): Promise<ProcessCredentials | null> {
  const { stdout } = await execFileAsync("ps", ["x", "-o", "pid=,args="], {
    maxBuffer: 4 * 1024 * 1024,
  });

  for (const line of stdout.split("\n")) {
    const credentials = parseLeagueClientUxProcessLine(line);

    if (credentials) {
      return credentials;
    }
  }

  return null;
}

async function discoverWindowsLeagueClientUxCredentials(): Promise<ProcessCredentials | null> {
  const command = [
    "$processes = Get-CimInstance Win32_Process -Filter \"name = 'LeagueClientUx.exe'\"",
    "$matches = $processes | Where-Object { $_.CommandLine -match '--remoting-auth-token=' -and $_.CommandLine -match '(^|\\s)--app-port=' }",
    "$matches | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", command], {
    maxBuffer: 4 * 1024 * 1024,
  });
  const trimmed = stdout.trim();

  if (!trimmed) {
    return null;
  }

  return parseWindowsProcessJson(JSON.parse(trimmed) as unknown);
}

function parseWindowsProcessJson(raw: unknown): ProcessCredentials | null {
  const entries = Array.isArray(raw) ? raw : [raw];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const processEntry = entry as {
      ProcessId?: unknown;
      CommandLine?: unknown;
    };
    const commandLine = processEntry.CommandLine;

    if (typeof commandLine !== "string") {
      continue;
    }

    const credentials = parseLeagueClientUxProcessLine(
      `${toNullableNumber(processEntry.ProcessId) ?? ""} ${commandLine}`,
    );

    if (credentials) {
      return credentials;
    }
  }

  return null;
}

function parseLeagueClientUxProcessLine(line: string): ProcessCredentials | null {
  if (
    !line.includes("LeagueClientUx") ||
    !line.includes("--remoting-auth-token=") ||
    !line.includes("--app-port=")
  ) {
    return null;
  }

  const pidMatch = /^\s*(\d+)\s+/.exec(line);
  const portMatch = /(?:^|\s)--app-port=(\d+)/.exec(line);
  const passwordMatch = /(?:^|\s)--remoting-auth-token=([^\s]+)/.exec(line);
  const appPidMatch = /(?:^|\s)--app-pid=(\d+)/.exec(line);

  if (!portMatch || !passwordMatch) {
    return null;
  }

  const fallbackPid = pidMatch ? Number(pidMatch[1]) : 0;
  const appPid = appPidMatch ? Number(appPidMatch[1]) : fallbackPid;

  return {
    port: Number(portMatch[1]),
    password: passwordMatch[1],
    pid: appPid,
  };
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
