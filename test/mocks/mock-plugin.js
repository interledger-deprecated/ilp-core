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

  getPrefix () {
    return Promise.resolve('example.blue.')
  }

  getAccount () {
    return Promise.resolve('example.blue.mark')
  }

  getInfo () {
    return Promise.resolve({
      connectors: [{name: 'connector1'}],
      precision: 10,
      scale: 2
    })
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
