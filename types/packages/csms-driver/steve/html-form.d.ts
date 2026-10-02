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
export declare function decodeHtml(text: string): string;
/**
 * The fields the form posting to `action` would submit, in document order, as
 * if its `submitter` button were clicked -- or `undefined` when the page has
 * no such form. `action` is relative to the manager base, as every path this
 * client takes is: `chargepoints/update` matches
 * `action="/steve/manager/chargepoints/update"`.
 */
export declare function readForm(html: string, action: string, submitter?: string): URLSearchParams | undefined;
/**
 * The text of every `<div class="error">` on a page: SteVe's validation list,
 * or the exception its controller advice rendered -- both are answered 200,
 * so this is the only place a refusal says what it was. Text only, never
 * markup: a re-rendered form echoes what was posted, password included, in
 * its `value` attributes, and none of that may reach an error message.
 */
export declare function pageErrors(html: string): string | undefined;
