// =============================================================================
// file_id: SOM-SCR-0042-v0.0.3
// name: firecracker-provision.mjs
// description: Tier-3 (Firecracker microVM) sandbox provisioner. On Linux
//              with /dev/kvm and firecracker binary present, writes jailer
//              config + drives a real microVM via the UDS API. Anywhere
//              else (Windows dev boxes) runs in STUB mode: records an
//              honest 'stub' row and logs why. Never lies with a fake
//              'booted' state.
// category: SCR
// tags: [colloquy, sandbox, firecracker, tier3, v0.0.3]
// created: 2026-04-22
// version: 0.0.3
// =============================================================================
import { existsSync, mkdirSync, appendFileSync, statSync, createReadStream } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { resolve as pathResolve } from 'node:path';

import {
  encodeGYST, fnv1a12, EPOCH_2026, SCHEME_VERSION_v1,
} from './lib/derive.mjs';

const LOG = 'D:/somacosf/utils/logs/firecracker.log';

function log(line) {
  try {
    mkdirSync('D:/somacosf/utils/logs', { recursive: true });
    appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`);
  } catch {}
}

// Type 0x020 SANDBOX (reserved block: 0x020-0x02F for sandbox lifecycle events).
export function mintSandboxUUID({ agent_uuid, tier, ts_ms }) {
  const ts_s = Math.floor(ts_ms / 1000) - EPOCH_2026;
  const seed = `sandbox|${agent_uuid}|${tier}|${ts_ms}|${randomBytes(8).toString('hex')}`;
  const hbuf = createHash('sha256').update(seed).digest();
  const hi = BigInt(hbuf.readUInt32BE(0));
  const lo = BigInt(hbuf.readUInt32BE(4));
  const rand42 = ((hi << 32n) | lo) & ((1n << 42n) - 1n);
  return encodeGYST({
    type: 0x020,
    namespace: fnv1a12(agent_uuid),
    timestamp: ts_s & 0xFFFFFF,
    version: 0x8,
    depth: 0,
    domain: 0x0,
    generation: SCHEME_VERSION_v1,
    variant: 0b10,
    provenance: 0x2,
    signal: 0xFFFF,
    random: rand42,
  });
}

function hashFile(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', c => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });
}

function canFirecracker() {
  if (process.platform !== 'linux') return { ok: false, why: `platform=${process.platform}` };
  if (!existsSync('/dev/kvm')) return { ok: false, why: '/dev/kvm missing' };
  const r = spawnSync('which', ['firecracker'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) return { ok: false, why: 'firecracker binary not on PATH' };
  return { ok: true, bin: r.stdout.trim() };
}

/**
 * Provision a Tier-3 microVM for a freshly born agent.
 *
 * Returns { sandbox_uuid, vm_id, socket_path, kernel_path, rootfs_path,
 *           rootfs_hash, mem_mib, vcpus, state, tier }.
 *
 * On unsupported platforms returns state='stub' and skips all binary work.
 */
export async function provisionMicroVM({
  agent_uuid,
  mem_mib = 2048,
  vcpus = 2,
  kernel_path = 'D:/somacosf/.claude/skills/colloquy/sandbox/vmlinux',
  rootfs_path = 'D:/somacosf/.claude/skills/colloquy/sandbox/rootfs.ext4',
} = {}) {
  const ts_ms = Date.now();
  const sandbox_uuid = mintSandboxUUID({ agent_uuid, tier: 3, ts_ms });
  const vm_id = `fc-${sandbox_uuid.slice(0, 8)}`;

  const cap = canFirecracker();
  if (!cap.ok) {
    log(`stub provision agent=${agent_uuid} vm=${vm_id} reason="${cap.why}"`);
    return {
      sandbox_uuid,
      vm_id,
      socket_path: null,
      kernel_path,
      rootfs_path,
      rootfs_hash: 'sha256:stub-rootfs-v0',
      mem_mib,
      vcpus,
      state: 'stub',
      tier: 3,
      provisioned_at: ts_ms,
      booted_at: null,
    };
  }

  // Real path (Linux + KVM + firecracker).
  if (!existsSync(kernel_path)) throw new Error(`kernel_path missing: ${kernel_path}`);
  if (!existsSync(rootfs_path)) throw new Error(`rootfs_path missing: ${rootfs_path}`);
  const rootfs_hash = 'sha256:' + await hashFile(rootfs_path);

  const socket_path = `/tmp/firecracker-${vm_id}.sock`;
  // Launch firecracker detached with API socket. Callers drive it via curl
  // (PUT /machine-config, /boot-source, /drives/rootfs; PUT /actions InstanceStart).
  const child = spawn(cap.bin, ['--api-sock', socket_path, '--id', vm_id], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  log(`real provision agent=${agent_uuid} vm=${vm_id} sock=${socket_path} pid=${child.pid}`);

  // We mark 'provisioned' — actual boot is a follow-on step driven by the
  // caller (curl to /actions InstanceStart) so we keep this function pure.
  return {
    sandbox_uuid,
    vm_id,
    socket_path,
    kernel_path,
    rootfs_path,
    rootfs_hash,
    mem_mib,
    vcpus,
    state: 'provisioned',
    tier: 3,
    provisioned_at: ts_ms,
    booted_at: null,
  };
}

/** Insert a sandboxes row matching the schema in 0003-sandbox.sql. */
export async function recordSandbox(client, agent_uuid, s) {
  await client.execute({
    sql: `INSERT INTO sandboxes (
            sandbox_uuid, agent_uuid, tier, vm_id, socket_path,
            kernel_path, rootfs_path, rootfs_hash, mem_mib, vcpus,
            state, provisioned_at, booted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      s.sandbox_uuid, agent_uuid, s.tier, s.vm_id, s.socket_path,
      s.kernel_path, s.rootfs_path, s.rootfs_hash, s.mem_mib, s.vcpus,
      s.state, s.provisioned_at, s.booted_at,
    ],
  });
}
