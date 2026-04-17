/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Timer, Guild } from '../types';

export interface StorageAdapter {
  saveTimers(guildId: string, timers: Timer[]): Promise<void>;
  loadTimers(guildId: string): Promise<Timer[]>;
  subscribe(guildId: string, callback: (timers: Timer[]) => void): () => void;
  saveGuildData(guild: Guild): Promise<void>;
  subscribeGuild(guildId: string, callback: (guild: Guild) => void): () => void;
}
