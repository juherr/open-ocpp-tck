/**
 * extract-assert-inventory.ts -- renders WHAT EACH SCENARIO MEASURES into a
 * stable, diffable text form.
 *
 * Why this exists
 * ---------------
 * The vendored scenario specs used to be pinned byte-for-byte against
 * upstream, and ADR-0089 decision 1 inferred a semantic guarantee from that
 * byte-identity: "a harness that adapts its assertions to the CSMS it tests
 * measures nothing". Making the harness CSMS-neutral edits the specs, so the
 * proxy is gone and the property has to be stated directly and checked:
 *
 *   The set of checks each scenario performs, their order, their nesting, and
 *   every literal they compare against, are unchanged. Only the syntax by
 *   which a scenario asks a CSMS to act may change.
 *
 * This extractor covers the first half (`assert`). extract-drive-trace.ts
 * covers the second (`drive`). Pinning only this half is the trap: a drive()
 * that silently drops a step makes every assertion fail honestly, but a
 * drive() that issues an operation twice, or loses a wait gate, produces green
 * for the wrong reason.
 *
 * Why a committed text file rather than a digest
 * ----------------------------------------------
 * A digest tells a reviewer THAT something changed; this tells them WHAT, in
 * the pull-request diff, with no tooling. A hash bump is a one-character diff
 * nobody can evaluate, so it gets waved through.
 *
 * Rendering rules (all chosen so a pure rename produces ZERO diff)
 * ---------------------------------------------------------------
 *  - Only the `assert` body is walked. `drive` is skipped entirely: that is
 *    where the driver refactor lives.
 *  - Emitted calls are those whose name starts with `assert` (which covers the
 *    assert.ts DSL and the specs' own assert* helpers) plus rec.pass/fail/skip.
 *  - Literal arguments render verbatim: strings, regexes, numbers, booleans,
 *    null, and array/object literals whose members are themselves literals.
 *  - EVERY non-literal argument renders as `·`, identifiers included. That is
 *    what makes renaming `db` to `records` or `rec` to `recorder` invisible
 *    here while flipping "Accepted" to "Rejected" is not.
 *  - Control flow (IF/ELSE/FOR/WHILE/TRY/CATCH/TERNARY/AND/OR/RETURN/AWAIT-OF)
 *    emits a token and indents what it contains, so moving an assertion into
 *    or out of a branch shows up.
 *
 * Known limits -- stated here because a guarantee that oversells itself is
 * worse than none:
 *  - A non-literal argument is `·`, so `assertEq(rec, computeExpected(), ...)`
 *    could change meaning invisibly. No spec does this today.
 *  - A helper's CALL is pinned, and helpers named assert* also get their own
 *    inventoried section, but a helper NOT named assert* that wrapped
 *    assertions would be a real hole.
 *  - Nothing here proves the assertions are CORRECT. It proves they are
 *    UNCHANGED, which is the only property ADR-0089 ever claimed.
 */
import * as ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SPECS_DIR = process.argv[2] ?? "runner/specs";

const ASSERTION_CALL = /^assert[A-Za-z0-9_]*$/;
const RECORDER_METHOD = /^(pass|fail|skip)$/;

/** Renders one argument. Literals verbatim, everything else `·`. */
function renderArg(node: ts.Node): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return JSON.stringify(node.text);
  }
  if (ts.isRegularExpressionLiteral(node) || ts.isNumericLiteral(node)) {
    return node.getText();
  }
  if (
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  ) {
    return node.getText();
  }
  if (ts.isArrayLiteralExpression(node)) {
    const parts = node.elements.map(renderArg);
    return parts.some((p) => p === "·") ? "·" : `[${parts.join(",")}]`;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const parts: string[] = [];
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop) || !prop.name) return "·";
      const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
        ? prop.name.text
        : null;
      if (key === null) return "·";
      const value = renderArg(prop.initializer);
      if (value === "·") return "·";
      parts.push(`${key}:${value}`);
    }
    return `{${parts.join(",")}}`;
  }
  // Identifiers, property accesses, calls, template expressions with
  // substitutions, `await` results -- deliberately opaque.
  return "·";
}

/** The callee name we key on, or null if this call is not an assertion. */
function assertionName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee) && ASSERTION_CALL.test(callee.text)) {
    return callee.text;
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.name) &&
    RECORDER_METHOD.test(callee.name.text)
  ) {
    // `rec.pass(...)` -- the receiver is rendered opaquely on purpose, so
    // renaming the recorder binding does not move the artifact.
    return `·.${callee.name.text}`;
  }
  return null;
}

/**
 * Emits a control-flow token for nodes that change WHEN an assertion runs.
 * Anything not listed here is structurally transparent and is walked without
 * a token, so incidental syntax (parentheses, blocks, awaits of plain calls)
 * does not pollute the artifact.
 */
