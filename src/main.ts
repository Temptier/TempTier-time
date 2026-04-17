/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  createIcons, Plus, Settings, Trash2, Play, Pause, RotateCcw, Edit, 
  Server as ServerIcon, Database, Bell, FileJson, LayoutGrid, ChevronRight, 
  Webhook, RefreshCw, MoreVertical, X, LogOut, Shield, UserCircle, LogIn,
  Users, Key, ShieldCheck, Lock, Unlock, Eye, EyeOff
} from 'lucide';
import { AppState, Timer, Guild, TimerType, UserProfile, UserRole } from './types';
import { StorageManager } from './storage/manager';
import { calculateRemaining, formatTime, startTimer, pauseTimer, resetTimer } from './timer-logic';
import { 
  sendDiscordNotification, 
  requestNotificationPermission, 
  sendBrowserNotification 
} from './notifications';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import './index.css';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

async function notifyGuild(guild: Guild, message: string) {
  if (guild.webhookUrl) {
    await sendDiscordNotification(guild.webhookUrl, message);
  }
}

function notifyLocal(timer: Timer, type: 'threshold' | 'spawn' | 'reset', message: string) {
  const map = type === 'threshold' ? notifiedLocalThresholds : type === 'spawn' ? notifiedLocalSpawns : notifiedLocalResets;
  
  if (map.get(timer.id) === timer.endTime) return;
  
  // Trigger audio
  if (type === 'spawn') triggerAudioAlert();
  
  // Trigger browser notification
  if (state.currentUser.browserNotificationsEnabled) {
    const cleanMessage = message.replace(/\*\*/g, '');
    sendBrowserNotification('Chronos Alert', cleanMessage);
  }
  
  map.set(timer.id, timer.endTime || 0);
}

// --- GLOBAL STATE ---
let state: AppState = {
  guilds: [],
  currentGuild: null,
  currentUser: {
    id: crypto.randomUUID(),
    nickname: 'New Explorer',
    role: 'member'
  },
  view: 'landing',
  timers: []
};

let storageManager = new StorageManager();
const appRoot = document.getElementById('app')!;
let onboardingShown = false;
let wakeLock: any = null;

// Initialize background worker
const timerWorker = new Worker(new URL('./timer-worker.ts', import.meta.url), { type: 'module' });
timerWorker.onmessage = (e) => {
  if (e.data.type === 'TICK') {
    checkTimersFinished(state.timers);
  }
};
timerWorker.postMessage({ type: 'START' });

// Stay awake if possible
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await (navigator as any).wakeLock.request('screen');
      console.log('Wake Lock active');
    } catch (err) {
      console.log('Wake Lock failed:', err);
    }
  }
}
requestWakeLock();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    render();
    requestWakeLock();
  }
});

// Local tracking for audio/browser alerts (id -> notified endTime)
const notifiedLocalThresholds = new Map<string, number>();
const notifiedLocalSpawns = new Map<string, number>();
const notifiedLocalResets = new Map<string, number>();

// --- UI HELPERS ---

function updateLucideIcons() {
  createIcons({
    icons: {
      Plus, Settings, Trash2, Play, Pause, RotateCcw, Edit, 
      ServerIcon, Database, Bell, FileJson, LayoutGrid, ChevronRight, 
      Webhook, RefreshCw, MoreVertical, X, LogOut, Shield, UserCircle, LogIn,
      Users, Key, ShieldCheck, Lock, Unlock, Eye, EyeOff
    }
  });
}

// --- DATA PERSISTENCE ---

function saveLocal() {
  localStorage.setItem('chronos_user', JSON.stringify(state.currentUser));
  localStorage.setItem('chronos_known_guilds', JSON.stringify(state.guilds));
  localStorage.setItem('chronos_view', state.view);
  if (state.currentGuild) {
    localStorage.setItem('chronos_active_guild_id', state.currentGuild.id);
  }
}

function loadLocal() {
  const user = localStorage.getItem('chronos_user');
  const guilds = localStorage.getItem('chronos_known_guilds');
  const view = localStorage.getItem('chronos_view');
  const activeId = localStorage.getItem('chronos_active_guild_id');

  if (user) {
    state.currentUser = JSON.parse(user);
    onboardingShown = true; // User already exists, so onboarding is considered done
  } else {
    onboardingShown = false;
  }
  
  if (guilds) {
    state.guilds = JSON.parse(guilds);
  } else {
    // Inject a dummy guild for first-time testing
    const demoGuild: Guild = {
      id: 'demo-guild-123',
      name: 'Royal Pride',
      memberPassword: '1234',
      leaderKey: 'demo-leader-key',
      storageType: 'local',
      officerIds: [],
      members: [],
      pendingApprovals: []
    };
    state.guilds = [demoGuild];
    localStorage.setItem('chronos_known_guilds', JSON.stringify(state.guilds));
  }
  if (view) state.view = view as any;

  if (activeId) {
    const guild = state.guilds.find(g => g.id === activeId);
    if (guild) {
      // Re-establish sync
      storageManager.setGuild(
        guild, 
        (timers) => { 
          state.timers = timers; 
          checkTimersFinished(timers);
          render(); 
        },
        (updatedGuild) => {
          // If synced data changes (e.g. officer list updated by leader)
          state.currentGuild = { ...state.currentGuild, ...updatedGuild };
          updateLocalGuildRegistry(updatedGuild);
          updateRoleFromGuild();
          render();
        }
      );
      state.currentGuild = guild;
      updateRoleFromGuild();
    } else {
      state.view = 'landing';
    }
  } else {
    state.view = 'landing';
  }
  render();
}

function updateLocalGuildRegistry(guild: Guild) {
  const idx = state.guilds.findIndex(g => g.id === guild.id);
  if (idx !== -1) {
    state.guilds[idx] = guild;
  } else {
    state.guilds.push(guild);
  }
  saveLocal();
}

function updateRoleFromGuild() {
  if (!state.currentGuild) return;
  
  const savedKey = localStorage.getItem(`auth_key_${state.currentGuild.id}`);
  const isLeader = savedKey === state.currentGuild.leaderKey;
  
  // Members check
  const isMember = (state.currentGuild.members || []).some(m => m.id === state.currentUser.id);
  
  if (!isLeader && !isMember) {
     leaveGuild();
     showAlert("You have been removed from this guild.", "Access Revoked");
     return;
  }

  // Checking role priority
  if (isLeader) {
     state.currentUser.role = 'leader';
     return;
  }
  
  if (state.currentGuild.officerIds.includes(state.currentUser.id)) {
     state.currentUser.role = 'officer';
  } else {
     state.currentUser.role = 'member';
  }
}

// --- CORE ACTIONS ---

function joinGuild(guildId: string, password?: string) {
  const guild = state.guilds.find(g => g.id === guildId);
  if (!guild) return showAlert('Guild not found in your local registry.', 'Connection Error');

  const savedKey = localStorage.getItem(`auth_key_${guild.id}`);
  const isLeader = savedKey === guild.leaderKey;
  const isMember = (guild.members || []).some(m => m.id === state.currentUser.id);
  
  // 1. Check if already authorized
  if (isLeader || isMember) {
    proceedToJoin(guild);
    return;
  }

  const hasPasswordRequired = !!guild.memberPassword;

  // 2. Automated password join
  if (hasPasswordRequired) {
    if (password === undefined) {
      showJoinPasswordModal(guildId);
      return;
    }
    
    if (guild.memberPassword === password) {
       // Add to members
       const nickname = state.currentUser.nickname;
       if (!guild.members) guild.members = [];
       guild.members.push({ id: state.currentUser.id, nickname, joinedAt: new Date().toISOString() });
       storageManager.saveGuildData(guild);
       proceedToJoin(guild);
    } else {
       return showAlert('Incorrect Guild Password. Please try again.', 'Access Denied');
    }
    return;
  }

  // 3. Manual Approval join
  const isPending = guild.pendingApprovals?.some(p => p.id === state.currentUser.id);
  if (isPending) {
     showAlert("Your join request is still pending approval from a Leader or Officer.", "Wait for Approval");
     return;
  }

  if (!guild.pendingApprovals) guild.pendingApprovals = [];
  const nickname = state.currentUser.nickname;
  guild.pendingApprovals.push({ id: state.currentUser.id, nickname, joinedAt: new Date().toISOString() });
  storageManager.saveGuildData(guild);
  showAlert("This guild requires manual approval. Your request has been sent to the leaders.", "Request Sent");
  render();
}

function proceedToJoin(guild: Guild) {
  state.currentGuild = guild;
  state.view = 'main';
  
  storageManager.setGuild(
    guild, 
    (timers) => { state.timers = timers; checkTimersFinished(timers); render(); },
    (updatedGuild) => {
       state.currentGuild = { ...state.currentGuild, ...updatedGuild };
       updateLocalGuildRegistry(updatedGuild);
       updateRoleFromGuild();
       render();
    }
  );
  
  updateRoleFromGuild();
  saveLocal();
  render();
}

