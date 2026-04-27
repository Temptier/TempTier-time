/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApp, getApps, FirebaseApp } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, 
  arrayUnion, arrayRemove 
} from 'firebase/firestore';
import { Timer, FirebaseConfig, Guild } from '../types';
import { StorageAdapter } from './adapters';

export class FirebaseStorageAdapter implements StorageAdapter {
  private db: any = null;
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
      }, appName);
    }
    this.db = getFirestore(this.app);
  }

  async saveTimers(guildId: string, timers: Timer[]): Promise<void> {
    if (!this.db) {
      console.error('Firebase DB not initialized');
      return;
    }
    console.log(`Saving timers for guild ${guildId}`);
    const timersRef = doc(this.db, `guilds/${guildId}/timers`, 'data');
    try {
      const sanitizedTimers = JSON.parse(JSON.stringify(timers));
      await setDoc(timersRef, { timers: sanitizedTimers });
      console.log(`Timers saved for guild ${guildId}`);
    } catch (error) {
      console.error(`Failed to save timers for guild ${guildId}:`, error);
      throw error;
    }
  }

  async loadTimers(guildId: string): Promise<Timer[]> {
    if (!this.db) {
      console.error('Firebase DB not initialized');
      return [];
    }
    console.log(`Loading timers for guild ${guildId}`);
    const timersRef = doc(this.db, `guilds/${guildId}/timers`, 'data');
    try {
      const docSnap = await getDoc(timersRef);
      if (docSnap.exists()) {
        return docSnap.data().timers || [];
      }
      return [];
    } catch (error) {
      console.error(`Failed to load timers for guild ${guildId}:`, error);
      return [];
    }
  }

  subscribe(guildId: string, callback: (timers: Timer[]) => void): () => void {
    if (!this.db) return () => {};
    console.log(`Subscribing to timers for guild ${guildId}`);
    const timersRef = doc(this.db, `guilds/${guildId}/timers`, 'data');
    return onSnapshot(timersRef, (snapshot) => {
      console.log(`Timers snapshot received for guild ${guildId}`);
      if (snapshot.exists() && snapshot.data()) {
        callback(snapshot.data()!.timers || []);
      } else {
        callback([]);
      }
    }, (error) => {
      console.error(`Timers snapshot error for guild ${guildId}:`, error);
    });
  }

  async saveGuildData(guild: Guild): Promise<void> {
    if (!this.db) {
      console.error('Firebase DB not initialized');
      return;
    }
    console.log(`Saving guild data for ${guild.id}`);
    const guildRef = doc(this.db, 'guilds', guild.id);
    
    // Ensure arrays exist to avoid potential undefined issues
    const sanitizedGuild = JSON.parse(JSON.stringify({
      ...guild,
      officerIds: guild.officerIds || [],
      members: guild.members || [],
      pendingApprovals: guild.pendingApprovals || []
    }));
    
    try {
      await setDoc(guildRef, sanitizedGuild);
      console.log(`Guild data saved for ${guild.id}`);
    } catch (error) {
      console.error(`Failed to save guild data for ${guild.id}:`, error);
      throw error;
    }
  }

  async initializeGuild(guild: Guild): Promise<void> {
      // For initialization, we do a full save
      await this.saveGuildData(guild);
  }

  subscribeGuild(guildId: string, callback: (guild: Guild) => void): () => void {
    if (!this.db) return () => {};
    const guildRef = doc(this.db, 'guilds', guildId);
    return onSnapshot(guildRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as Guild;
        callback({
           ...data,
           members: data.members || [],
           officerIds: data.officerIds || [],
           pendingApprovals: data.pendingApprovals || []
        });
      }
    }, (error) => {
      console.error(`Guild snapshot error for guildId ${guildId}:`, error);
    });
  }

  async updateGuildPartial(guildId: string, data: any): Promise<void> {
    if (!this.db) {
      console.error('[FirebaseAdapter] Cannot update: DB not initialized');
      return;
    }
    const guildRef = doc(this.db, 'guilds', guildId);
    
    const scrubData = (obj: any): any => {
      if (obj === null || typeof obj !== 'object') return obj;
      const scrubbed: any = Array.isArray(obj) ? [] : {};
      for (const key in obj) {
        const val = obj[key];
        if (val !== undefined) {
          scrubbed[key] = scrubData(val);
        }
      }
      return scrubbed;
    };

    // Resolve array helpers if present and filter out undefined values
    const finalData: any = {};
    for (const key in data) {
      const val = data[key];
      if (val === undefined) continue;

      if (val && typeof val === 'object' && val._type === 'arrayUnion') {
        if (val.value !== undefined) {
          finalData[key] = arrayUnion(scrubData(val.value));
        }
      } else if (val && typeof val === 'object' && val._type === 'arrayRemove') {
        if (val.value !== undefined) {
          finalData[key] = arrayRemove(scrubData(val.value));
        }
      } else {
        finalData[key] = scrubData(val);
      }
    }

    console.log(`[FirebaseAdapter] Updating guild ${guildId} with keys: ${Object.keys(finalData).join(', ')}`);
    try {
      await setDoc(guildRef, finalData, { merge: true });
      console.log(`[FirebaseAdapter] Guild partial update successful for ${guildId}`);
    } catch (error) {
      console.error(`[FirebaseAdapter] Failed partial update for ${guildId}:`, error);
      throw error;
    }
  }
}
