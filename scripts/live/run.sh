#!/usr/bin/env bash
# Live verification harness (docs/impl/v2.1.2-tasks.md §2.4). Runs on Git Bash (Windows), macOS, Linux.
# Windows: use `make live` (it adds the MSVC toolchain env). Needs docker, kind, kubectl, helm, cargo.
#
# kind create -> proxies on the kind network -> kubeconfig with proxied contexts -> cargo test -> teardown.
# Writes only to its own temp dir, its own kind cluster and containers. Never touches ~/.kube/config.
set -euo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'   # Git Bash: keep docker/kind args as written

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CLUSTER=garita-live
CTX="kind-$CLUSTER"
SQUID=ubuntu/squid@sha256:6a097f68bae708cedbabd6188d68c7e2e7a38cedd05a176e1cc0ba29e3bbe029
SOCKS=serjs/go-socks5-proxy@sha256:0af522996f402c03ecd985a87997158eabeb28935365e3a384df37eafcf740ea

# Docker Desktop's CLI is not always on PATH on Windows.
if ! command -v docker >/dev/null 2>&1 && [ -n "${LOCALAPPDATA:-}" ] && command -v cygpath >/dev/null 2>&1; then
  PATH="$(cygpath -u "$LOCALAPPDATA")/Programs/DockerDesktop/resources/bin:$PATH"
fi
for t in docker kind kubectl helm cargo; do
  command -v "$t" >/dev/null 2>&1 || { echo "live: missing $t on PATH" >&2; exit 2; }
done
docker info >/dev/null 2>&1 || { echo "live: docker daemon not running" >&2; exit 2; }
if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "live: kind cluster $CLUSTER already exists and was not created by this run; delete it first" >&2; exit 2
fi

native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }
TMP="$(mktemp -d)"
KCFG="$TMP/kubeconfig"
RAW="$TMP/raw"
CREATED=0
cleanup() {
  docker rm -f garita-live-squid garita-live-socks >/dev/null 2>&1 || true
  if [ "$CREATED" = 1 ]; then kind delete cluster --name "$CLUSTER" --kubeconfig "$(native "$RAW")" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
if [ "${GARITA_LIVE_KEEP:-}" = 1 ]; then  # debugging: leave cluster + proxies up; delete by hand
  cleanup() { echo "live: kept cluster $CLUSTER, containers garita-live-squid/-socks, $TMP"; }
fi
trap cleanup EXIT

# kind create and the --no-run build run without the dead proxy env: kind copies it into the nodes,
# cargo would route its fetches through it. Only the final test line sets it.
CREATED=1
kind create cluster --name "$CLUSTER" --config "$(native "$HERE/kind-config.yaml")" \
  --kubeconfig "$(native "$RAW")" --wait 180s

kview() { kubectl --kubeconfig "$(native "$RAW")" config view --raw -o "jsonpath=$1"; }
EXT_SERVER="$(kview '{.clusters[0].cluster.server}')"
CA="$(kview '{.clusters[0].cluster.certificate-authority-data}')"
CRT="$(kview '{.users[0].user.client-certificate-data}')"
KEY="$(kview '{.users[0].user.client-key-data}')"
INT_SERVER="https://$CLUSTER-control-plane:6443"   # resolves only on the kind docker network (T51-10)

# Proxies on the kind network, published on 127.0.0.1.
SQCONF='http_port 3128
acl tls_ports port 6443
acl connect method CONNECT
http_access allow connect tls_ports
http_access deny all
cache_effective_user proxy
pid_filename none
access_log stdio:/var/log/squid/access.log'
docker run -d --name garita-live-squid --network kind -p 127.0.0.1::3128 -e "SQCONF=$SQCONF" \
  --entrypoint sh "$SQUID" -c 'printf "%s\n" "$SQCONF" > /tmp/squid.conf; exec squid -N -f /tmp/squid.conf' >/dev/null
docker run -d --name garita-live-socks --network kind -p 127.0.0.1::1080 -e REQUIRE_AUTH=false "$SOCKS" >/dev/null
hostport() { docker port "$1" "$2/tcp" | head -n1 | sed 's/.*://'; }
SQ_PORT="$(hostport garita-live-squid 3128)"
SO_PORT="$(hostport garita-live-socks 1080)"
sleep 4

# Userinfo is built at runtime (no literal credential URL in the repo).
USERINFO_URL="$(printf '%s%s%s%s%s%s' http :// garita-user : garita-pw "@127.0.0.1:$SQ_PORT")"
{
  echo "apiVersion: v1"; echo "kind: Config"; echo "current-context: $CTX"
  echo "clusters:"
  emit_cluster() { # name server [proxy]
    echo "- name: $1"; echo "  cluster:"; echo "    server: $2"
    if [ -n "${3:-}" ]; then echo "    proxy-url: $3"; fi
    echo "    certificate-authority-data: $CA"
  }
  emit_cluster "$CTX" "$EXT_SERVER"
  emit_cluster "$CTX-direct" "$INT_SERVER"
  emit_cluster "$CTX-http" "$INT_SERVER" "http://127.0.0.1:$SQ_PORT"
  emit_cluster "$CTX-socks5" "$INT_SERVER" "socks5://127.0.0.1:$SO_PORT"
  emit_cluster "$CTX-userinfo" "$INT_SERVER" "$USERINFO_URL"
  emit_cluster "$CTX-deadproxy" "$INT_SERVER" "http://127.0.0.1:9"
  echo "users:"
  echo "- name: $CTX"; echo "  user:"; echo "    client-certificate-data: $CRT"; echo "    client-key-data: $KEY"
  echo "contexts:"
  for s in "" -direct -http -socks5 -userinfo -deadproxy; do
    echo "- name: $CTX$s"; echo "  context: { cluster: $CTX$s, user: $CTX }"
  done
} > "$KCFG"

export KUBECONFIG="$(native "$KCFG")"
export GARITA_LIVE_CONTEXT="$CTX"
cd "$ROOT/src-tauri"
cargo test --lib --no-run
rc=0
HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 NO_PROXY=127.0.0.1,localhost \
  cargo test --lib --offline live -- --ignored --test-threads=1 --nocapture || rc=$?

echo "--- squid access log (CONNECT lines) ---"
docker exec garita-live-squid sh -c 'grep CONNECT /var/log/squid/access.log' | tail -n 5 || true
if [ "$rc" = 0 ] && ! docker exec garita-live-squid sh -c 'grep -q CONNECT /var/log/squid/access.log'; then
  echo "live: squid saw no CONNECT: proxy was bypassed" >&2; rc=1
fi
exit "$rc"
