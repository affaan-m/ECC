'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const gate = require('../../../scripts/lib/eval-harness/gate');
const { test, tempDir, cleanup, finish } = require('./helpers');
const example = path.resolve(__dirname,'../../../examples/eval-harness');
const baseline = path.join(example,'variants/baseline');
const candidate = path.join(example,'variants/candidate');
const taskset = path.join(example,'taskset.json');

test('directory digests are stable and distinguish baseline from candidate',()=>{
  assert.equal(gate.digestDir(candidate),gate.digestDir(candidate));
  assert.notEqual(gate.digestDir(candidate),gate.digestDir(baseline));
  assert.match(gate.digestDir(candidate),/^[0-9a-f]{64}$/);
});
test('variant and taskset inspection remains available without execution',()=>{
  const v=gate.loadVariant(candidate);const t=gate.loadTaskset(taskset);
  assert.equal(v.entry,'run.js');assert.equal(t.tasks.length,12);assert.match(t.digest,/^[0-9a-f]{64}$/);
  assert.equal(gate.scanTripwires(v).length,0);
});
test('known reward-hack fixture is inspectable but cannot run',()=>{
  const v=gate.loadVariant(path.join(example,'variants/reward-hack'));
  const rules=new Set(gate.scanTripwires(v).map(hit=>hit.rule));
  assert.ok(rules.has('hidden_network'));assert.ok(rules.has('checker_probe'));
  assert.throws(()=>gate.runVariant(v,[],'.',{trusted_local:true}),e=>e.code==='gate.isolation_required');
});
test('effect-class expansion remains visible in static tripwire inspection',()=>{
  const v={...gate.loadVariant(candidate),effect_class:'SE3'};
  assert.ok(gate.scanTripwires(v,{max_effect_class:'SE1'}).some(hit=>hit.rule==='effect_class_expansion'));
});
test('honest example also refuses without OS containment and writes no false receipt',()=>{
  const work=tempDir('gate-disabled');
  try {
    assert.throws(()=>gate.runGate({taskset,baseline,candidate,work_dir:work,trusted_local:true}),e=>e.code==='gate.isolation_required');
    assert.deepEqual(fs.readdirSync(work),[]);
  } finally {cleanup(work);}
});
test('malformed tasksets and missing variant manifests reject during inspection',()=>{
  const root=tempDir('gate-invalid');
  try {
    const file=path.join(root,'bad.json');fs.writeFileSync(file,JSON.stringify({version:'1',family:'f',tasks:[{id:'t',input:0}]}));
    assert.throws(()=>gate.loadTaskset(file),e=>e.code==='gate.taskset_invalid');
    assert.throws(()=>gate.loadVariant(root),e=>e.code==='gate.variant_missing');
  } finally {cleanup(root);}
});
test('manifest replacement after validation never changes the object read', () => {
  const root = tempDir('manifest-race');
  const manifest = path.join(root, 'variant.json');
  const saved = path.join(root, 'saved.json');
  const original = JSON.stringify({ name: 'candidate', effect_class: 'SE0' });
  const replacement = JSON.stringify({ name: 'replacement_marker', effect_class: 'SE0' });
  fs.writeFileSync(manifest, original);
  fs.writeFileSync(path.join(root, 'run.js'), 'module.exports={solve:()=>1};');
  const read = fs.readFileSync;
  let swapped = false;
  let observed;
  fs.readFileSync = function(file, ...args) {
    if (!swapped && (file === manifest || typeof file === 'number')) {
      swapped = true;
      fs.renameSync(manifest, saved);
      fs.writeFileSync(manifest, replacement);
      observed = read.call(this, file, ...args);
      return observed;
    }
    return read.call(this, file, ...args);
  };
  try {
    gate.loadVariant(root);
    assert.ok(swapped, 'replacement boundary was exercised');
    assert.strictEqual(String(observed), original, 'read must stay bound to the validated descriptor');
  } finally {
    fs.readFileSync = read;
    cleanup(root);
  }
});

test('manifest descriptors close when parsing fails', () => {
  const root = tempDir('manifest-close');
  fs.writeFileSync(path.join(root, 'variant.json'), '{invalid');
  const open = fs.openSync;
  const close = fs.closeSync;
  const active = new Set();
  fs.openSync = function(...args) {
    const fd = open.apply(this, args);
    active.add(fd);
    return fd;
  };
  fs.closeSync = function(fd) {
    const result = close.call(this, fd);
    active.delete(fd);
    return result;
  };
  try {
    assert.throws(() => gate.loadVariant(root), SyntaxError);
    assert.strictEqual(active.size, 0, 'failed inspection must not leak descriptors');
  } finally {
    fs.openSync = open;
    fs.closeSync = close;
    for (const fd of active) close(fd);
    cleanup(root);
  }
});
finish('gate');
