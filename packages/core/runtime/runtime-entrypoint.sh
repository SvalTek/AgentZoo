#!/usr/bin/env bash
set -euo pipefail

agent_root() {
  local id="$1"
  [[ "$id" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || { echo "invalid agent id" >&2; exit 2; }
  printf '/var/lib/runtime/agents/%s' "$id"
}

agent_init_running() {
  local root="$1"
  [[ -s "${root}/init.pid" && -s "${root}/launcher.pid" ]] || return 1
  local init_pid launcher_pid children
  init_pid="$(cat "${root}/init.pid")"
  launcher_pid="$(cat "${root}/launcher.pid")"
  [[ "$init_pid" =~ ^[0-9]+$ && "$launcher_pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$init_pid" 2>/dev/null && kill -0 "$launcher_pid" 2>/dev/null || return 1
  children="$(cat "/proc/${launcher_pid}/task/${launcher_pid}/children" 2>/dev/null || true)"
  [[ " ${children} " == *" ${init_pid} "* ]]
}

mount_agent_dev() {
  local dev="$1"
  mount -t tmpfs -o nosuid,mode=755,size=16m tmpfs "$dev"
  mknod -m 666 "$dev/null" c 1 3
  mknod -m 666 "$dev/zero" c 1 5
  mknod -m 666 "$dev/full" c 1 7
  mknod -m 666 "$dev/random" c 1 8
  mknod -m 666 "$dev/urandom" c 1 9
  mknod -m 666 "$dev/tty" c 5 0
  mkdir -m 755 "$dev/pts"
  mkdir -m 1777 "$dev/shm"
  mount -t devpts -o nosuid,noexec,newinstance,ptmxmode=0666,mode=0620,gid=5 devpts "$dev/pts"
  ln -s pts/ptmx "$dev/ptmx"
  mount -t tmpfs -o nosuid,nodev,mode=1777,size=64m tmpfs "$dev/shm"
  ln -s /proc/self/fd "$dev/fd"
  ln -s /proc/self/fd/0 "$dev/stdin"
  ln -s /proc/self/fd/1 "$dev/stdout"
  ln -s /proc/self/fd/2 "$dev/stderr"
}

unmount_agent_dev() {
  local dev="$1"
  mountpoint -q "$dev/pts" && umount "$dev/pts"
  mountpoint -q "$dev/shm" && umount "$dev/shm"
  mountpoint -q "$dev" && umount "$dev"
}

if [[ "${1:-}" == "create-agent" ]]; then
  root="$(agent_root "${2:?agent id required}")"
  mkdir -p "${root}/upper" "${root}/work" "${root}/merged"
  if ! mountpoint -q "${root}/merged"; then
    mount -t overlay overlay -o "lowerdir=/opt/runtime/rootfs-template,upperdir=${root}/upper,workdir=${root}/work" "${root}/merged"
    bindfs /shared "${root}/merged/shared"
    mount_agent_dev "${root}/merged/dev"
  fi
  if ! agent_init_running "$root"; then
    rm -f "${root}/init.pid" "${root}/launcher.pid" "${root}/namespace.ready"
    nohup unshare --mount --pid --fork /usr/local/bin/runtime-host agent-init "${2}" \
      </dev/null >"${root}/init.log" 2>&1 &
    launcher_pid="$!"
    printf '%s\n' "$launcher_pid" > "${root}/launcher.pid"
    init_pid=""
    for _ in $(seq 1 100); do
      if ! kill -0 "$launcher_pid" 2>/dev/null; then
        cat "${root}/init.log" >&2
        echo "agent process namespace failed to start" >&2
        exit 4
      fi
      children="$(cat "/proc/${launcher_pid}/task/${launcher_pid}/children" 2>/dev/null || true)"
      init_pid="${children%% *}"
      [[ -n "$init_pid" && -e "/proc/${init_pid}/ns/pid" && -e "${root}/namespace.ready" ]] && break
      sleep 0.05
    done
    [[ -n "$init_pid" && -e "/proc/${init_pid}/ns/pid" && -e "${root}/namespace.ready" ]] || {
      kill "$launcher_pid" 2>/dev/null || true
      echo "agent process namespace did not become ready" >&2
      exit 4
    }
    printf '%s\n' "$init_pid" > "${root}/init.pid"
  fi
  exit 0
fi

if [[ "${1:-}" == "destroy-agent" ]]; then
  root="$(agent_root "${2:?agent id required}")"
  if agent_init_running "$root"; then
    init_pid="$(cat "${root}/init.pid")"
    kill "$init_pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$init_pid" 2>/dev/null || break
      sleep 0.05
    done
    kill -KILL "$init_pid" 2>/dev/null || true
  fi
  if [[ -s "${root}/launcher.pid" ]]; then
    launcher_pid="$(cat "${root}/launcher.pid")"
    kill "$launcher_pid" 2>/dev/null || true
  fi
  unmount_agent_dev "${root}/merged/dev"
  mountpoint -q "${root}/merged/shared" && umount "${root}/merged/shared"
  mountpoint -q "${root}/merged" && umount "${root}/merged"
  rm -rf "${root}"
  exit 0
fi

if [[ "${1:-}" == "agent-init" ]]; then
  root="$(agent_root "${2:?agent id required}")"
  mount --make-rprivate /
  umount /shared
  mount -t proc -o nosuid,nodev,noexec proc "${root}/merged/proc"
  touch "${root}/namespace.ready"
  exec /usr/bin/tini -- /bin/sleep infinity
fi

if [[ "${1:-}" == "chroot-exec" ]]; then
  id="${2:?agent id required}"
  root="$(agent_root "$id")"
  agent_init_running "$root" || { echo "agent environment is not running" >&2; exit 3; }
  init_pid="$(cat "${root}/init.pid")"
  shift
  exec nsenter --target "$init_pid" --mount --pid /usr/local/bin/runtime-host chroot-exec-private "$@"
fi

if [[ "${1:-}" == "chroot-exec-private" ]]; then
  id="${2:?agent id required}"
  shift 2
  root="$(agent_root "$id")"
  mountpoint -q "${root}/merged" || { echo "agent environment is not prepared" >&2; exit 3; }
  command_id=""
  cwd="/"
  if [[ "${1:-}" == "--command-id" ]]; then
    command_id="${2:?command id required}"
    [[ "$command_id" =~ ^[0-9a-f-]{36}$ ]] || { echo "invalid command id" >&2; exit 2; }
    shift 2
  fi
  if [[ "${1:-}" == "--cwd" ]]; then
    cwd="${2:?working directory required}"
    shift 2
  fi
  [[ "$cwd" == /* && "$cwd" != *".."* ]] || { echo "invalid working directory" >&2; exit 2; }
  [[ "${1:-}" == "--" ]] && shift
  [[ "$#" -gt 0 ]] || { echo "command required" >&2; exit 2; }
  [[ -n "$command_id" ]] || { echo "command id required" >&2; exit 2; }
  # The directory change happens after chroot, so it is evaluated in the
  # private merged root rather than against the runtime host filesystem.
  mkdir -p "${root}/commands"
  command_file="${root}/commands/${command_id}.pid"
  # An asynchronous command in a non-interactive shell otherwise receives
  # /dev/null on stdin. Preserve Docker exec's input for write/edit tools.
  exec 3<&0
  setsid chroot "${root}/merged" /bin/bash -c 'cd -- "$1" && shift && exec "$@"' bash "$cwd" "$@" <&3 &
  command_pid="$!"
  printf '%s\n' "$command_pid" > "$command_file"
  status=0
  wait "$command_pid" || status="$?"
  rm -f "$command_file"
  exit "$status"
fi

if [[ "${1:-}" == "cancel-command" ]]; then
  id="${2:?agent id required}"
  command_id="${3:?command id required}"
  [[ "$command_id" =~ ^[0-9a-f-]{36}$ ]] || { echo "invalid command id" >&2; exit 2; }
  root="$(agent_root "$id")"
  agent_init_running "$root" || { echo "agent environment is not running" >&2; exit 3; }
  init_pid="$(cat "${root}/init.pid")"
  exec nsenter --target "$init_pid" --mount --pid /usr/local/bin/runtime-host cancel-command-private "$id" "$command_id"
fi

if [[ "${1:-}" == "cancel-command-private" ]]; then
  id="${2:?agent id required}"
  command_id="${3:?command id required}"
  root="$(agent_root "$id")"
  command_file="${root}/commands/${command_id}.pid"
  command_pid=""
  for _ in $(seq 1 100); do
    if [[ -s "$command_file" ]]; then
      command_pid="$(cat "$command_file")"
      break
    fi
    sleep 0.01
  done
  # The command may have completed during cancellation startup.
  [[ -n "$command_pid" ]] || exit 0
  [[ "$command_pid" =~ ^[0-9]+$ ]] || { echo "invalid command pid" >&2; exit 3; }
  kill -TERM -- "-${command_pid}" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 -- "-${command_pid}" 2>/dev/null || exit 0
    sleep 0.1
  done
  kill -KILL -- "-${command_pid}" 2>/dev/null || true
  exit 0
fi

exec "$@"
