'use strict'

const co = require('co')
const uuid = require('uuid')
const BigNumber = require('bignumber.js')
const isUndefined = require('lodash/fp/isUndefined')
const omitUndefined = require('lodash/fp/omitBy')(isUndefined)
const EventEmitter = require('eventemitter2')
const notUndefined = require('lodash/fp/negate')(isUndefined)
const startsWith = require('lodash/fp/startsWith')
const packet = require('ilp-packet')
const debug = require('debug')('ilp-core')

class Client extends EventEmitter {
  /**
   * @param {Object} pluginOpts options for the ledger plugin, or an instantiated plugin object
   * @param {Function} pluginOpts._plugin A ledger plugin constructor (if pluginOpts isn't instantiated)
   * @param {Object} [_clientOpts]
   * @param {IlpAddress[]} [_clientOpts.connectors] A list of connectors to quote from
   * @param {Integer} [_clientOpts.messageTimeout] The number of milliseconds to wait for a response to sendMessage.
   */
  constructor (pluginOpts, _clientOpts) {
    super()

    if (typeof pluginOpts !== 'object') {
      throw new TypeError('Client pluginOpts must be an object')
    }

    // if pluginOpts is an eventEmitter, then it is instantiated
    const instantiated = (typeof pluginOpts.on === 'function')

    if (!instantiated && typeof pluginOpts._plugin !== 'function') {
      throw new TypeError('"pluginOpts._plugin" must be a function unless pluginOpts is an instantiated plugin')
    }

    if (_clientOpts !== undefined && typeof _clientOpts !== 'object') {
      throw new TypeError('Client clientOpts must be an object')
    }

    const clientOpts = _clientOpts || {}
    this.connectors = clientOpts.connectors
    this.messageTimeout = clientOpts.messageTimeout === undefined ? 10000 : clientOpts.messageTimeout
    this.pendingMessages = {} // { requestId ⇒ {resolve, reject, timeout} }

    if (this.connectors !== undefined && !Array.isArray(this.connectors)) {
      throw new TypeError('"clientOpts.connectors" must be an Array or undefined')
    }
    if (typeof this.messageTimeout !== 'number') {
      throw new TypeError('"clientOpts.messageTimeout" must be a Number or undefined')
    }

    const Plugin = pluginOpts._plugin
    this.plugin = instantiated ? pluginOpts : (new Plugin(pluginOpts))
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
    this.plugin.on('incoming_message', (message) =>
      this.emitAsync('incoming_message', message))
    this.plugin.on('incoming_message', this._onIncomingMessage.bind(this))

    this._extensions = {}
  }

  getPlugin () {
    return this.plugin
  }

  fulfillCondition (transferId, fulfillment) {
    return this.plugin.fulfillCondition(transferId, fulfillment)
  }

