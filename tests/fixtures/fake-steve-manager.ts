// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * A SteVe manager UI that reaches no SteVe, for the charge-point rows of
 * tests/csms-driver-charge-points.ts: sign-in, the add form, the list query,
 * the details form, update and delete.
 *
 * What it models is what the pinned image (steve-3.14.1) was MEASURED to do,
 * and each of these is a way the adapter could be wrong while a kinder fake
 * stayed green:
 *  - every refusal is a 200 page -- the validation list re-rendered with the
 *    posted values, password included, or the controller advice's exception
 *    page (duplicate id, unknown chargeBoxPk);
 *  - an add without the address block is a NullPointerException page;
 *  - an update overwrites every column with what was posted, so a member the
 *    form left out is erased -- EXCEPT the password, which an empty field
 *    leaves unchanged, and which nothing clears;
 *  - the list query matches with LIKE, so `CP-1` lists `CP-10`;
 *  - the handshake checks the password under profiles 1 and 2 only.
 * Markup follows Spring's form tags as the pinned image renders them. The
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
  authenticates(cpId: string, password: string | undefined): boolean;
}

export interface FakeSteveOptions {
  /** Answer an accepted add with its redirect and store nothing. */
  readonly forgetAdds?: boolean;
  /** Answer an accepted update with its redirect and change nothing, as SteVe does for an unknown chargeBoxPk. */
  readonly forgetUpdates?: boolean;
}

function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function csrfInput(token: string): string {
  return `<div>\n<input type="hidden" name="_csrf" value="${token}" />\n</div>`;
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
  readonly values: Map<string, string | null>;
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
  return { values, insertFlag };
}

function chargePointForm(
  action: string,
  submit: string,
  token: string,
  station: Partial<FakeStation> & { echoedPassword?: string | null },
  details: boolean,
): string {
  const address = station.address ?? {};
  return (
    `<form id="chargePointForm" action="${CONTEXT}/${action}" method="post">` +
    (details ? `<input id="chargeBoxPk" name="chargeBoxPk" readonly="true" type="hidden" value="${station.pk}"/>` : "") +
    `<table class="userInput">\n` +
    `<input id="chargeBoxId" name="chargeBoxId"${details ? ' readonly="readonly"' : ""} type="text" value="${esc(station.chargeBoxId)}"/>\n` +
    `<input id="insertConnectorStatusAfterTransactionMsg1" name="insertConnectorStatusAfterTransactionMsg" type="checkbox" value="true"` +
    `${station.insertConnectorStatusAfterTransactionMsg ? ' checked="checked"' : ""}/>` +
    `<input type="hidden" name="_insertConnectorStatusAfterTransactionMsg" value="on"/>\n` +
    select("registrationStatus", REGISTRATION, station.registrationStatus ?? null) + "\n" +
    select("securityProfile", PROFILES, station.securityProfile ?? "Profile_0") + "\n" +
    `<input id="authPassword" name="authPassword" placeholder="${station.authPassword ? "Enter new password" : "Enter password"}" ` +
    `type="password" value="${esc(station.echoedPassword)}"/>\n` +
    (details ? `<input id="address.addressPk" name="address.addressPk" readonly="true" type="hidden" value=""/>` : "") +
    ADDRESS.map((member) =>
      member === "country" || member === "timeZone"
        ? select(`address.${member}`, ["", member === "country" ? "DE" : "Europe/Berlin"], address[member] ?? "")
        : `<input id="address.${member}" name="address.${member}" type="text" value="${esc(address[member])}"/>`,
    ).join("\n") +
    `\n<input id="description" name="description" type="text" value="${esc(station.description)}"/>\n` +
    `<input id="adminAddress" name="adminAddress" type="text" value="${esc(station.adminAddress)}"/>\n` +
    `<textarea id="note" name="note">\n${esc(station.note)}</textarea>\n` +
    `<input type="submit" name="${submit}" value="${submit === "add" ? "Add" : "Update"}">\n` +
    `<input type="submit" name="backToOverview" value="Back to Overview">\n` +
    `</table>${csrfInput(token)}</form>`
  );
}

export function fakeSteveManager(options: FakeSteveOptions = {}): FakeSteveManager {
  const sessions = new Map<string, { token: string; authenticated: boolean }>();
  const stations = new Map<string, FakeStation>();
  const posts: { action: string; fields: URLSearchParams }[] = [];
  let nextSession = 0;
  let nextPk = 1;

  const byPk = (pk: number): FakeStation | undefined => [...stations.values()].find((station) => station.pk === pk);

  const validate = (bound: Bound, existing: FakeStation | undefined): string[] => {
    const errors: string[] = [];
    const value = (key: string): string | null => bound.values.get(key) ?? null;
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
    action: string,
    submit: string,
    token: string,
    bound: Bound,
    errors: string[],
    existing: FakeStation | undefined,
  ): Response => {
    const value = (key: string): string | null => bound.values.get(key) ?? null;
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
    const verb = submit === "add" ? "add" : "update";
    return html(
      `<div class="error" id="singleError">\n        Error while trying to ${verb} a charge point:\n        <ul>\n` +
        errors.map((error) => `            <li>${esc(error)}</li>\n`).join("") +
        `            </ul>\n    </div>` +
        chargePointForm(action, submit, token, echoed, submit === "update"),
    );
  };

  const apply = (station: FakeStation, bound: Bound): void => {
    const value = (key: string): string | null => bound.values.get(key) ?? null;
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
    if (!session?.authenticated) return redirect(`${CONTEXT}/signin`);
    if (path === "home" && method === "GET") return html("home");

    if (method === "GET") {
      if (path === "chargepoints/add") {
        return html(
          `<form id="batchChargePointForm" action="${CONTEXT}/chargepoints/add/batch" method="post">` +
            `<textarea id="idList" name="idList">\n</textarea><input type="submit" value="Add All">${csrfInput(session.token)}</form>` +
            chargePointForm("chargepoints/add/single", "add", session.token, {}, false),
        );
      }
      if (path === "chargepoints/query") {
        const filter = url.searchParams.get("chargeBoxId") ?? "";
        const rows = [...stations.values()]
          .filter((station) => station.chargeBoxId.includes(filter))
          .map((station) =>
            `<tr><td><a href="${CONTEXT}/chargepoints/details/${station.pk}">${esc(station.chargeBoxId)}</a></td>` +
            `<td><form id="command" action="${CONTEXT}/chargepoints/delete/${station.pk}" method="post">` +
            `<input type="submit" class="redSubmit" value="Delete">${csrfInput(session.token)}</form></td></tr>`,
          );
        return html(`<table class="res"><tbody>${rows.join("\n")}</tbody></table>`);
      }
      const details = /^chargepoints\/details\/(\d+)$/.exec(path);
      if (details) {
        const station = byPk(Number(details[1]));
        if (!station) return exceptionPage("de.rwth.idsg.steve.SteveException: Charge point not found");
        return html(chargePointForm("chargepoints/update", "update", session.token, station, true));
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
      const chargeBoxId = bound.values.get("chargeBoxId") ?? null;
      const existing = chargeBoxId === null ? undefined : stations.get(chargeBoxId);
      const errors = validate(bound, existing);
      if (errors.length > 0) return rerender("chargepoints/add/single", "add", session.token, bound, errors, undefined);
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
      const station = byPk(Number(bound.values.get("chargeBoxPk")));
      const errors = validate(bound, station);
      if (errors.length > 0) return rerender("chargepoints/update", "update", session.token, bound, errors, station);
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
  };
}
