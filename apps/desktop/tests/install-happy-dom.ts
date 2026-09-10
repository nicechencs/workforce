import { Window } from "happy-dom";

const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLDivElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "HTMLFormElement",
  "HTMLSpanElement",
  "HTMLUListElement",
  "HTMLLIElement",
  "HTMLLabelElement",
  "HTMLParagraphElement",
  "HTMLHeadingElement",
  "HTMLAnchorElement",
  "DocumentFragment",
  "Text",
  "Comment",
  "Event",
  "CustomEvent",
  "InputEvent",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
  "MutationObserver",
  "DOMParser",
  "NodeFilter",
  "NodeList",
  "NamedNodeMap",
  "CSSStyleDeclaration",
  "FormData",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const;

interface InstalledDom {
  window: Window;
  previous: Map<string, PropertyDescriptor | undefined>;
}

let installed: InstalledDom | null = null;

export function installHappyDom(): Window {
  if (installed) {
    return installed.window;
  }
  const window = new Window({ url: "http://127.0.0.1/" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const target = globalThis as typeof globalThis & Record<string, unknown>;
  for (const name of DOM_GLOBALS) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = (window as unknown as Record<string, unknown>)[name];
    const bind =
      name === "getComputedStyle" ||
      name === "requestAnimationFrame" ||
      name === "cancelAnimationFrame";
    Object.defineProperty(target, name, {
      configurable: true,
      writable: true,
      value: bind && typeof value === "function" ? value.bind(window) : value,
    });
  }
  target.window = window;
  target.document = window.document;
  target.IS_REACT_ACT_ENVIRONMENT = true;
  installed = { window, previous };
  return window;
}

export function uninstallHappyDom(): void {
  if (!installed) {
    return;
  }
  const target = globalThis as typeof globalThis & Record<string, unknown>;
  for (const [name, descriptor] of installed.previous) {
    if (descriptor === undefined) {
      delete target[name];
    } else {
      Object.defineProperty(target, name, descriptor);
    }
  }
  installed.window.close();
  installed = null;
}
