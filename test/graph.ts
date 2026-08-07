import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import ts from "typescript";

/**
 * A hand-rolled import graph over `src/**`.
 *
 * ## Why not madge, and why not a regex
 *
 * A regex over source would trip on this codebase's own prose: several files
 * explain at length why nothing may import `wallet.ts`, and a text scan cannot
 * tell an explanation from an import.
 *
 * madge would report a false failure for the opposite reason. `import type { X }
 * from "./wallet"` is **erased at compile time** and is harmless — the emitted
 * JavaScript contains no reference at all — but a default dependency graph does
 * not discriminate type-only edges. A test that fails on a harmless import gets
 * silenced with an ignore rule, and an ignore rule is how the real invariant
 * eventually dies.
 *
 * So: ~90 lines, no dependency, `importKind` respected, and — the argument that
 * decides it — the failure reports the *path*
 * (`components/console.tsx → lib/commands.ts → lib/pay.ts`) rather than a
 * boolean. The message is the product here.
 */

export const SRC = resolve(import.meta.dirname, "../src");

export interface Edge {
  to: string;
  typeOnly: boolean;
}

export function sourceFiles(root: string = SRC): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if ([".ts", ".tsx"].includes(extname(full))) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out.sort();
}

export function read(file: string): string {
  return readFileSync(file, "utf8");
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    read(file),
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ false,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Resolve a specifier to an absolute file under src/, or null if external. */
function resolveSpecifier(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = join(SRC, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(from, "..", specifier);
  } else {
    return null;
  }

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // keep trying
    }
  }
  return null;
}

export function importGraph(files: string[] = sourceFiles()): Map<string, Edge[]> {
  const graph = new Map<string, Edge[]>();

  for (const file of files) {
    const edges: Edge[] = [];
    const sf = parse(file);

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const to = resolveSpecifier(file, node.moduleSpecifier.text);
        if (to) {
          // `import type X` — erased. `import { type X }` on every named binding
          // is also erased, but a mixed clause is not, so only the declaration
          // level counts as fully type-only.
          const typeOnly = node.importClause?.isTypeOnly === true;
          edges.push({ to, typeOnly });
        }
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const to = resolveSpecifier(file, node.moduleSpecifier.text);
        if (to) edges.push({ to, typeOnly: node.isTypeOnly === true });
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);
    graph.set(file, edges);
  }

  return graph;
}

/**
 * Shortest value-import path from `start` to any file in `targets`, or null.
 * Type-only edges are not traversed because they do not exist at runtime.
 */
export function findPath(
  graph: Map<string, Edge[]>,
  start: string,
  targets: ReadonlySet<string>,
): string[] | null {
  const queue: string[][] = [[start]];
  const seen = new Set([start]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const node = path[path.length - 1];
    for (const edge of graph.get(node) ?? []) {
      if (edge.typeOnly || seen.has(edge.to)) continue;
      const next = [...path, edge.to];
      if (targets.has(edge.to)) return next;
      seen.add(edge.to);
      queue.push(next);
    }
  }
  return null;
}

export function rel(file: string): string {
  return file.slice(SRC.length + 1);
}

/** Walk every node of a file, for the source-level assertions. */
export function visitFile(file: string, cb: (node: ts.Node) => void): void {
  const sf = parse(file);
  const walk = (node: ts.Node) => {
    cb(node);
    ts.forEachChild(node, walk);
  };
  walk(sf);
}

export { ts };
