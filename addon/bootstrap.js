var companionScope;

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  companionScope = {
    Zotero,
    ChromeUtils,
    Services,
    IOUtils,
    PathUtils,
    Cc: Components.classes,
    Ci: Components.interfaces,
    Cu: Components.utils,
    crypto,
    TextEncoder,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    // The operation core clones validated JSON only. Plugin sandboxes do not
    // expose every Window global, so provide its JSON snapshot primitive here.
    structuredClone: (value) => JSON.parse(JSON.stringify(value)),
  };
  Services.scriptloader.loadSubScript(rootURI + "companion.js", companionScope);
  await companionScope.ResearchCompanion.start({ id, version, rootURI });
}

function onMainWindowLoad({ window }) {
  companionScope?.ResearchCompanion?.onMainWindowLoad?.(window);
}

function onMainWindowUnload({ window }) {
  companionScope?.ResearchCompanion?.onMainWindowUnload?.(window);
}

async function shutdown() {
  await companionScope?.ResearchCompanion?.stop?.();
  companionScope = undefined;
}

function install() {}
function uninstall() {}
