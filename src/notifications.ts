/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export async function sendDiscordNotification(webhookUrl: string, message: string) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });
  } catch (error) {
    console.error('Failed to send Discord notification:', error);
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.error('This browser does not support desktop notifications.');
    return false;
  }

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

export async function sendBrowserNotification(title: string, body: string, url: string = '/') {
  if (Notification.permission === 'granted') {
    // Try via Service Worker if available for background support
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      if (registration) {
        registration.showNotification(title, {
          body,
          icon: 'https://picsum.photos/seed/chronos/192/192',
          badge: 'https://picsum.photos/seed/chronos/192/192',
          data: url,
        });
        return;
      }
    }
    
    // Fallback to standard Notification API
    new Notification(title, {
      body,
      icon: 'https://picsum.photos/seed/chronos/192/192',
    });
  }
}
