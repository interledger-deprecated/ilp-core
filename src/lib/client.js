'use strict'

const Payment = require('./payment')
const EventEmitter = require('eventemitter2')

class Client extends EventEmitter {
  constructor (opts) {
    super()

    if (typeof opts !== 'object') {
      throw new TypeError('Client options must be an object')
    }

    if (typeof opts.type !== 'string' || !opts.type.length) {
      throw new TypeError('Plugin type must be a non-empty string')
    }

    const Plugin = require('ilp-plugin-' + opts.type)

    this.plugin = new Plugin(opts)
    this.connecting = true
    this.plugin.connect()
      .catch((err) => {
        console.error((err && err.stack) ? err.stack : err)
      })

    this.plugin.on('receive', (transfer) => this.emit('receive', transfer))
    this.plugin.on('fulfill_execution_condition', (transfer, fulfillment) =>
      this.emit('fulfill_execution_condition', transfer, fulfillment))
    this.plugin.on('fulfill_cancellation_condition', (transfer, fulfillment) =>
      this.emit('fulfill_cancellation_condition', transfer, fulfillment))

    this._extensions = {}
  }

  /**
   * Use an ILP Extension
   * @param  {Function} Extension ILP Extension to use
   */
  use (Extension) {
    if (typeof Extension.getName !== 'function') {
      throw new Error('Extension class must have a static getName method')
    }
    const name = Extension.getName()
    if (typeof name !== 'string') {
      throw new Error('Extension.getName must return a string')
    }
    const ext = new Extension(this)
    this._extensions[name] = ext
    this[name] = ext
  }

  getPlugin () {
    return this.plugin
  }

  createPayment (opts) {
    return new Payment(this, opts)
  }

  waitForConnection () {
    // First check if we're even trying to connect
    if (!this.connecting) {
      return Promise.reject(new Error('Plugin is set to disconnected state'))
    }

    // If we're already connected, just return
    if (this.plugin.isConnected()) return Promise.resolve(null)

    // Otherwise wait until we're connected
    return new Promise((resolve) => this.plugin.once('connect', resolve))
  }

  fulfillCondition (transferId, fulfillment) {
    return this.plugin.fulfillCondition(transferId, fulfillment)
  }

  connect () {
    this.connecting = true
    this.plugin.connect()
  }

  disconnect () {
    this.connecting = false
    this.plugin.disconnect()
  }
}

module.exports = Client
