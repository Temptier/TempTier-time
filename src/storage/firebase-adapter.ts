/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApp, getApps, FirebaseApp } from 'firebase/app';
import { getDatabase, ref, set, onValue, off, Database } from 'firebase/database';
import { Timer, FirebaseConfig, Guild } from '../types';
import { StorageAdapter } from './adapters';

export class FirebaseStorageAdapter implements StorageAdapter {
  private db: Database | null = null;
  private app: FirebaseApp | null = null;

  constructor(config: FirebaseConfig) {
    const appName = `app_${config.projectId}`;
    if (getApps().find(a => a.name === appName)) {
      this.app = getApp(appName);
    } else {
      this.app = initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        databaseURL: config.databaseURL
      }, appName);
    }
    this.db = getDatabase(this.app);
  }

  async saveTimers(guildId: string, timers: Timer[]): Promise<void> {
    if (!this.db) return;
    const timersRef = ref(this.db, `guilds/${guildId}/timers`);
    await set(timersRef, timers);
  }

  async loadTimers(guildId: string): Promise<Timer[]> {
    if (!this.db) return [];
    return new Promise((resolve) => {
      const timersRef = ref(this.db, `guilds/${guildId}/timers`);
      onValue(timersRef, (snapshot) => {
        resolve(snapshot.val() || []);
      }, { onlyOnce: true });
    });
  }

  subscribe(guildId: string, callback: (timers: Timer[]) => void): () => void {
    if (!this.db) return () => {};
    const timersRef = ref(this.db, `guilds/${guildId}/timers`);
    const listener = onValue(timersRef, (snapshot) => {
      callback(snapshot.val() || []);
    });
    return () => off(timersRef, 'value', listener);
  }

  async saveGuildData(guild: Guild): Promise<void> {
    if (!this.db) return;
    const guildRef = ref(this.db, `guilds/${guild.id}/data`);
    await set(guildRef, guild);
  }

  subscribeGuild(guildId: string, callback: (guild: Guild) => void): () => void {
    if (!this.db) return () => {};
    const guildRef = ref(this.db, `guilds/${guildId}/data`);
    const listener = onValue(guildRef, (snapshot) => {
      const val = snapshot.val();
      if (val) callback(val);
    });
    return () => off(guildRef, 'value', listener);
  }
}
