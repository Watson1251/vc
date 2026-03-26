const rabbitmq = require("./rabbitmq");

// This function checks if a message with the given ID exists in the queue (non-blocking scan)
async function isIdInQueue(queue, id) {
    const channel = rabbitmq.channel;
    if (!channel) {
        await rabbitmq.connect();
    }

    await channel.assertQueue(queue, { durable: true });

    const messages = [];
    let found = false;

    for (let i = 0; i < 100; i++) {  // Limit to 100 peeked messages max
        const msg = await channel.get(queue, { noAck: false });
        if (!msg) break;

        try {
            const content = JSON.parse(msg.content.toString());
            messages.push(msg);

            if (content.id === id) {
                found = true;
                break;
            }
        } catch (err) {
            console.error("❌ Error parsing message content:", err);
        }
    }

    // Requeue all peeked messages
    for (const msg of messages) {
        channel.nack(msg, false, true);  // Requeue all peeked messages
    }

    return found;
}

module.exports = {
    isIdInQueue
};
