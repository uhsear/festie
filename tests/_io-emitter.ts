/** Test double for the emitter's generic fan-out methods over a fake `io`; a null `io` drops every emit. */
export function ioEmitter(io: any) {
  return {
    toCrew: (crewId: string, event: string, payload: unknown) => io?.to('crew:' + crewId).emit(event, payload),
    toRoom: (room: string | string[], event: string, payload: unknown) => io?.to(room).emit(event, payload),
    broadcast: (event: string, payload: unknown) => io?.emit(event, payload),
  };
}
