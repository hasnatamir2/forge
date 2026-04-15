import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";
import { getOAuthApiKey, loginOpenAICodex, type OAuthCredentials } from "@mariozechner/pi-ai/oauth";
import type { ForgeConfig, OpenAICodexProviderConfig } from "../../config/schema.js";

const OPENAI_CODEX_PROVIDER_ID = "openai-codex";

const storedCredentialsSchema = z.record(
  z.string(),
  z.object({
    access: z.string().min(1),
    refresh: z.string().min(1),
    expires: z.number(),
    accountId: z.string().min(1).optional()
  }).catchall(z.unknown())
);

type OAuthApiKeyResolver = typeof getOAuthApiKey;
type OpenAICodexLogin = typeof loginOpenAICodex;

export class OpenAICodexAuthManager {
  constructor(
    private readonly config: ForgeConfig,
    private readonly loginFn: OpenAICodexLogin = loginOpenAICodex,
    private readonly oauthApiKeyResolver: OAuthApiKeyResolver = getOAuthApiKey
  ) {}

  async resolveApiKey(projectRoot: string, providerConfig: OpenAICodexProviderConfig): Promise<string> {
    const credentialsMap = await this.readCredentials(projectRoot);
    const resolved = await this.oauthApiKeyResolver(OPENAI_CODEX_PROVIDER_ID, credentialsMap);

    if (!resolved) {
      throw new Error(
        'OpenAI Codex login is not configured. Run "forge auth login --provider openai-codex" first.'
      );
    }

    if (resolved.newCredentials !== credentialsMap[OPENAI_CODEX_PROVIDER_ID]) {
      await this.persistCredentials(projectRoot, {
        ...credentialsMap,
        [OPENAI_CODEX_PROVIDER_ID]: resolved.newCredentials
      });
    }

    return resolved.apiKey;
  }

  async login(projectRoot: string, providerConfig: OpenAICodexProviderConfig, openBrowser = true): Promise<string> {
    await mkdir(this.getAuthDirectory(projectRoot), { recursive: true });

    const credentials = await this.loginFn({
      originator: providerConfig.originator,
      onAuth: ({ url, instructions }) => {
        output.write(`${instructions ?? "Open this URL to authenticate:"}\n${url}\n`);
        if (openBrowser) {
          this.tryOpenBrowser(url);
        }
      },
      onPrompt: async ({ message }) => {
        const rl = createInterface({ input, output });
        try {
          return (await rl.question(`${message} `)).trim();
        } finally {
          rl.close();
        }
      }
    });

    await this.persistCredentials(projectRoot, {
      [OPENAI_CODEX_PROVIDER_ID]: credentials
    });
    return this.getCredentialsPath(projectRoot);
  }

  async logout(projectRoot: string): Promise<boolean> {
    const credentialsPath = this.getCredentialsPath(projectRoot);
    if (!existsSync(credentialsPath)) {
      return false;
    }

    await rm(credentialsPath, { force: true });
    return true;
  }

  getCredentialsPath(projectRoot: string): string {
    return resolve(this.getAuthDirectory(projectRoot), "oauth.json");
  }

  private getAuthDirectory(projectRoot: string): string {
    return resolve(projectRoot, this.config.runtime.stateDir, "auth", OPENAI_CODEX_PROVIDER_ID);
  }

  private async readCredentials(projectRoot: string): Promise<Record<string, OAuthCredentials>> {
    const credentialsPath = this.getCredentialsPath(projectRoot);
    if (!existsSync(credentialsPath)) {
      return {};
    }

    const content = await readFile(credentialsPath, "utf8");
    return storedCredentialsSchema.parse(JSON.parse(content));
  }

  private async persistCredentials(
    projectRoot: string,
    credentials: Record<string, OAuthCredentials>
  ): Promise<void> {
    await mkdir(this.getAuthDirectory(projectRoot), { recursive: true });
    await writeFile(this.getCredentialsPath(projectRoot), JSON.stringify(credentials, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
  }

  private tryOpenBrowser(url: string): void {
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "cmd"
          : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore"
      });
      child.unref();
    } catch {
      // Best effort only. The login flow also prints the URL.
    }
  }
}