function leaveGuild() {
  state.currentGuild = null;
  state.view = 'landing';
  localStorage.removeItem('chronos_active_guild_id');
  saveLocal();
  render();
}

function checkTimersFinished(timers: Timer[]) {
  if (!state.currentGuild) return;
  const now = Date.now();

  timers.forEach(timer => {
    if (timer.status === 'running') {
      const remaining = calculateRemaining(timer);

      // 1. Threshold alert (e.g. 5 mins before spawn)
      if (timer.alertThreshold && remaining <= (timer.alertThreshold * 60) && remaining > 0) {
        // Shared Notification
        if (timer.lastThresholdNotifiedAt !== timer.endTime) {
          notifyGuild(state.currentGuild!, `⏳ **${timer.name}** will spawn in **${timer.alertThreshold} mins**!`);
          updateTimer({ ...timer, lastThresholdNotifiedAt: timer.endTime });
        }
        // Local Alert
        notifyLocal(timer, 'threshold', `⏳ **${timer.name}** will spawn in **${timer.alertThreshold} mins**!`);
      }

      // 2. Spawn alert
      if (remaining <= 0) {
        // Shared Notification
        if (timer.lastSpawnNotifiedAt !== timer.endTime) {
          notifyGuild(state.currentGuild!, `🔔 **${timer.name}** has spawned`);
          updateTimer({ ...timer, lastSpawnNotifiedAt: timer.endTime });
        }
        // Local Alert
        notifyLocal(timer, 'spawn', `🔔 **${timer.name}** has spawned`);

        // 3. Auto-reset with Delay
        if (timer.autoReset && timer.type === 'field') {
          const delayMs = (timer.autoResetDelay || 0) * 1000;
          if (now >= (timer.endTime || 0) + delayMs) {
            // Shared Notification
            if (timer.lastResetNotifiedAt !== timer.endTime) {
              notifyGuild(state.currentGuild!, `♻️ **${timer.name}** is automatically reset`);
              const nextTimer = resetTimer(timer);
              // Clear notification history for new cycle in shared state
              nextTimer.lastSpawnNotifiedAt = undefined;
              nextTimer.lastResetNotifiedAt = undefined;
              nextTimer.lastThresholdNotifiedAt = undefined;
              updateTimer(nextTimer);
            }
            // Local Alert
            notifyLocal(timer, 'reset', `♻️ **${timer.name}** is automatically reset`);
          }
        } else if (remaining <= 0 && !timer.autoReset) {
          // If not auto-reset, just mark as finished
          updateTimer({ ...timer, status: 'finished' });
        }
      }
    }
  });
}

function triggerAudioAlert() {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
    oscillator.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.5);
  } catch(e) {}
}

function updateTimer(updatedTimer: Timer) {
  if (!state.currentGuild) return;
  const index = state.timers.findIndex(t => t.id === updatedTimer.id);
  if (index !== -1) {
    const newTimers = [...state.timers];
    newTimers[index] = updatedTimer;
    storageManager.saveTimers(state.currentGuild.id, newTimers);
  }
}

// --- RENDER LOGIC ---

function render() {
  appRoot.innerHTML = '';
  
  // Show onboarding for first-time users
  if (!onboardingShown) {
    onboardingShown = true; // Set to true immediately to avoid recursive loops if render is called
    setTimeout(() => showOnboardingModal(), 100);
  }

  let content: HTMLElement;
  switch (state.view) {
    case 'landing':
      content = renderLanding();
      break;
    case 'main':
      content = renderMainPage();
      break;
    case 'control':
      content = renderControlRoom();
      break;
    default:
      content = renderLanding();
  }

  appRoot.appendChild(content);
  updateLucideIcons();
}

function renderLanding() {
  const div = document.createElement('div');
  div.className = 'flex-1 flex flex-col items-center justify-center p-6 bg-navy-dark';
  div.innerHTML = `
    <div class="w-full max-w-md space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div class="text-center space-y-3">
        <div class="w-24 h-24 bg-gold rounded-3xl mx-auto flex items-center justify-center shadow-2xl shadow-gold/30 mb-8 border-4 border-navy-dark overflow-hidden">
           <img src="/icon.png" alt="Chronos Lion" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
           <div style="display:none" class="w-full h-full flex items-center justify-center bg-gold">
              <span data-lucide="shield" class="w-12 h-12 text-navy-dark"></span>
           </div>
        </div>
        <h1 class="text-4xl font-black text-white tracking-tighter">CHRONOS</h1>
        <p class="text-gray-400 text-sm max-w-[320px] mx-auto leading-relaxed">Elite Timer Coordination for Competitive Guilds</p>
      </div>

      <div class="grid grid-cols-1 gap-4">
        <button id="btn-create-guild" class="flex items-center gap-4 p-5 glass-card hover:bg-gold/10 transition-all text-left group">
           <div class="w-12 h-12 bg-gold/10 rounded-xl flex items-center justify-center group-hover:bg-gold transition-colors">
              <span data-lucide="plus" class="w-6 h-6 text-gold group-hover:text-navy-dark"></span>
           </div>
           <div>
              <p class="font-bold text-white">Establish New Realm</p>
              <p class="text-xs text-gray-400">Start fresh guild storage & sync.</p>
           </div>
        </button>

        <div class="space-y-3">
          <span class="label px-2">Joined Guilds</span>
          ${state.guilds.length === 0 ? `
             <p class="text-sm text-center py-6 text-gray-600 italic">No guilds joined yet.</p>
          ` : `
             <div class="space-y-2">
                ${state.guilds.map(g => {
                  const isMember = (g.members || []).some(m => m.id === state.currentUser.id);
                  const isLeader = localStorage.getItem(`auth_key_${g.id}`) === g.leaderKey;
                  const isPending = (g.pendingApprovals || []).some(p => p.id === state.currentUser.id);
                  const status = (isMember || isLeader) ? 'active' : (isPending ? 'pending' : 'none');
                  
                  return `
                  <button class="guild-item w-full flex items-center gap-3 p-3 glass-card hover:bg-white/5 disabled:opacity-50 disabled:cursor-wait transition-all text-left" data-guild-id="${g.id}" ${status === 'pending' ? 'disabled' : ''}>
                     <div class="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center">
                        <span data-lucide="users" class="w-4 h-4 text-gray-400"></span>
                     </div>
                     <span class="flex-1 font-medium text-sm">${g.name}</span>
                     ${status === 'pending' ? `
                        <div class="flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 rounded-lg">
                           <span data-lucide="clock" class="w-3 h-3 text-amber-500"></span>
                           <span class="text-[8px] font-black text-amber-500 uppercase tracking-widest">Pending</span>
                        </div>
                     ` : `
                        <span data-lucide="log-in" class="w-4 h-4 text-gray-600"></span>
                     `}
                  </button>
                  `;
                }).join('')}
             </div>
          `}
          <button id="btn-join-code" class="w-full py-2 text-xs font-black uppercase tracking-[0.2em] text-gold hover:text-[#d4af37] transition-colors mt-2">
             Have an invite code?
          </button>
        </div>
      </div>
      
      <div class="pt-8 border-t border-white/5 text-center">
         <button id="btn-edit-user" class="text-xs text-gray-500 hover:text-white transition-colors flex items-center gap-2 mx-auto">
            <span data-lucide="user-circle" class="w-4 h-4"></span>
            Profile: ${state.currentUser.nickname}
         </button>
      </div>
    </div>
  `;

  div.querySelector('#btn-create-guild')?.addEventListener('click', () => showCreateGuildModal());
  div.querySelector('#btn-edit-user')?.addEventListener('click', () => showProfileModal());
  div.querySelector('#btn-join-code')?.addEventListener('click', () => showJoinByCodeModal());
  
  div.querySelectorAll('.guild-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-guild-id')!;
      joinGuild(id);
    });
  });

  return div;
}

