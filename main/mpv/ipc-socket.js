// ─────────────────────────────────────────────────────────────────────────────
// CT-desk  ·  MPV JSON IPC Socket
// ─────────────────────────────────────────────────────────────────────────────
// Communicates with mpv via its JSON IPC protocol over a Unix domain socket
// (macOS/Linux) or named pipe (Windows).
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const net = require('net');
const EventEmitter = require('events');

class MpvIpcSocket extends EventEmitter {
  constructor(socketPath) {
    super();
    this._socketPath = socketPath;
    this._socket = null;
    this._requestId = 0;
    this._pending = new Map(); // requestId -> { resolve, reject, timer }
    this._buffer = '';
    this._connected = false;
  }

  /**
   * Connect to the mpv IPC socket.
   * @param {number} timeoutMs  Connection timeout
   * @returns {Promise<void>}
   */
  connect(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('mpv IPC connection timed out'));
        if (this._socket) this._socket.destroy();
      }, timeoutMs);

      // Retry connection — mpv needs a moment to create the socket
      const tryConnect = (retriesLeft = 20) => {
        this._socket = net.createConnection(this._socketPath);

        this._socket.on('connect', () => {
          clearTimeout(timer);
          this._connected = true;
          this.emit('connected');
          resolve();
        });

        this._socket.on('data', (data) => this._onData(data));

        this._socket.on('error', (err) => {
          if (retriesLeft > 0 && !this._connected) {
            setTimeout(() => tryConnect(retriesLeft - 1), 250);
          } else if (!this._connected) {
            clearTimeout(timer);
            reject(err);
          } else {
            this.emit('error', err);
          }
        });

        this._socket.on('close', () => {
          this._connected = false;
          this.emit('disconnected');
        });
      };

      tryConnect();
    });
  }

  /**
   * Disconnect from the IPC socket.
   */
  disconnect() {
    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }
    this._connected = false;

    // Reject all pending requests
    for (const [, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('IPC disconnected'));
    }
    this._pending.clear();
  }

  /**
   * Send a command to mpv and await the response.
   * @param  {...any} args  mpv command arguments
   * @returns {Promise<any>}
   */
  command(...args) {
    return new Promise((resolve, reject) => {
      if (!this._connected) {
        return reject(new Error('Not connected to mpv IPC'));
      }

      const requestId = ++this._requestId;
      const msg = JSON.stringify({ command: args, request_id: requestId }) + '\n';

      const timer = setTimeout(() => {
        this._pending.delete(requestId);
        reject(new Error(`mpv command timed out: ${args[0]}`));
      }, 10000);

      this._pending.set(requestId, { resolve, reject, timer });

      this._socket.write(msg, (err) => {
        if (err) {
          clearTimeout(timer);
          this._pending.delete(requestId);
          reject(err);
        }
      });
    });
  }

  /**
   * Get a property value from mpv.
   * @param {string} name  Property name
   * @returns {Promise<any>}
   */
  async getProperty(name) {
    const result = await this.command('get_property', name);
    return result;
  }

  /**
   * Set a property on mpv.
   * @param {string} name   Property name
   * @param {any}    value  Property value
   */
  async setProperty(name, value) {
    return this.command('set_property', name, value);
  }

  /**
   * Observe a property for changes.
   * @param {string} name  Property name
   * @param {number} id    Observer ID
   */
  async observeProperty(name, id) {
    return this.command('observe_property', id, name);
  }

  get connected() {
    return this._connected;
  }

  // ── Private ────────────────────────────────────────────────────────────

  _onData(data) {
    this._buffer += data.toString();
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this._handleMessage(msg);
      } catch {
        // Ignore malformed JSON
      }
    }
  }

  _handleMessage(msg) {
    // Event / property change notification
    if (msg.event) {
      this.emit('mpv-event', msg);
      return;
    }

    // Response to a command
    if (msg.request_id !== undefined) {
      const pending = this._pending.get(msg.request_id);
      if (pending) {
        clearTimeout(pending.timer);
        this._pending.delete(msg.request_id);

        if (msg.error && msg.error !== 'success') {
          pending.reject(new Error(`mpv error: ${msg.error}`));
        } else {
          pending.resolve(msg.data);
        }
      }
    }
  }
}

module.exports = { MpvIpcSocket };
