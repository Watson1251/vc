// /rabbitmq/rabbitmq.js
const amqp = require("amqplib");
const logger = require("/logger/logger");
const crypto = require("crypto");

class RabbitMQ {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.connectionString = `amqp://${process.env.RABBITMQ_USERNAME}:${process.env.RABBITMQ_PASSWORD}@${process.env.RABBITMQ_URL}:${process.env.RABBITMQ_PORT}`;
    this.prefetch = parseInt(process.env.RABBIT_PREFETCH || '4', 10); // default 4
  }

  async connect() {
    if (this.connection && this.channel) return;
    this.connection = await amqp.connect(this.connectionString);
    this.connection.on('error', e => logger.error(`🐰 AMQP conn error: ${e.message}`));
    this.connection.on('close', () => {
      logger.warn('🐰 AMQP connection closed. Exiting process for restart.');
      process.exit(1);
    });

    this.channel = await this.connection.createChannel();
    await this.channel.prefetch(this.prefetch);
    logger.info(`🟢 Connected to RabbitMQ (prefetch=${this.prefetch})`);
  }

  /**
   * Publish JSON with useful defaults:
   * - persistent delivery
   * - contentType, messageId, timestamp, type, appId
   * - headers: targetId/runName (if present in message)
   */
  async publish(queue, message, props = {}) {
    await this.connect();
    await this.channel.assertQueue(queue, { durable: true });

    const payload = Buffer.from(JSON.stringify(message));
    const now = Math.floor(Date.now() / 1000);
    const autoMessageId =
      props.messageId ||
      message.messageId ||
      `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    const options = {
      persistent: true,
      contentType: "application/json",
      appId: process.env.APP_ID || "backend-vc",
      type: message.type || props.type || "vc.training.status",
      timestamp: props.timestamp || now,
      messageId: autoMessageId,
      headers: {
        ...(props.headers || {}),
        targetId: message.targetId ?? (props.headers?.targetId),
        runName: message.runName ?? (props.headers?.runName),
      },
      // keep any extra fields (correlationId, etc.)
      ...props,
    };

    const ok = this.channel.sendToQueue(queue, payload, options);
    if (ok) {
      logger.info(`📨 Published to "${queue}" (msgId=${options.messageId})`);
    } else {
      logger.warn(`⚠️ sendToQueue returned false for "${queue}"`);
    }
  }

  /**
   * Passes raw AMQP msg to callback(doc, msg)
   * Acks automatically after callback resolves (unchanged semantics).
   */
  async consume(queue, callback, { requeueOnError = false } = {}) {
    await this.connect();
    await this.channel.assertQueue(queue, { durable: true });
    this.channel.consume(
      queue,
      async (msg) => {
        if (!msg) return;
        let doc = null;
        try {
          doc = JSON.parse(msg.content.toString());
        } catch (e) {
          logger.warn(`⚠️ Non-JSON message on ${queue}. Acking. ${e.message}`);
          this.channel.ack(msg);
          return;
        }

        try {
          // ⬇️ send raw amqp msg so you can read fields/properties
          await callback(doc, msg);
          this.channel.ack(msg);
        } catch (err) {
          logger.error(`❌ Consumer error on ${queue}: ${err.message}`);
          this.channel.nack(msg, false, !!requeueOnError);
        }
      },
      { noAck: false }
    );
    logger.info(`🐰 Consuming "${queue}"`);
  }

  async peek(queue, limit = 1000) {
    await this.connect();
    await this.channel.assertQueue(queue, { durable: true });

    const docs = [];
    for (let i = 0; i < limit; i++) {
      const msg = await this.channel.get(queue, { noAck: false });
      if (!msg) break;

      try {
        const parsed = JSON.parse(msg.content.toString());
        docs.push(parsed);
      } catch (e) {
        logger.warn(`⚠️ Peek parse error on "${queue}": ${e.message}`);
      } finally {
        this.channel.nack(msg, false, true);
      }
    }

    logger.info(`👀 Peeked ${docs.length} message(s) from "${queue}"`);
    return docs;
  }

  async removeOneById(queue, targetId, { limit = 1000 } = {}) {
    await this.connect();
    await this.channel.assertQueue(queue, { durable: true });

    const kept = [];
    let removed = false;

    for (let i = 0; i < limit; i++) {
      const msg = await this.channel.get(queue, { noAck: false });
      if (!msg) break;

      let doc = null;
      try {
        doc = JSON.parse(msg.content.toString());
      } catch {
        // not JSON, just keep it
      }

      if (!removed && doc && doc.id === String(targetId)) {
        this.channel.ack(msg); // drop target
        removed = true;
        continue;
      }

      this.channel.ack(msg);
      kept.push({ content: msg.content, properties: msg.properties || {} });
    }

    for (const k of kept) {
      this.channel.sendToQueue(queue, k.content, { persistent: true, ...k.properties });
    }

    return removed;
  }

  async close() {
    if (this.channel) await this.channel.close();
    if (this.connection) await this.connection.close();
    this.channel = null;
    this.connection = null;
  }
}

module.exports = new RabbitMQ();
