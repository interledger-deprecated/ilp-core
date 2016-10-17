'use strict'

const co = require('co')
const EventEmitter = require('eventemitter2')
const BigNumber = require('bignumber.js')
const isUndefined = require('lodash/fp/isUndefined')
const omitUndefined = require('lodash/fp/omitBy')(isUndefined)
const RoutingTables = require('ilp-routing').RoutingTables

class Core extends EventEmitter {
  /**
   * @param {Object} options
   * @param {five-bells-routing.RoutingTables} options.routingTables
   */
  constructor (options) {
    if (!options) options = {}
    super()
    this.clientList = [] // Client[]
    this.clients = {} // { prefix ⇒ Client }
    this.tables = options.routingTables || new RoutingTables([], null)

    const core = this
    this._relayEvent = function (event, arg1, arg2, arg3) {
      return core.emitAsync(event, this, arg1, arg2, arg3)
    }
  }

  /**
   * `getClient`/`getPlugin` will find the Client/Plugin corresponding
   * to either a local ledger address (e.g. "us.fed.wf.").
   *
   * @param {IlpAddress} address
   * @returns {Client|null}
   */
  getClient (ledger) {
    if (ledger.slice(-1) !== '.') {
      throw new Error('prefix must end with "."')
    }
    return this.clients[ledger] || null
  }

  /**
   * @param {IlpAddress} address
   * @returns {LedgerPlugin|null}
   */
  getPlugin (ledger) {
    const client = this.getClient(ledger)
    return client && client.getPlugin()
  }

  /**
   * @returns {Client[]}
   */
  getClients () { return this.clientList.slice() }

  /**
   * @param {IlpAddress} prefix
   * @param {Client} client
   */
  addClient (prefix, client) {
    if (prefix.slice(-1) !== '.') {
      throw new Error('prefix must end with "."')
    }

    client.onAny(this._relayEvent)
    this.clientList.push(client)
    this.clients[prefix] = client
  }

  /**
   * @param {IlpAddress} prefix
   * @returns {Client}
   */
  removeClient (prefix) {
    const client = this.getClient(prefix)
    if (!client) return
    client.offAny(this._relayEvent)
    this.clientList.splice(this.clientList.indexOf(client), 1)
    delete this.clients[prefix]
    return client
  }

  connect () {
    return Promise.all(this.clientList.map((client) => client.connect()))
  }

  disconnect () {
    return Promise.all(this.clientList.map((client) => client.disconnect()))
  }

  /**
   * @param {Object} query
   * @param {String} query.sourceAddress Sender's address
   * @param {String} query.destinationAddress Recipient's address
   * @param {String} [query.sourceAmount] Either the sourceAmount or destinationAmount must be specified
   * @param {String} [query.destinationAmount] Either the sourceAmount or destinationAmount must be specified
   * @param {String|Number} [query.sourceExpiryDuration] Number of seconds between when the source transfer is proposed and when it expires.
   * @param {String|Number} [query.destinationExpiryDuration] Number of seconds between when the destination transfer is proposed and when it expires.
   * @param {Object} [query.destinationPrecisionAndScale]
   * @returns {Promise<Quote>}
   */
  quote (query) {
    return co(this._quote.bind(this), query)
  }

