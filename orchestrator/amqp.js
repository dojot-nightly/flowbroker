"use strict";

/**
 * Feeds messages to the flow engine, mapping received messages to known configured flows
 */
var amqp = require('amqplib/callback_api');
var config = require('./config');

class AMQPBase {
  constructor(target) {
    this.target = target || config.amqp.url;
    this.connection = null;
    this.channel = null;
    this.callbacks = {};
  }

  connect() {
    return new Promise((resolve, reject) => {
      amqp.connect(this.target, (error, connection) => {
        if (error) {
          return reject(error);
        }

        this.connection = connection;
        for (let callback in this.callbacks.connection) {
          if (this.callbacks.connection.hasOwnProperty(callback)) {
            callback(this.connection);
          }
        }

        this.connection.createChannel((error, channel) => {
          if (error) {
            return reject(error);
          }

          this.channel = channel;
          let list = this.callbacks.channel;
          for (let i = 0; i < list.length; i++) {
            list[i](channel);
          }

          return resolve();
        });
      });
    });
  }

  on(event, callback) {
    let registered = [];
    if (this.callbacks.hasOwnProperty(event)) {
      registered = this.callbacks[event];
    }

    registered.unshift(callback);
    this.callbacks[event] = registered;
  }
}

class AMQPProducer extends AMQPBase {
  constructor(queue, target) {
    if (queue === undefined) {
      throw new Error("Queue must be defined");
    }

    super(target);
    this.queue = queue;
    this.backtrack = [];

    this.on('channel', (channel) => {
      channel.assertQueue(this.queue, { durable: true });
      console.log('[amqp] producer ready ... ');

      let event = this.backtrack.pop();
      while (event) {
        this.sendMessage(event);
        event = this.backtrack.pop();
      }
    });
  }

  sendMessage(data) {
    if (this.channel) {
      let buffer = new Buffer(data);
      // console.log('Will send message [%s] %s', this.queue, data);
      this.channel.sendToQueue(this.queue, buffer, { persistent: true });
      return;
    } else {
      // console.log('channel was not ready yet', this);
      this.backtrack.push(data);
    }
  }
}

class AMQPConsumer extends AMQPBase {
  constructor(queue, onMessage, target) {
    if (queue === undefined || onMessage === undefined) {
      throw new Error("Both queue and message callbacks must be defined");
    }

    super(target);
    this.queue = queue;
    this.on('channel', (channel) => {
      console.log('[amqp] consumer ready ... ');
      channel.assertQueue(this.queue, { durable: true });
      channel.consume(this.queue, (amqpCtx) => {
        onMessage(amqpCtx.content.toString(), () => {
          // console.log('will ack message', new Error().stack);
          channel.ack(amqpCtx);
        });
      });
    });
  }
}

module.exports = {
  AMQPConsumer: AMQPConsumer,
  AMQPProducer: AMQPProducer
};
