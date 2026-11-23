import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { createSocket, createAuthErrorHandler } from '../services/socket';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';
import { useFestivalStore } from '../stores/festivalStore';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import { OnlineUser } from '../types';

export interface UseSocketReturn {
  socket: Socket | null;
  connected: boolean;
  onlineUsers: OnlineUser[];
}

export function useSocket(festivalId?: string): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  // Published as state so consumers re-render and re-attach listeners once the
  // effect creates the socket; a ref read at render time stays null for them.
  const [liveSocket, setLiveSocket] = useState<Socket | null>(null);
  // Invariant: joinedFestivalIdRef.current holds the festivalId that the
  // currently-live socket emitted `join:festival` for. Updated
  // synchronously at the top of each effect run and read in the cleanup.
  // Using a ref (rather than a closure-captured local) keeps the leave/
  // join sides in lockstep even under rapid festivalId switches
  // (A -> B -> C), so we never emit `leave:festival` against a socket
  // that has since joined C.
  const joinedFestivalIdRef = useRef<string | null>(null);
  const userToken = useAuthStore((state) => state.userToken);
  const connected = useUIStore((state) => state.connected);
  const setConnected = useUIStore((state) => state.setConnected);
  const addOnlineUser = useUIStore((state) => state.addOnlineUser);
  const removeOnlineUser = useUIStore((state) => state.removeOnlineUser);
  const onlineUsers = useUIStore((state) => state.onlineUsers);
  const currentFestivalId = useFestivalStore((state) => state.currentFestivalId);
  // The server rejects crew realtime for signed-in non-members; join only once a profile exists.
  const isMember = useFestivalDataStore((state) => state.currentProfile != null);
  // Boolean, not the user object: checkSession/profile edits replace `user` and would recreate the socket.
  const canJoin = useAuthStore((state) => !state.user) || isMember;

  useEffect(() => {
    const joinedFestivalId = canJoin ? festivalId || currentFestivalId : undefined;
    // A socket that never emits join:festival is dropped by the server after 5 s
    // (socket:auth-timeout), so do not connect until there is a room to join.
    if (!joinedFestivalId) {
      joinedFestivalIdRef.current = null;
      return;
    }
    const socket = createSocket(userToken || undefined, undefined, createAuthErrorHandler(() => socketRef.current, useAuthStore.getState));
    // Sync the ref BEFORE wiring handlers so handleConnect reads the
    // right id and cleanup can leave the right room.
    joinedFestivalIdRef.current = joinedFestivalId;

    const handleConnect = () => {
      setConnected(true);
      const joinId = joinedFestivalIdRef.current;
      if (joinId) {
        socket.emit('join:festival', joinId, { _v: 1 }, () => {});
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
    };

    const handleUserOnline = (user: OnlineUser) => {
      addOnlineUser(user);
    };

    const handleUserOffline = (userId: string) => {
      removeOnlineUser(userId);
    };

    const handleError = (error: Error) => {
      console.error('Socket error:', error);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('user:online', handleUserOnline);
    socket.on('user:offline', handleUserOffline);
    socket.on('error', handleError);

    socketRef.current = socket;
    setLiveSocket(socket);

    return () => {
      // Leave the festival room before tearing down so the server stops
      // broadcasting picks to a room we no longer care about. Read the
      // ref rather than the closure-captured local to respect the
      // invariant documented above.
      const toLeave = joinedFestivalIdRef.current;
      if (toLeave && socket.connected) {
        socket.emit('leave:festival');
      }
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('user:online', handleUserOnline);
      socket.off('user:offline', handleUserOffline);
      socket.off('error', handleError);
      socket.disconnect();
      socketRef.current = null;
      setLiveSocket(null);
    };
  }, [userToken, festivalId, currentFestivalId, canJoin, setConnected, addOnlineUser, removeOnlineUser]);

  return {
    socket: liveSocket,
    connected,
    onlineUsers,
  };
}
