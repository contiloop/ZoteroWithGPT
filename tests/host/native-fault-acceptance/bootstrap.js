var diagnosticScope;

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  diagnosticScope = {
    Zotero,
    ChromeUtils,
    Services,
    IOUtils,
    PathUtils,
    crypto,
    TextEncoder,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
    structuredClone: (value) => JSON.parse(JSON.stringify(value)),
  };
  Services.scriptloader.loadSubScript(rootURI + "diagnostic.js", diagnosticScope);
  await diagnosticScope.R12NativeFaultAcceptance.start({ id, version, rootURI });
}

function onMainWindowLoad({ window }) {
  diagnosticScope?.R12NativeFaultAcceptance?.onMainWindowLoad?.(window);
}

function onMainWindowUnload({ window }) {
  diagnosticScope?.R12NativeFaultAcceptance?.onMainWindowUnload?.(window);
}

async function shutdown() {
  const stoppingScope = diagnosticScope;
  try {
    await stoppingScope?.R12NativeFaultAcceptance?.stop?.();
  } finally {
    if (diagnosticScope === stoppingScope) diagnosticScope = undefined;
  }
}

function install() {}
function uninstall() {}
