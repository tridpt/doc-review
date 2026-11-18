/**
 * ⚡ DocReview Studio v2.0 — Realtime Collaboration & Live Presence Hub (Server-Sent Events)
 * - Quản lý các phiên kết nối trực tiếp (nhiều tab / nhiều người rà soát cùng lúc)
 * - Phát sóng tức thì: presence:update, doc:updated, workspace:updated, governance:updated
 */

class RealtimeHub {
  constructor() {
    this.clients = new Map(); // clientId -> { res, clientId, author, role, docId, mode, connectedAt, lastSeenAt }
    this.keepAliveTimer = setInterval(() => {
      for (const [cid, client] of this.clients.entries()) {
        try {
          client.res.write(': keepalive\n\n');
        } catch {
          this.clients.delete(cid);
        }
      }
    }, 18000);
    if (this.keepAliveTimer.unref) {
      this.keepAliveTimer.unref();
    }
  }

  addClient({ clientId, author = 'Reviewer', role = 'Reviewer', docId = '', mode = 'review', res }) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const now = new Date().toISOString();
    const record = {
      clientId,
      author,
      role,
      docId,
      mode,
      connectedAt: now,
      lastSeenAt: now,
      res
    };
    this.clients.set(clientId, record);

    // Gửi gói chào mừng & danh sách người đang trực tuyến ngay lập tức
    this._sendToClient(res, 'connected', {
      clientId,
      presence: this.getPresenceSnapshot()
    });
    this.broadcastPresence();

    res.on('close', () => {
      this.clients.delete(clientId);
      this.broadcastPresence();
    });
  }

  updatePresence({ clientId, author, role, docId, mode }) {
    const client = this.clients.get(clientId);
    if (!client) return this.getPresenceSnapshot();
    if (author !== undefined) client.author = author;
    if (role !== undefined) client.role = role;
    if (docId !== undefined) client.docId = docId;
    if (mode !== undefined) client.mode = mode;
    client.lastSeenAt = new Date().toISOString();
    this.broadcastPresence();
    return this.getPresenceSnapshot();
  }

  getPresenceSnapshot() {
    const viewers = [];
    for (const c of this.clients.values()) {
      viewers.push({
        clientId: c.clientId,
        author: c.author,
        role: c.role,
        docId: c.docId,
        mode: c.mode,
        lastSeenAt: c.lastSeenAt
      });
    }
    return viewers;
  }

  _sendToClient(res, eventName, payload) {
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // Bỏ qua kết nối đã đóng
    }
  }

  broadcast(eventName, payload, excludeClientId = null) {
    for (const [cid, client] of this.clients.entries()) {
      if (excludeClientId && cid === excludeClientId) continue;
      this._sendToClient(client.res, eventName, payload);
    }
  }

  broadcastPresence() {
    this.broadcast('presence:update', {
      presence: this.getPresenceSnapshot()
    });
  }

  closeAll() {
    clearInterval(this.keepAliveTimer);
    for (const c of this.clients.values()) {
      try {
        c.res.end();
      } catch {}
    }
    this.clients.clear();
  }
}

module.exports = {
  RealtimeHub
};
