// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * certificate-material.ts -- the one X.509 certificate this suite installs, and
 * why it is committed rather than generated.
 *
 * HERE AND NOT UNDER `specs/`, which is the one placement question this file
 * had. Its two readers are `states-201.ts`'s `CertificateInstalled` fixture and
 * the one scenario that does not go through that fixture, and a fixture living
 * in the core may not import from the scenarios. Putting it there and letting
 * the SCENARIO pass the PEM in was the alternative, and it costs the thing that
 * matters more: a `states:` declaration carrying an identifier renders `·` and
 * is then OMITTED from `ASSERT-INVENTORY.txt` entirely, taking the certificate
 * TYPE -- the member the four cases differ in -- off the committed artifact
 * with it.
 *
 * WHAT NEEDS IT. OCPP 2.0.1's `InstallCertificateRequest` carries a PEM, and
 * `TC_M_01`..`TC_M_05` are the five cases that send one. What those cases
 * validate is the REQUEST -- its `certificateType`, and that its `certificate`
 * member holds a certificate -- so nothing here has to be trusted by anything,
 * signed by anything, or match any other material in the tree.
 *
 * WHY IT IS NOT GENERATED AT RUN TIME, which is the shape #127 assumed and
 * which does not survive contact with the platform. Building an X.509
 * certificate means emitting ASN.1: `node:crypto` can PARSE one
 * (`X509Certificate`) and cannot build one, and neither can Bun. Generating it
 * would mean a runtime dependency on a certificate library for the whole
 * package -- shipped to every consumer, vendored, pinned and diffed -- to
 * produce a value that never varies. A constant is the cheaper honest answer.
 *
 * WHY IT MUST STILL BE WELL FORMED, which is the part that is not obvious and
 * is the reason `tests/certificate-material.ts` exists. At least one pinned
 * CSMS PARSES this before it dispatches anything -- an install helper reads
 * the PEM on the way in and throws on anything it cannot read -- so a
 * malformed value fails all five cases with an HTTP error and no frame,
 * reported as an ERROR against the CSMS for a defect that would be ours.
 * A driver's own note is where that deployment is named.
 *
 * THE PRIVATE KEY WAS DISCARDED. It was generated once with `openssl req
 * -x509`, used to self-sign this certificate and deleted in the same step;
 * nothing here signs anything, and no operation in the contract would need it.
 * So this file holds a public certificate and no secret, which is what makes
 * committing it uninteresting rather than a judgement call.
 */

/**
 * A self-signed root: `C=US`, serial 1, SHA-256 with RSA, valid to 2126.
 *
 * EVERY ONE OF THOSE IS LOAD-BEARING AGAINST THE PINNED CSMS AND NONE OF THEM
 * IS AGAINST OCPP, which is why `tests/certificate-material.ts` asserts them
 * instead of leaving them a coincidence of how this was generated:
 *
 *  - SERIAL 1, because that deployment stores `parseInt(serialNumberHex)` in an
 *    INTEGER column. A serial whose hex spelling is not all decimal digits
 *    reads back as `NaN`, and a 20-byte one overflows the column.
 *  - `C=US`, because the country is read out of the subject into a column whose
 *    model type enumerates exactly that one value.
 *  - SHA-256 WITH RSA, the same shape one field over.
 *  - NOT EXPIRED, which nothing checks today and which a regeneration at
 *    openssl's default of 30 days would quietly break for every run after the
 *    thirtieth.
 *
 * Under 5500 characters, which is the schema's cap on the member.
 */
export const TEST_ROOT_CERTIFICATE_PEM =
  "-----BEGIN CERTIFICATE-----\n" +
  "MIIDCjCCAfICAQEwDQYJKoZIhvcNAQELBQAwSjELMAkGA1UEBhMCVVMxFjAUBgNV\n" +
  "BAoMDU9wZW4gT0NQUCBUQ0sxIzAhBgNVBAMMGk9wZW4gT0NQUCBUQ0sgVGVzdCBS\n" +
  "b290IENBMCAXDTI2MDkwNjA2NTA0MVoYDzIxMjYwODEzMDY1MDQxWjBKMQswCQYD\n" +
  "VQQGEwJVUzEWMBQGA1UECgwNT3BlbiBPQ1BQIFRDSzEjMCEGA1UEAwwaT3BlbiBP\n" +
  "Q1BQIFRDSyBUZXN0IFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK\n" +
  "AoIBAQCkn4Yn9o+sGgouRAoj3wCBHomjSyN6gcgdRQ/MfWj6+PUeiZqa6KXOMz/J\n" +
  "8Hu3yg1KxwSahCX8K06feUYrOJ+BPluS7RlLfF9kH1kBFpBEcASa0TDxImE+zyCd\n" +
  "VtiR8vWT0MYJzdWJqd5h5GM5K+GTGGkAdwYBJ2x1durHFwDpytZttiBy12v5GCQt\n" +
  "vwlAZtm9uspZFFl7BPo5+MlRialmq0Y3bCPlwcfm5/f4ctLl+fIIAcBo9GnK8MBb\n" +
  "rFxqQk85FoPMqgL0e4xBe38/JHJXfKyFPy7zKjpNZxudQb/5HjYNHPPFHcB+GpMP\n" +
  "4b73an8e0jWEklH+qCzy7nV4PbwtAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAAjc\n" +
  "k291WRrLFNbQlVow1GhOb9W9cjbUa8hViHGcNvA7OhUjBTrXLlUY++1VFvDxpbIW\n" +
  "uW92xt75E/IXfvkWLTvtyQtYqCyxr721vKTBcF/D1t9KvWXwhzlsifntgxd/VNaJ\n" +
  "LyNN25u3ynSMeV0QfmzWAwDsczQVvMAzgX9WrZqUX2v1h9pJ/awUJfrEH037IIXx\n" +
  "+oQXsa3sVqXiqAu2OAYpQ7i5Y8cvoVNHKvps+j6rjRzLV6WasGbFFYhfek/XN6Za\n" +
  "7chr/SlnzFl01WCV2IHHC6OR1CF9HkMrXcTk6lfQcdDk4SEm6RdIyFcDo0nUUEXK\n" +
  "pdtfdssVhGnBDvvoEN8=\n" +
  "-----END CERTIFICATE-----\n";
