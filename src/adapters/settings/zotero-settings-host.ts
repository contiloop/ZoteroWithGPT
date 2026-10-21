import {
  SETTINGS_PREFERENCE_NAMES,
  type SettingsDialogAction,
  type SettingsHostPort,
  type SettingsSnapshot,
  type SettingsWindowLike,
} from "./types.js";

const FILE_PICKER_MODULE = "chrome://zotero/content/modules/filePicker.mjs";
const MENU_ITEM_ID = "zotero-ai-research-companion-settings";
const OWNED_PREFERENCES = new Set<string>(Object.values(SETTINGS_PREFERENCE_NAMES));

interface ZoteroPreferencesLike {
  get(name: string, global: true): unknown;
  set(name: string, value: boolean | string, global: true): void;
}

interface PromptServiceLike {
  readonly BUTTON_POS_0: number;
  readonly BUTTON_POS_1: number;
  readonly BUTTON_POS_2: number;
  readonly BUTTON_TITLE_IS_STRING: number;
  confirmEx(
    parent: unknown,
    title: string,
    text: string,
    buttonFlags: number,
    button0Title: string,
    button1Title: string,
    button2Title: string,
    checkMessage: string | null,
    checkState: { value: boolean },
  ): number;
  alert(parent: unknown, title: string, text: string): void;
}

interface ZoteroFilePickerLike {
  readonly modeGetFolder: number;
  readonly returnOK: number;
  displayDirectory?: string;
  readonly file: string;
  init(parent: unknown, title: string, mode: number): void;
  show(): Promise<number>;
}

interface MenuElementLike {
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  appendChild?(child: MenuElementLike): void;
  remove(): void;
}

interface MenuDocumentLike {
  getElementById(id: string): MenuElementLike | null;
  createXULElement(name: string): MenuElementLike;
}

interface MenuWindowLike extends SettingsWindowLike {
  readonly document: MenuDocumentLike;
}

export interface ZoteroSettingsEnvironment {
  Zotero: {
    Prefs: ZoteroPreferencesLike;
    logError?(error: unknown): void;
  };
  ChromeUtils: {
    importESModule(uri: string): { FilePicker?: new () => ZoteroFilePickerLike };
  };
  Services: { prompt: PromptServiceLike };
  PathUtils: { normalize(path: string): string };
}

function isMenuWindow(window: SettingsWindowLike): window is MenuWindowLike {
  const document = window.document as Partial<MenuDocumentLike> | undefined;
  return (
    document !== undefined &&
    typeof document.getElementById === "function" &&
    typeof document.createXULElement === "function"
  );
}

function promptButtons(snapshot: SettingsSnapshot): {
  labels: readonly [string, string, string];
  actions: readonly [SettingsDialogAction, SettingsDialogAction, SettingsDialogAction];
} {
  if (snapshot.status.state === "ready" || snapshot.status.state === "connecting") {
    return {
      labels: ["Disable", "Close", "Reconnect"],
      actions: ["disable", "close", "reconnect"],
    };
  }
  return {
    labels: ["Enable", "Close", "Choose Directory…"],
    actions: ["enable", "close", "choose_directory"],
  };
}

/** Zotero 10 host implementation using its documented bootstrap window hooks. */
export function createZoteroSettingsHost(
  environment: ZoteroSettingsEnvironment,
): SettingsHostPort {
  let FilePicker: (new () => ZoteroFilePickerLike) | undefined;
  const filePickerClass = (): (new () => ZoteroFilePickerLike) => {
    if (FilePicker !== undefined) return FilePicker;
    const imported = environment.ChromeUtils.importESModule(FILE_PICKER_MODULE).FilePicker;
    if (imported === undefined) throw new Error("Zotero's native file picker is unavailable");
    FilePicker = imported;
    return FilePicker;
  };

  return {
    getPreference(name): unknown {
      try {
        return environment.Zotero.Prefs.get(name, true);
      } catch (error) {
        environment.Zotero.logError?.(error);
        return undefined;
      }
    },

    setPreference(name, value): void {
      if (!OWNED_PREFERENCES.has(name)) {
        throw new Error(`Refusing preference outside the companion namespace: ${name}`);
      }
      environment.Zotero.Prefs.set(name, value, true);
    },

    normalizeDirectory(directory): string {
      return environment.PathUtils.normalize(directory);
    },

    async chooseDirectory(window, currentDirectory): Promise<string | undefined> {
      const Picker = filePickerClass();
      const picker = new Picker();
      picker.init(window, "Choose a dedicated Research Companion directory", picker.modeGetFolder);
      if (currentDirectory !== undefined) picker.displayDirectory = currentDirectory;
      const result = await picker.show();
      return result === picker.returnOK ? picker.file : undefined;
    },

    addToolsMenu(window, openSettings): () => void {
      if (!isMenuWindow(window)) {
        environment.Zotero.logError?.(
          new Error("Research Companion could not access the Zotero main-window document"),
        );
        return () => {};
      }
      const toolsMenu = window.document.getElementById("menu_ToolsPopup");
      if (toolsMenu === null || toolsMenu.appendChild === undefined) {
        environment.Zotero.logError?.(
          new Error("Research Companion could not find Zotero's Tools menu"),
        );
        return () => {};
      }
      window.document.getElementById(MENU_ITEM_ID)?.remove();
      const item = window.document.createXULElement("menuitem");
      item.setAttribute("id", MENU_ITEM_ID);
      item.setAttribute("label", "Research Companion Settings…");
      const command = (): void => {
        Promise.resolve(openSettings()).catch((error: unknown) => {
          environment.Zotero.logError?.(error);
          environment.Services.prompt.alert(window, "Research Companion", errorMessage(error));
        });
      };
      item.addEventListener("command", command);
      toolsMenu.appendChild(item);
      return () => {
        item.removeEventListener("command", command);
        item.remove();
      };
    },

    async promptAction(window, snapshot): Promise<SettingsDialogAction> {
      const { prompt } = environment.Services;
      const { labels, actions } = promptButtons(snapshot);
      const flags =
        prompt.BUTTON_POS_0 * prompt.BUTTON_TITLE_IS_STRING |
        prompt.BUTTON_POS_1 * prompt.BUTTON_TITLE_IS_STRING |
        prompt.BUTTON_POS_2 * prompt.BUTTON_TITLE_IS_STRING;
      const selected = prompt.confirmEx(
        window,
        "Research Companion",
        snapshot.diagnostics.join("\n"),
        flags,
        labels[0],
        labels[1],
        labels[2],
        null,
        { value: false },
      );
      return actions[selected] ?? "close";
    },

    showError(window, title, message): void {
      environment.Services.prompt.alert(window, title, message);
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The settings window could not be opened";
}
