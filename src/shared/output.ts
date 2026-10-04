// Terminal control characters are intentional here because this is the output sanitizer.
// eslint-disable-next-line no-control-regex
const ansiPattern = /(?:\u001B\][^\u0007]*(?:\u0007|\u001B\\)|\u001B\[[0-?]*[ -/]*[@-~]|\u009B[0-?]*[ -/]*[@-~])/g;

/** Removes terminal control sequences while preserving human-readable line breaks. */
export function stripAnsi(value: string): string {
  return String(value).replace(ansiPattern, '').replace(/\r\n?/g, '\n');
}
