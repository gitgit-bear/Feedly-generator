import { spawn } from "child_process";
import { existsSync } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { buildReportPdf } from "./exportPdf";
import type { ReportPayload } from "./reportPayload";

const CHROMIUM_PACK =
  "https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar";

function vendorFile(name: string): string {
  return path.join(process.cwd(), "vendor", name);
}

function fontFile(name: string): string {
  return path.join(process.cwd(), "templates", "fonts", name);
}

function localChrome(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function runPython(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const candidates = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
  const tryOne = (cmd: string, extra: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(cmd, [...extra, ...args], {
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  return (async () => {
    let lastErr: unknown;
    for (const cmd of candidates) {
      const extra = cmd === "py" ? ["-3"] : [];
      try {
        return await tryOne(cmd, extra);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Python is not available");
  })();
}

async function convertDocxWithWord(docx: Uint8Array): Promise<Uint8Array | null> {
  if (process.env.VERCEL || process.platform !== "win32") return null;
  const script = path.join(process.cwd(), "scripts", "word_export_pdf.py");
  if (!existsSync(script)) return null;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "feedly-pdf-"));
  const src = path.join(tmp, "in.docx");
  const dst = path.join(tmp, "out.pdf");
  try {
    await fs.writeFile(src, docx);
    const result = await Promise.race([
      runPython([script, src, dst]),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Word PDF export timed out")), 60_000);
      }),
    ]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "Word PDF export failed");
    }
    return new Uint8Array(await fs.readFile(dst));
  } catch (err) {
    console.error("[report] Word PDF export of filled sample failed", err);
    return null;
  } finally {
    await new Promise((r) => setTimeout(r, 200));
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function fontFace(family: string, file: string, style = "normal"): Promise<string> {
  if (!existsSync(file)) return "";
  const b64 = Buffer.from(await fs.readFile(file)).toString("base64");
  return `@font-face{font-family:'${family}';font-style:${style};font-weight:400;src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
}

async function convertDocxWithChromium(docx: Uint8Array): Promise<Uint8Array> {
  const puppeteer = (await import("puppeteer-core")).default;
  const jszipPath = vendorFile("jszip.min.js");
  const previewPath = vendorFile("docx-preview.js");
  const [jszip, preview, cambria, cambriaItalic] = await Promise.all([
    fs.readFile(jszipPath, "utf8"),
    fs.readFile(previewPath, "utf8"),
    fontFace("Cambria", fontFile("Caladea-Regular.ttf")),
    fontFace("Cambria", fontFile("Caladea-Italic.ttf"), "italic"),
  ]);

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
${cambria}${cambriaItalic}
html, body { margin: 0; background: #fff; }
@page { size: A4; margin: 0; }
.docx-wrapper { padding: 0 !important; background: #fff !important; }
.docx-wrapper > section.docx { box-shadow: none !important; margin: 0 auto !important; }
</style>
</head>
<body>
<div id="container"></div>
<script>${jszip}</script>
<script>${preview}</script>
</body>
</html>`;

  const launch = async () => {
    if (process.env.VERCEL) {
      const chromium = (await import("@sparticuz/chromium-min")).default;
      chromium.setGraphicsMode = false;
      const args = puppeteer.defaultArgs({ args: chromium.args, headless: "shell" });
      return puppeteer.launch({
        args: args instanceof Promise ? await args : args,
        executablePath: await chromium.executablePath(CHROMIUM_PACK),
        headless: "shell",
      });
    }
    const executablePath = localChrome();
    if (!executablePath) throw new Error("Chrome/Edge was not found");
    return puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });
  };

  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const api = (window as Window & { docx?: { renderAsync: Function } }).docx;
      if (!api) throw new Error("docx-preview failed to load");
      await api.renderAsync(bytes, document.getElementById("container"), undefined, {
        inWrapper: true,
        hideWrapperOnPrint: true,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        ignoreLastRenderedPageBreak: false,
        useBase64URL: true,
      });
    }, Buffer.from(docx).toString("base64"));
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return new Uint8Array(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function convertFilledDocxToPdf(docx: Uint8Array, payload: ReportPayload): Promise<Uint8Array> {
  const fromWord = await convertDocxWithWord(docx);
  if (fromWord) return fromWord;
  try {
    return await convertDocxWithChromium(docx);
  } catch (err) {
    console.error("[report] Chromium conversion of filled sample failed", err);
    return buildReportPdf(payload);
  }
}
