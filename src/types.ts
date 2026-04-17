/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type TimerType = 'field' | 'schedule' | 'repeat';
export type TimerStatus = 'running' | 'paused' | 'finished';
export type StorageType = 'local' | 'firebase';
export type UserRole = 'leader' | 'officer' | 'member';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  databaseURL: string;
}

export interface GuildMember {
  id: string;
  nickname: string;
  joinedAt: string;
}

export interface Guild {
  id: string;
  name: string;
  memberPassword?: string;
  leaderKey?: string; // Used to authenticate as Leader
  storageType: StorageType;
  firebaseConfig?: FirebaseConfig;
  webhookUrl?: string;
  officerIds: string[]; // IDs of users appointed as officers
  members: GuildMember[]; // Approved members
  pendingApprovals: GuildMember[]; // Users waiting for approval
  timers?: Timer[];
}

export interface UserProfile {
  id: string; // Unique ID (local or firebase)
  nickname: string;
  role: UserRole;
  guildId?: string;
  browserNotificationsEnabled?: boolean;
}

export interface ScheduleEntry {
  day: number; // 0 for Sunday, 1 for Monday, etc.
  time: string; // "HH:MM" format
}

export interface Timer {
  id: string;
  guildId: string;
  name: string;
  type: TimerType;
  group: string;
  status: TimerStatus;
  durationSeconds?: number;
  scheduledTime?: string; // Kept for backward compatibility if needed, but we'll prefer schedules
  schedules?: ScheduleEntry[];
  endTime?: number; 
  lastPausedAt?: number;
  remainingWhenPaused?: number;
  autoReset?: boolean;
  alertThreshold?: number;
  autoResetDelay?: number;
  lastSpawnNotifiedAt?: number;
  lastResetNotifiedAt?: number;
  lastThresholdNotifiedAt?: number;
}

export interface AppState {
  guilds: Guild[]; // Local index of known guilds
  currentGuild: Guild | null;
  currentUser: UserProfile;
  view: 'landing' | 'main' | 'control';
  timers: Timer[];
}
