'use strict'

const EventEmitter = require('eventemitter2')

class MockClient extends EventEmitter {
  constructor (opts) {
    super()
    this.plugin = opts
    this.plugin.getPrefix = function () { return Promise.resolve(this.prefix) }
    this.plugin.getAccount = function () { return Promise.resolve(this.prefix + 'mark') }
    this.plugin.getInfo = function () { return Promise.resolve({precision: 10, scale: 2}) }
  }

  getPlugin () { return this.plugin }

  connect () { return Promise.resolve(null) }
  disconnect () { return Promise.resolve(null) }
}

module.exports = MockClient
