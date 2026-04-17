/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Simple worker to keep the timer loop running even when the tab is inactive
let timerId: any = null;

self.onmessage = (event) => {
  if (event.data.type === 'START') {
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      self.postMessage({ type: 'TICK' });
    }, 1000);
  } else if (event.data.type === 'STOP') {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }
};
