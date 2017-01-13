'use strict'

const EventEmitter = require('eventemitter2')

class MockClient extends EventEmitter {
  constructor (opts) {
    super()
    this.plugin = opts
    this.plugin.getAccount = function () { return this.prefix + 'mark' }
    this.plugin.getInfo = function () {
      return {
        prefix: this.prefix,
        connectors: ['example.blue.connector1'],
        precision: 10,
        scale: 2
      }
    }
  }

  getPlugin () { return this.plugin }

  connect () { return Promise.resolve(null) }
  disconnect () { return Promise.resolve(null) }
}

module.exports = MockClient
