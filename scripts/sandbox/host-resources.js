'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const GiB = 1024 ** 3;
const MAX_PROBE_MS = 10_000;
const MAX_OUTPUT_BYTES = 65_536;

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${label}`);
  return value;
}

function decimal(text, label) {
  if (typeof text !== 'string' || !/^[0-9]+$/.test(text.trim())) throw new Error(`Invalid ${label}`);
  return integer(Number(text.trim()), label);
}

function guestMemoryBytes(manifest) {
  const memory = manifest && manifest.resources && manifest.resources.memory;
  const match = typeof memory === 'string' && memory.match(/^([1-9][0-9]*)(MB|GB)$/);
  if (!match) throw new Error('Invalid guest memory');
  return integer(Number(match[1]) * (match[2] === 'GB' ? GiB : 1024 ** 2), 'guest memory', 1);
}

function runReadOnly(run, executable, args) {
  const result = run(executable, args, {
    encoding: 'utf8', timeout: 2_000, maxBuffer: MAX_OUTPUT_BYTES,
    shell: false, windowsHide: true, env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  });
  if (!result || result.status !== 0 || result.error || result.signal ||
      typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > MAX_OUTPUT_BYTES) {
    throw new Error('Host resource command failed');
  }
  return result.stdout;
}

function readPressure(run) {
  // The sysctl exports dispatch flags, not the kernel's internal 0/1/2/3 enum:
  // https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_memorystatus_notify.c
  const level = decimal(runReadOnly(run, '/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']), 'pressure');
  const pressure = { 1: 'normal', 2: 'warning', 4: 'critical' }[level];
  if (!pressure) throw new Error('Unknown memory pressure');
  return pressure;
}

function pageCount(output, label) {
  const matches = output.split('\n').filter(line => line.startsWith(`${label}:`));
  if (matches.length !== 1) throw new Error('Missing or repeated VM statistic');
  const value = matches[0].slice(label.length + 1).trim();
  if (!/^[0-9]+\.$/.test(value)) throw new Error('Malformed VM statistic');
  return decimal(value.slice(0, -1), label);
}

function parseDarwinMemory(output, totalBytes) {
  integer(totalBytes, 'total memory', 1);
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_OUTPUT_BYTES) throw new Error('Invalid VM statistics');
  const header = output.match(/^Mach Virtual Memory Statistics: \(page size of ([0-9]+) bytes\)\r?\n/);
  if (!header) throw new Error('Missing VM statistics header');
  const pageBytes = decimal(header[1], 'page size');
  if (![4096, 16384, 65536].includes(pageBytes)) throw new Error('Unsupported page size');
  const [free, speculative, fileBacked] = ['Pages free', 'Pages speculative', 'File-backed pages']
    .map(label => integer(pageCount(output, label) * pageBytes, label));
  if ([free, speculative, fileBacked, free + speculative].some(value => value > totalBytes)) {
    throw new Error('VM statistics exceed physical memory');
  }
  // vm_stat displays free_count - speculative_count, so its two printed fields
  // can be added. Conservatively subtract speculative from file-backed credit
  // as well, and never add inactive/purgeable/compressed counts independently.
  // https://github.com/apple-oss-distributions/system_cmds/blob/main/vm_stat/vm_stat.c
  // File-backed pages are an estimate of reclaimable cache, not a reservation.
  // Cap their additional credit at half physical RAM to avoid counting a large
  // active mapped-file workload as entirely disposable.
  const disjointCache = Math.max(0, fileBacked - speculative);
  if (free + speculative + disjointCache > totalBytes) {
    throw new Error('Disjoint VM statistics exceed physical memory');
  }
  const reclaimable = Math.min(disjointCache, Math.floor(totalBytes / 2));
  return Object.freeze({
    available_memory_bytes: free + speculative + reclaimable,
    free_memory_bytes: free,
    speculative_memory_bytes: speculative,
    file_backed_memory_bytes: fileBacked,
    file_backed_credit_bytes: reclaimable,
  });
}

function diskAvailable(statfs, storagePath) {
  const stats = statfs(storagePath);
  if (!stats) throw new Error('Missing disk statistics');
  const blockBytes = integer(stats.bsize, 'disk block size', 1);
  const blocks = integer(stats.blocks, 'disk block count', 1);
  const available = integer(stats.bavail, 'disk available blocks');
  if (available > blocks) throw new Error('Invalid available disk blocks');
  integer(blockBytes * blocks, 'disk size', 1);
  return integer(blockBytes * available, 'available disk');
}

function receipt(base, code, message, metrics = {}) {
  return Object.freeze({ ...base, ...metrics, decision: code === 'host_resources_available' ? 'allow' : 'deny', code, message });
}

function gibibytes(bytes) {
  return (bytes / GiB).toFixed(2);
}

function pressureDenial(base, pressure, metrics = {}) {
  return receipt(base, 'host_memory_pressure',
    `VM launch refused: host memory pressure is ${pressure}. Close memory-heavy apps or use another host, then retry.`,
    { ...metrics, memory_pressure: pressure });
}

// A point-in-time admission check, not a promise about later host activity or
// full guest disk growth. Call again immediately before starting a VM. No CLI,
// manifest, or environment setting can lower these fixed safety margins.
function assessHostResources(manifest, options = {}) {
  const { storagePath, platform = process.platform, run = spawnSync, statfs = fs.statfsSync, now = Date.now, cloneBytes = 0 } = options;
  const fallbackTime = new Date().toISOString();
  let base = {
    schema_version: 1, platform, checked_at: fallbackTime,
    guest_memory_bytes: null, total_memory_bytes: null, available_memory_bytes: null,
    free_memory_bytes: null, speculative_memory_bytes: null,
    file_backed_memory_bytes: null, file_backed_credit_bytes: null,
    host_reserve_bytes: null, vm_overhead_bytes: null, required_memory_bytes: null,
    available_disk_bytes: null, required_disk_bytes: null, probe_duration_ms: null,
    memory_pressure: 'unknown', clone_bytes: null, disk_deficit_bytes: null,
  };
  let started;
  let guest;
  let requiredDisk;
  try {
    started = integer(now(), 'probe start time');
    base = { ...base, checked_at: new Date(started).toISOString() };
    guest = guestMemoryBytes(manifest);
    integer(cloneBytes, 'clone bytes');
    requiredDisk = integer(Math.max(10 * GiB, integer(guest + 4 * GiB, 'required disk', 1)) + cloneBytes, 'disk with clone', 1);
    if (typeof storagePath !== 'string' || !path.isAbsolute(storagePath) || storagePath.includes('\0')) {
      throw new Error('Invalid storage path');
    }
  } catch {
    return receipt(base, 'host_resource_request_invalid', 'VM launch refused: a valid guest memory request, nonnegative clone budget, and absolute VM storage path are required.');
  }
  base = { ...base, guest_memory_bytes: guest, clone_bytes: cloneBytes };
  if (platform !== 'darwin') {
    return receipt(base, 'host_resource_platform_unsupported', 'VM launch refused: host resource admission is supported on macOS only. Use a supported host or an explicitly selected hosted environment.');
  }
  let metrics;
  try {
    const initialPressure = readPressure(run);
    if (initialPressure !== 'normal') return pressureDenial(base, initialPressure);
    const total = decimal(runReadOnly(run, '/usr/sbin/sysctl', ['-n', 'hw.memsize']), 'total memory');
    const memory = parseDarwinMemory(runReadOnly(run, '/usr/bin/vm_stat', []), total);
    const hostReserve = Math.max(4 * GiB, Math.ceil(total * 0.1));
    const overhead = Math.max(GiB, Math.ceil(guest * 0.2));
    const required = integer(guest + hostReserve + overhead, 'required memory', 1);
    // The caller supplies a conservative copy budget before cloning. Pass zero
    // for the fresh admission after cloning to avoid charging the copy twice.
    // This minimum headroom does not guarantee full guest disk growth.
    const availableDisk = diskAvailable(statfs, storagePath);
    metrics = {
      total_memory_bytes: total, ...memory,
      host_reserve_bytes: hostReserve, vm_overhead_bytes: overhead,
      required_memory_bytes: required, required_disk_bytes: requiredDisk,
      available_disk_bytes: availableDisk, disk_deficit_bytes: Math.max(0, requiredDisk - availableDisk),
      memory_pressure: readPressure(run),
    };
  } catch {
    return receipt(base, 'host_resource_probe_failed', 'VM launch refused: host memory pressure, available memory, or VM storage space could not be verified. Check host diagnostics and VM storage access, then retry.');
  }
  let duration;
  try { duration = integer(now() - started, 'probe duration'); } catch { duration = MAX_PROBE_MS + 1; }
  if (duration > MAX_PROBE_MS) {
    return receipt(base, 'host_resource_probe_stale', 'VM launch refused: host resource measurements became stale or the system clock changed. Retry for fresh measurements.');
  }
  metrics = { ...metrics, probe_duration_ms: duration };
  if (metrics.memory_pressure !== 'normal') return pressureDenial(base, metrics.memory_pressure, metrics);
  if (metrics.available_memory_bytes < metrics.required_memory_bytes) {
    return receipt(base, 'host_insufficient_memory',
      `VM launch refused: ${gibibytes(metrics.available_memory_bytes)} GiB estimated host memory is available; ${gibibytes(metrics.required_memory_bytes)} GiB is required including guest RAM, host reserve, and VM overhead. Close memory-heavy apps, request a smaller supported VM, or use another host, then retry.`, metrics);
  }
  if (metrics.available_disk_bytes < metrics.required_disk_bytes) {
    return receipt(base, 'host_insufficient_disk',
      `VM launch refused: VM storage has ${gibibytes(metrics.available_disk_bytes)} GiB available; at least ${gibibytes(metrics.required_disk_bytes)} GiB is required including the clone budget (${gibibytes(metrics.disk_deficit_bytes)} GiB deficit). Free space on the VM storage volume or use another host, then retry.`, metrics);
  }
  return receipt(base, 'host_resources_available',
    'Host resource admission passed with normal memory pressure and budgeted headroom for RAM and disk. This measurement does not reserve resources or guarantee full guest disk growth.', metrics);
}

module.exports = { assessHostResources, parseDarwinMemory };
