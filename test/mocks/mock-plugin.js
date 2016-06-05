'use strict'

const EventEmitter = require('eventemitter2')

class MockPlugin extends EventEmitter {
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

  getConnectors () {
    return Promise.resolve(['http://connector.example'])
  }
}

module.exports = MockPlugin
