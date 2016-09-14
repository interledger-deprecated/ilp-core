'use strict'

const co = require('co')
const uuid = require('uuid')
const BigNumber = require('bignumber.js')
const isUndefined = require('lodash/fp/isUndefined')
const omitUndefined = require('lodash/fp/omitBy')(isUndefined)
const EventEmitter = require('eventemitter2')
const notUndefined = require('lodash/fp/negate')(isUndefined)
const startsWith = require('lodash/fp/startsWith')
const getQuote = require('./util').getQuote

class Client extends EventEmitter {
  /**
   * @param {Object} pluginOpts options for the ledger plugin
   * @param {Function} pluginOpts._plugin A ledger plugin constructor
   * @param {Object} [_clientOpts]
   * @param {URI[]} [_clientOpts.connectors] A list of connectors to quote from
   */
  constructor (pluginOpts, _clientOpts) {
    super()

    if (typeof pluginOpts !== 'object') {
      throw new TypeError('Client pluginOpts must be an object')
    }

    if (typeof pluginOpts._plugin !== 'function') {
      throw new TypeError('"pluginOpts._plugin" must be a function')
    }

    if (_clientOpts !== undefined && typeof _clientOpts !== 'object') {
      throw new TypeError('Client clientOpts must be an object')
    }

    const clientOpts = _clientOpts || {}
    if (clientOpts.connectors !== undefined && !Array.isArray(clientOpts.connectors)) {
      throw new TypeError('"clientOpts.connectors" must be an Array or undefined')
    }

    const Plugin = pluginOpts._plugin

    this.plugin = new Plugin(pluginOpts)
    this.connectors = clientOpts.connectors
    this.connecting = false

    // listen for all events in both the incoming and outgoing directions
    for (let direction of ['incoming', 'outgoing']) {
      this.plugin
        .on(direction + '_transfer', (transfer) =>
          this.emitAsync(direction + '_transfer', transfer))
        .on(direction + '_prepare', (transfer) =>
          this.emitAsync(direction + '_prepare', transfer))
        .on(direction + '_fulfill', (transfer, fulfillment) =>
          this.emitAsync(direction + '_fulfill', transfer, fulfillment))
        .on(direction + '_cancel', (transfer, reason) =>
          this.emitAsync(direction + '_cancel', transfer, reason))
        .on(direction + '_reject', (transfer, reason) =>
          this.emitAsync(direction + '_reject', transfer, reason))
    }

    this._extensions = {}
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
   * @param  {Array} [params.connectors] List of connectors to get the quotes from
   * @return {Object} Object including the amount that was not specified
   */
  quote (params) {
    const plugin = this.plugin
    const _this = this
    return co(function * () {
      if (params.sourceAmount ? params.destinationAmount : !params.destinationAmount) {
        throw new Error('Should provide source or destination amount but not both')
      }
      const prefix = yield plugin.getPrefix()
      // Same-ledger payment
      if (startsWith(prefix, params.destinationAddress)) {
        const amount = params.sourceAmount || params.destinationAmount
        return omitUndefined({
          sourceAmount: amount,
          destinationAmount: amount,
          sourceExpiryDuration: params.destinationExpiryDuration
        })
      }

      const quoteQuery = {
        source_address: (yield plugin.getAccount()),
        source_amount: params.sourceAmount,
        destination_address: params.destinationAddress,
        destination_amount: params.destinationAmount,
        destination_expiry_duration: params.destinationExpiryDuration,
        destination_precision: params.destinationPrecision,
        destination_scale: params.destinationScale
      }
      const connectors = params.connectors || (yield _this.getConnectors())
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
   * @param  {String} [params.uuid] Unique identifier for the transfer.
   * @return {Promise.<Object>} Resolves when the payment has been submitted to the plugin
   */
  sendQuotedPayment (params) {
    return co.wrap(this._sendQuotedPayment).call(this, params)
  }

  * _sendQuotedPayment (params) {
    if (!params.executionCondition && !params.unsafeOptimisticTransport) {
      throw new Error('executionCondition must be provided unless unsafeOptimisticTransport is true')
    }

    if (params.executionCondition && !params.expiresAt) {
      throw new Error('executionCondition should not be used without expiresAt')
    }

    const transferData = {
      ilp_header: omitUndefined({
        account: params.destinationAccount,
        amount: params.destinationAmount,
        data: params.destinationMemo
      })
    }
    const prefix = yield this.plugin.getPrefix()

    // Same-ledger payment
    if (!params.connectorAccount) {
      if (params.sourceAmount !== params.destinationAmount) {
        throw new Error('sourceAmount and destinationAmount must be equivalent for local transfers')
      }
      return this.plugin.send(omitUndefined({
        id: params.uuid || uuid.v4(),
        account: params.destinationAccount,
        ledger: prefix,
        amount: params.sourceAmount,
        data: transferData,
        executionCondition: params.executionCondition,
        expiresAt: params.expiresAt
      }))
    }

    // TODO throw errors if other fields are not specified

    const transfer = omitUndefined({
      id: params.uuid || uuid.v4(),
      account: params.connectorAccount,
      ledger: prefix,
      amount: params.sourceAmount,
      data: transferData,
      executionCondition: params.executionCondition,
      expiresAt: params.expiresAt
    })

    return this.plugin.send(transfer)
  }

  /**
   * Get the list of connector URIs.
   * @returns {Promise.<URI[]>}
   */
  getConnectors () {
    if (this.connectors) return Promise.resolve(this.connectors)
    return this.plugin.getInfo().then((info) => {
      if (!info.connectors) return []
      return info.connectors.map((connector) => connector.connector)
    })
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
