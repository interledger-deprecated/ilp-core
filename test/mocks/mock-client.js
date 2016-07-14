'use strict'

const EventEmitter = require('eventemitter2')

class MockClient extends EventEmitter {
  constructor (opts) {
    super()
    this.plugin = opts
  }

  getPlugin () { return this.plugin }

  connect () { return Promise.resolve(null) }
  disconnect () { return Promise.resolve(null) }
}

module.exports = MockClient
