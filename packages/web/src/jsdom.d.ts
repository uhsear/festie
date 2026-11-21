// Test-only stub (boot-guard.test.tsx): jsdom ships no types and @types/jsdom is not a dependency. Declare only what that test uses.
declare module 'jsdom' {
  export class VirtualConsole {}
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    window: Window & typeof globalThis;
  }
}
