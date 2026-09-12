/**
 * Optional installer toolchain. T17 does not add these to the lockfile (T01).
 * The packer in this directory produces unpacked trees without them.
 */
export const requiredCoordinatorDependencies = {
  package: "tooling/release",
  reason:
    "Optional electron-builder when NSIS/DMG/AppImage installers are authorized. Not required for unpacked packs.",
  devDependencies: {
    "electron-builder": "26.0.12",
  },
  notInstalled: true,
};
