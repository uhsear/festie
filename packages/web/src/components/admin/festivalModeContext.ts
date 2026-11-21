import { createContext, useContext } from 'react';

/**
 * `organizer` runs the festival editors under /manage. The artist match and create routes are admin-only
 * there, so the editors keep a typed name as free text and the server resolves it on save.
 */
export const FestivalModeContext = createContext<'admin' | 'organizer'>('admin');

export const useCanMatchArtists = () => useContext(FestivalModeContext) === 'admin';
