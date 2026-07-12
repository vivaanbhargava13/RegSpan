import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve as resolvePath } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import ts from "typescript";

const root = process.cwd();
const extensions = [".ts", ".tsx", ".mjs", ".js"];

function resolveAlias(specifier) {
  const base = resolvePath(root, specifier.slice(2));
  for (const candidate of [base, ...extensions.map((extension) => `${base}${extension}`)]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  throw new Error(`Unable to resolve server module alias: ${specifier}`);
}

function resolveRelativeTypeScriptModule(specifier, parentURL) {
  if (!parentURL || extname(specifier)) return null;

  const base = resolvePath(dirname(fileURLToPath(parentURL)), specifier);
  for (const extension of extensions) {
    const candidate = `${base}${extension}`;
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return { url: resolveAlias(specifier), shortCircuit: true };
  }
  if (specifier.startsWith("next/") && !specifier.endsWith(".js")) {
    return nextResolve(`${specifier}.js`, context);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const resolved = resolveRelativeTypeScriptModule(specifier, context.parentURL);
    if (resolved) return { url: resolved, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".ts") && !url.endsWith(".tsx")) return nextLoad(url, context);
  const source = await readFile(fileURLToPath(url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: false,
    },
    fileName: fileURLToPath(url),
  }).outputText;
  return { format: "module", source: output, shortCircuit: true };
}