  connect (options) {
    this.connecting = true
    return this.plugin.connect(options)
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
   * @param  {String[]} [params.connectors] List of connectors to get the quotes from
   * @return {Object} Object including the amount that was not specified
   */
  quote (params) {
    const plugin = this.plugin
    const _this = this
    return co(function * () {
      if (params.sourceAmount ? params.destinationAmount : !params.destinationAmount) {
        throw new Error('Should provide source or destination amount but not both')
      }
      const prefix = plugin.getInfo().prefix
      // Same-ledger payment
      if (startsWith(prefix, params.destinationAddress)) {
        const amount = params.sourceAmount || params.destinationAmount
        return omitUndefined({
          sourceAmount: amount,
          destinationAmount: amount,
          sourceExpiryDuration: params.destinationExpiryDuration
        })
      }

      const quoteQuery = omitUndefined({
        source_address: plugin.getAccount(),
        source_amount: params.sourceAmount,
        destination_address: params.destinationAddress,
        destination_amount: params.destinationAmount,
        destination_expiry_duration: params.destinationExpiryDuration
      })
      debug('constructed quote query: ' + JSON.stringify(quoteQuery))
      const connectors = params.connectors || (yield _this.getConnectors())
      debug('sending quote to connectors: ', connectors)
      const quotes = (yield connectors.map((connector) => {
        return _this._getQuote(connector, quoteQuery)
      })).filter(notUndefined)
      if (quotes.length === 0) return
      const bestQuote = quotes.reduce(getCheaperQuote)
      debug('got best quote from connector:', bestQuote)
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
    if (!params.executionCondition && !params.unsafeOptimisticTransport) {
      return Promise.reject(new Error('executionCondition must be provided unless unsafeOptimisticTransport is true'))
    }

    if (params.executionCondition && !params.expiresAt) {
      return Promise.reject(new Error('executionCondition should not be used without expiresAt'))
    }

    if (!params.sourceAmount) {
      return Promise.reject(new Error('sourceAmount must be provided'))
    }
    if (!params.destinationAmount) {
      return Promise.reject(new Error('destinationAmount must be provided'))
    }
    if (!params.destinationAccount) {
      return Promise.reject(new Error('destinationAccount must be provided'))
    }

    const ilpPayment = packet.serializeIlpPayment({
      account: params.destinationAccount,
      amount: params.destinationAmount,
      data: Client._stringifyPacketData(params.destinationMemo)
    }).toString('base64')
    const prefix = this.plugin.getInfo().prefix

    // Same-ledger payment
    if (!params.connectorAccount) {
      if (params.sourceAmount !== params.destinationAmount) {
        return Promise.reject(new Error('sourceAmount and destinationAmount must be equivalent for local transfers'))
      }
      return this.plugin.sendTransfer(omitUndefined({
        id: params.uuid || uuid.v4(),
        account: params.destinationAccount,
        ledger: prefix,
        amount: params.sourceAmount,
        ilp: ilpPayment,
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
      ilp: ilpPayment,
      executionCondition: params.executionCondition,
      expiresAt: params.expiresAt
    })

    return this.plugin.sendTransfer(transfer)
  }

  /**
   * Get the list of connector addresses.
   * @returns {Promise.<IlpAddress[]>}
   */
  getConnectors () {
    if (this.connectors) return Promise.resolve(this.connectors)
    const info = this.plugin.getInfo()
    const connectorAddresses = info.connectors || []
    return Promise.resolve(connectorAddresses)
  }

  _getQuote (connectorAddress, quoteQuery) {
    debug('remote quote connector=' + connectorAddress + ' query=' + JSON.stringify(quoteQuery))
    const prefix = this.plugin.getInfo().prefix
    return this._sendAndReceiveMessage({
      ledger: prefix,
      from: this.plugin.getAccount(),
      to: connectorAddress,
      data: {
        method: 'quote_request',
        data: quoteQuery
      }
    }).then((quoteResponse) => {
      return quoteResponse.data.data
    }).catch((err) => {
      debug('getQuote: ignoring remote quote error: ' + err.message)
    })
  }

  _sendAndReceiveMessage (reqMessage) {
    const id = reqMessage.data.id = uuid()
    debug('sending message: ' + JSON.stringify(reqMessage))
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out while awaiting response message'))
      }, this.messageTimeout)
      this.pendingMessages[id] = {resolve, reject, timeout}
      this.plugin.sendMessage(reqMessage).catch((err) => {
        reject(err)
        clearTimeout(timeout)
        delete this.pendingMessages[id]
      })
    })
  }

  _onIncomingMessage (resMessage) {
    debug('got incoming message: ' + JSON.stringify(resMessage))
    const resData = resMessage.data
    if (!resData) return
    // Find the matching outgoing message, if any.
    const pendingMessage = this.pendingMessages[resData.id]
    if (!pendingMessage) return

    if (resData.method === 'error') {
      pendingMessage.reject(new Error(resData.data.message))
    } else if (resData.method === 'quote_response') {
      pendingMessage.resolve(resMessage)
    } else {
      return
    }
    clearTimeout(pendingMessage.timeout)
    delete this.pendingMessages[resData.id]
  }

  static _stringifyPacketData (data) {
    return toBase64Url(Buffer.from(JSON.stringify(data)))
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

function toBase64Url (buffer) {
  return buffer.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

module.exports = Client
