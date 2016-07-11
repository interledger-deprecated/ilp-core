'use strict'

const co = require('co')
const uuid = require('uuid')
const request = require('superagent')
const isUndefined = require('lodash/fp/isUndefined')
const omitUndefined = require('lodash/fp/omitBy')(isUndefined)
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
    this.connecting = false

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
    return this.plugin.connect()
  }

  disconnect () {
    this.connecting = false
    this.plugin.disconnect()
  }

  /**
   * Get a quote from a connector
   * @param  {String} [params.sourceAmount] Either the sourceAmount or destinationAmount must be specified
   * @param  {String} [params.destinationAmount] Either the sourceAmount or destinationAmount must be specified
   * @param  {String} params.destinationLedger Recipient's ledger
   * @return {Object} Object including the amount that was not specified
   */
  quote (params) {
    const plugin = this.plugin
    return co(function * () {
      if (params.sourceAmount ? params.destinationAmount : !params.destinationAmount) {
        throw new Error('Should provide source or destination amount but not both')
      }

      const connector = (yield plugin.getConnectors())[0]
      const res = yield request.get(connector + '/quote')
        .query({
          source_ledger: plugin.id,
          source_amount: params.sourceAmount,
          destination_ledger: params.destinationLedger,
          destination_amount: params.destinationAmount
        })

      return omitUndefined({
        sourceAmount: res.body.source_amount,
        destinationAmount: res.body.destination_amount,
        connectorAccount: res.body.source_connector_account
      })
    })
  }

  /**
   * Send a payment
   * @param  {String} params.sourceAmount Amount to send
   * @param  {String} params.destinationAmount Amount recipient will receive
   * @param  {String} params.destinationAccount Recipient's account
   * @param  {String} params.destinationLedger Recipient's ledger
   * @param  {String} params.connectorAccount First connector's account on the source ledger (from the quote)
   * @param  {Object} params.destinationMemo Memo for the recipient to be included with the payment
   * @param  {String} params.expiresAt Payment expiry timestamp
   * @param  {String} params.executionCondition Crypto condition
   * @return {Promise.<Object>} Resolves when the payment has been submitted to the plugin
   */
  sendQuotedPayment (params) {
    if (!params.executionCondition && !params.unsafeOptimisticTransport) {
      return Promise.reject(new Error('executionCondition must be provided unless unsafeOptimisticTransport is true'))
    }

    if (params.executionCondition && !params.expiresAt) {
      return Promise.reject(new Error('executionCondition should not be used without expiresAt'))
    }

    // TODO throw errors if other fields are not specified

    const transfer = omitUndefined({
      id: uuid.v4(),
      ledger: this.plugin.id,
      account: params.connectorAccount,
      amount: params.sourceAmount,
      data: {
        ilp_header: omitUndefined({
          account: params.destinationAccount,
          ledger: params.destinationLedger,
          amount: params.destinationAmount,
          data: params.destinationMemo
        })
      },
      executionCondition: params.executionCondition,
      expiresAt: params.expiresAt
    })

    return this.plugin.send(transfer)
  }
}

module.exports = Client
