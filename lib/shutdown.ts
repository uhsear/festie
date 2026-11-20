/**
 * Create the server close handler for graceful shutdown.
 */
function createCloseHandler({
  server,
  io,
  config,
  state,
  log,
  pool,
  redis,
  cacheBus,
  emitter,
  crewNotify,
  clearPresenceTimers,
  avatarPool,
  inFlightRequests,
  sentry,
  reengagementQueue,
}: any) {
  return async function close() {
    const closeStart = Date.now();
    const activeConnections = io.engine?.clientsCount || 0;
    log.info('closing server', {
      activeConnections,
      uptime: Math.round(process.uptime()),
      totalRequests: state.metrics.totalRequests,
    });

    clearPresenceTimers();
    for (const timer of state.timers) clearInterval(timer);
    if (state.reminderScheduler) {
      try {
        state.reminderScheduler.stop();
      } catch (err: any) {
        log.warn('shutdown: reminder scheduler stop failed', { error: err.message });
      }
    }
    if (state.checkinScheduler) {
      try {
        state.checkinScheduler.stop();
      } catch (err: any) {
        log.warn('shutdown: checkin scheduler stop failed', { error: err.message });
      }
    }

    // Flush any pending batched events before disconnecting sockets
    try {
      await emitter?.flushAll?.();
    } catch (err: any) {
      log.warn('emitter flush on shutdown failed', { error: err.message });
    }
    try {
      await crewNotify?.flushAll();
    } catch (err: any) {
      log.warn('crew digest flush on shutdown failed', { error: err.message });
    }

    // Stop accepting new HTTP connections
    if (server.listening) {
      server.close();
    }

    // Emit draining event to all connected sockets
    io.emit('server:draining', { message: 'Server is shutting down' });

    // Gracefully close sockets in batches
    const sockets = Array.from(io.of('/').sockets.values());
    const batchSize = config.DRAIN_BATCH_SIZE;
    const batchDelay = config.DRAIN_BATCH_DELAY_MS;

    for (let i = 0; i < sockets.length; i += batchSize) {
      const batch = sockets.slice(i, i + batchSize);
      for (const socket of batch) {
        (socket as any).disconnect(true);
      }
      if (i + batchSize < sockets.length) {
        await new Promise((resolve) => setTimeout(resolve, batchDelay));
      }
    }

    // Close Socket.IO engine transports
    if (io.engine) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2000);
        io.engine.close(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    // Wait for in-flight requests to complete (with timeout)
    const shutdownStart = Date.now();
    while (inFlightRequests.count > 0 && Date.now() - shutdownStart < config.SHUTDOWN_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (inFlightRequests.count > 0) {
      log.warn('shutdown timeout reached, closing with in-flight requests', {
        inFlightCount: inFlightRequests.count,
      });
    }

    // Drain running sweeps before the pg pool ends, within the shared shutdown deadline.
    if (state.sweepsInFlight?.size > 0) {
      let drainTimer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.allSettled([...state.sweepsInFlight]),
        new Promise((resolve) => {
          drainTimer = setTimeout(resolve, Math.max(0, config.SHUTDOWN_TIMEOUT_MS - (Date.now() - shutdownStart)));
        }),
      ]);
      clearTimeout(drainTimer);
      if (state.sweepsInFlight.size > 0) log.warn('shutdown timeout reached, sweeps still running', { count: state.sweepsInFlight.size });
    }

    if (sentry?.close) await sentry.close(2000);
    // Close the re-engagement worker/queue BEFORE the pg pool: the worker may
    // have an in-flight job whose executor still queries `pool`, so ending the
    // pool first triggers "Cannot use a pool after calling end on the pool".
    // Draining the worker first lets that job finish (or be force-closed) before
    // the pool — and the shared redis client — go away.
    if (reengagementQueue?.close) {
      try {
        await reengagementQueue.close();
      } catch (err: any) {
        log.warn('shutdown: reengagement queue close failed', { error: err.message });
      }
    }
    await pool.end();
    try {
      await avatarPool.terminate();
    } catch (err: any) {
      log.warn('shutdown: avatar pool terminate failed', { error: err.message });
    }
    if (cacheBus) {
      try {
        await cacheBus.close();
      } catch (err: any) {
        log.warn('shutdown: cache bus close failed', { error: err.message });
      }
    }
    if (redis) {
      try {
        redis.disconnect();
      } catch (err: any) {
        log.warn('shutdown: redis disconnect failed', { error: err.message });
      }
    }
    log.info('server closed', { durationMs: Date.now() - closeStart });
  };
}

export { createCloseHandler };
