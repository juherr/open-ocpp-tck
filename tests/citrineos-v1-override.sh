#!/usr/bin/env bash
# The v1.9.1 compose override yields a v1.9.1 stack that can find its database.
#
# THE PROPERTY, in three parts, all read off the MERGED configuration --
# `docker compose -f compose.yaml -f compose.v1.yaml config` -- rather than off
# either file:
#   1. the `citrine` service runs the v1.9.1 image, by tag and by digest;
#   2. every configuration variable the v1.9.1 image reads is present with the
#      value the base file used to carry: the `docker` app-env selector and
#      the BOOTSTRAP_CITRINEOS_* patches, database host first among them;
#   3. the base file alone carries NONE of those variables -- the control that
#      says part 2 read a merge and not a base file that still had them.
#
# WHY IT EXISTS. Moving the CitrineOS pin to v2.0.0-beta4 replaced the base
# file's environment block: the `docker` app-env and every BOOTSTRAP_CITRINEOS_*
# variable are gone upstream, so the block became CITRINEOS_<PATH> overrides.
# The v1.9.1 override inherited that block by compose's merge rules and had
# nothing of its own -- so it would have booted v1.9.1 on its local defaults,
# looking for Postgres on localhost, and `check:driver:citrineos-v1` would have
# stayed green: it reads the driver's declarations and never opens a compose
# file. No CI job runs the v1 line, so nothing else would have said so either.
# The variables now live in compose.v1.yaml, and this is what holds them there.
#
# WHY THE MERGED CONFIG AND NOT THE OVERRIDE FILE. Compose merges `environment`
# maps: a key in the override wins, a key only in the base survives. So the
# fact worth checking is what the container would be handed, which neither
# file states on its own -- and the same command is how a reader answers the
# question by hand. `docker compose config` renders without a daemon; only the
# CLI plugin is needed, which is what keeps this inside the offline gate.
#
# THE VARIABLE TABLE IS THE GUARD'S ONE ASSUMPTION: what v1.9.1 reads was
# taken from the environment block the base file carried through beta3 --
# apps/ocpp-server/src/config/envs/docker.ts at that tag is where the names
# come from -- and the v1.9.1 pin does not move, so the table does not either.
#
# WHAT PART 1 DOES NOT CLAIM: that the digest in compose.v1.yaml is the right
# bytes for v1.9.1. The digest is read off that file, so a wrong one there is
# consistently wrong here and this guard stays green -- deliberately, since
# spelling the digest a second time in a guard is the duplication
# tests/documented-install-ref.sh's header argues against, and the registry
# answers that question outright: `docker compose up` refuses a digest that
# does not resolve. What is claimed is that the merge selected the override's
# FULL reference, tag and digest, byte for byte.
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

base=drivers/citrineos/compose.yaml
override=drivers/citrineos/compose.v1.yaml

# What v1.9.1 reads, and the value each must carry.
legacy=(
  "APP_ENV=docker"
  "BOOTSTRAP_CITRINEOS_DATABASE_HOST=ocpp-db"
  "BOOTSTRAP_CITRINEOS_CONFIG_FILENAME=config.json"
  "BOOTSTRAP_CITRINEOS_FILE_ACCESS_TYPE=local"
  "BOOTSTRAP_CITRINEOS_FILE_ACCESS_LOCAL_DEFAULT_FILE_PATH=/data"
  "CONFIG_CITRINEOS_WIPE_FILE_ON_START=false"
)

if ! docker compose version >/dev/null 2>&1; then
  echo "FAIL: the docker compose CLI plugin is required to render the merged configuration." >&2
  exit 1
fi

# The `citrine` service of a rendered configuration, as `key=value` lines:
# `image=<ref>` and one `env:<NAME>=<value>` per environment entry. Compose
# renders a canonical document -- two-space indents, one service per block,
# `environment:` as a map -- and this reads exactly that shape.
citrine_facts() {
  docker compose "$@" config 2>/dev/null | awk '
    /^services:/            { in_services = 1; next }
    in_services && /^[^ ]/  { in_services = 0 }
    !in_services            { next }
    /^  [^ ]/               { in_citrine = ($0 == "  citrine:"); in_env = 0; next }
    !in_citrine             { next }
    /^    [^ ]/             { in_env = ($0 == "    environment:")
                              if ($1 == "image:") print "image=" $2
                              next }
    in_env && /^      [^ ]/ { key = $1; sub(/:$/, "", key)
                              val = $0; sub(/^      [^:]*: */, "", val)
                              gsub(/^"|"$/, "", val)
                              print "env:" key "=" val }
  '
}

merged=$(citrine_facts -f "$base" -f "$override")
plain=$(citrine_facts -f "$base")

if [ -z "$merged" ] || [ -z "$plain" ]; then
  echo "FAIL: the rendered configuration has no \`citrine\` service, or the render failed." >&2
  echo "  → run: docker compose -f $base -f $override config" >&2
  exit 1
fi

fail=0

# 1. The image is the v1.9.1 pin, tag and digest both. The digest is read off
#    the override's own `image:` line rather than spelled here -- the same rule
#    tests/documented-install-ref.sh follows -- so the check is that the MERGE
#    selected the override's full reference byte for byte, and that reference
#    names a v1.9.1 tag with a sha256 digest.
image=$(printf '%s\n' "$merged" | sed -n 's/^image=//p')
declared=$(sed -n 's/^    image: \(ghcr\.io\/citrineos\/citrineos-server:[^ ]*\)$/\1/p' "$override")
case "$declared" in
  ghcr.io/citrineos/citrineos-server:v1.9.1@sha256:????????????????????????????????????????????????????????????????) ;;
  *)
    echo "FAIL: $override declares '$declared', not a v1.9.1 tag pinned by a full sha256 digest." >&2
    fail=1 ;;
esac
if [ "$image" != "$declared" ]; then
  echo "FAIL: the merged \`citrine\` image is '$image'; $override declares '$declared'." >&2
  fail=1
fi

# 2. Every legacy variable, with its value, in the merged environment.
for kv in "${legacy[@]}"; do
  if ! printf '%s\n' "$merged" | grep -qxF "env:$kv"; then
    have=$(printf '%s\n' "$merged" | sed -n "s/^env:${kv%%=*}=//p")
    echo "FAIL: merged environment lacks ${kv%%=*}=${kv#*=} (has: '${have:-<absent>}')." >&2
    fail=1
  fi
done

# 3. The control: the base file alone carries none of them, so a hit above is
#    the override's doing and not a leftover the base still had.
for kv in "${legacy[@]}"; do
  if printf '%s\n' "$plain" | grep -q "^env:${kv%%=*}="; then
    echo "FAIL: $base itself sets ${kv%%=*}; the v1.9.1 variables belong in $override only," >&2
    echo "  → and with them in both files this guard could not tell the merge from the base." >&2
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "The v1.9.1 override renders the v1.9.1 image with all ${#legacy[@]} legacy variables, none of which the base file carries."
