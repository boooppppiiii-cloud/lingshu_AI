/**
 * Active backend selection — the single swap point.
 *
 * Routes import `store` and `auth` from here. To move to a different backend
 * (e.g. Supabase), implement DataStore + AuthProvider in a new file and switch
 * the assignments below (optionally gated on an env var like DATA_BACKEND).
 */
import type { AuthProvider, DataStore } from './datastore.js';
import { pbStore, pbAuth } from './pbStore.js';

// import { supabaseStore, supabaseAuth } from './supabaseStore.js';
// const backend = process.env.DATA_BACKEND ?? 'pocketbase';

export const store: DataStore = pbStore;
export const auth: AuthProvider = pbAuth;

export type { DataStore, AuthProvider } from './datastore.js';
export type { ListQuery, ListResult, Identity, Where, Record_ } from './datastore.js';
