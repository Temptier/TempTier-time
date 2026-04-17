/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Timer, Guild } from '../types';
import { StorageAdapter } from './adapters';

export class LocalStorageAdapter implements StorageAdapter {
  async saveTimers(guildId: string, timers: Timer[]): Promise<void> {
    localStorage.setItem(`timers_${guildId}`, JSON.stringify(timers));
    window.dispatchEvent(new Event('storage'));
  }

  async loadTimers(guildId: string): Promise<Timer[]> {
    const raw = localStorage.getItem(`timers_${guildId}`);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  subscribe(guildId: string, callback: (timers: Timer[]) => void): () => void {
    const handler = () => {
      this.loadTimers(guildId).then(callback);
    };
    window.addEventListener('storage', handler);
    this.loadTimers(guildId).then(callback);
    return () => window.removeEventListener('storage', handler);
  }

  async saveGuildData(guild: Guild): Promise<void> {
    localStorage.setItem(`guild_${guild.id}`, JSON.stringify(guild));
    window.dispatchEvent(new Event('storage'));
  }

  subscribeGuild(guildId: string, callback: (guild: Guild) => void): () => void {
    const handler = () => {
      const raw = localStorage.getItem(`guild_${guildId}`);
      if (raw) callback(JSON.parse(raw));
    };
    window.addEventListener('storage', handler);
    handler();
    return () => window.removeEventListener('storage', handler);
  }
}