function controlToken(node: ts.Node): string | null {
  switch (node.kind) {
    case ts.SyntaxKind.IfStatement:
      return "IF";
    case ts.SyntaxKind.ConditionalExpression:
      return "TERNARY";
    case ts.SyntaxKind.ForOfStatement:
      return "FOROF";
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
      return "FOR";
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
      return "WHILE";
    case ts.SyntaxKind.TryStatement:
      return "TRY";
    case ts.SyntaxKind.CatchClause:
      return "CATCH";
    case ts.SyntaxKind.SwitchStatement:
      return "SWITCH";
    case ts.SyntaxKind.ReturnStatement:
      return "RETURN";
    case ts.SyntaxKind.BinaryExpression: {
      const op = (node as ts.BinaryExpression).operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) return "AND";
      if (op === ts.SyntaxKind.BarBarToken) return "OR";
      if (op === ts.SyntaxKind.QuestionQuestionToken) return "NULLISH";
      return null;
    }
    default:
      return null;
  }
}

function walk(node: ts.Node, depth: number, out: string[]): void {
  const pad = "  ".repeat(depth);

  if (ts.isCallExpression(node)) {
    const name = assertionName(node);
    if (name !== null) {
      const args = node.arguments.map(renderArg).join(", ");
      out.push(`${pad}${name}(${args})`);
      // Do not descend: a nested call inside an assertion's arguments is
      // already rendered as `·`, and descending would emit it twice.
      return;
    }
  }

  const token = controlToken(node);
  if (token !== null) {
    out.push(`${pad}${token}`);
    ts.forEachChild(node, (child) => walk(child, depth + 1, out));
    return;
  }

  ts.forEachChild(node, (child) => walk(child, depth, out));
}

/** The `assert` property of a spec object literal, whatever syntax declared it. */
function assertBody(spec: ts.ObjectLiteralExpression): ts.Node | null {
  for (const prop of spec.properties) {
    if (!prop.name || !ts.isIdentifier(prop.name) || prop.name.text !== "assert") {
      continue;
    }
    if (ts.isMethodDeclaration(prop) && prop.body) return prop.body;
    if (ts.isPropertyAssignment(prop)) {
      const init = prop.initializer;
      if (
        (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
        init.body
      ) {
        return init.body;
      }
    }
  }
  return null;
}

function literalProp(
  spec: ts.ObjectLiteralExpression,
  name: string,
): string | null {
  for (const prop of spec.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      prop.name &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === name
    ) {
      const rendered = renderArg(prop.initializer);
      return rendered === "·" ? null : rendered;
    }
  }
  return null;
}

const out: string[] = [];
out.push("# ASSERT-INVENTORY -- what each scenario measures.");
out.push("# Generated by tests/ocpp-verify/extract-assert-inventory.ts. Do not hand-edit.");
out.push("# A diff here means a scenario's checks changed. See the test's header.");

for (const file of readdirSync(SPECS_DIR).filter((f) => f.endsWith(".ts")).sort()) {
  const path = join(SPECS_DIR, file);
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
  );

  out.push("");
  out.push(`FILE ${file}`);

  // Helpers first: a file-level function named assert* is assertions in a
  // trench coat, and its body must be pinned too or moving a check into one
  // would erase it from this artifact.
  for (const stmt of source.statements) {
    let name: string | null = null;
    let body: ts.Node | null = null;
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      name = stmt.name.text;
      body = stmt.body;
    } else if (ts.isVariableStatement(stmt)) {
      const decl = stmt.declarationList.declarations[0];
      if (
        decl &&
        ts.isIdentifier(decl.name) &&
        decl.initializer &&
        (ts.isArrowFunction(decl.initializer) ||
          ts.isFunctionExpression(decl.initializer))
      ) {
        name = decl.name.text;
        body = decl.initializer.body;
      }
    }
    if (name === null || body === null || !ASSERTION_CALL.test(name)) continue;
    out.push(`  HELPER ${name}`);
    walk(body, 2, out);
  }

  // Then the scenarios, in source order.
  for (const stmt of source.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) {
        continue;
      }
      const spec = decl.initializer;
      const templateId = literalProp(spec, "templateId");
      if (templateId === null) continue;

      const meta = ["connector", "bootWaitSecs", "holdSecs"]
        .map((k) => `${k}=${literalProp(spec, k) ?? "default"}`)
        .join(" ");
      out.push(`  SPEC ${JSON.parse(templateId)} ${meta}`);

      const body = assertBody(spec);
      if (body === null) {
        out.push("    <no assert body>");
        continue;
      }
      walk(body, 2, out);
    }
  }
}

process.stdout.write(out.join("\n") + "\n");
