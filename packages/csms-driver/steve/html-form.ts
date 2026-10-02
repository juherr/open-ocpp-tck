// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * html-form.ts -- reads a manager page the way a browser submits it.
 *
 * SteVe's charge-point forms cannot be posted from a list of field names. Its
 * update overwrites every column with whatever is posted, nulls included, so a
 * form that names only the members it means to change erases the rest; and
 * its add handler dereferences the address block without checking it, so a
 * form without one is answered with a NullPointerException page (both measured
 * on the pinned image). The browser never trips on either because it posts
 * every control the page rendered. So does this: load the page, read its form,
 * change what the caller asked for, post the rest back untouched.
 *
 * It reads Spring's form-tag output, not arbitrary HTML -- attributes quoted,
 * no control nested in another, no script building the form. That is enough
 * for the pages it is pointed at, and it is a regex reader rather than a DOM
 * because this package has no runtime dependencies.
 */

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[body.toLowerCase()] ?? entity;
  });
}

function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>();
  const body = tag.replace(/^<[a-z]+/i, "").replace(/\/?>$/, "");
  for (const match of body.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    found.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return found;
}

const CONTROL = /<input\b[^>]*>|<select\b[^>]*>[\s\S]*?<\/select>|<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi;
const SKIPPED_INPUTS = new Set(["submit", "button", "image", "reset", "file"]);

/** What one control submits; `open` is its start tag and `attrs` its attributes. */
function controlValues(control: string, open: string, attrs: Map<string, string>): string[] {
  if (/^<input/i.test(control)) {
    const type = attrs.get("type")?.toLowerCase() ?? "text";
    if (SKIPPED_INPUTS.has(type)) return [];
    if ((type === "checkbox" || type === "radio") && !attrs.has("checked")) return [];
    return [attrs.get("value") ?? (type === "checkbox" || type === "radio" ? "on" : "")];
  }
  if (/^<textarea/i.test(control)) {
    // HTML drops one newline straight after the start tag, and Spring writes one.
    const content = control.slice(open.length, control.lastIndexOf("<"));
    return [decodeHtml(content).replace(/^\r?\n/, "")];
  }
  const options = [...control.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((option) => {
    const optionAttrs = attributes(`<option${option[1]}>`);
    return { selected: optionAttrs.has("selected"), value: optionAttrs.get("value") ?? decodeHtml(option[2]).trim() };
  });
  const selected = options.filter((option) => option.selected);
  if (attrs.has("multiple")) return selected.map((option) => option.value);
  // A single select with nothing marked submits its first option.
  const chosen = selected.at(-1) ?? options[0];
  return chosen === undefined ? [] : [chosen.value];
}

/**
 * The fields the form posting to `action` would submit, in document order, as
 * if its `submitter` button were clicked -- or `undefined` when the page has
 * no such form. `action` is relative to the manager base, as every path this
 * client takes is: `chargepoints/update` matches
 * `action="/steve/manager/chargepoints/update"`.
 */
export function readForm(html: string, action: string, submitter?: string): URLSearchParams | undefined {
  for (const form of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const formAction = attributes(`<form${form[1]}>`).get("action") ?? "";
    if (!formAction.endsWith(`/${action}`)) continue;
    const fields = new URLSearchParams();
    for (const control of form[2].matchAll(CONTROL)) {
      const open = /^<[^>]*>/.exec(control[0])?.[0] ?? control[0];
      const attrs = attributes(open);
      const name = attrs.get("name");
      if (!name || attrs.has("disabled")) continue;
      for (const value of controlValues(control[0], open, attrs)) fields.append(name, value);
      if (name === submitter && attrs.get("type")?.toLowerCase() === "submit") {
        fields.append(name, attrs.get("value") ?? "");
      }
    }
    return fields;
  }
  return undefined;
}

/**
 * The text of every `<div class="error">` on a page: SteVe's validation list,
 * or the exception its controller advice rendered -- both are answered 200,
 * so this is the only place a refusal says what it was. Text only, never
 * markup: a re-rendered form echoes what was posted, password included, in
 * its `value` attributes, and none of that may reach an error message.
 */
export function pageErrors(html: string): string | undefined {
  const texts = [...html.matchAll(/<div\b[^>]*class="error"[^>]*>([\s\S]*?)<\/div>/gi)].map((div) =>
    decodeHtml(div[1].replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .replace(/\s*You can go back or, for more detail, view the log\s*$/, "")
      .trim(),
  ).filter((text) => text !== "");
  return texts.length === 0 ? undefined : texts.join("; ");
}
