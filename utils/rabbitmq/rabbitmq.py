# utils/rabbitmq.py
import os, json, time, uuid
import pika
from threading import Thread
from queue import Queue, Empty
from typing import List, Dict

import sys
sys.path.append('/logger')
from logger import AppLogger
logger = AppLogger()

_RETRY_SLEEP_BASE = 0.5
_MAX_RETRY_SLEEP  = 8.0

class RabbitMQManager:
    def __init__(self, queue_name, durable=True, auto_ack=False, callback=None):
        self.host = os.getenv("RABBITMQ_URL", "localhost")
        self.port = int(os.getenv("RABBITMQ_PORT", 5672))
        self.user = os.getenv("RABBITMQ_DEFAULT_USER", "admin")
        self.password = os.getenv("RABBITMQ_DEFAULT_PASS", "admin")
        self.queue_name = queue_name
        self.durable = durable
        self.auto_ack = auto_ack
        self.callback = callback

        self.publish_queue = Queue()
        self.ack_queue = Queue()

        self._start_publisher_thread()
        self._start_ack_thread()

    def _connection_params(self):
        credentials = pika.PlainCredentials(self.user, self.password)
        return pika.ConnectionParameters(
            host=self.host,
            port=self.port,
            credentials=credentials,
            heartbeat=600,
            blocked_connection_timeout=300,
            connection_attempts=999999,  # keep trying in _connect loop
            retry_delay=2.0,
            socket_timeout=10,
            client_properties={"connection_name": f"vc-engine:{self.queue_name}"}
        )

    def _connect(self):
        params = self._connection_params()
        while True:
            try:
                conn = pika.BlockingConnection(params)
                ch = conn.channel()
                ch.queue_declare(queue=self.queue_name, durable=self.durable)
                return conn, ch
            except pika.exceptions.AMQPConnectionError:
                logger.info("Waiting for RabbitMQ to be ready...")
                time.sleep(2)

    def is_queue_empty(self) -> bool:
        try:
            conn = pika.BlockingConnection(self._connection_params())
            ch = conn.channel()
            q = ch.queue_declare(queue=self.queue_name, passive=True)
            count = q.method.message_count
            conn.close()
            logger.info(f"[RabbitMQ] Queue '{self.queue_name}' has {count} messages")
            return count == 0
        except Exception:
            logger.exception("[RabbitMQ] Failed to check queue length")
            return False

    def drain_messages(self, max_wait=2) -> List[Dict]:
        conn, ch = self._connect()
        msgs = []
        start = time.time()
        logger.info(f"[RabbitMQ] Draining '{self.queue_name}' for up to {max_wait}s...")
        while True:
            method, props, body = ch.basic_get(self.queue_name, auto_ack=False)
            if method is None:
                if time.time() - start > max_wait: break
                time.sleep(0.1); continue
            try:
                msg = json.loads(body)
                msgs.append((msg, method.delivery_tag))
            except Exception as e:
                logger.error(f"[RabbitMQ] Failed to decode message: {e}; dropping.")
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                continue
        conn.close()
        logger.info(f"[RabbitMQ] Drained {len(msgs)} message(s).")
        return msgs

    def publish(self, message: dict):
        self.publish_queue.put(message)

    def ack(self, delivery_tag):
        self.ack_queue.put(delivery_tag)

    # ---------- threads ----------
    def _start_publisher_thread(self):
        def worker():
            conn, ch = self._connect()
            ch.confirm_delivery()  # publisher confirms
            logger.info("Publisher thread started.")
            backoff = _RETRY_SLEEP_BASE

            while True:
                try:
                    msg = self.publish_queue.get(timeout=0.5)
                except Empty:
                    # keep heartbeats flowing
                    if conn.is_closed or ch.is_closed:
                        try: conn.close()
                        except Exception: pass
                        conn, ch = self._connect()
                        ch.confirm_delivery()
                    continue

                if msg is None:
                    break

                body = json.dumps(msg)
                props = pika.BasicProperties(
                    delivery_mode=2 if self.durable else 1,
                    content_type="application/json",
                    message_id=msg.get("messageId") or f"{int(time.time()*1000)}-{uuid.uuid4().hex[:8]}",
                    timestamp=int(time.time()),
                    type=msg.get("type") or "vc.training.status",
                    app_id=os.getenv("APP_ID", "vc-engine"),
                    headers={"targetId": msg.get("targetId"), "runName": msg.get("runName")},
                    correlation_id=msg.get("runName") or msg.get("targetId"),
                )

                while True:
                    try:
                        if conn.is_closed or ch.is_closed:
                            try: conn.close()
                            except Exception: pass
                            conn, ch = self._connect()
                            ch.confirm_delivery()
                            backoff = _RETRY_SLEEP_BASE

                        ch.basic_publish(exchange='', routing_key=self.queue_name, body=body, properties=props, mandatory=False)
                        logger.info(f"Published to {self.queue_name}: {body}")
                        backoff = _RETRY_SLEEP_BASE
                        break
                    except (pika.exceptions.ChannelClosedByBroker,
                            pika.exceptions.StreamLostError,
                            pika.exceptions.ConnectionClosed,
                            pika.exceptions.AMQPError) as e:
                        logger.error(f"Publish failed (will retry): {e}")
                        try: conn.close()
                        except Exception: pass
                        time.sleep(backoff)
                        backoff = min(_MAX_RETRY_SLEEP, backoff * 2)
                        conn, ch = self._connect()
                        ch.confirm_delivery()
                    except Exception as e:
                        logger.exception(f"Unexpected publish error (dropping message): {e}")
                        break
                self.publish_queue.task_done()

            try: conn.close()
            except Exception: pass
            logger.info("Publisher thread stopped.")

        Thread(target=worker, daemon=True).start()

    def _start_ack_thread(self):
        # Keep for legacy users who might still call ack(); prefer per-message acking on the consume channel.
        def worker():
            conn, ch = self._connect()
            logger.info("Ack thread started.")
            backoff = _RETRY_SLEEP_BASE
            while True:
                try:
                    tag = self.ack_queue.get(timeout=0.5)
                except Empty:
                    if conn.is_closed or ch.is_closed:
                        try: conn.close()
                        except Exception: pass
                        conn, ch = self._connect()
                    continue
                if tag is None: break

                while True:
                    try:
                        ch.basic_ack(delivery_tag=tag)
                        logger.info(f"Acknowledged tag: {tag}")
                        backoff = _RETRY_SLEEP_BASE
                        break
                    except (pika.exceptions.StreamLostError,
                            pika.exceptions.ConnectionClosed,
                            pika.exceptions.ChannelClosedByBroker) as e:
                        logger.warning(f"Ack failed (retrying): {e}")
                        try: conn.close()
                        except Exception: pass
                        time.sleep(backoff)
                        backoff = min(_MAX_RETRY_SLEEP, backoff * 2)
                        conn, ch = self._connect()
                    except Exception as e:
                        logger.exception(f"Unexpected ack error (giving up): {e}")
                        break
                self.ack_queue.task_done()

            try: conn.close()
            except Exception: pass
            logger.info("Ack thread stopped.")

        Thread(target=worker, daemon=True).start()

    # ---------- consumers ----------
    def consume_queue(self, on_message_callback):
        # Auto-ack consumer; wrapper will ack after callback returns.
        while True:
            conn, ch = self._connect()
            def wrapper(ch_, method, properties, body):
                try:
                    msg = json.loads(body)
                except Exception as e:
                    logger.error(f"Error decoding message: {e}. Acking to drop.")
                    ch_.basic_ack(delivery_tag=method.delivery_tag)
                    return
                try:
                    on_message_callback(msg, ch_, method.delivery_tag)
                finally:
                    ch_.basic_ack(delivery_tag=method.delivery_tag)
            try:
                ch.basic_qos(prefetch_count=10)
                ch.basic_consume(queue=self.queue_name, on_message_callback=wrapper, auto_ack=False)
                logger.info(f"Consuming (auto-ack) from {self.queue_name}...")
                ch.start_consuming()
            except Exception as e:
                logger.warning(f"[RabbitMQ] Consumer error on '{self.queue_name}': {e}. Reconnecting in 2s...")
                try: conn.close()
                except Exception: pass
                time.sleep(2)
                continue

    def consume_with_manual_ack_queue(self, on_message_callback):
        """
        Manual-ack consumer: the callback MUST call basic_ack/basic_nack on ch.
        No separate ack thread is involved to avoid double acks.
        """
        while True:
            conn, ch = self._connect()
            try:
                prefetch = int(os.getenv("VC_MAX_CONCURRENCY", "4"))
            except Exception:
                prefetch = 1

            def wrapper(ch_, method, properties, body):
                try:
                    msg = json.loads(body)
                except Exception as e:
                    logger.error(f"Error decoding message: {e}. Acking to drop.")
                    ch_.basic_ack(delivery_tag=method.delivery_tag)
                    return
                try:
                    on_message_callback(msg, ch_, method.delivery_tag)
                except Exception as e:
                    logger.error(f"Error in message handler: {e}. NACK requeue.")
                    try: ch_.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
                    except Exception: pass

            try:
                ch.basic_qos(prefetch_count=prefetch)
                ch.basic_consume(queue=self.queue_name, on_message_callback=wrapper, auto_ack=False)
                logger.info(f"Consuming (manual ack) from {self.queue_name}...")
                ch.start_consuming()
            except Exception as e:
                logger.warning(f"[RabbitMQ] Consumer error on '{self.queue_name}': {e}. Reconnecting in 2s...")
                try: conn.close()
                except Exception: pass
                time.sleep(2)
                continue
