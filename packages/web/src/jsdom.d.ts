// jsdom ships no types and @types/jsdom is not a dependency. Declare only what boot-guard.test.tsx uses.
declare module 'jsdom' {
  export class VirtualConsole {}
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    window: Window & typeof globalThis;
  }
}
