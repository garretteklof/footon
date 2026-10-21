import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { GarminAuthError } from "@/errors";
import { validateTokens, type Tokens } from "./tokens";

export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  #tokens: Tokens | null = null;
  async load(): Promise<Tokens | null> { return this.#tokens ? structuredClone(this.#tokens) : null; }
  async save(tokens: Tokens): Promise<void> {
    this.#tokens = validateTokens(tokens);
    if (!this.#tokens) throw new GarminAuthError("Cannot store an invalid DI token set");
  }
  async clear(): Promise<void> { this.#tokens = null; }
}

/** Stores one DI token pair in `garmin_tokens.json` with owner-only permissions. */
export class FileTokenStore implements TokenStore {
  readonly #file: string;
  constructor(path: string) {
    const absolute = resolve(path);
    this.#file = absolute.endsWith(".json") ? absolute : join(absolute, "garmin_tokens.json");
  }

  async load(): Promise<Tokens | null> {
    try {
      const stat = await lstat(this.#file);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new GarminAuthError("Token store must be a regular file, not a symlink");
      const value: unknown = JSON.parse(await readFile(this.#file, "utf8"));
      return validateTokens(value);
    } catch (error) {
      if (isMissing(error)) return null;
      if (error instanceof GarminAuthError) throw error;
      return null;
    }
  }

  async save(tokens: Tokens): Promise<void> {
    const valid = validateTokens(tokens);
    if (!valid) throw new GarminAuthError("Cannot store an invalid DI token set");
    const directory = dirname(this.#file);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    try {
      const stat = await lstat(this.#file);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new GarminAuthError("Token store must be a regular file, not a symlink");
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const temporary = join(directory, `.${basename(this.#file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(valid, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(temporary, 0o600);
      await rename(temporary, this.#file);
      await chmod(this.#file, 0o600);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async clear(): Promise<void> { await rm(this.#file, { force: true }); }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
