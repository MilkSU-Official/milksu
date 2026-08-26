#!/usr/bin/env bash
# Build and install the Omarchy/Arch pacman package from the shared tarball.
set -euo pipefail

release_dir="${1:?path to build/release containing tarball, PKGBUILD, milksu.desktop}"
image="${ARCH_IMAGE:-archlinux:latest}"

release_dir="$(cd "$release_dir" && pwd)"
test -f "$release_dir/PKGBUILD"
test -f "$release_dir/milksu.desktop"
tarball="$(find "$release_dir" -maxdepth 1 -name 'MilkSU-Linux-x64-*.tar.gz' | head -n1)"
test -n "$tarball"

docker run -i --rm --platform linux/amd64 \
  -v "$release_dir:/work:ro" \
  "$image" \
  bash -s <<'EOS'
set -euo pipefail
pacman -Syu --noconfirm --needed base-devel
useradd -m builder
install -d /home/builder/pkg
cp /work/PKGBUILD /work/milksu.desktop /work/MilkSU-Linux-x64-*.tar.gz /home/builder/pkg/
chown -R builder:builder /home/builder/pkg
# Prebuilt Electron tree; runtime depends are for the installed system, not makepkg.
su - builder -c 'cd /home/builder/pkg && makepkg --skippgpcheck --nodeps'
package="$(find /home/builder/pkg -maxdepth 1 -name 'milksu-*.pkg.tar.*' | head -n1)"
test -n "$package"
pacman -U --noconfirm "$package"
test -x /opt/MilkSU/milksu
test -x /usr/bin/milksu
node_runtime=/opt/MilkSU/resources/milksu-sidecar/node
test -x "$node_runtime"
test "$("$node_runtime" --version)" = "v24.18.0"
runtime_home="$(mktemp -d)"
mkdir -p "$runtime_home/.git"
printf '%s\n' \
  '{"action":"create_session","conversationId":"arch-package-smoke","executionMode":"go","approvalPolicy":"workspace-auto"}' \
  '{"action":"destroy_session","conversationId":"arch-package-smoke"}' \
  | HOME="$runtime_home" "$node_runtime" \
    /opt/MilkSU/resources/milksu-sidecar/chat-bridge.cjs \
  | tee /tmp/milksu-sidecar.stdout
grep -q '"type":"ready"' /tmp/milksu-sidecar.stdout
backend=/opt/MilkSU/resources/milksu-backend
test -x "$backend"
"$backend" >/tmp/milksu-backend.stdout 2>/tmp/milksu-backend.stderr &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  grep -q '"type"[[:space:]]*:[[:space:]]*"ready"' /tmp/milksu-backend.stdout && break
  kill -0 "$backend_pid"
  sleep 0.5
done
grep -q '"type"[[:space:]]*:[[:space:]]*"ready"' /tmp/milksu-backend.stdout
kill "$backend_pid"
wait "$backend_pid" || true
EOS
