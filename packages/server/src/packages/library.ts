import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PackageBlockDef, PackageManifest } from "@agent-canvas/shared";

const LIBRARY_DIR = resolve(__dirname, "library");

interface BlockFileDef extends Omit<PackageBlockDef, "html" | "js" | "css"> {
  htmlFile: string;
  jsFile: string;
  cssFile?: string;
}

type ManifestFile = Omit<PackageManifest, "blocks"> & { blocks: BlockFileDef[] };

/**
 * Biblioteca de pacotes prontos: uma pasta por pacote com `manifest.json` (metadados, conexoes que pede,
 * colecoes, canvases) e os arquivos dos componentes (.html/.css/.js) ao lado.
 */
export function loadLibrary(): PackageManifest[] {
  if (!existsSync(LIBRARY_DIR)) return [];
  const out: PackageManifest[] = [];
  for (const entry of readdirSync(LIBRARY_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(LIBRARY_DIR, entry.name);
    const file = join(dir, "manifest.json");
    if (!existsSync(file)) continue;
    try {
      const m = JSON.parse(readFileSync(file, "utf8")) as ManifestFile;
      const read = (name?: string) => (name ? readFileSync(join(dir, name), "utf8") : "");
      out.push({ ...m, blocks: m.blocks.map(({ htmlFile, jsFile, cssFile, ...b }) => ({ ...b, html: read(htmlFile), css: read(cssFile), js: read(jsFile) })) });
    } catch (err) {
      console.warn(`[agent-canvas] pacote "${entry.name}" ignorado: ${err instanceof Error ? err.message : err}`);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
