import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const plain = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

async function waitFor(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 4000;
    while (!check()) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for the terminal prompt");
        await Bun.sleep(10);
    }
}

test.skipIf(process.platform === "win32")("root training command keeps name and selection prompts visible while typing", async () => {
    const directory = mkdtempSync(join(tmpdir(), "training-terminal-"));
    let output = "";
    const child = Bun.spawn([process.execPath, "run", "training", "connect"], {
        cwd: repository,
        env: { ...process.env, FUELD_B_PATH: join(directory, "test.sqlite") },
        terminal: { cols: 100, rows: 24, data(_terminal, chunk) { output += new TextDecoder().decode(chunk); } },
    });
    try {
        await waitFor(() => plain(output).includes("Your name: "));
        child.terminal!.write("Alex");
        await waitFor(() => plain(output).includes("Your name: Alex"));
        child.terminal!.write("\r");
        await waitFor(() => plain(output).includes("Choose a number: "));
        child.terminal!.write("1");
        await waitFor(() => plain(output).includes("Choose a number: 1"));
        const redraw = output.length;
        child.terminal!.write("\x0c");
        await waitFor(() => plain(output.slice(redraw)).includes("Choose a number: 1"));
        child.terminal!.write("\r");
        await waitFor(() => plain(output).includes("Final Surge email: "));
        child.terminal!.write("test@example.invalid");
        await waitFor(() => plain(output).includes("Final Surge email: test@example.invalid"));
        // Stop before credentials, authentication, or profile creation.
        child.terminal!.write("\x03");
        await child.exited;
        expect(plain(output)).toContain("Your name: Alex");
        expect(plain(output)).toContain("Choose a number: 1");
    } finally {
        child.kill(); await child.exited; child.terminal?.close();
        rmSync(directory, { recursive: true, force: true });
    }
}, 10000);

test.skipIf(process.platform === "win32")("successive visible and password prompts preserve labels without echoing the password", async () => {
    let output = "";
    const child = Bun.spawn([process.execPath, "-e", `
        import { terminalQuestion } from "./packages/fueld_b/src/training/cli.ts";
        await terminalQuestion("Your name");
        const password = await terminalQuestion("Password", true);
        console.log("Password length:", password.length);
        await terminalQuestion("Next question");
    `], {
        cwd: repository,
        terminal: { cols: 100, rows: 24, data(_terminal, chunk) { output += new TextDecoder().decode(chunk); } },
    });
    try {
        await waitFor(() => plain(output).includes("Your name: "));
        child.terminal!.write("Alex\r");
        await waitFor(() => plain(output).includes("Password: "));
        child.terminal!.write("synthetic-secret\r");
        await waitFor(() => plain(output).includes("Next question: "));
        expect(output).not.toContain("synthetic-secret");
        expect(plain(output)).toContain("Password length: 16");
        child.terminal!.write("done\r");
        expect(await child.exited).toBe(0);
    } finally { child.kill(); await child.exited; child.terminal?.close(); }
}, 10000);
