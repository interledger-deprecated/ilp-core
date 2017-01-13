'use strict'

const EventEmitter = require('eventemitter2')

class MockPlugin extends EventEmitter {
  constructor () {
    super()
    this.host = 'mock:'
  }

  connect () {
    this.connected = true
    this.emit('connect')
    return Promise.resolve(null)
  }

  disconnect () {
    this.connected = false
  }

  isConnected () {
    return this.connected
  }

  getAccount () {
    return 'example.blue.mark'
  }

  getInfo () {
    return {
      prefix: 'example.blue.',
      connectors: ['example.blue.connector1'],
      precision: 10,
      scale: 2
    }
  }

  sendTransfer () {
    return Promise.resolve(null)
  }

  sendMessage () {
    return Promise.resolve(null)
  }

  fulfillCondition () {
    return Promise.resolve(null)
  }
}

module.exports = MockPlugin
