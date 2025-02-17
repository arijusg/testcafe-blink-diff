const path = require('path');
const fs = require('fs');

const isFullPage = process.env.FULL_PAGE || process.argv.slice(2).indexOf('--full-page');
const isTakeSnapshot = process.env.TAKE_SNAPSHOT || process.argv.slice(2).indexOf('--take-snapshot');
const snapshotName = isTakeSnapshot > -1 ? process.argv.slice(2)[isTakeSnapshot + 1] : null;

const type = (snapshotName && snapshotName.match(/^[a-z\d_]/) ? snapshotName : null)
  || (isTakeSnapshot !== -1 ? 'base' : 'actual');

function getCurrentStack() {
  let found;

  return (new Error()).stack.split('\n').filter(x => {
    if (x.indexOf('anonymous') !== -1) return false;
    if (found || x.indexOf(' at ') === -1) return true;
    if (x.indexOf('takeSnapshot') !== -1) {
      found = true;
      return false;
    }

    return found;
  }).join('\n');
}

function noop() {
  // do nothing
}

function debug(message) {
  console.warn(`[testcafe-blink-diff] ${message}`);
}

function normalize(value) {
  return value
    .replace(/_/g, '__')
    .replace(/[^a-zA-Z/\d%[(@;,.)\]_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/\//g, '-or-');
}

function _takeSnapshot(t, opts, extra) {
  if (typeof opts === 'string') {
    opts = Object.assign({}, extra, { label: opts });
  }

  const options = Object.assign({}, opts);
  const groupId = t.testRun.test.fixture.name;
  const filename = normalize(options.label || t.testRun.test.name);
  const imagePath = `${normalize(groupId)}/${filename}/${options.as || type}.png`;

  return Promise.resolve()
    .then(() => t.wait(options.timeout === false ? 0 : (options.timeout || 500)))
    .then(() => {
      if (!isFullPage || options.selector) {
        const sel = typeof options.selector === 'function'
          ? options.selector.with({ boundTestRun: t })
          : options.selector;

        return t.takeElementScreenshot(sel, imagePath);
      }

      return t.takeScreenshot(imagePath);
    })
    .then(() => {
      if (options.blockOut) {
        const selectors = Array.isArray(options.blockOut) ? options.blockOut : [options.blockOut];
        const results = [];

        return Promise.all(selectors.map(x => {
          if (typeof x !== 'function') {
            debug(`Expecting a Selector() instance, given '${x}'`);
            return;
          }

          let result;

          return Promise.resolve()
            .then(() => x.with({ boundTestRun: t }))
            .then(_result => {
              result = _result;
            })
            .catch(() => { /* do nothing */ })
            .then(() => {
              if (!result) {
                const key = Object.getOwnPropertySymbols(x)[0];

                debug(`Selector('${x[key].fn}') was not found on the DOM`);
              }

              results.push(result.boundingClientRect);
            });
        })).then(() => {
          const baseDir = path.join(t.testRun.opts.screenshotPath, path.dirname(imagePath));
          const metaFile = path.join(baseDir, 'blockOut.json');

          fs.writeFileSync(metaFile, JSON.stringify(results.filter(Boolean)));
        });
      }
    });
}

function takeSnapshot(t, opts, extra) {
  const fixedStack = getCurrentStack();

  return _takeSnapshot(t, opts, extra).catch(() => {
    const err = new Error('takeSnapshot() failed');

    err.stack = fixedStack;

    throw err;
  });
}

module.exports = {
  takeSnapshot: isTakeSnapshot === -1 ? noop : takeSnapshot,
};