function renderMainPage() {
  const guild = state.currentGuild!;
  const main = document.createElement('div');
  main.className = 'flex flex-col h-screen';
  
  main.innerHTML = `
    <header class="p-6 border-b border-white/5 flex items-center justify-between bg-[#111318]">
      <div class="flex items-center gap-4">
        <button id="btn-back-landing" class="p-2 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-colors">
          <span data-lucide="log-out" class="w-5 h-5"></span>
        </button>
        <div>
          <h2 class="text-xl font-bold tracking-tight">${guild.name}</h2>
          <div class="flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-gray-500">
             <span class="text-gold">${state.currentUser.role}</span>
             <span>•</span>
             <span>${state.timers.length} Timers</span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button id="btn-toggle-profile" class="px-3 py-1.5 glass-card flex items-center gap-2 text-xs hover:bg-white/10 transition-colors">
           <span data-lucide="user-circle" class="w-4 h-4 text-gold"></span>
           <span class="hidden sm:inline">${state.currentUser.nickname}</span>
        </button>
        <button id="btn-go-control" class="btn btn-primary flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
           <span data-lucide="shield" class="w-3.5 h-3.5"></span>
           Control Room
        </button>
      </div>
    </header>

    <div id="timers-container" class="flex-1 overflow-y-auto px-6 py-8">
    </div>
  `;

  main.querySelector('#btn-back-landing')?.addEventListener('click', () => leaveGuild());
  main.querySelector('#btn-toggle-profile')?.addEventListener('click', () => showProfileModal());
  main.querySelector('#btn-go-control')?.addEventListener('click', () => {
    state.view = 'control';
    saveLocal();
    render();
  });

  const timersContainer = main.querySelector('#timers-container')!;
  timersContainer.appendChild(renderTimerGrid(guild));

  return main;
}

