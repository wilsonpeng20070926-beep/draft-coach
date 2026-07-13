export function deriveProPatchWindow(version: string): string[] {
  const [major, minor] = version.split(".").slice(0, 2).map(Number);

  if (!Number.isInteger(major) || !Number.isInteger(minor) || major <= 0 || minor <= 0) {
    throw new Error(`Cannot derive a professional-data patch window from ${version || "unknown"}`);
  }

  const patches: string[] = [];
  let patchMajor = major;
  let patchMinor = minor;

  while (patches.length < 3) {
    patches.push(`${patchMajor}.${patchMinor}`);
    patchMinor -= 1;

    if (patchMinor === 0) {
      patchMajor -= 1;
      patchMinor = 24;
    }
  }

  return patches;
}
