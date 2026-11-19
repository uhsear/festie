import { mock } from 'node:test';

// Fake Socket.IO server for route tests: io.to(room).emit(...) is recorded on _emit.
// Kept free of DB and server imports so mock-only tests need no Postgres.
export function makeIo() {
  const emitFn = mock.fn(() => {});
  return {
    to: mock.fn(() => ({ emit: emitFn })),
    _emit: emitFn,
  };
}