function renderTimerGrid(_guild: Guild) {
  const container = document.createElement('div');
  container.className = 'px-4 max-w-7xl mx-auto space-y-12';

  if (state.timers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'flex flex-col items-center justify-center p-20 text-center text-gray-600';
    empty.innerHTML = `
      <span data-lucide="bell" class="w-12 h-12 mb-4 opacity-20"></span>
      <p>No active timers found for this guild.</p>
      ${state.currentUser.role !== 'member' ? '<p class="text-xs mt-2">Go to Control Room to add one.</p>' : ''}
    `;
    return empty;
  }

  // Add "Upcoming Bosses Today" section
  const now = new Date();
  const upcomingToday = state.timers.filter(timer => {
    if (!timer.endTime) return false;
    const end = new Date(timer.endTime);
    return end.getDate() === now.getDate() && 
           end.getMonth() === now.getMonth() && 
           end.getFullYear() === now.getFullYear() &&
           end.getTime() > now.getTime(); // Future events today
  }).sort((a, b) => (a.endTime || 0) - (b.endTime || 0));

  if (upcomingToday.length > 0) {
    const section = document.createElement('section');
    section.className = 'space-y-3 animate-in fade-in slide-in-from-top-4 duration-700 bg-gold/5 p-4 rounded-2xl border border-gold/10';
    section.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
           <span data-lucide="zap" class="w-3 h-3 text-gold"></span>
           <h3 class="text-[10px] font-black uppercase tracking-[0.2em] text-gold">Upcoming Today</h3>
        </div>
        <span class="text-[10px] text-gold/60 font-mono">${upcomingToday.length} Event${upcomingToday.length > 1 ? 's' : ''} Remaining</span>
      </div>
      <div class="flex flex-wrap gap-x-6 gap-y-2">
        ${upcomingToday.map(t => {
          const remaining = calculateRemaining(t);
          const timeStr = new Date(t.endTime!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return `
            <div class="flex items-center gap-2 group cursor-default">
              <span class="w-1.5 h-1.5 rounded-full bg-gold/40 group-hover:bg-gold transition-colors"></span>
              <span class="text-xs font-bold text-gray-300">${t.name}</span>
              <span class="text-xs font-mono text-gold/80">${timeStr}</span>
              <span class="text-[10px] font-mono text-gray-500" data-timer-id="${t.id}">${formatTime(remaining)}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
    container.appendChild(section);
  }

  // Group timers by group property
  const groups: Record<string, Timer[]> = {};
  state.timers.forEach(timer => {
    const g = timer.group || 'Uncategorized';
    if (!groups[g]) groups[g] = [];
    groups[g].push(timer);
  });

  // Sort groups alphabetically
  const sortedGroupNames = Object.keys(groups).sort();

  sortedGroupNames.forEach(groupName => {
    const section = document.createElement('section');
    section.className = 'space-y-6';
    
    section.innerHTML = `
      <div class="flex items-center gap-3">
        <h3 class="text-xs font-black uppercase tracking-[0.2em] text-gray-500">${groupName}</h3>
        <span class="px-1.5 py-0.5 rounded-full bg-white/5 text-[9px] font-bold text-gray-600">${groups[groupName].length}</span>
      </div>
      <div class="subgroups-container space-y-6"></div>
    `;

    const subgroupContainer = section.querySelector('.subgroups-container')!;
    const fieldTimers = groups[groupName].filter(t => t.type === 'field');
    const scheduleTimers = groups[groupName].filter(t => t.type === 'schedule');

    if (fieldTimers.length > 0) {
      const fieldGrid = document.createElement('div');
      fieldGrid.className = 'p-6 rounded-3xl border border-white/5 bg-white/[0.02] space-y-4';
      fieldGrid.innerHTML = `
        <div class="flex items-center gap-2 opacity-40">
           <span data-lucide="crosshair" class="w-3 h-3 text-red-500"></span>
           <span class="text-[10px] uppercase font-bold tracking-widest">Field Bosses</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"></div>
      `;
      const grid = fieldGrid.querySelector('.grid')!;
      fieldTimers.forEach(t => grid.appendChild(renderTimerCard(t)));
      subgroupContainer.appendChild(fieldGrid);
    }

    if (scheduleTimers.length > 0) {
      const scheduleGrid = document.createElement('div');
      scheduleGrid.className = 'p-6 rounded-3xl border border-white/5 bg-white/[0.02] space-y-4';
      scheduleGrid.innerHTML = `
        <div class="flex items-center gap-2 opacity-40">
           <span data-lucide="calendar" class="w-3 h-3 text-gold"></span>
           <span class="text-[10px] uppercase font-bold tracking-widest">Schedules & Events</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"></div>
      `;
      const grid = scheduleGrid.querySelector('.grid')!;
      scheduleTimers.forEach(t => grid.appendChild(renderTimerCard(t)));
      subgroupContainer.appendChild(scheduleGrid);
    }

    container.appendChild(section);
  });

  updateLucideIcons();
  return container;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getEstimatedText(timer: Timer) {
  if (!timer.endTime) return 'N/A';
  const d = new Date(timer.endTime);
  const now = new Date();
  const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isToday ? timeStr : `${DAYS_SHORT[d.getDay()]} ${timeStr}`;
}

function renderTimerCard(timer: Timer) {
  const card = document.createElement('div');
  const remaining = calculateRemaining(timer);
  const isFinished = remaining <= 0;
  
  card.className = cn(
    'glass-card p-6 flex flex-col justify-between transition-all relative overflow-hidden h-48 group',
    isFinished ? 'border-red-500/30 bg-red-500/5' : 'hover:border-gold/20'
  );

  card.innerHTML = `
    <div>
      <div class="flex justify-between items-start mb-2">
        <h4 class="font-bold text-lg truncate pr-4">${timer.name}</h4>
        <span class="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-white/5 text-gray-500">${timer.group}</span>
      </div>
      <p class="text-4xl font-mono font-bold tracking-tighter ${isFinished ? 'text-red-500 animate-pulse' : 'text-white'}" data-timer-id="${timer.id}">
        ${formatTime(remaining)}
      </p>
    </div>

    <div class="flex items-center justify-between pt-4 border-t border-white/5">
      <p class="text-[10px] text-gray-600 uppercase font-bold tracking-tighter">
        ${timer.type} • Est. ${getEstimatedText(timer)}
      </p>
      
      <div class="flex gap-1.5">
          ${(state.currentUser.role === 'leader' || state.currentUser.role === 'officer') ? `
             <button class="edit-timer p-1.5 hover:bg-white/10 rounded-md text-gray-500" title="Edit">
                <span data-lucide="edit" class="w-4 h-4"></span>
             </button>
             <button class="delete-timer p-1.5 hover:bg-red-500/20 rounded-md text-red-500/50 hover:text-red-500" title="Delete">
                <span data-lucide="trash-2" class="w-4 h-4"></span>
             </button>
             <button class="reset-timer p-1.5 hover:bg-white/10 rounded-md text-gray-500" title="Full Reset">
                <span data-lucide="rotate-ccw" class="w-4 h-4"></span>
             </button>
             <button class="toggle-timer p-1.5 bg-white/5 hover:bg-white/10 rounded-md text-white" title="${timer.status === 'running' ? 'Pause' : 'Resume'}">
                <span data-lucide="${timer.status === 'running' ? 'pause' : 'play'}" class="w-4 h-4 text-gold"></span>
             </button>
          ` : `
             <span class="text-[9px] text-gray-700 uppercase font-bold items-center flex gap-1"><span data-lucide="lock" class="w-2 h-2"></span> View Only</span>
          `}
      </div>
    </div>
  `;

  card.querySelector('.edit-timer')?.addEventListener('click', (e) => {
     e.stopPropagation();
     showTimerModal(timer);
  });
  card.querySelector('.delete-timer')?.addEventListener('click', (e) => {
     e.stopPropagation();
     if (confirm(`Delete timer ${timer.name}?`)) {
       state.timers = state.timers.filter(t => t.id !== timer.id);
       storageManager.saveTimers(state.currentGuild!.id, state.timers);
     }
  });
  card.querySelector('.reset-timer')?.addEventListener('click', (e) => {
     e.stopPropagation();
     updateTimer(resetTimer(timer));
  });
  card.querySelector('.toggle-timer')?.addEventListener('click', (e) => {
     e.stopPropagation();
     if (timer.status === 'running') {
        updateTimer(pauseTimer(timer));
     } else {
        updateTimer(startTimer(timer));
     }
  });

  return card;
}

function renderControlRoom() {
  const guild = state.currentGuild!;
  const isLeader = state.currentUser.role === 'leader';
  
  const isAuthorized = state.currentUser.role === 'leader' || state.currentUser.role === 'officer';
  
  const div = document.createElement('div');
  div.className = 'flex flex-col h-screen bg-[#0d0f14]';
  div.innerHTML = `
    <header class="p-6 border-b border-white/5 flex items-center justify-between bg-[#0a0c10]">
      <div class="flex items-center gap-4">
        <button id="btn-back-main" class="p-2 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-colors">
          <span data-lucide="chevron-right" class="w-5 h-5 rotate-180"></span>
        </button>
        <div class="flex items-center gap-3">
           <div class="w-10 h-10 bg-gold/20 rounded-xl flex items-center justify-center border border-gold/20">
              <span data-lucide="shield-check" class="w-6 h-6 text-gold"></span>
           </div>
           <div>
              <h2 class="text-xl font-bold tracking-tight">Control Room</h2>
              <p class="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Guild Assets & Management</p>
           </div>
        </div>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 max-w-5xl mx-auto w-full">
      
      <!-- Management Tools -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="md:col-span-2 space-y-6">
           <section class="glass-card p-6">
              <div class="flex items-center justify-between mb-6">
                <div>
                  <h3 class="text-lg font-bold">Active Timers</h3>
                  <p class="text-xs text-gray-500">${isAuthorized ? 'Add, edit or remove guild timers.' : 'List of registered timers (View Only).'}</p>
                </div>
                ${isAuthorized ? `
                <button id="btn-add-timer" class="btn btn-primary btn-sm flex items-center gap-2">
                   <span data-lucide="plus" class="w-4 h-4"></span> New Timer
                </button>
                ` : ''}
              </div>
              
              <div class="space-y-2 max-h-96 overflow-y-auto pr-2">
                 ${state.timers.length === 0 ? '<p class="text-xs text-gray-700 italic py-4">No timers found.</p>' : ''}
                 ${state.timers.map(t => `
                   <div class="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 group">
                      <div class="flex items-center gap-3">
                         <div class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center font-mono text-[10px] text-gray-500">${t.type[0].toUpperCase()}</div>
                         <span class="text-sm font-medium">${t.name}</span>
                      </div>
                      ${isAuthorized ? `
                      <div class="flex items-center gap-1 transition-opacity">
                         <button class="edit-timer p-1.5 hover:bg-white/10 rounded text-gray-400" data-id="${t.id}"><span data-lucide="edit" class="w-3.5 h-3.5"></span></button>
                         <button class="delete-timer p-1.5 hover:bg-red-500/20 rounded text-red-500/50 hover:text-red-500" data-id="${t.id}"><span data-lucide="trash-2" class="w-3.5 h-3.5"></span></button>
                      </div>
                      ` : ''}
                   </div>
                 `).join('')}
              </div>
           </section>
        </div>

        <div class="space-y-6">
           <section class="glass-card p-6 flex flex-col gap-4">
              <div>
                <h3 class="text-lg font-bold">Officer Roster</h3>
                <p class="text-xs text-gray-500">Users authorized to manage timers.</p>
              </div>
              <div class="space-y-2">
                 ${guild.officerIds.length === 0 ? '<p class="text-xs text-gray-600 italic">No officers appointed.</p>' : ''}
                 ${guild.officerIds.map(oid => `
                   <div class="flex items-center justify-between p-2 bg-white/5 rounded-lg">
                      <span class="text-xs truncate max-w-[100px]">${oid}</span>
                      ${isLeader ? `<button class="p-1 text-red-500/40 hover:text-red-500 remove-officer" data-id="${oid}"><span data-lucide="trash-2" class="w-3 h-3"></span></button>` : ''}
                   </div>
                 `).join('')}
              </div>
              ${isLeader ? `
                <button id="btn-add-officer" class="w-full py-2 border border-white/10 rounded-lg text-xs hover:bg-white/5 transition-colors">Appoint Officer</button>
              ` : ''}
           </section>

           <section class="glass-card p-6 flex flex-col gap-4">
              <div>
                <h3 class="text-lg font-bold">Members</h3>
                <p class="text-xs text-gray-500">Manage guild access and population.</p>
              </div>

              ${(guild.pendingApprovals?.length || 0) > 0 && isAuthorized ? `
              <div class="space-y-3 p-4 bg-gold/5 rounded-2xl border border-gold/20">
                 <p class="text-[10px] text-gold font-bold uppercase tracking-widest">Pending Approvals</p>
                 <div class="space-y-2">
                    ${guild.pendingApprovals.map(p => `
                       <div class="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5">
                          <div>
                             <p class="text-xs font-bold text-white">${p.nickname}</p>
                             <p class="text-[9px] text-gray-500 font-mono">${p.id.slice(0, 8)}...</p>
                          </div>
                          <div class="flex items-center gap-1">
                             <button class="approve-member p-1.5 hover:bg-emerald-500/20 text-emerald-500 rounded" data-id="${p.id}"><span data-lucide="shield-check" class="w-3.5 h-3.5"></span></button>
                             <button class="reject-member p-1.5 hover:bg-red-500/20 text-red-500 rounded" data-id="${p.id}"><span data-lucide="x" class="w-3.5 h-3.5"></span></button>
                          </div>
                       </div>
                    `).join('')}
                 </div>
              </div>
              ` : ''}

              <div class="space-y-2 max-h-64 overflow-y-auto pr-2">
                 ${(guild.members?.length || 0) === 0 ? '<p class="text-xs text-gray-600 italic">No members found.</p>' : ''}
                 ${guild.members.map(m => {
                    const isOfficer = guild.officerIds.includes(m.id);
                    const isTheLeader = m.id === state.currentUser.id && state.currentUser.role === 'leader';
                    
                    // Permission logic for kicking
                    // Leader can kick everyone (except themselves)
                    // Officers can kick members (not officers/leaders)
                    const canKick = isLeader ? (m.id !== state.currentUser.id) 
                                             : (state.currentUser.role === 'officer' && !isOfficer && m.id !== state.currentUser.id);
                    
                    return `
                    <div class="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5">
                       <div class="flex items-center gap-2">
                          <div class="w-6 h-6 rounded-full bg-gold/10 flex items-center justify-center">
                             <span data-lucide="${isOfficer ? 'shield' : 'user-circle'}" class="w-3 h-3 ${isOfficer ? 'text-gold' : 'text-gray-500'}"></span>
                          </div>
                          <div>
                             <p class="text-xs font-medium">${m.nickname}</p>
                             <p class="text-[9px] text-gray-500 font-mono">${m.id.slice(0, 8)}...</p>
                          </div>
                       </div>
                       ${canKick ? `<button class="p-1.5 text-red-500/40 hover:text-red-500 kick-member" data-id="${m.id}"><span data-lucide="log-out" class="w-3.5 h-3.5"></span></button>` : ''}
                    </div>
                    `;
                 }).join('')}
              </div>
           </section>

           <section class="glass-card p-6 flex flex-col gap-4 border-amber-500/20 bg-amber-500/5">
              <div class="flex items-center gap-2">
                 <span data-lucide="key" class="w-4 h-4 text-amber-500"></span>
                 <h3 class="text-lg font-bold">Leader Access</h3>
              </div>
              <p class="text-xs text-gray-400">Sensitive guild data which only the Leader can see or edit.</p>
              
              <div id="leader-locked-zone" class="space-y-4">
                 ${isLeader ? `
                    <button id="btn-edit-guild" class="w-full btn btn-secondary text-xs flex items-center justify-center gap-2">
                       <span data-lucide="settings" class="w-4 h-4"></span>
                       Guild Privacy & Sync
                    </button>
                    <div class="p-3 bg-white/5 rounded-xl border border-white/5 space-y-2">
                       <p class="text-[10px] font-bold uppercase text-gray-500 tracking-widest">Webhook Status</p>
                       <p class="text-xs truncate ${guild.webhookUrl ? 'text-emerald-400' : 'text-gray-500'}">${guild.webhookUrl || 'Not Configured'}</p>
                    </div>
                 ` : `
                    <div class="py-4 text-center space-y-2">
                       <span data-lucide="lock" class="w-6 h-6 mx-auto text-gray-700"></span>
                       <button id="btn-unlock-leader" class="text-xs text-amber-500 font-bold hover:underline">Unlock Leader Privileges</button>
                    </div>
                 `}
              </div>
           </section>
        </div>
      </div>
    </div>
  `;

  div.querySelector('#btn-back-main')?.addEventListener('click', () => {
    state.view = 'main';
    saveLocal();
    render();
  });

  div.querySelector('#btn-add-timer')?.addEventListener('click', () => showTimerModal());
  div.querySelectorAll('.delete-timer').forEach(el => {
     el.addEventListener('click', () => {
        const id = el.getAttribute('data-id')!;
        state.timers = state.timers.filter(t => t.id !== id);
        storageManager.saveTimers(guild.id, state.timers);
     });
  });
  div.querySelectorAll('.edit-timer').forEach(el => {
    el.addEventListener('click', () => {
       const id = el.getAttribute('data-id')!;
       const timer = state.timers.find(t => t.id === id);
       if (timer) showTimerModal(timer);
    });
  });

  // Member management events
  div.querySelectorAll('.approve-member').forEach(el => {
     el.addEventListener('click', () => {
        const id = el.getAttribute('data-id')!;
        const pending = guild.pendingApprovals.find(p => p.id === id);
        if (pending) {
           if (!guild.members) guild.members = [];
           guild.members.push(pending);
           guild.pendingApprovals = guild.pendingApprovals.filter(p => p.id !== id);
           storageManager.saveGuildData(guild);
           notifyGuild(guild, `✅ **${pending.nickname}** has been approved and is now a member.`);
           render();
        }
     });
  });

  div.querySelectorAll('.reject-member, .kick-member').forEach(el => {
     el.addEventListener('click', () => {
        const id = el.getAttribute('data-id')!;
        const isKick = el.classList.contains('kick-member');
        
        const member = (guild.members || []).find(m => m.id === id);
        const pending = (guild.pendingApprovals || []).find(p => p.id === id);
        const name = member?.nickname || pending?.nickname || 'Unknown User';

        if (isKick) {
           guild.members = (guild.members || []).filter(m => m.id !== id);
           guild.officerIds = (guild.officerIds || []).filter(oid => oid !== id);
           notifyGuild(guild, `🚪 **${name}** has been removed from the guild.`);
        } else {
           guild.pendingApprovals = (guild.pendingApprovals || []).filter(p => p.id !== id);
           notifyGuild(guild, `❌ **${name}**'s join request was rejected.`);
        }
        
        storageManager.saveGuildData(guild);
        render();
     });
  });

  if (isLeader) {
    div.querySelector('#btn-edit-guild')?.addEventListener('click', () => showEditGuildModal());
    div.querySelector('#btn-add-officer')?.addEventListener('click', () => {
       showAddOfficerModal(guild.id);
    });
    div.querySelectorAll('.remove-officer').forEach(el => {
       el.addEventListener('click', () => {
          const id = el.getAttribute('data-id')!;
          guild.officerIds = guild.officerIds.filter(o => o !== id);
          storageManager.saveGuildData(guild);
       });
    });
 } else {
    div.querySelector('#btn-unlock-leader')?.addEventListener('click', () => {
       showUnlockLeaderModal(guild.id);
    });
 }

  return div;
}

