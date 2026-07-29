<!-- =============================================================================== file_id: SOM-DOC-8727-v1.0.0 name: README.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

<!-- =============================================================================== file_id: SOM-DOC-8727-v1.0.0 name: README.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

---
file_id: SOM-DOC-0021-v0.0.3
name: sandbox/README
description: Sandbox provisioning layer for colloquy v0.0.3. Tier-3 Firecracker microVMs are the only active modality; Tiers 1 (Docker) and 2 (gVisor) are reserved for later module drops.
category: DOC
tags: [colloquy, sandbox, firecracker, tier3]
created: 2026-04-22
---

# Colloquy Sandbox Layer — v0.0.3

## Tiers

| Tier | Tech | Status | Isolation |
|------|------|--------|-----------|
| 1 | Docker | **Reserved** — later module | Shared kernel |
| 2 | gVisor | **Reserved** — later module | User-space kernel, syscall filtering |
| 3 | Firecracker microVM | **ACTIVE** | Dedicated microVM per agent, KVM-based, full hardware isolation |

Only Tier 3 is implemented. `spawn-agent.mjs` rejects `--sandbox-tier` other than 3.

## Runtime assets (NOT checked in)

Place your kernel + rootfs here before attempting a real (non-stub) boot:

```
D:/somacosf/.claude/skills/colloquy/sandbox/vmlinux       # Firecracker-compatible kernel
D:/somacosf/.claude/skills/colloquy/sandbox/rootfs.ext4   # Agent runtime rootfs (Python/Node, tool budget only)
```

Recommended sources:
- Kernel: https://s3.amazonaws.com/spec.ccfc.min/img/quickstart_guide/x86_64/kernels/vmlinux.bin
- Rootfs: build with `docker-to-ext4` or a minimal Alpine + uv + @anthropic-ai/claude-agent-sdk.

`rootfs.ext4` is content-hashed (sha256) at provision time and stored in
`agents.sandbox_rootfs_hash` so the witness chain can detect rootfs drift.

## Platform support

| Platform | Mode | Reason |
|----------|------|--------|
| Linux + `/dev/kvm` + `firecracker` on PATH | **Real** — spawns microVM via `--api-sock` | KVM + firecracker binary both present |
| Linux without KVM | **Stub** — record row, log reason | no KVM device |
| Windows (OMEN-01, this dev box) | **Stub** — record row, state='stub' | no Firecracker on Windows |
| macOS (Mini) | **Stub** — record row, state='stub' | Firecracker is Linux-only |

Stub rows carry `state='stub'` and `rootfs_hash='sha256:stub-rootfs-v0'` so
downstream queries `WHERE state != 'stub'` cleanly exclude them.

## Boot sequence (real tier 3)

```
provisionMicroVM()
  -> spawn firecracker --api-sock /tmp/firecracker-$vm.sock --id $vm (detached)
  -> returns { sandbox_uuid, state:'provisioned', socket_path, ... }

caller then drives the UDS API:
  curl --unix-socket $sock PUT /machine-config {mem_size_mib, vcpu_count}
  curl --unix-socket $sock PUT /boot-source   {kernel_image_path, boot_args}
  curl --unix-socket $sock PUT /drives/rootfs {drive_id, path_on_host, is_root_device:true}
  curl --unix-socket $sock PUT /actions       {action_type:'InstanceStart'}

  -> UPDATE sandboxes SET state='booted', booted_at=... WHERE sandbox_uuid=?
  -> UPDATE agents    SET sandbox_booted_at=... WHERE agent_uuid=?
```

The API-drive step is deliberately NOT inside `provisionMicroVM` so that
step can be re-tried independently and tested without an actual VM.

## Witness / audit

Every provision emits a candidate heartbeat with `event_kind='sandbox_boot'`
and payload `{ tier, vm_id, rootfs_hash, mem_mib, vcpus }`. This row hashes
into the heartbeat chain (see v0.0.3 follow-on `prior_heartbeat_hash` column)
so rootfs drift, tier downgrade, or mem/vcpu over-allocation are all
detectable via a recursive CTE on `heartbeats`.

## References

- Firecracker: https://github.com/firecracker-microvm/firecracker
- Jailer: https://github.com/firecracker-microvm/firecracker/blob/main/docs/jailer.md
- Symbiont 7-layer security: https://symbiont.dev/security (source of the tier model)
- GYST UUIDv8: `D:/somacosf/.claude/skills/colloquy/references/codebook-v0.0.2.md`
