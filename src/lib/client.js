'use strict'

const co = require('co')
const uuid = require('uuid')
const request = require('superagent')
const BigNumber = require('bignumber.js')
const isUndefined = require('lodash/fp/isUndefined')
const omitUndefined = require('lodash/fp/omitBy')(isUndefined)
const EventEmitter = require('eventemitter2')
const notUndefined = require('lodash/fp/negate')(isUndefined)

class Client extends EventEmitter {
  constructor (opts) {
    super()

    if (typeof opts !== 'object') {
      throw new TypeError('Client options must be an object')
    }

    if (typeof opts.plugin !== 'function') {
      throw new TypeError('"plugin" must be a function')
    }

    const Plugin = opts.plugin

    this.plugin = new Plugin(opts)
    this.connecting = false

    this.plugin
      .on('receive', (transfer) => this.emitAsync('receive', transfer))
      .on('fulfill_execution_condition', (transfer, fulfillment) =>
        this.emitAsync('fulfill_execution_condition', transfer, fulfillment))
      .on('fulfill_cancellation_condition', (transfer, fulfillment) =>
        this.emitAsync('fulfill_cancellation_condition', transfer, fulfillment))

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
    return this.plugin.disconnect()
  }

  /**
   * Get a quote from a connector
   * @param  {String} [params.sourceAmount] Either the sourceAmount or destinationAmount must be specified
   * @param  {String} [params.destinationAmount] Either the sourceAmount or destinationAmount must be specified
   * @param  {String} params.destinationAddress Recipient's ledger
   * @param  {Number} [params.destinationExpiryDuration] Number of seconds between when the destination transfer is proposed and when it expires.
   * @param  {String} [params.destinationPrecision] Must be provided for ledgers that are not adjacent to the quoting connector when quoting by source amount.
   * @param  {String} [params.destinationScale]
   * @return {Object} Object including the amount that was not specified
   */
  quote (params) {
    const plugin = this.plugin
    return co(function * () {
      if (params.sourceAmount ? params.destinationAmount : !params.destinationAmount) {
        throw new Error('Should provide source or destination amount but not both')
      }

      const quoteQuery = {
        source_address: (yield plugin.getPrefix()),
        source_amount: params.sourceAmount,
        destination_address: params.destinationAddress,
        destination_amount: params.destinationAmount,
        destination_expiry_duration: params.destinationExpiryDuration,
        destination_precision: params.destinationPrecision,
        destination_scale: params.destinationScale
      }
      const connectors = yield plugin.getConnectors()
      const quotes = (yield connectors.map(function (connector) {
        return getQuote(connector, quoteQuery)
      })).filter(notUndefined)
      if (quotes.length === 0) return
      const bestQuote = quotes.reduce(getCheaperQuote)
      return omitUndefined({
        sourceAmount: bestQuote.source_amount,
        destinationAmount: bestQuote.destination_amount,
        connectorAccount: bestQuote.source_connector_account,
        sourceExpiryDuration: bestQuote.source_expiry_duration
      })
    })
  }

  /**
   * Send a payment
   * @param  {String} params.sourceAmount Amount to send
   * @param  {String} params.destinationAmount Amount recipient will receive
   * @param  {String} params.destinationAccount Recipient's account
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
      account: params.connectorAccount,
      amount: params.sourceAmount,
      data: {
        ilp_header: omitUndefined({
          account: params.destinationAccount,
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

function * getQuote (connector, query) {
  try {
    const res = yield request.get(connector + '/quote').query(query)
    return res.body
  } catch (err) {
    if (err.response.body.id !== 'AssetsNotTradedError') throw err
  }
}

function getCheaperQuote (quote1, quote2) {
  if ((new BigNumber(quote1.source_amount))
      .lessThan(quote2.source_amount)) {
    return quote1
  }
  if ((new BigNumber(quote1.destination_amount))
      .greaterThan(quote2.destination_amount)) {
    return quote1
  }
  return quote2
}

module.exports = Client
