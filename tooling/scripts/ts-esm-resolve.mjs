/**
 * Node/Electron ESM resolve hook: map TypeScript `./foo.js` specifiers to `./foo.ts`
 * when the compiled JS sibling is missing. Workspace packages export `.ts` sources.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const remapped = remapJsSpecifierToTs(specifier);
    if (!remapped || !isModuleNotFound(error)) {
      throw error;
    }
    return await nextResolve(remapped, context);
  }
}

export function remapJsSpecifierToTs(specifier) {
  if (typeof specifier !== "string") {
    return null;
  }
  if (!(specifier.startsWith("./") || specifier.startsWith("../"))) {
    return null;
  }
  if (!specifier.endsWith(".js")) {
    return null;
  }
  return `${specifier.slice(0, -3)}.ts`;
}

function isModuleNotFound(error) {
  return Boolean(error && typeof error === "object" && error.code === "ERR_MODULE_NOT_FOUND");
}
