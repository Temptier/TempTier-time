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

  ensureAdapter(guild: Guild) {
    console.log('Ensuring adapter for guild', guild.id, 'type:', guild.storageType);
    // If there is an adapter but it's for a different storage type or different firebase config, reset it.
    if (this.currentAdapter) {
      const isConfigDifferent = guild.storageType === 'firebase' && 
                               guild.firebaseConfig && 
                               ((this.currentAdapter as any).app?.options?.projectId !== guild.firebaseConfig.projectId);
      
      const isTypeDifferent = (guild.storageType === 'firebase' && this.currentAdapter instanceof LocalStorageAdapter) ||
                              (guild.storageType === 'local' && this.currentAdapter instanceof FirebaseStorageAdapter);

      if (isConfigDifferent || isTypeDifferent) {
        console.log('Resetting adapter');
        this.currentAdapter = null;
      }
    }

    if (!this.currentAdapter) {
      if (guild.storageType === 'firebase' && guild.firebaseConfig && guild.firebaseConfig.apiKey && guild.firebaseConfig.projectId) {
        console.log('Creating FirebaseStorageAdapter');
        this.currentAdapter = new FirebaseStorageAdapter(guild.firebaseConfig);
      } else {
        console.log('Creating LocalStorageAdapter');
        this.currentAdapter = new LocalStorageAdapter();
      }
    }
  }

  setGuild(guild: Guild | null, onTimers: (timers: Timer[]) => void, onData: (guild: Guild) => void) {
    if (this.unsubTimers) this.unsubTimers();
    if (this.unsubGuild) this.unsubGuild();
    this.unsubTimers = null;
    this.unsubGuild = null;
    
    if (!guild) {
      this.currentAdapter = null;
      return;
    }
    
    this.currentAdapter = null;
    this.ensureAdapter(guild);

    this.unsubTimers = this.currentAdapter!.subscribe(guild.id, onTimers);
    this.unsubGuild = this.currentAdapter!.subscribeGuild(guild.id, onData);
  }

  async saveTimers(guildId: string, timers: Timer[]) {
    // Note: We need the guild object to know the storage type, 
    // but saveTimers currently only takes guildId.
    // This is a design limitation. We should probably pass the guild or ensure it's initialized.
    if (this.currentAdapter) {
      await this.currentAdapter.saveTimers(guildId, timers);
    }
  }

  async saveGuildData(guild: Guild) {
    this.ensureAdapter(guild);
    if (this.currentAdapter) {
      await this.currentAdapter.saveGuildData(guild);
    }
  }

  async initializeGuild(guild: Guild) {
    this.ensureAdapter(guild);
    if (this.currentAdapter) {
      await this.currentAdapter.initializeGuild(guild);
    }
  }

  async updateGuildPartial(guildId: string, data: any, guildContext?: Guild) {
    if (guildContext) {
      this.ensureAdapter(guildContext);
    }
    console.log('StorageManager updateGuildPartial for guild:', guildId, 'adapter:', this.currentAdapter?.constructor.name);
    if (this.currentAdapter && this.currentAdapter.updateGuildPartial) {
      await this.currentAdapter.updateGuildPartial(guildId, data);
    }
  }

  static arrayUnion(value: any) {
    return { _type: 'arrayUnion', value };
  }

  static arrayRemove(value: any) {
    return { _type: 'arrayRemove', value };
  }
}
