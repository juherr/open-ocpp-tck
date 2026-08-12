#!/usr/bin/env bash
# Copyright 2026 Julien Herr
# SPDX-License-Identifier: Apache-2.0
#
# The idTags a CSMS must be seeded with, read from the pinned simulator image.
#
# Most of them are hard-coded in the SIMULATOR's scenario templates, not in
# tck/specs/. CERT013 and its neighbours appear nowhere in this repository, so a
# list derived by grepping the specs looks complete, passes check-driver, and
# then fails TC_013/014/017/018 at runtime: an unknown tag gets
# Authorize:Invalid, so the transaction those scenarios assert on never starts.
# That cost a full sweep and a wire-log investigation once. This makes the
# ground truth one command instead of a comment nobody re-runs.
#
# Network + docker: pulls the pinned image if absent. Deliberately NOT part of
# `bun run test`, which stays offline and deterministic.
#
#   bash tools/extract-fixture-tags.sh           # print the tags the image uses
#   bash tools/extract-fixture-tags.sh --diff    # compare with every bundled driver
set -euo pipefail

repo_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repo_root"

mode="${1:-print}"
case "$mode" in
  print | --diff) ;;
  *)
    echo "usage: $0 [--diff]" >&2
    exit 2
    ;;
esac

for cmd in docker bun; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "FAIL: $cmd is required." >&2
    exit 1
  fi
done

# The digest lives in tck/sim.ts and is printed by the CLI, so this script
# cannot drift from the image the scenarios actually run against.
image="$(bun bin/ocpp-tck.ts print-sim-image | tail -1)"
echo "# simulator image: $image" >&2

# CERT_QUIRKS / CERTIFICATE_PEM_RE and friends are source identifiers, not tags:
# a real idTag has no underscore.
image_tags="$(
  docker run --rm --entrypoint sh "$image" \
    -c "grep -rhoE 'CERT[A-Za-z0-9-]+' /app/src 2>/dev/null | sort -u" |
    grep -vE '^CERTIFICATE' | sort -u
)"

if [ "$mode" = "print" ]; then
  printf '%s\n' "$image_tags"
  exit 0
fi

# Tags the CSMS supplies (RemoteStartTransaction, ReserveNow, SendLocalList)
# come from tck/specs/, so a driver legitimately knows tags the image does not.
spec_tags="$(
  grep -rhoE '"CERT[A-Za-z0-9-]+"' tck/specs/*.ts | tr -d '"' | sort -u
)"

# Every bundled provisioner, discovered rather than listed. Each is an
# independent hard-coded copy of the same tag list -- they cannot share a
# constant, because the list is a property of the simulator image and a driver
# may live in another repository entirely. So a second driver reintroduces
# exactly the drift this script exists to catch: a hard-coded list would say
# "add it to SteVe", SteVe would go green, and the other driver would keep
# failing TC_013/014/017/018 with an Authorize:Invalid that looks like a CSMS
# bug. A glob means a third driver is covered the day it lands, and an empty
# glob is itself a failure rather than a silent pass.
shopt -s nullglob
provisioners=(drivers/*/provision.ts)
shopt -u nullglob

if [ "${#provisioners[@]}" -eq 0 ]; then
  echo "FAIL: no drivers/*/provision.ts found -- nothing was checked." >&2
  exit 1
fi

# Loop-invariant: what a driver is ALLOWED to know, image plus specs.
explained="$(sort -u <(printf '%s\n' "$image_tags" "$spec_tags"))"

status=0
for provisioner in "${provisioners[@]}"; do
  name="$(basename "$(dirname "$provisioner")")"

  # `|| true`: grep exits 1 on no match, which under `set -euo pipefail` would
  # abort the whole run at the first driver that provisions no tag at all --
  # silently, and before the FAIL line below could name it. An empty set is the
  # honest answer there, and it falls straight into the missing branch.
  driver_tags="$(grep -oE '"CERT[A-Za-z0-9-]+"' "$provisioner" | tr -d '"' | sort -u || true)"

  missing="$(comm -23 <(printf '%s\n' "$image_tags") \
    <(printf '%s\n' "$driver_tags"))"
  unexplained="$(comm -13 <(printf '%s\n' "$explained") \
    <(printf '%s\n' "$driver_tags"))"

  if [ -n "$missing" ]; then
    echo "FAIL: the image uses tags the $name driver does not provision:" >&2
    printf '%s\n' "$missing" | sed 's/^/  /' >&2
    echo "  → add them to VALID_TAGS in $provisioner." >&2
    status=1
  fi
  if [ -n "$unexplained" ]; then
    echo "WARN: the $name driver provisions tags neither the image nor the specs use:" >&2
    printf '%s\n' "$unexplained" | sed 's/^/  /' >&2
  fi
  if [ -z "$missing" ] && [ -z "$unexplained" ]; then
    echo "The $name driver provisions every tag the pinned simulator image uses."
  fi
done
exit "$status"
