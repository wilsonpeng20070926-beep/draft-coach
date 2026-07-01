import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_APP_CONFIG,
  type AppConfig,
  type AppConfigPatch,
  mergeAppConfig,
  sanitizeAppConfig,
} from "../../shared/config";

export class AppConfigStore {
  private current: AppConfig | null = null;

  constructor(private readonly configPath: string) {}

  async load(): Promise<AppConfig> {
    const parsed = await this.readConfigFile();
    const config = sanitizeAppConfig(parsed ?? DEFAULT_APP_CONFIG);
    this.current = config;
    await this.persist(config);
    return config;
  }

  get(): AppConfig {
    if (!this.current) {
      throw new Error("App config has not been loaded");
    }

    return this.current;
  }

  async set(patch: AppConfigPatch): Promise<AppConfig> {
    const config = mergeAppConfig(this.get(), patch);
    this.current = config;
    await this.persist(config);
    return config;
  }

  async reset(): Promise<AppConfig> {
    this.current = DEFAULT_APP_CONFIG;
    await this.persist(DEFAULT_APP_CONFIG);
    return DEFAULT_APP_CONFIG;
  }

  private async readConfigFile(): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(this.configPath, "utf8")) as unknown;
    } catch {
      return null;
    }
  }

  private async persist(config: AppConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
}

export function createAppConfigStore(userDataDirectory: string): AppConfigStore {
  return new AppConfigStore(join(userDataDirectory, "config.json"));
}
