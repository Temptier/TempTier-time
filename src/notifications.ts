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
