// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * A SteVe manager UI that reaches no SteVe, for the charge-point rows of
 * tests/csms-driver-charge-points.ts: sign-in, the add form, the list query,
 * the details form, update and delete.
 *
 * What it models is what the pinned image (steve-3.15.0) was MEASURED to do,
 * and each of these is a way the adapter could be wrong while a kinder fake
 * stayed green:
 *  - every refusal is a 200 page -- the validation list re-rendered with the
 *    posted values, password included, or the controller advice's exception
 *    page (duplicate id, unknown chargeBoxPk);
 *  - an add without the address block is a NullPointerException page;
 *  - an update overwrites every column with what was posted, so a member the
 *    form left out is erased -- EXCEPT the password, which an empty field
 *    leaves unchanged, and which nothing clears;
 *  - the list query matches with LIKE -- case-insensitive, `_` and `%` taken
 *    as wildcards -- so `CP-1` lists `CP-10`, and `cp_01` lists `CP&01`;
 *  - the list escapes the id, as the details form does -- `CP&01` is listed
 *    as `CP&amp;01`, which is also how a station whose id IS `CP&amp;01`
 *    would be listed raw. Releases up to 3.14.x wrote the list raw
 *    (chargepoints.jsp's `${cp.chargeBoxId}`), and the adapter still has to
 *    find the right row on them: `listRendering: "raw"` models that;
 *  - a request without an authenticated session is redirected to sign-in;
 *  - the handshake checks the password under profiles 1 and 2 only.
 * Markup follows the Thymeleaf templates as the pinned image renders them --
 * the CSRF input first in each form, no `id` on a `th:object` form. The
 * model is this fixture's one assumption; `tools/steve-charge-points.ts`
 * re-checks the adapter against the real image when the pin moves.
 */
import type { FetchLike } from "../../packages/csms-driver/contracts";

export const FAKE_STEVE_BASE = "http://steve.test/manager";
const CONTEXT = "/steve/manager";

const REGISTRATION = ["ACCEPTED", "PENDING", "REJECTED"] as const;
const PROFILES = ["Profile_0", "Profile_1", "Profile_2", "Profile_3"] as const;
const ADDRESS = ["street", "houseNumber", "zipCode", "city", "country", "latitude", "longitude", "timeZone"] as const;

export interface FakeStation {
  readonly pk: number;
  readonly chargeBoxId: string;
  registrationStatus: string;
  securityProfile: string;
  /** Stored in the clear: the fake only needs to compare it. */
  authPassword: string | null;
  description: string | null;
  note: string | null;
  adminAddress: string | null;
  insertConnectorStatusAfterTransactionMsg: boolean;
  address: Record<string, string | null>;
}

export interface FakeSteveManager {
  readonly fetch: FetchLike;
  /** Every form posted after sign-in, by action relative to the manager base. */
  readonly posts: { readonly action: string; readonly fields: URLSearchParams }[];
  /** By chargeBoxId. */
  readonly stations: Map<string, FakeStation>;
  /** Whether a WebSocket handshake for `cpId` with this Basic Auth password would be accepted. */
  authenticates(cpId: string, password: string): boolean;
  /**
   * Let the session expire between the next form's GET and its POST, which is
   * then bounced to sign-in with a 302 -- a redirect, like an acceptance.
   * (Spring may refuse such a POST with a 403 for its CSRF token instead,
   * which the client already reports as a non-dispatch; the redirect is the
   * answer that looks like success.)
   */
  expireSessionBeforeNextPost(): void;
}

export interface FakeSteveOptions {
  /** Answer an accepted add with its redirect and store nothing. */
  readonly forgetAdds?: boolean;
  /** Answer an accepted update with its redirect and change nothing, as SteVe does for an unknown chargeBoxPk. */
  readonly forgetUpdates?: boolean;
  /** How the list query writes a charge-box id: escaped from 3.15.0 on (the default), raw up to 3.14.x. */
  readonly listRendering?: "escaped" | "raw";
}

function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `charge_box_id LIKE '%<filter>%'` as MariaDB runs it: case-insensitive, `_` and `%` left as wildcards. */
function likePattern(filter: string): RegExp {
  const body = [...filter]
    .map((char) => (char === "%" ? "[\\s\\S]*" : char === "_" ? "[\\s\\S]" : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(body, "iu");
}

function html(body: string): Response {
  return new Response(`<!DOCTYPE html><html><body><div class="content">${body}</div></body></html>`, {
    headers: { "content-type": "text/html" },
  });
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location });
  if (cookie) headers.append("set-cookie", `JSESSIONID=${cookie}; Path=/steve; HttpOnly`);
  return new Response(null, { status: 302, headers });
}

/** Thymeleaf's `th:action` writes it as the form's first child. */
function csrfInput(token: string): string {
  return `<input type="hidden" name="_csrf" value="${token}"/>`;
}

/** What GlobalControllerAdvice renders for an exception: a 200, with no status. */
function exceptionPage(exception: string, reason?: string): Response {
  return html(
    `<div class="error">\n    <h3>Error:</h3>\n    <p>${esc(exception)}</p>\n` +
      (reason ? `    <h3>Reason:</h3>\n        <p>${esc(reason)}</p>\n` : "") +
      `    <br>\n    <p>You can <a href="javascript:window.history.back()">go back</a> or, for more detail, ` +
      `<a href="${CONTEXT}/log">view the log</a></p>\n</div>`,
  );
}

function select(name: string, values: readonly string[], selected: string | null): string {
  const options = values
    .map((value) => `<option value="${esc(value)}"${value === selected ? ' selected="selected"' : ""}>${esc(value)}</option>`)
    .join("");
  return `<select id="${name}" name="${name}">${options}</select>`;
}

/** The fields a charge-point form posts, as Spring binds them: trimmed, empty is null. */
interface Bound {
  value(key: string): string | null;
  readonly insertFlag: boolean | null;
}

function bind(fields: URLSearchParams): Bound {
  const values = new Map<string, string | null>();
  for (const [key, value] of fields) values.set(key, value.trim() === "" ? null : value.trim());
  const insertFlag = fields.has("insertConnectorStatusAfterTransactionMsg")
    ? true
    : fields.has("_insertConnectorStatusAfterTransactionMsg")
      ? false
      : null;
  return { value: (key) => values.get(key) ?? null, insertFlag };
}

/** The two charge-point forms: where each posts, and what its button and its error say. */
const FORMS = {
  add: { action: "chargepoints/add/single", submit: "add", label: "Add", details: false, id: ' id="chargePointForm"' },
  update: { action: "chargepoints/update", submit: "update", label: "Update", details: true, id: "" },
} as const;
type FormKind = keyof typeof FORMS;

function chargePointForm(
  kind: FormKind,
  token: string,
  station: Partial<FakeStation> & { echoedPassword?: string | null },
): string {
  const { action, submit, label, details, id } = FORMS[kind];
  const address = station.address ?? {};
  return (
    `<form${id} action="${CONTEXT}/${action}" method="post">${csrfInput(token)}` +
    (details ? `<input type="hidden" readonly="readonly" id="chargeBoxPk" name="chargeBoxPk" value="${station.pk}"/>` : "") +
    `<table class="userInput">\n` +
    `<input id="chargeBoxId" name="chargeBoxId"${details ? ' readonly="readonly"' : ""} type="text" value="${esc(station.chargeBoxId)}"/>\n` +
    `<input id="insertConnectorStatusAfterTransactionMsg1" name="insertConnectorStatusAfterTransactionMsg" type="checkbox" value="true"` +
    `${station.insertConnectorStatusAfterTransactionMsg ? ' checked="checked"' : ""}/>` +
    `<input type="hidden" name="_insertConnectorStatusAfterTransactionMsg" value="on"/>\n` +
    select("registrationStatus", REGISTRATION, station.registrationStatus ?? null) + "\n" +
    select("securityProfile", PROFILES, station.securityProfile ?? "Profile_0") + "\n" +
    `<input id="authPassword" name="authPassword" placeholder="${station.authPassword ? "Enter new password" : "Enter password"}" ` +
    `type="password" value="${esc(station.echoedPassword)}"/>\n` +
    (details ? `<input type="hidden" readonly="readonly" id="address.addressPk" name="address.addressPk" value=""/>` : "") +
    ADDRESS.map((member) =>
      member === "country" || member === "timeZone"
        ? select(`address.${member}`, ["", member === "country" ? "DE" : "Europe/Berlin"], address[member] ?? "")
        : `<input id="address.${member}" name="address.${member}" type="text" value="${esc(address[member])}"/>`,
    ).join("\n") +
    `\n<input id="description" name="description" type="text" value="${esc(station.description)}"/>\n` +
    `<input id="adminAddress" name="adminAddress" type="text" value="${esc(station.adminAddress)}"/>\n` +
    `<textarea id="note" name="note">${esc(station.note)}</textarea>\n` +
    `<input type="submit" name="${submit}" value="${label}">\n` +
    `<input type="submit" name="backToOverview" value="Back to Overview">\n` +
    `</table></form>`
  );
}

export function fakeSteveManager(options: FakeSteveOptions = {}): FakeSteveManager {
  const sessions = new Map<string, { token: string; authenticated: boolean }>();
  const stations = new Map<string, FakeStation>();
  const posts: { action: string; fields: URLSearchParams }[] = [];
  let nextSession = 0;
  let expireBeforePost = false;
  let nextPk = 1;

  const byPk = (pk: number): FakeStation | undefined => [...stations.values()].find((station) => station.pk === pk);

  const validate = (bound: Bound, existing: FakeStation | undefined): string[] => {
    const errors: string[] = [];
    const { value } = bound;
    if (value("chargeBoxId") === null) errors.push("ChargeBox ID is required");
    if (!REGISTRATION.includes(value("registrationStatus") as never)) errors.push("Registration status is required");
    if (bound.insertFlag === null) errors.push("must not be null");
    const profile = value("securityProfile");
    if (!PROFILES.includes(profile as never)) errors.push("must not be null");
    const password = value("authPassword");
    if (password !== null && (password.length < 16 || password.length > 20)) {
      errors.push("The field must be between 16 and 20 characters");
    }
    if ((profile === "Profile_1" || profile === "Profile_2") && password === null && !existing?.authPassword) {
      errors.push("Security profiles 1 and 2 require the Basic Auth Password to be set");
    }
    return errors;
  };

  const rerender = (
    kind: FormKind,
    token: string,
    bound: Bound,
    errors: string[],
    existing: FakeStation | undefined,
  ): Response => {
    const { value } = bound;
    const echoed: Partial<FakeStation> & { echoedPassword?: string | null } = {
      ...existing,
      chargeBoxId: value("chargeBoxId") ?? "",
      registrationStatus: value("registrationStatus") ?? "",
      securityProfile: value("securityProfile") ?? "",
      description: value("description"),
      note: value("note"),
      adminAddress: value("adminAddress"),
      insertConnectorStatusAfterTransactionMsg: bound.insertFlag === true,
      echoedPassword: value("authPassword"),
    };
    return html(
      `<div class="error" id="singleError">\n        Error while trying to ${kind} a charge point:\n        <ul>\n` +
        errors.map((error) => `            <li>${esc(error)}</li>\n`).join("") +
        `            </ul>\n    </div>` +
        chargePointForm(kind, token, echoed),
    );
  };

  const apply = (station: FakeStation, bound: Bound): void => {
    const { value } = bound;
    station.registrationStatus = value("registrationStatus") ?? station.registrationStatus;
    station.securityProfile = value("securityProfile") ?? station.securityProfile;
    station.insertConnectorStatusAfterTransactionMsg = bound.insertFlag ?? false;
    // Every column is overwritten with what was posted -- but an empty
    // password leaves the stored one, and nothing clears it.
    station.description = value("description");
    station.note = value("note");
    station.adminAddress = value("adminAddress");
    station.address = Object.fromEntries(ADDRESS.map((member) => [member, value(`address.${member}`)]));
    const password = value("authPassword");
    if (password !== null) station.authPassword = password;
  };

  const fetch: FetchLike = async (input, init) => {
    await Promise.resolve();
    const url = new URL(String(input));
    if (!url.href.startsWith(`${FAKE_STEVE_BASE}/`)) return new Response("unexpected host", { status: 500 });
    const path = url.pathname.replace(/^\/manager\//, "");
    const method = init?.method ?? "GET";
    const cookie = /JSESSIONID=([^;]+)/.exec(new Headers(init?.headers).get("cookie") ?? "")?.[1];
    const session = cookie === undefined ? undefined : sessions.get(cookie);

    if (path === "signin" && method === "GET") {
      const id = `s${++nextSession}`;
      sessions.set(id, { token: `t${nextSession}`, authenticated: false });
      const res = html(`<form action="${CONTEXT}/signin" method="post">${csrfInput(`t${nextSession}`)}</form>`);
      res.headers.append("set-cookie", `JSESSIONID=${id}; Path=/steve; HttpOnly`);
      return res;
    }
    const fields = new URLSearchParams(String(init?.body ?? ""));
    if (path === "signin" && method === "POST") {
      if (!session || fields.get("_csrf") !== session.token) return new Response("forbidden", { status: 403 });
      session.authenticated = true;
      return redirect("/steve/");
    }
    if (expireBeforePost && method === "POST" && session) {
      expireBeforePost = false;
      session.authenticated = false;
    }
    if (!session?.authenticated) return redirect(`${CONTEXT}/signin`);
    if (path === "home" && method === "GET") return html("home");

    if (method === "GET") {
      if (path === "chargepoints/add") {
        return html(
          `<form id="batchChargePointForm" action="${CONTEXT}/chargepoints/add/batch" method="post">${csrfInput(session.token)}` +
            `<textarea id="idList" name="idList"></textarea><input type="submit" value="Add All"></form>` +
            chargePointForm("add", session.token, {}),
        );
      }
      if (path === "chargepoints/query") {
        const filter = likePattern(url.searchParams.get("chargeBoxId") ?? "");
        const rows = [...stations.values()]
          .filter((station) => filter.test(station.chargeBoxId))
          .map((station) =>
            `<tr><td><a href="${CONTEXT}/chargepoints/details/${station.pk}">` +
            `${options.listRendering === "raw" ? station.chargeBoxId : esc(station.chargeBoxId)}</a></td>` +
            `<td><form action="${CONTEXT}/chargepoints/delete/${station.pk}" method="post">${csrfInput(session.token)}` +
            `<input type="submit" class="redSubmit" value="Delete"></form></td></tr>`,
          );
        return html(`<table class="res"><tbody>${rows.join("\n")}</tbody></table>`);
      }
      const details = /^chargepoints\/details\/(\d+)$/.exec(path);
      if (details) {
        const station = byPk(Number(details[1]));
        if (!station) return exceptionPage("de.rwth.idsg.steve.SteveException: Charge point not found");
        return html(chargePointForm("update", session.token, station));
      }
      return new Response("not found", { status: 404 });
    }

    if (fields.get("_csrf") !== session.token) return new Response("forbidden", { status: 403 });
    posts.push({ action: path, fields });

    if (path === "chargepoints/add/single") {
      if (!fields.has("add")) return new Response("forbidden", { status: 403 });
      if (!ADDRESS.some((member) => fields.has(`address.${member}`))) {
        return exceptionPage(
          'java.lang.NullPointerException: Cannot invoke "de.rwth.idsg.steve.web.dto.Address.isEmpty()" because "address" is null',
        );
      }
      const bound = bind(fields);
      const chargeBoxId = bound.value("chargeBoxId");
      const existing = chargeBoxId === null ? undefined : stations.get(chargeBoxId);
      const errors = validate(bound, existing);
      if (errors.length > 0) return rerender("add", session.token, bound, errors, undefined);
      if (existing) {
        return exceptionPage(
          `de.rwth.idsg.steve.SteveException: Failed to add the charge point with chargeBoxId '${chargeBoxId}'`,
          `org.jooq.exception.IntegrityConstraintViolationException: Duplicate entry '${chargeBoxId}' for key 'chargeBoxId_UNIQUE'`,
        );
      }
      if (!options.forgetAdds && chargeBoxId !== null) {
        const station: FakeStation = {
          pk: nextPk++,
          chargeBoxId,
          registrationStatus: "",
          securityProfile: "",
          authPassword: null,
          description: null,
          note: null,
          adminAddress: null,
          insertConnectorStatusAfterTransactionMsg: false,
          address: {},
        };
        apply(station, bound);
        stations.set(chargeBoxId, station);
      }
      return redirect(`${CONTEXT}/chargepoints`);
    }

    if (path === "chargepoints/update") {
      if (!fields.has("update")) return new Response("forbidden", { status: 403 });
      const bound = bind(fields);
      const station = byPk(Number(bound.value("chargeBoxPk")));
      const errors = validate(bound, station);
      if (errors.length > 0) return rerender("update", session.token, bound, errors, station);
      // An unknown chargeBoxPk updates no row and redirects all the same.
      if (station && !options.forgetUpdates) apply(station, bound);
      return redirect(`${CONTEXT}/chargepoints`);
    }

    const deletion = /^chargepoints\/delete\/(\d+)$/.exec(path);
    if (deletion) {
      const station = byPk(Number(deletion[1]));
      if (!station) return exceptionPage("de.rwth.idsg.steve.SteveException: Charge point not found");
      stations.delete(station.chargeBoxId);
      return redirect(`${CONTEXT}/chargepoints`);
    }
    return new Response("not found", { status: 404 });
  };

  return {
    fetch,
    posts,
    stations,
    authenticates(cpId, password) {
      const station = stations.get(cpId);
      if (!station) return false;
      if (station.securityProfile !== "Profile_1" && station.securityProfile !== "Profile_2") return true;
      return station.authPassword !== null && password === station.authPassword;
    },
    expireSessionBeforeNextPost() {
      expireBeforePost = true;
    },
  };
}