// --- MODALS ---

function showModal(title: string, content: HTMLElement, onClose: () => void = () => {}) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-300';
  
  const modal = document.createElement('div');
  modal.className = 'bg-[#1a1d23] border border-white/10 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200';
  
  modal.innerHTML = `
    <div class="px-8 py-6 border-b border-white/5 flex items-center justify-between">
      <h3 class="font-bold text-xl tracking-tight">${title}</h3>
      <button class="close-modal p-2 hover:bg-white/5 rounded-xl text-gray-500 transition-colors">
        <span data-lucide="x" class="w-6 h-6"></span>
      </button>
    </div>
    <div class="p-8"></div>
  `;

  modal.querySelector('.p-8')?.appendChild(content);
  modal.querySelector('.close-modal')?.addEventListener('click', () => {
    overlay.remove();
    onClose();
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  updateLucideIcons();
  return overlay;
}

function showProfileModal() {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
     <div class="grid grid-cols-2 gap-4">
        <div class="space-y-1">
           <label class="label">Nickname</label>
           <input type="text" name="nickname" value="${state.currentUser.nickname}" class="input text-xs" placeholder="E.g. ShadowBlade">
        </div>
        <div class="space-y-1">
           <label class="label">Current Rank</label>
           <div class="input text-xs flex items-center gap-2 bg-white/5 cursor-default select-none border-white/5">
              <span data-lucide="${state.currentUser.role === 'leader' ? 'shield-check' : state.currentUser.role === 'officer' ? 'shield' : 'user-circle'}" 
                    class="w-3 h-3 ${state.currentUser.role === 'leader' ? 'text-gold' : state.currentUser.role === 'officer' ? 'text-gold/80' : 'text-gray-400'}"></span>
              <span class="capitalize font-bold">${state.currentUser.role}</span>
           </div>
        </div>
     </div>

     <div class="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
        <label class="flex items-center gap-3 cursor-pointer group">
           <div class="relative">
              <input type="checkbox" id="check-browser-notifications" class="sr-only peer" ${state.currentUser.browserNotificationsEnabled ? 'checked' : ''}>
              <div class="w-10 h-5 bg-white/10 rounded-full peer-checked:bg-gold transition-all"></div>
              <div class="absolute left-1 top-1 w-3 h-3 bg-white/50 rounded-full transition-all peer-checked:left-6 peer-checked:bg-white"></div>
           </div>
           <div>
              <p class="text-[10px] font-bold text-white uppercase tracking-wider group-hover:text-gold transition-colors">Desktop Notifications</p>
              <p class="text-[9px] text-gray-500 italic">Get alerts even when the tab is hidden</p>
           </div>
        </label>
     </div>

     ${state.currentGuild ? `
     <div class="p-4 bg-gold/5 rounded-2xl border border-gold/10 space-y-4">
        <div class="flex items-center justify-between">
           <p class="text-[10px] text-gold font-bold uppercase tracking-widest">Current Guild</p>
           <span class="px-1.5 py-0.5 rounded-full bg-gold/10 text-[9px] font-bold text-gold border border-gold/20 capitalize">${state.currentUser.role}</span>
        </div>
        <div class="flex items-center gap-3">
           <div class="w-10 h-10 bg-gold/10 rounded-xl flex items-center justify-center">
              <span data-lucide="users" class="w-5 h-5 text-gold"></span>
           </div>
           <div>
              <p class="text-sm font-bold text-white">${state.currentGuild.name}</p>
              <div class="flex items-center gap-1.5 opacity-50">
                 <span data-lucide="${state.currentGuild.storageType === 'firebase' ? 'database' : 'layout-grid'}" class="w-3 h-3"></span>
                 <p class="text-[10px] uppercase font-bold tracking-tighter">${state.currentGuild.storageType} Storage</p>
              </div>
           </div>
        </div>
        <button type="button" id="btn-leave-guild" class="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-[9px] font-black uppercase tracking-[0.2em] rounded-xl transition-all border border-red-500/20">
           Unjoin Guild
        </button>
     </div>
     ` : ''}

     <div class="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-2">
        <p class="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Internal ID (Share with Leader for Officer role)</p>
        <p class="text-xs font-mono select-all break-all text-gold/80">${state.currentUser.id}</p>
     </div>
     <button type="submit" class="btn btn-primary w-full">Update Profile</button>

     <div class="pt-6 border-t border-white/5 space-y-4">
        <div class="flex items-center gap-2">
           <span data-lucide="shield" class="w-3 h-3 text-red-500"></span>
           <p class="text-[10px] text-red-500/60 font-black uppercase tracking-widest">Danger Zone</p>
        </div>
        <button type="button" id="btn-reset-data" class="group flex items-center justify-between w-full p-4 rounded-2xl bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 transition-all text-left">
           <div>
              <p class="text-xs font-bold text-red-500">Reset All App Data</p>
              <p class="text-[10px] text-red-500/60">Logout, delete profile, and clear guild registry.</p>
           </div>
           <span data-lucide="trash-2" class="w-4 h-4 text-red-500 opacity-40 group-hover:opacity-100 transition-opacity"></span>
        </button>
     </div>
  `;

  const overlay = showModal('My Profile', form);

  form.querySelector('#btn-leave-guild')?.addEventListener('click', () => {
     if (state.currentGuild) {
        const guildId = state.currentGuild.id;
        const nickname = state.currentUser.nickname;
        
        // Remove from remote members
        state.currentGuild.members = (state.currentGuild.members || []).filter(m => m.id !== state.currentUser.id);
        state.currentGuild.officerIds = (state.currentGuild.officerIds || []).filter(oid => oid !== state.currentUser.id);
        storageManager.saveGuildData(state.currentGuild);
        
        // Cleanup locally
        leaveGuild();
        state.guilds = state.guilds.filter(g => g.id !== guildId);
        saveLocal();
        overlay.remove();
        render();
        showAlert(`You have left the guild. Membership for ${nickname} has been revoked.`, "Guild Exit");
     }
  });

  form.querySelector('#btn-reset-data')?.addEventListener('click', () => {
    overlay.remove();
    showResetConfirmModal();
  });

  const notifyCheck = form.querySelector('#check-browser-notifications') as HTMLInputElement;
  notifyCheck?.addEventListener('change', async () => {
    if (notifyCheck.checked) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        notifyCheck.checked = false;
        showAlert('Browser notification permission is required for this feature.', 'Permission Denied');
      }
    }
  });

  form.onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(form);
    state.currentUser.nickname = (data.get('nickname') as string).trim() || 'Anonymous';
    state.currentUser.browserNotificationsEnabled = notifyCheck.checked;
    
    saveLocal();
    overlay.remove();
    render();
  };
}

function showResetConfirmModal() {
  const div = document.createElement('div');
  div.className = 'space-y-6 text-center';
  div.innerHTML = `
     <div class="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <span data-lucide="shield" class="w-8 h-8 text-red-500"></span>
     </div>
     <div class="space-y-2">
        <h3 class="text-xl font-bold text-white leading-tight">Wipe All Local Data?</h3>
        <p class="text-xs text-gray-500 leading-relaxed px-4">This will permanently delete your nickname, your guild connections, and all local timers. <br><br><span class="text-amber-500/70 font-bold uppercase tracking-[0.15em] text-[10px]">Note:</span> Shared data on Firebase remains safe.</p>
     </div>
     <div class="grid grid-cols-2 gap-4">
        <button id="btn-cancel-reset" class="btn bg-white/5 hover:bg-white/10 text-gray-300 py-3 text-xs">Cancel</button>
        <button id="btn-confirm-reset" class="btn bg-red-600 hover:bg-red-700 text-white py-3 text-xs shadow-lg shadow-red-600/20">Wipe Data</button>
     </div>
  `;

  const overlay = showModal('Safety Confirmation', div);

  div.querySelector('#btn-cancel-reset')?.addEventListener('click', () => overlay.remove());
  div.querySelector('#btn-confirm-reset')?.addEventListener('click', () => {
     localStorage.clear();
     window.location.reload();
  });
}

function showAlert(message: string, title: string = 'Alert') {
  const div = document.createElement('div');
  div.className = 'space-y-4 text-center';
  div.innerHTML = `
    <p class="text-sm text-gray-400 leading-relaxed">${message}</p>
    <button class="btn bg-white/5 hover:bg-white/10 w-full py-2 text-xs">Dismiss</button>
  `;
  const overlay = showModal(title, div);
  div.querySelector('button')?.addEventListener('click', () => overlay.remove());
}

function showAddOfficerModal(guildId: string) {
  const guild = state.guilds.find(g => g.id === guildId);
  if (!guild) return;

  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div class="space-y-2">
      <p class="text-sm text-gray-400">Enter the <span class="text-gold font-bold">User ID</span> of the member you want to appoint as an Officer.</p>
      <input type="text" name="userId" class="input py-3" placeholder="Paste User ID here..." required autofocus>
      <p class="text-[10px] text-gray-500 italic font-mono">Tip: Members can find their ID in their Profile modal.</p>
    </div>
    <button type="submit" class="btn btn-primary w-full py-3 mt-2 font-bold tracking-widest uppercase text-xs">Appoint Officer</button>
  `;

  const overlay = showModal('Appoint Officer', form);
  form.onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const id = (data.get('userId') as string).trim();
    if (id && !guild.officerIds.includes(id)) {
      guild.officerIds.push(id);
      storageManager.saveGuildData(guild);
      overlay.remove();
      render();
    } else if (id) {
      overlay.remove();
      showAlert('This user is already an officer or ID is invalid.', 'Process Error');
    }
  };
}

