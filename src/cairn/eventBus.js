const { now } = require("./utils");

class EventBus {
  constructor() {
    this.events = [];
    this.clients = new Set();
  }

  emit(type, payload = {}) {
    const event = {
      id: this.events.length + 1,
      ts: now(),
      type,
      ...payload
    };
    this.events.push(event);
    if (this.events.length > 500) {
      this.events.shift();
    }
    const wire = `id: ${event.id}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      client.write(wire);
    }
    return event;
  }

  subscribe(res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.write("\n");
    this.clients.add(res);
    for (const event of this.events.slice(-60)) {
      res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    return () => this.clients.delete(res);
  }
}

module.exports = { EventBus };
