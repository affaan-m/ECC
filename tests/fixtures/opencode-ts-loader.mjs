import { readFile } from "node:fs/promises"
import ts from "typescript"

// Emulate OpenCode's in-place TypeScript loading without remapping missing
// .js specifiers to .ts files. Such remapping would hide issue #3112.
export async function load(url, context, nextLoad) {
  if (!url.endsWith(".ts")) return nextLoad(url, context)

  const source = await readFile(new URL(url), "utf8")
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
    },
  })
  return { format: "module", source: result.outputText, shortCircuit: true }
}