function showJoinPasswordModal(guildId: string) {
  const guild = state.guilds.find(g => g.id === guildId);
  if (!guild) return;

  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div class="space-y-2">
      <p class="text-sm text-gray-400">Password required to enter <span class="text-white font-bold">${guild.name}</span></p>
      <input type="password" name="password" class="input py-3" placeholder="Member Code" required autofocus>
    </div>
    <button type="submit" class="btn btn-primary w-full py-3 mt-2">Join Guild</button>
  `;

  const overlay = showModal('Guild Protection', form);
  form.onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const pass = data.get('password') as string;
    
    if (guild.memberPassword === pass) {
      overlay.remove();
      joinGuild(guildId, pass);
    } else {
      const input = form.querySelector('input')!;
      input.classList.add('border-red-500', 'animate-shake');
      setTimeout(() => input.classList.remove('animate-shake'), 500);
    }
  };
}

function showJoinByCodeModal() {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div class="space-y-2">
      <p class="text-sm text-gray-400">Paste the Guild Data JSON to join a shared group.</p>
      <textarea name="guildData" class="input font-mono text-[10px] h-32" placeholder='{"id": "...", "name": "...", ...}' required autofocus></textarea>
    </div>
    <button type="submit" class="btn btn-primary w-full py-3 mt-2 font-bold tracking-widest uppercase text-xs">Register Guild</button>
  `;

  const overlay = showModal('Join via Data', form);
  form.onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(form);
    try {
      const guild = JSON.parse(data.get('guildData') as string) as Guild;
      if (guild.id && guild.name) {
        updateLocalGuildRegistry(guild);
        overlay.remove();
        render();
      } else {
        throw new Error('Invalid Guild Data Format');
      }
    } catch (err) {
      showAlert('Failed to parse Guild Data. Make sure it is a valid JSON.', 'Parse Error');
    }
  };
}

