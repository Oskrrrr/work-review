// CloudBase HTTP functions require scf_bootstrap to be executable on Linux.
// Windows reports every regular text file as 0666, so make the deployment
// packager observe 0755 for this one file.
const fs = require('node:fs');
const path = require('node:path');
const isBootstrap = file => path.basename(String(file)) === 'scf_bootstrap';
const patchStat = (file, stat) => {
  if (!stat || !isBootstrap(file)) return stat;
  return new Proxy(stat, { get(target, property) { return property === 'mode' ? 0o100755 : target[property]; } });
};
const originalStatSync = fs.statSync;
fs.statSync = function patchedStatSync(file, options) { return patchStat(file, originalStatSync.call(fs, file, options)); };
const originalStat = fs.stat;
fs.stat = function patchedStat(file, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? undefined : options;
  return originalStat.call(fs, file, opts, (error, stat) => cb(error, patchStat(file, stat)));
};
const originalPromiseStat = fs.promises.stat;
fs.promises.stat = async function patchedPromiseStat(file, options) { return patchStat(file, await originalPromiseStat.call(fs.promises, file, options)); };
const originalLstatSync = fs.lstatSync;
fs.lstatSync = function patchedLstatSync(file, options) { return patchStat(file, originalLstatSync.call(fs, file, options)); };
const originalLstat = fs.lstat;
fs.lstat = function patchedLstat(file, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? undefined : options;
  return originalLstat.call(fs, file, opts, (error, stat) => cb(error, patchStat(file, stat)));
};
const originalPromiseLstat = fs.promises.lstat;
fs.promises.lstat = async function patchedPromiseLstat(file, options) {
  return patchStat(file, await originalPromiseLstat.call(fs.promises, file, options));
};
