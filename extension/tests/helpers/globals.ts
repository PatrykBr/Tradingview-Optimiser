import { afterEach } from 'bun:test';

const originals = new Map<string, PropertyDescriptor | undefined>();

/** Install browser/WXT globals and restore their original descriptors after each test. */
export function mockGlobal(name: string, value: unknown): void {
  if (!originals.has(name)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});