function showUnlockLeaderModal(guildId: string) {
  const guild = state.guilds.find(g => g.id === guildId);
  if (!guild) return;

  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div class="space-y-2">
      <p class="text-sm text-gray-400">Enter your <span class="text-white font-bold">Leader Secret Key</span> to unlock administrative controls.</p>
      <input type="password" name="key" class="input py-3" placeholder="Secret Key" required autofocus>
    </div>
    <button type="submit" class="btn btn-primary w-full py-3 mt-2">Verify Authority</button>
  `;

  const overlay = showModal('Administrative Access', form);
  form.onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const key = data.get('key') as string;
    
    if (guild.leaderKey === key) {
      overlay.remove();
      localStorage.setItem(`auth_key_${guildId}`, key || '');
      updateRoleFromGuild();
      render();
    } else {
      const input = form.querySelector('input')!;
      input.classList.add('border-red-500', 'animate-shake');
      setTimeout(() => input.classList.remove('animate-shake'), 500);
    }
  };
}

function showOnboardingModal() {
  const form = document.createElement('form');
  form.className = 'space-y-6';
  form.innerHTML = `
    <div class="space-y-4">
      <div class="w-16 h-16 bg-gold rounded-2xl flex items-center justify-center shadow-lg shadow-gold/20 mb-4">
        <span data-lucide="user-circle" class="w-8 h-8 text-white"></span>
      </div>
      <div class="space-y-1">
        <h2 class="text-xl font-bold text-white leading-tight">Welcome to Chronos</h2>
        <p class="text-sm text-gray-500">Pick a nickname to identify yourself to your guild mates.</p>
      </div>
      <div class="space-y-2">
        <label class="label">Your Nickname</label>
        <input type="text" name="nickname" class="input py-3" placeholder="E.g. GreatLeader_42" required autofocus>
      </div>
    </div>
    <button type="submit" class="btn btn-primary w-full py-4 text-sm font-bold tracking-widest uppercase">Start Exploring</button>
  `;

  const overlay = showModal('Quick Setup', form, () => {
    // Prevent closing without setting a nickname for first timers
    if (!localStorage.getItem('chronos_user')) {
      saveLocal(); 
    }
  });

  // Hide close button if we want to force it
  const closeBtn = overlay.querySelector('.close-modal');
  if (closeBtn) closeBtn.remove();

  form.onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const nickname = (data.get('nickname') as string).trim();
    if (nickname) {
      state.currentUser.nickname = nickname;
      saveLocal();
      overlay.remove();
      render();
    }
  };
}

function showTimerModal(existing?: Timer) {
  let modalSchedules = existing?.schedules ? [...existing.schedules] : [];
  
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div class="space-y-1">
      <label class="label">Timer Name</label>
      <input type="text" name="name" class="input" value="${existing?.name || ''}" placeholder="E.g. Field Boss" required>
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div class="space-y-1">
        <label class="label">Type</label>
        <select name="type" class="input">
          <option value="field" ${existing?.type === 'field' ? 'selected' : ''}>Field</option>
          <option value="schedule" ${existing?.type === 'schedule' ? 'selected' : ''}>Schedule</option>
        </select>
      </div>
       <div class="space-y-1">
        <label class="label">Group / Category</label>
        <input type="text" name="group" class="input" value="${existing?.group || 'Bosses'}" list="categories-list">
        <datalist id="categories-list">
          <option value="Bosses">
          <option value="Events">
          <option value="Daily">
        </datalist>
      </div>
    </div>
    <div class="space-y-1">
      <label class="label">Alert Threshold (Mins before end)</label>
      <input type="number" name="alertThreshold" class="input" value="${existing?.alertThreshold || 0}" min="0">
      <p class="text-[10px] text-gray-500 mt-1">Discord notification will trigger when timer reaches this many minutes remaining.</p>
    </div>
    <div id="type-config" class="bg-white/5 p-4 rounded-xl border border-white/5"></div>
    <div class="space-y-3 py-2">
      <div class="flex items-center gap-3">
        <input type="checkbox" name="autoReset" id="auto-reset" ${existing?.autoReset ? 'checked' : ''} class="w-4 h-4 rounded border-white/10 bg-white/5 accent-gold">
        <label for="auto-reset" class="text-sm text-gray-300">Auto-reset after finished</label>
      </div>
      <div id="auto-reset-delay-config" class="${existing?.autoReset ? '' : 'hidden'} space-y-1 pl-7">
        <label class="label text-[10px]">Auto-Reset Delay (Seconds)</label>
        <input type="number" name="autoResetDelay" class="input py-2 text-xs" value="${existing?.autoResetDelay || 0}" min="0">
        <p class="text-[9px] text-gray-500 italic">Timer will stay at 'Spawned' for this long before restarting.</p>
      </div>
    </div>
    <button type="submit" class="btn btn-primary w-full py-3 mt-2">${existing ? 'Update Timer' : 'Add Timer'}</button>
  `;

  const typeConfig = form.querySelector('#type-config')!;
  const typeSelect = form.querySelector('[name="type"]') as HTMLSelectElement;
  const autoResetCheck = form.querySelector('#auto-reset') as HTMLInputElement;
  const autoResetDelayArea = form.querySelector('#auto-reset-delay-config')!;

  autoResetCheck.addEventListener('change', () => {
    if (autoResetCheck.checked) autoResetDelayArea.classList.remove('hidden');
    else autoResetDelayArea.classList.add('hidden');
  });

  const renderTypeInputs = () => {
    const type = typeSelect.value as TimerType;
    if (type === 'field') {
      typeConfig.innerHTML = `
        <div class="space-y-4">
          <div class="space-y-1">
            <label class="label">Duration (Hours)</label>
            <input type="number" name="durationHours" class="input" value="${existing?.durationSeconds ? (existing.durationSeconds / 3600) : 1}" step="0.5" min="0.5" required>
          </div>
        </div>
      `;
    } else {
      typeConfig.innerHTML = `
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <label class="label">Schedules</label>
            <button type="button" id="btn-add-schedule" class="text-[10px] text-gold font-bold hover:underline">+ Add Entry</button>
          </div>
          <div id="schedule-list" class="space-y-2"></div>
        </div>
      `;

      const list = typeConfig.querySelector('#schedule-list')!;
      const renderScheduleList = () => {
        list.innerHTML = modalSchedules.length === 0 ? '<p class="text-[10px] text-gray-600 italic">No schedules defined.</p>' : '';
        modalSchedules.forEach((s, idx) => {
          const row = document.createElement('div');
          row.className = 'flex gap-2 items-center animate-in slide-in-from-left-2 duration-200';
          row.innerHTML = `
            <select class="input text-xs flex-1 schedule-day" data-idx="${idx}">
              ${DAYS.map((d, i) => `<option value="${i}" ${s.day === i ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
            <input type="time" class="input text-xs w-24 schedule-time" data-idx="${idx}" value="${s.time}">
            <button type="button" class="remove-schedule p-2 text-red-500/50 hover:text-red-500" data-idx="${idx}">
              <span data-lucide="trash-2" class="w-3.5 h-3.5"></span>
            </button>
          `;
          list.appendChild(row);
        });
        updateLucideIcons();

        list.querySelectorAll('.schedule-day').forEach(el => {
          el.addEventListener('change', (e: any) => {
            modalSchedules[Number(el.getAttribute('data-idx'))].day = Number(e.target.value);
          });
        });
        list.querySelectorAll('.schedule-time').forEach(el => {
          el.addEventListener('change', (e: any) => {
            modalSchedules[Number(el.getAttribute('data-idx'))].time = e.target.value;
          });
        });
        list.querySelectorAll('.remove-schedule').forEach(el => {
          el.addEventListener('click', () => {
            modalSchedules.splice(Number(el.getAttribute('data-idx')), 1);
            renderScheduleList();
          });
        });
      };

      typeConfig.querySelector('#btn-add-schedule')?.addEventListener('click', () => {
        modalSchedules.push({ day: 0, time: '12:00' });
        renderScheduleList();
      });

      renderScheduleList();
    }
  };

  typeSelect.addEventListener('change', renderTypeInputs);
  renderTypeInputs();

  const overlay = showModal(existing ? 'Edit Timer' : 'New Timer', form);
    form.onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const type = data.get('type') as TimerType;
    const durationHours = Number(data.get('durationHours'));

    const alertThreshold = Number(data.get('alertThreshold')) || undefined;
    const autoResetDelay = Number(data.get('autoResetDelay')) || undefined;

    const timer: Timer = {
      id: existing?.id || crypto.randomUUID(),
      guildId: state.currentGuild!.id,
      name: data.get('name') as string,
      type,
      group: (data.get('group') as string) || 'Uncategorized',
      alertThreshold,
      autoResetDelay,
      status: existing?.status || 'running',
      durationSeconds: type === 'field' ? (durationHours * 3600) : undefined,
      scheduledTime: (data.get('scheduledTime') as string) || undefined,
      schedules: type === 'schedule' ? modalSchedules : undefined,
      autoReset: data.get('autoReset') === 'on',
    };

    if (!existing) {
       const initialRemaining = calculateRemaining(timer);
       timer.endTime = Date.now() + initialRemaining * 1000;
       state.timers.push(timer);
    } else {
       const index = state.timers.findIndex(t => t.id === existing.id);
       state.timers[index] = { ...existing, ...timer };
    }

    storageManager.saveTimers(state.currentGuild!.id, state.timers);
    overlay.remove();
    render();
  };
}

function showCreateGuildModal() {
  const form = document.createElement('form');
  form.className = 'space-y-4 text-left';
  form.innerHTML = `
     <div class="space-y-1">
        <label class="label">Guild Name</label>
        <input type="text" name="name" class="input" placeholder="Kings of the Hill" required>
     </div>
     <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="space-y-1">
           <label class="label">Member Code (To Join)</label>
           <input type="text" name="memberPassword" class="input" placeholder="Optionally require password">
        </div>
        <div class="space-y-1">
           <label class="label">Leader Secret Key</label>
           <input type="text" name="leaderKey" class="input" placeholder="For control access" required>
        </div>
     </div>
     <div class="space-y-2 pt-4">
        <span class="label">Choose Initialization Type</span>
        <div class="grid grid-cols-2 gap-3">
           <label class="cursor-pointer">
              <input type="radio" name="storageType" value="local" checked class="peer hidden">
              <div class="p-4 border border-white/10 rounded-2xl peer-checked:bg-gold/10 peer-checked:border-gold transition-all text-center">
                 <p class="text-sm font-bold">Local Only</p>
                 <p class="text-[10px] text-gray-500 mt-1">Individual storage</p>
              </div>
           </label>
           <label class="cursor-pointer">
              <input type="radio" name="storageType" value="firebase" class="peer hidden">
              <div class="p-4 border border-white/10 rounded-2xl peer-checked:bg-amber-500/10 peer-checked:border-amber-500 transition-all text-center">
                 <p class="text-sm font-bold">Firebase Sync</p>
                 <p class="text-[10px] text-gray-500 mt-1">Real-time shared</p>
              </div>
           </label>
        </div>
     </div>
     <div id="fb-config-area" class="hidden animate-in slide-in-from-top-2 space-y-3 p-4 bg-amber-500/5 border border-amber-500/10 rounded-2xl">
        <p class="text-[10px] text-amber-500/50 font-bold uppercase">Firebase Realtime Database Config</p>
        <div class="grid grid-cols-2 gap-3">
           <div class="space-y-1">
              <label class="text-[10px] text-gray-400">API Key</label>
              <input type="text" name="fbApiKey" class="input text-xs" placeholder="AIza...">
           </div>
           <div class="space-y-1">
              <label class="text-[10px] text-gray-400">Project ID</label>
              <input type="text" name="fbProjectId" class="input text-xs" placeholder="my-project-123">
           </div>
        </div>
        <div class="space-y-1">
           <label class="text-[10px] text-gray-400">Database URL</label>
           <input type="text" name="fbDbUrl" class="input text-xs" placeholder="https://...firebaseio.com">
        </div>
        <div class="space-y-1">
           <label class="text-[10px] text-gray-400">Auth Domain</label>
           <input type="text" name="fbAuthDomain" class="input text-xs" placeholder="...firebaseapp.com">
        </div>
     </div>
     <button type="submit" class="btn btn-primary w-full py-4 mt-4">Create Guild & Claim Leadership</button>
  `;

  const storageRadios = form.querySelectorAll('input[name="storageType"]');
  const fbArea = form.querySelector('#fb-config-area')!;
  storageRadios.forEach(r => r.addEventListener('change', (e: any) => {
     if (e.target.value === 'firebase') fbArea.classList.remove('hidden');
     else fbArea.classList.add('hidden');
  }));

  const overlay = showModal('Establish New Guild', form);
  form.onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const storageType = data.get('storageType') as any;
    let fbConfig: any = null;
    if (storageType === 'firebase') {
       fbConfig = {
         apiKey: data.get('fbApiKey') as string,
         projectId: data.get('fbProjectId') as string,
         databaseURL: data.get('fbDbUrl') as string,
         authDomain: data.get('fbAuthDomain') as string
       };
       if (!fbConfig.apiKey || !fbConfig.projectId || !fbConfig.databaseURL) {
         return showAlert('Please fill in all primary Firebase fields (API Key, Project ID, Database URL)', 'Validation Error');
       }
    }

    const guild: Guild = {
      id: crypto.randomUUID(),
      name: data.get('name') as string,
      memberPassword: (data.get('memberPassword') as string) || undefined,
      leaderKey: data.get('leaderKey') as string,
      storageType,
      firebaseConfig: fbConfig,
      officerIds: [],
      members: [{ id: state.currentUser.id, nickname: state.currentUser.nickname, joinedAt: new Date().toISOString() }],
      pendingApprovals: []
    };

    localStorage.setItem(`auth_key_${guild.id}`, guild.leaderKey || '');
    state.guilds.push(guild);
    saveLocal();
    overlay.remove();
    joinGuild(guild.id, guild.memberPassword);
  };
}

function showEditGuildModal() {
  if (state.currentUser.role !== 'leader') return;
  const guild = state.currentGuild!;

  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
     <div class="space-y-1">
        <label class="label">Discord Webhook</label>
        <div class="flex gap-2">
           <input type="url" name="webhookUrl" value="${guild.webhookUrl || ''}" class="input text-xs flex-1" placeholder="https://discord.com/api/webhooks/...">
           <button type="button" id="btn-test-webhook" class="px-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors">
              <span data-lucide="play" class="w-4 h-4 text-emerald-500"></span>
           </button>
        </div>
     </div>
     <div class="space-y-1">
        <label class="label">Leader Secret Key (Update)</label>
        <input type="text" name="leaderKey" value="${guild.leaderKey || ''}" class="input text-xs">
     </div>
     <div class="space-y-1">
        <label class="label">Member Join Pass (Update)</label>
        <input type="text" name="memberPassword" value="${guild.memberPassword || ''}" class="input text-xs">
     </div>

     <div class="space-y-2 pt-2">
        <span class="label">Storage Type</span>
        <div class="grid grid-cols-2 gap-3">
           <label class="cursor-pointer">
              <input type="radio" name="storageType" value="local" ${guild.storageType === 'local' ? 'checked' : ''} class="peer hidden">
              <div class="p-3 border border-white/10 rounded-xl peer-checked:bg-gold/10 peer-checked:border-gold transition-all text-center">
                 <p class="text-xs font-bold">Local</p>
              </div>
           </label>
           <label class="cursor-pointer">
              <input type="radio" name="storageType" value="firebase" ${guild.storageType === 'firebase' ? 'checked' : ''} class="peer hidden">
              <div class="p-3 border border-white/10 rounded-xl peer-checked:bg-amber-500/10 peer-checked:border-amber-500 transition-all text-center">
                 <p class="text-xs font-bold">Firebase</p>
              </div>
           </label>
        </div>
     </div>

     <div id="fb-edit-config" class="${guild.storageType === 'firebase' ? '' : 'hidden'} p-4 bg-amber-500/5 border border-amber-500/10 rounded-2xl space-y-3">
        <p class="text-[10px] text-amber-500/50 font-bold uppercase">Firebase Config</p>
        <div class="grid grid-cols-2 gap-3">
           <div class="space-y-1">
              <label class="text-[10px] text-gray-400">API Key</label>
              <input type="text" name="fbApiKey" value="${guild.firebaseConfig?.apiKey || ''}" class="input text-xs">
           </div>
           <div class="space-y-1">
              <label class="text-[10px] text-gray-400">Project ID</label>
              <input type="text" name="fbProjectId" value="${guild.firebaseConfig?.projectId || ''}" class="input text-xs">
           </div>
        </div>
        <div class="space-y-1">
           <label class="text-[10px] text-gray-400">Database URL</label>
           <input type="text" name="fbDbUrl" value="${guild.firebaseConfig?.databaseURL || ''}" class="input text-xs">
        </div>
        <div class="space-y-1">
           <label class="text-[10px] text-gray-400">Auth Domain</label>
           <input type="text" name="fbAuthDomain" value="${guild.firebaseConfig?.authDomain || ''}" class="input text-xs">
        </div>
        <p class="text-[9px] text-amber-500/40">Switching modes or changing config will refresh your connection.</p>
     </div>

     <button type="submit" class="btn btn-primary w-full">Save Guild Configuration</button>
  `;

  const overlay = showModal('Leaderboard Console', form);

  form.querySelector('#btn-test-webhook')?.addEventListener('click', () => {
    const data = new FormData(form);
    const url = data.get('webhookUrl') as string;
    if (!url) return showAlert('Please enter a webhook URL first.', 'Test Failed');
    sendDiscordNotification(url, `🧪 **Test Notification** from CHRONOS for guild: **${guild.name}**!`);
    showAlert('Test notification sent. Check your Discord channel.', 'Test Sent');
  });

  const storageRadios = form.querySelectorAll('input[name="storageType"]');
  const fbArea = form.querySelector('#fb-edit-config')!;
  storageRadios.forEach(r => r.addEventListener('change', (e: any) => {
     if (e.target.value === 'firebase') fbArea.classList.remove('hidden');
     else fbArea.classList.add('hidden');
  }));

  form.onsubmit = (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const newStorageType = data.get('storageType') as any;
      
      guild.webhookUrl = data.get('webhookUrl') as string;
      guild.leaderKey = data.get('leaderKey') as string;
      guild.memberPassword = data.get('memberPassword') as string;
      guild.storageType = newStorageType;

      if (newStorageType === 'firebase') {
        guild.firebaseConfig = {
          apiKey: data.get('fbApiKey') as string,
          projectId: data.get('fbProjectId') as string,
          databaseURL: data.get('fbDbUrl') as string,
          authDomain: data.get('fbAuthDomain') as string
        };
      }
      
      localStorage.setItem(`auth_key_${guild.id}`, guild.leaderKey || '');
      storageManager.saveGuildData(guild);
      
      // If storage type changed, we need to re-initialize the storage manager
      if (newStorageType !== guild.storageType) {
         // This is handled by joinGuild which calls storageManager.setGuild
      }

      overlay.remove();
      // Re-join to re-initialize storage with new config/type
      joinGuild(guild.id, guild.memberPassword); 
  };
}


// --- APP START ---

function startLoop() {
  function uiTick() {
    if (document.visibilityState === 'visible') {
      const timerElements = document.querySelectorAll('[data-timer-id]');
      timerElements.forEach(el => {
        const id = el.getAttribute('data-timer-id');
        const timer = state.timers.find(t => t.id === id);
        if (timer) {
          const remaining = calculateRemaining(timer);
          el.textContent = formatTime(remaining);
          if (remaining <= 0) {
            el.classList.add('text-red-500', 'animate-pulse');
          } else {
            el.classList.remove('text-red-500', 'animate-pulse');
            el.classList.add('text-white');
          }
        }
      });
    }
    requestAnimationFrame(uiTick);
  }
  requestAnimationFrame(uiTick);
}

loadLocal();
startLoop();
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('SW registered:', reg);
    }).catch(err => {
      console.log('SW registration failed:', err);
    });
  });
}
