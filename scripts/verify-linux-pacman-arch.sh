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
test -f /usr/share/icons/hicolor/256x256/apps/milksu.png
test -f /usr/share/pixmaps/milksu.png
node_runtime=/opt/MilkSU/resources/milksu-sidecar/node
test -x "$node_runtime"
test "$("$node_runtime" --version)" = "v24.18.0"
runtime_home="$(mktemp -d)"
mkdir -p "$runtime_home/.git"
printf '%s\n' \
  '{"action":"create_session","conversationId":"arch-package-smoke","executionMode":"go","approvalPolicy":"workspace-auto","provider":"tokenflux","model":"deepseek/deepseek-flash","modelSourceOrder":["personal"]}' \
  '{"action":"destroy_session","conversationId":"arch-package-smoke"}' \
  | HOME="$runtime_home" \
    OPENAI_API_KEY='package-smoke-imagegen-credential-never-log' \
    TOKENFLUX_API_KEY='package-smoke-imagegen-credential-never-log' \
    "$node_runtime" \
    /opt/MilkSU/resources/milksu-sidecar/chat-bridge.cjs \
  | tee /tmp/milksu-sidecar.stdout
grep -q '"type":"ready"' /tmp/milksu-sidecar.stdout
if grep -q 'package-smoke-imagegen-credential-never-log' /tmp/milksu-sidecar.stdout; then
  echo 'packaged sidecar smoke leaked the dummy credential' >&2
  exit 1
fi
runtime=/opt/MilkSU/resources/runtime/main.cjs
test -f "$runtime"
ELECTRON_RUN_AS_NODE=1 /opt/MilkSU/milksu "$runtime" >/tmp/milksu-runtime.stdout 2>/tmp/milksu-runtime.stderr &
runtime_pid=$!
trap 'kill "$runtime_pid" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  grep -q '"type"[[:space:]]*:[[:space:]]*"ready"' /tmp/milksu-runtime.stdout && break
  kill -0 "$runtime_pid"
  sleep 0.5
done
grep -q '"type"[[:space:]]*:[[:space:]]*"ready"' /tmp/milksu-runtime.stdout
kill "$runtime_pid"
wait "$runtime_pid" || true
EOS
