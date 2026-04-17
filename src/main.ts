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
import { sendDiscordNotification } from './notifications';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import './index.css';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
const notifiedTimers = new Set<string>();

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

  if (user) state.currentUser = JSON.parse(user);
  if (guilds) state.guilds = JSON.parse(guilds);
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
  
  // Checking role priority
  if (state.currentGuild.leaderKey) {
     const savedKey = localStorage.getItem(`auth_key_${state.currentGuild.id}`);
     if (savedKey === state.currentGuild.leaderKey) {
        state.currentUser.role = 'leader';
        return;
     }
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
  if (!guild) return alert('Guild not found in your local registry.');

  if (guild.memberPassword && guild.memberPassword !== password) {
    return alert('Incorrect Guild Password.');
  }

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
  timers.forEach(timer => {
    if (timer.status === 'running') {
      const remaining = calculateRemaining(timer);
      if (remaining <= 0 && !notifiedTimers.has(timer.id)) {
        notifiedTimers.add(timer.id);
        handleTimerEnd(timer);
      } else if (remaining > 0) {
        notifiedTimers.delete(timer.id);
      }
    }
  });
}

async function handleTimerEnd(timer: Timer) {
  triggerAudioAlert();
  if (state.currentGuild?.webhookUrl) {
    sendDiscordNotification(state.currentGuild.webhookUrl, `🔔 **${timer.name}** has finished in **${state.currentGuild.name}**!`);
  }
  if (timer.autoReset && timer.type === 'field') {
    updateTimer(resetTimer(timer, true));
  } else {
    updateTimer({ ...timer, status: 'finished' });
  }
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
  div.className = 'flex-1 flex flex-col items-center justify-center p-6 bg-[#0a0c10]';
  div.innerHTML = `
    <div class="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div class="text-center space-y-2">
        <div class="w-16 h-16 bg-indigo-600 rounded-2xl mx-auto flex items-center justify-center shadow-2xl shadow-indigo-500/20 mb-6">
           <span data-lucide="refresh-cw" class="w-8 h-8 text-white"></span>
        </div>
        <h1 class="text-3xl font-bold tracking-tight">CHRONOS</h1>
        <p class="text-gray-400">Collaborative Timer Management System</p>
      </div>

      <div class="grid grid-cols-1 gap-4">
        <button id="btn-create-guild" class="flex items-center gap-4 p-5 glass-card hover:bg-white/10 transition-all text-left group">
           <div class="w-12 h-12 bg-indigo-500/10 rounded-xl flex items-center justify-center group-hover:bg-indigo-500 transition-colors">
              <span data-lucide="plus" class="w-6 h-6 text-indigo-400 group-hover:text-white"></span>
           </div>
           <div>
              <p class="font-bold">Create New Guild</p>
              <p class="text-xs text-gray-400">Set up a new space for your team.</p>
           </div>
        </button>

        <div class="space-y-3">
          <span class="label px-2">Joined Guilds</span>
          ${state.guilds.length === 0 ? `
             <p class="text-sm text-center py-6 text-gray-600 italic">No guilds joined yet.</p>
          ` : `
             <div class="space-y-2">
               ${state.guilds.map(g => `
                 <button class="guild-item w-full flex items-center gap-3 p-3 glass-card hover:bg-white/5 transition-all text-left" data-guild-id="${g.id}">
                    <div class="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center">
                       <span data-lucide="users" class="w-4 h-4 text-gray-400"></span>
                    </div>
                    <span class="flex-1 font-medium text-sm">${g.name}</span>
                    <span data-lucide="log-in" class="w-4 h-4 text-gray-600"></span>
                 </button>
               `).join('')}
             </div>
          `}
          <button id="btn-join-code" class="w-full py-2 text-xs font-bold uppercase tracking-widest text-indigo-400 hover:text-indigo-300 transition-colors">
             Join via Code / ID
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
  div.querySelectorAll('.guild-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-guild-id')!;
      const guild = state.guilds.find(g => g.id === id)!;
      if (guild.memberPassword) {
        const pass = prompt(`Enter password for ${guild.name}:`);
        if (pass !== null) joinGuild(id, pass);
      } else {
        joinGuild(id);
      }
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
             <span class="text-indigo-500">${state.currentUser.role}</span>
             <span>•</span>
             <span>${state.timers.length} Timers</span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button id="btn-toggle-profile" class="px-3 py-1.5 glass-card flex items-center gap-2 text-xs hover:bg-white/10 transition-colors">
           <span data-lucide="user-circle" class="w-4 h-4"></span>
           <span class="hidden sm:inline">${state.currentUser.nickname}</span>
        </button>
        <button id="btn-go-control" class="btn btn-secondary flex items-center gap-2 text-xs">
           <span data-lucide="shield" class="w-4 h-4"></span>
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
    section.className = 'space-y-3 animate-in fade-in slide-in-from-top-4 duration-700 bg-indigo-500/5 p-4 rounded-2xl border border-indigo-500/10';
    section.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
           <span data-lucide="zap" class="w-3 h-3 text-indigo-400"></span>
           <h3 class="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Upcoming Today</h3>
        </div>
        <span class="text-[10px] text-indigo-500/60 font-mono">${upcomingToday.length} Event${upcomingToday.length > 1 ? 's' : ''} Remaining</span>
      </div>
      <div class="flex flex-wrap gap-x-6 gap-y-2">
        ${upcomingToday.map(t => {
          const remaining = calculateRemaining(t);
          const timeStr = new Date(t.endTime!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return `
            <div class="flex items-center gap-2 group cursor-default">
              <span class="w-1.5 h-1.5 rounded-full bg-indigo-500/40 group-hover:bg-indigo-400 transition-colors"></span>
              <span class="text-xs font-bold text-gray-300">${t.name}</span>
              <span class="text-xs font-mono text-indigo-400/80">${timeStr}</span>
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
           <span data-lucide="calendar" class="w-3 h-3 text-indigo-500"></span>
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
    isFinished ? 'border-red-500/30 bg-red-500/5' : 'hover:border-indigo-500/20'
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
                <span data-lucide="${timer.status === 'running' ? 'pause' : 'play'}" class="w-4 h-4 text-indigo-400"></span>
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
           <div class="w-10 h-10 bg-indigo-600/20 rounded-xl flex items-center justify-center border border-indigo-500/20">
              <span data-lucide="shield-check" class="w-6 h-6 text-indigo-400"></span>
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

 if (isLeader) {
    div.querySelector('#btn-edit-guild')?.addEventListener('click', () => showEditGuildModal());
    div.querySelector('#btn-add-officer')?.addEventListener('click', () => {
       const id = prompt('Enter User ID to appoint as Officer:');
       if (id && !guild.officerIds.includes(id)) {
          guild.officerIds.push(id);
          storageManager.saveGuildData(guild);
       }
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
       const key = prompt('Enter Leader Secret Key:');
       if (key === guild.leaderKey) {
          localStorage.setItem(`auth_key_${guild.id}`, key || '');
          updateRoleFromGuild();
          render();
       } else {
          alert('Invalid Key.');
       }
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
     <div class="space-y-1">
        <label class="label">Nickname</label>
        <input type="text" name="nickname" value="${state.currentUser.nickname}" class="input">
     </div>
     <div class="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-2">
        <p class="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Internal ID (Share with Leader for Officer role)</p>
        <p class="text-xs font-mono select-all break-all text-indigo-300">${state.currentUser.id}</p>
     </div>
     <button type="submit" class="btn btn-primary w-full">Update Profile</button>
  `;

  const overlay = showModal('My Profile', form);
  form.onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(form);
    state.currentUser.nickname = data.get('nickname') as string;
    saveLocal();
    overlay.remove();
    render();
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
    <div id="type-config" class="bg-white/5 p-4 rounded-xl border border-white/5"></div>
    <div class="flex items-center gap-3 py-2">
      <input type="checkbox" name="autoReset" id="auto-reset" ${existing?.autoReset ? 'checked' : ''} class="w-4 h-4 rounded border-white/10 bg-white/5 accent-indigo-500">
      <label for="auto-reset" class="text-sm text-gray-300">Auto-reset after finished</label>
    </div>
    <button type="submit" class="btn btn-primary w-full py-3 mt-2">${existing ? 'Update Timer' : 'Add Timer'}</button>
  `;

  const typeConfig = form.querySelector('#type-config')!;
  const typeSelect = form.querySelector('[name="type"]') as HTMLSelectElement;

  const renderTypeInputs = () => {
    const type = typeSelect.value as TimerType;
    if (type === 'field') {
      typeConfig.innerHTML = `
        <div class="space-y-4">
          <div class="space-y-1">
            <label class="label">Duration (Hours)</label>
            <input type="number" name="durationHours" class="input" value="${existing?.durationSeconds ? (existing.durationSeconds / 3600) : 1}" step="0.5" min="0.5" required>
          </div>
          <div class="space-y-1">
            <label class="label">Auto-Reset Duration (Seconds)</label>
            <input type="number" name="autoResetDurationSeconds" class="input" value="${existing?.autoResetDurationSeconds || 0}" min="0">
            <p class="text-[10px] text-gray-500 mt-1">If "Auto-reset" is enabled, it will restart with this many seconds when it reaches 0.</p>
          </div>
        </div>
      `;
    } else {
      typeConfig.innerHTML = `
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <label class="label">Schedules</label>
            <button type="button" id="btn-add-schedule" class="text-[10px] text-indigo-400 font-bold hover:underline">+ Add Entry</button>
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
    const autoResetDurationSeconds = Number(data.get('autoResetDurationSeconds')) || undefined;

    const timer: Timer = {
      id: existing?.id || crypto.randomUUID(),
      guildId: state.currentGuild!.id,
      name: data.get('name') as string,
      type,
      group: (data.get('group') as string) || 'Uncategorized',
      status: existing?.status || 'running',
      durationSeconds: type === 'field' ? (durationHours * 3600) : undefined,
      autoResetDurationSeconds,
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
              <div class="p-4 border border-white/10 rounded-2xl peer-checked:bg-indigo-500/10 peer-checked:border-indigo-500 transition-all text-center">
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
         return alert('Please fill in all primary Firebase fields (API Key, Project ID, Database URL)');
       }
    }

    const guild: Guild = {
      id: crypto.randomUUID(),
      name: data.get('name') as string,
      memberPassword: (data.get('memberPassword') as string) || undefined,
      leaderKey: data.get('leaderKey') as string,
      storageType,
      firebaseConfig: fbConfig,
      officerIds: []
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
        <input type="url" name="webhookUrl" value="${guild.webhookUrl || ''}" class="input text-xs" placeholder="https://discord.com/api/webhooks/...">
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
              <div class="p-3 border border-white/10 rounded-xl peer-checked:bg-indigo-500/10 peer-checked:border-indigo-500 transition-all text-center">
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
  function tick() {
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

    checkTimersFinished(state.timers);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

loadLocal();
startLoop();
render();
