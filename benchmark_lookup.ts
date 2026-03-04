import { performance } from "perf_hooks";

// Mock devices
const MOCK_DEVICES = Array.from({ length: 10 }).map((_, i) => ({
  deviceId: `device-${i}`,
  kind: 'audioinput',
  label: `Microphone ${i}`,
  groupId: `group-${i}`
}));

const selectedDeviceId = 'device-8'; // near the end

// Baseline: Array.find
function benchmarkArrayFind(iterations: number) {
  let found;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    found = MOCK_DEVICES.find(d => d.deviceId === selectedDeviceId);
  }
  const end = performance.now();
  console.log(`Array.find: ${(end - start).toFixed(2)} ms for ${iterations} iterations`);
  return found;
}

// Optimized: Map.get
const deviceMap = new Map();
MOCK_DEVICES.forEach(d => deviceMap.set(d.deviceId, d));

function benchmarkMapGet(iterations: number) {
  let found;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    found = deviceMap.get(selectedDeviceId);
  }
  const end = performance.now();
  console.log(`Map.get: ${(end - start).toFixed(2)} ms for ${iterations} iterations`);
  return found;
}

const ITERATIONS = 1_000_000;
console.log(`Benchmarking device lookup for ${ITERATIONS} iterations...`);
benchmarkArrayFind(ITERATIONS);
benchmarkMapGet(ITERATIONS);
