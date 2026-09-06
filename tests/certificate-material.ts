/**
 * The committed certificate is one the pinned CSMS can parse, and one it can
 * store.
 *
 * WHY THIS IS A GUARD AND NOT A SWEEP. The value it protects is read by a CSMS
 * BEFORE any frame: its install helper runs the PEM through a certificate parser on the way in, and a value it cannot read is refused with an HTTP
 * error and nothing on the wire. So the five cases that send this certificate
 * fail as ERROR -- "the request never reached the CSMS" -- for a defect that
 * would be entirely ours, and the sweep's report would name the deployment.
 * Reaching that from a live run costs a container and points at the wrong
 * system when it arrives.
 *
 * FOUR CLAIMS, AND THEY ARE THE PARSE'S REQUIREMENTS RATHER THAN OCPP'S. OCPP
 * says `certificate` is a string of at most 5500 characters and says nothing
 * else; every property below comes from what that deployment then does with it,
 * read out of the pinned image:
 *
 *   1. IT PARSES AT ALL, and as a certificate rather than as text that happens
 *      to carry the armour lines.
 *   2. THE SERIAL IS A SMALL DECIMAL, because the parse stores
 *      `parseInt(serialNumberHex)` in an INTEGER column: a hex spelling
 *      carrying `a`-`f` reads back as `NaN` and a 20-byte serial overflows.
 *      This is the claim that is invisible in the PEM and unguessable from the
 *      protocol, and it is why the certificate was generated with
 *      `-set_serial 1`.
 *   3. `C=US` AND SHA-256 WITH RSA, because both are read into columns whose
 *      model types enumerate one value each.
 *   4. IT HAS NOT EXPIRED, and this is the row that exists for the FUTURE
 *      rather than for today. Nothing in that deployment checks the date, so a
 *      certificate regenerated at openssl's default of 30 days would pass every
 *      other row here and pass every run for a month.
 *
 * THE PARSER IS NOT THE ONE THAT MATTERS, and that is this guard's one
 * assumption, stated rather than hidden: `node:crypto`'s `X509Certificate` is
 * what is available here and `jsrsasign` is what reads it there. Both decode
 * DER, so a value one accepts and the other refuses would have to be malformed
 * in a way only one of them notices -- possible, and narrower than the failure
 * this catches, which is a value that is not a certificate at all.
 */
import { X509Certificate } from "node:crypto";
import { TEST_ROOT_CERTIFICATE_PEM } from "../tck/certificate-material";

let failures = 0;

function fail(what: string, detail: string): void {
  failures += 1;
  process.stderr.write(`FAIL: ${what}\n      ${detail}\n`);
}

function pass(what: string): void {
  process.stdout.write(`  ok: ${what}\n`);
}

// 1. IT PARSES. A throw here is the whole failure mode in its purest form.
let cert: X509Certificate | null = null;
try {
  cert = new X509Certificate(TEST_ROOT_CERTIFICATE_PEM);
  pass("the committed material parses as an X.509 certificate");
} catch (error) {
  fail(
    "the parse",
    `new X509Certificate(TEST_ROOT_CERTIFICATE_PEM) threw: ${String(error)}. ` +
      "The pinned CSMS parses this before dispatching, so every InstallCertificate " +
      "case would report ERROR against the CSMS for a defect in this file.",
  );
}

if (cert) {
  // 2. THE SERIAL. The check is on the HEX SPELLING and not on the value,
  //    because that is what the deployment reads: `parseInt` of it, into an
  //    INTEGER column.
  const serialHex = cert.serialNumber;
  const asRead = Number.parseInt(serialHex, 10);
  if (!/^[0-9]+$/.test(serialHex)) {
    fail(
      "the serial",
      `serialNumber is "${serialHex}", whose hex spelling is not all decimal ` +
        "digits -- the CSMS reads it with parseInt(x, 10) and stores NaN.",
    );
  } else if (!Number.isSafeInteger(asRead) || asRead > 2_147_483_647) {
    fail(
      "the serial",
      `serialNumber "${serialHex}" reads as ${asRead}, which overflows the ` +
        "INTEGER column the CSMS stores it in.",
    );
  } else {
    pass(`the serial reads back as ${asRead}, which an INTEGER column holds`);
  }

  // 3. THE TWO ENUMERATED FIELDS. Both are stored as free strings and both are
  //    typed in that deployment's model as an enumeration of exactly one
  //    value, so a certificate carrying anything else is a row nothing here
  //    could read back.
  if (!/(^|[,/])C=US($|[,/])/.test(cert.subject.replace(/\n/g, "/"))) {
    fail(
      "the country",
      `subject is ${JSON.stringify(cert.subject)}, which does not carry C=US`,
    );
  } else {
    pass("the subject carries C=US");
  }

  // READ OUT OF THE DER, because `node:crypto` exposes no accessor for it --
  // `toLegacyObject().sigalg` is `undefined`, which is how the first draft of
  // this row went green while asserting nothing. What is searched for is the
  // encoded OID 1.2.840.113549.1.1.11, sha256WithRSAEncryption, which
  // `jsrsasign` renders as the `SHA256withRSA` that deployment enumerates. The
  // OID appears in a certificate only as a signatureAlgorithm -- an RSA
  // subjectPublicKeyInfo carries rsaEncryption, 1.1.1, not 1.1.11 -- so its
  // presence identifies the field without a parser.
  const SHA256_WITH_RSA_OID = Buffer.from([
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b,
  ]);
  const keyType = cert.publicKey.asymmetricKeyType;
  if (!Buffer.from(cert.raw).includes(SHA256_WITH_RSA_OID)) {
    fail(
      "the signature algorithm",
      "the DER carries no sha256WithRSAEncryption OID; the CSMS's model " +
        "enumerates SHA256withRSA and SHA256withECDSA, and stores anything " +
        "else as a value nothing reads back",
    );
  } else if (keyType !== "rsa") {
    fail(
      "the signature algorithm",
      `the key is ${String(keyType)}, not rsa, so the signature OID above ` +
        "describes something other than this certificate's own key",
    );
  } else {
    pass("the certificate is signed with SHA-256 and RSA");
  }

  // 4. NOT EXPIRED. The row that is about the next person to regenerate this.
  const notAfter = new Date(cert.validTo);
  if (!(notAfter.getTime() > Date.now())) {
    fail(
      "the validity",
      `the certificate expired on ${cert.validTo}. Nothing in the pinned CSMS ` +
        "checks the date, so this is the failure that would arrive silently: " +
        "regenerate with a long -days, not with openssl's default of 30.",
    );
  } else {
    pass(`the certificate is valid until ${cert.validTo}`);
  }
}

// The schema's own cap, and the only claim here that IS OCPP's.
if (TEST_ROOT_CERTIFICATE_PEM.length > 5500) {
  fail(
    "the length",
    `${TEST_ROOT_CERTIFICATE_PEM.length} characters; InstallCertificateRequest ` +
      "caps `certificate` at 5500, so the station would refuse the frame",
  );
} else {
  pass(`the PEM is ${TEST_ROOT_CERTIFICATE_PEM.length} characters, under the schema's 5500`);
}

if (failures > 0) {
  process.stderr.write(
    `\n${failures} failure(s). The pinned CSMS parses this certificate before ` +
      `it dispatches anything, so a value that is wrong here fails five ` +
      `certification cases as ERROR -- pointing at the CSMS, for a defect in ` +
      `this repository.\n`,
  );
  process.exit(1);
}
process.stdout.write(
  "Certificate material: OK (parses, storable serial, C=US, SHA-256/RSA, unexpired, under the cap)\n",
);
