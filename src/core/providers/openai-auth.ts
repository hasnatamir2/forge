import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";
import type { ForgeConfig, OpenAIProviderConfig } from "../../config/schema.js";

const OPENAI_API_KEYS_URL =
    "https://platform.openai.com/settings/organization/api-keys";

const storedLoginStateSchema = z.object({
    apiKey: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    source: z.literal("browser_assisted_login"),
});

type StoredLoginState = z.infer<typeof storedLoginStateSchema>;

export class OpenAIAuthManager {
    constructor(private readonly config: ForgeConfig) {}

    async resolveApiKey(
        projectRoot: string,
        providerConfig: OpenAIProviderConfig,
    ): Promise<string> {
        if (providerConfig.authMode === "api_key") {
            const apiKey = process.env[providerConfig.apiKeyEnvVar];
            if (!apiKey) {
                throw new Error(
                    `Missing OpenAI API key. Set ${providerConfig.apiKeyEnvVar} or switch to login mode with "forge auth login --provider openai".`,
                );
            }

            return apiKey;
        }

        const loginState = await this.readLoginState(projectRoot);
        if (!loginState) {
            throw new Error(
                'OpenAI login mode is not configured. Run "forge auth login --provider openai" to link a local credential first.',
            );
        }

        return loginState.apiKey;
    }

    async login(
        projectRoot: string,
        apiKeyOverride?: string,
        openBrowser = true,
    ): Promise<string> {
        await mkdir(this.getAuthDirectory(projectRoot), { recursive: true });
        if (openBrowser) {
            this.tryOpenBrowser();
        }

        const apiKey = apiKeyOverride ?? (await promptForApiKey());
        if (!apiKey) {
            throw new Error("No API key provided. Login was cancelled.");
        }

        const now = new Date().toISOString();
        const nextState: StoredLoginState = {
            apiKey,
            createdAt: now,
            updatedAt: now,
            source: "browser_assisted_login",
        };

        const statePath = this.getLoginStatePath(projectRoot);
        await writeFile(statePath, JSON.stringify(nextState, null, 2), {
            encoding: "utf8",
            mode: 0o600,
        });
        return statePath;
    }

    async logout(projectRoot: string): Promise<boolean> {
        const statePath = this.getLoginStatePath(projectRoot);
        if (!existsSync(statePath)) {
            return false;
        }

        await rm(statePath, { force: true });
        return true;
    }

    getLoginStatePath(projectRoot: string): string {
        return resolve(this.getAuthDirectory(projectRoot), "login.json");
    }

    private getAuthDirectory(projectRoot: string): string {
        return resolve(
            projectRoot,
            this.config.runtime.stateDir,
            "auth",
            "openai",
            "login",
        );
    }

    private async readLoginState(
        projectRoot: string,
    ): Promise<StoredLoginState | null> {
        const statePath = this.getLoginStatePath(projectRoot);
        if (!existsSync(statePath)) {
            return null;
        }

        const content = await readFile(statePath, "utf8");
        return storedLoginStateSchema.parse(JSON.parse(content));
    }

    private tryOpenBrowser(): void {
        const command =
            process.platform === "darwin"
                ? "open"
                : process.platform === "win32"
                  ? "cmd"
                  : "xdg-open";
        const args =
            process.platform === "win32"
                ? ["/c", "start", "", OPENAI_API_KEYS_URL]
                : [OPENAI_API_KEYS_URL];

        try {
            const child = spawn(command, args, {
                detached: true,
                stdio: "ignore",
            });
            child.unref();
        } catch {
            // Best-effort only. The CLI also prints the URL after login starts.
        }
    }
}

async function promptForApiKey(): Promise<string> {
    const rl = createInterface({ input, output });
    try {
        output.write(
            `OpenAI login mode uses a browser-assisted local credential flow.\nOpen ${OPENAI_API_KEYS_URL} if a browser did not launch, then paste the API key here.\n`,
        );
        const apiKey = (await rl.question("OpenAI API key: ")).trim();
        return apiKey;
    } finally {
        rl.close();
    }
}
