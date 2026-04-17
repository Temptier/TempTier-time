/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Timer, TimerStatus } from './types';

export function calculateRemaining(timer: Timer): number {
  if (timer.type === 'schedule') {
    const now = new Date();
    let nextOccurrence: Date | null = null;

    if (timer.schedules && timer.schedules.length > 0) {
      for (const entry of timer.schedules) {
        const [hours, minutes] = entry.time.split(':').map(Number);
        const occurrence = new Date(now);
        occurrence.setHours(hours, minutes, 0, 0);
        
        const currentDay = occurrence.getDay();
        let daysToAdd = (entry.day - currentDay + 7) % 7;
        
        // If it's the target day but the time has passed, move to next week
        if (daysToAdd === 0 && occurrence.getTime() <= now.getTime()) {
           daysToAdd = 7;
        }
        
        occurrence.setDate(occurrence.getDate() + daysToAdd);
        
        if (!nextOccurrence || occurrence.getTime() < nextOccurrence.getTime()) {
          nextOccurrence = occurrence;
        }
      }
    } else if (timer.scheduledTime) {
      // Fallback for old single-time format
      const [hours, minutes] = timer.scheduledTime.split(':').map(Number);
      const scheduled = new Date(now);
      scheduled.setHours(hours, minutes, 0, 0);
      if (scheduled.getTime() <= now.getTime()) {
        scheduled.setDate(scheduled.getDate() + 1);
      }
      nextOccurrence = scheduled;
    }

    if (!nextOccurrence) return 0;
    return Math.max(0, Math.floor((nextOccurrence.getTime() - now.getTime()) / 1000));
  }

  if (timer.status === 'paused') {
    return timer.remainingWhenPaused || 0;
  }

  if (timer.status === 'running' && timer.endTime) {
    const remaining = Math.floor((timer.endTime - Date.now()) / 1000);
    return Math.max(0, remaining);
  }

  // If status is finished, it should return 0
  if (timer.status === 'finished') {
    return 0;
  }

  return 0;
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

export function startTimer(timer: Timer): Timer {
  const remaining = calculateRemaining(timer);
  if (remaining <= 0 && timer.type !== 'schedule') return { ...timer, status: 'finished' };
  
  const endTime = Date.now() + (timer.status === 'paused' ? (timer.remainingWhenPaused || 0) : remaining) * 1000;
  
  return {
    ...timer,
    status: 'running',
    endTime,
    lastPausedAt: undefined,
    remainingWhenPaused: undefined
  };
}

export function pauseTimer(timer: Timer): Timer {
  if (timer.status !== 'running') return timer;
  const remaining = calculateRemaining(timer);
  return {
    ...timer,
    status: 'paused',
    lastPausedAt: Date.now(),
    remainingWhenPaused: remaining
  };
}

export function resetTimer(timer: Timer): Timer {
  let endTime: number | undefined;
  if (timer.type === 'field') {
    const duration = timer.durationSeconds || 0;
    endTime = Date.now() + duration * 1000;
  } else if (timer.type === 'schedule') {
    const remaining = calculateRemaining(timer);
    endTime = Date.now() + remaining * 1000;
  }

  return {
    ...timer,
    status: 'running',
    endTime,
    lastPausedAt: undefined,
    remainingWhenPaused: undefined
  };
}