  * _quote (query) {
    const hop = this._findBestHopForAmount(
      query.sourceAddress, query.destinationAddress,
      query.sourceAmount, query.destinationAmount)
    if (!hop) return null

    const sourceLedger = hop.sourceLedger
    const connectorAccount = yield this.getPlugin(sourceLedger).getAccount()
    const sourceExpiryDuration = parseDuration(query.sourceExpiryDuration)
    const destinationExpiryDuration = (sourceExpiryDuration || query.destinationExpiryDuration)
      ? parseDuration(query.destinationExpiryDuration) : 5
    const destinationPrecisionAndScale = query.destinationPrecisionAndScale || {}
    const quote = {connectorAccount, sourceLedger}

    const localQuote = Object.assign(
      getExpiryDurations(sourceExpiryDuration, destinationExpiryDuration, hop.minMessageWindow),
      hopToQuote(hop), quote)
    const isLocalPath = hop.isLocal
    const isDirectPath = getLedgerPrefix(query.destinationAddress) === hop.finalLedger

    // If we know a local route to the destinationAddress, use the local route.
    // If the route's destination is exactly the prefix being targeted, use the local route.
    // Otherwise, ask a connector closer to the destination.
    if (isLocalPath || isDirectPath) return localQuote

    let headHop
    // Quote by source amount
    if (query.sourceAmount) {
      headHop = this.tables.findBestHopForSourceAmount(
        sourceLedger, hop.destinationCreditAccount, query.sourceAmount)
    }

    const sourceClient = this.getClient(hop.destinationLedger)
    const intermediateConnector = hop.destinationCreditAccount
    const tailQuote = yield sourceClient._getQuote(intermediateConnector, omitUndefined({
      source_address: intermediateConnector,
      source_amount: query.sourceAmount === undefined
        ? undefined
        : (yield this._roundDown(headHop.destinationLedger, headHop.destinationAmount)),
      destination_address: query.destinationAddress,
      destination_amount: query.sourceAmount === undefined ? hop.finalAmount : undefined,
      source_expiry_duration: sourceExpiryDuration
        ? (sourceExpiryDuration - hop.minMessageWindow)
        : undefined,
      destination_expiry_duration: destinationExpiryDuration,
      destination_precision: destinationPrecisionAndScale.precision,
      destination_scale: destinationPrecisionAndScale.scale,
      slippage: '0' // Slippage will be applied at the first connector, not an intermediate one.
    }))

    // If no remote quote can be found, just use the local one.
    if (!tailQuote) return localQuote

    // Quote by destination amount
    if (query.destinationAmount) {
      headHop = this.tables.findBestHopForDestinationAmount(
        sourceLedger, intermediateConnector, tailQuote.source_amount)
    }

    const minMessageWindow = headHop.minMessageWindow +
      (parseFloat(tailQuote.source_expiry_duration) - parseFloat(tailQuote.destination_expiry_duration))
    return Object.assign({
      nextLedger: headHop.destinationLedger,
      destinationLedger: tailQuote.destination_ledger,
      sourceAmount: headHop.sourceAmount,
      destinationAmount: tailQuote.destination_amount,
      minMessageWindow: minMessageWindow
    }, quote, getExpiryDurations(sourceExpiryDuration, destinationExpiryDuration, minMessageWindow))
  }

  _findBestHopForAmount (sourceLedger, destinationAddress, sourceAmount, destinationAmount) {
    return sourceAmount === undefined
      ? this.tables.findBestHopForDestinationAmount(
          sourceLedger, destinationAddress, destinationAmount)
      : this.tables.findBestHopForSourceAmount(
          sourceLedger, destinationAddress, sourceAmount)
  }

  * _roundDown (ledger, amount) {
    const info = yield this.getPlugin(ledger).getInfo()
    const roundedAmount = new BigNumber(amount).toFixed(info.scale, BigNumber.ROUND_DOWN)
    return roundedAmount.toString()
  }
}

function hopToQuote (hop) {
  return {
    nextLedger: hop.destinationLedger,
    destinationLedger: hop.finalLedger,
    sourceAmount: hop.sourceAmount,
    destinationAmount: hop.finalAmount,
    minMessageWindow: hop.minMessageWindow,
    additionalInfo: hop.additionalInfo
  }
}

/**
 * @param {IlpAddress} address
 * @returns {IlpAddress} prefix
 */
function getLedgerPrefix (address) {
  return address.split('.').slice(0, -1).join('.') + '.'
}

function parseDuration (expiryDuration) {
  return expiryDuration ? parseFloat(expiryDuration) : undefined
}

function getExpiryDurations (sourceExpiryDuration, destinationExpiryDuration, minMessageWindow) {
  return {
    sourceExpiryDuration:
      sourceExpiryDuration || (destinationExpiryDuration + minMessageWindow),
    destinationExpiryDuration:
      destinationExpiryDuration || (sourceExpiryDuration - minMessageWindow)
  }
}

module.exports = Core
