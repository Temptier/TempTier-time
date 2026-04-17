/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Guild, Timer } from '../types';
import { StorageAdapter } from './adapters';
import { LocalStorageAdapter } from './local-adapter';
import { FirebaseStorageAdapter } from './firebase-adapter';

export class StorageManager {
  private currentAdapter: StorageAdapter | null = null;
  private unsubTimers: (() => void) | null = null;
  private unsubGuild: (() => void) | null = null;

  setGuild(guild: Guild, onTimers: (timers: Timer[]) => void, onData: (guild: Guild) => void) {
    if (this.unsubTimers) this.unsubTimers();
    if (this.unsubGuild) this.unsubGuild();
    
    if (guild.storageType === 'firebase' && guild.firebaseConfig) {
      this.currentAdapter = new FirebaseStorageAdapter(guild.firebaseConfig);
    } else {
      this.currentAdapter = new LocalStorageAdapter();
    }

    this.unsubTimers = this.currentAdapter.subscribe(guild.id, onTimers);
    this.unsubGuild = this.currentAdapter.subscribeGuild(guild.id, onData);
  }

  async saveTimers(guildId: string, timers: Timer[]) {
    if (this.currentAdapter) {
      await this.currentAdapter.saveTimers(guildId, timers);
    }
  }

  async saveGuildData(guild: Guild) {
    if (this.currentAdapter) {
      await this.currentAdapter.saveGuildData(guild);
    }
  }
}
