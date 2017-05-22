'use strict'

const co = require('co')
const EventEmitter = require('eventemitter2')
const BigNumber = require('bignumber.js')
const isUndefined = require('lodash/fp/isUndefined')
const omitUndefined = require('lodash/fp/omitBy')(isUndefined)
const routing = require('ilp-routing')
const debug = require('debug')('ilp-core')

class Core extends EventEmitter {
  /**
   * @param {Object} options
   * @param {ilp-routing.RoutingTables} options.routingTables
   */
  constructor (options) {
    if (!options) options = {}
    super()
    this.clientList = [] // Client[]
    this.clients = {} // { prefix ⇒ Client }
    this.tables = options.routingTables || new routing.RoutingTables([], null)

    const core = this
    this._relayEvent = function () {
      const event = arguments[0]
      const args = Array.prototype.slice.call(arguments, 1)
      return core.emitAsync.apply(core, [event, this].concat(args))
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

  connect (options) {
    return Promise.all(this.clientList.map((client) => client.connect(options)))
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
    const connectorAccount = this.getPlugin(sourceLedger).getAccount()
    const sourceExpiryDuration = parseDuration(query.sourceExpiryDuration)
    const destinationExpiryDuration = (sourceExpiryDuration || query.destinationExpiryDuration)
      ? parseDuration(query.destinationExpiryDuration) : 5
    const quote = {connectorAccount, sourceLedger}

    const localQuote = Object.assign(
      getExpiryDurations(sourceExpiryDuration, destinationExpiryDuration, hop.minMessageWindow),
      hopToQuote(hop), quote)

    if (localQuote.sourceAmount && localQuote.destinationAmount) return localQuote

    // Reaching this point means the best next hop is know, but its liquidity curve is not
    // This can happen if the next hop had BROADCAST_CURVES set to false, and/or if this connector
    // had SAVE_CURVES set to false.
    // In that case, get a live tailQuote from the next connector on the path,
    // and add our headHop to that:

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
      source_amount: (!query.sourceAmount)
        ? undefined
        : (new BigNumber(headHop.destinationAmount)).toFixed(0, BigNumber.ROUND_DOWN),
      destination_address: query.destinationAddress,
      destination_amount: (!query.sourceAmount) ? hop.finalAmount : undefined,
      source_expiry_duration: (sourceExpiryDuration && headHop)
        ? (sourceExpiryDuration - headHop.minMessageWindow)
        : undefined,
      destination_expiry_duration: destinationExpiryDuration,
      slippage: '0' // Slippage will be applied at the first connector, not an intermediate one.
    }))

    // If no remote quote can be found, just use the local one.
    // if (!tailQuote) return localQuote
    if (!tailQuote) {
      debug('_quote no tailQuote - returning null!')
      return null
    }

    // Quote by destination amount
    if (query.destinationAmount) {
      headHop = this.tables.findBestHopForDestinationAmount(
        sourceLedger, intermediateConnector, tailQuote.source_amount)
    }

    const minMessageWindow = headHop.minMessageWindow +
      (parseFloat(tailQuote.source_expiry_duration) - parseFloat(tailQuote.destination_expiry_duration))
    const curve = tailQuote.liquidity_curve &&
      (new routing.LiquidityCurve(headHop.liquidityCurve)).join(
        new routing.LiquidityCurve(tailQuote.liquidity_curve)).getPoints()
    return Object.assign({
      nextLedger: headHop.destinationLedger,
      destinationLedger: tailQuote.destination_ledger,
      sourceAmount: headHop.sourceAmount,
      destinationAmount: tailQuote.destination_amount,
      minMessageWindow: minMessageWindow,
      liquidityCurve: curve
    }, quote, getExpiryDurations(sourceExpiryDuration, destinationExpiryDuration, minMessageWindow))
  }

  _findBestHopForAmount (sourceLedger, destinationAddress, sourceAmount, destinationAmount) {
    return (!sourceAmount)
      ? this.tables.findBestHopForDestinationAmount(
          sourceLedger, destinationAddress, destinationAmount)
      : this.tables.findBestHopForSourceAmount(
          sourceLedger, destinationAddress, sourceAmount)
  }
}

function hopToQuote (hop) {
  return omitUndefined({
    nextLedger: hop.destinationLedger,
    destinationLedger: hop.finalLedger,
    sourceAmount: hop.sourceAmount,
    destinationAmount: hop.finalAmount,
    minMessageWindow: hop.minMessageWindow,
    liquidityCurve: hop.liquidityCurve,
    additionalInfo: hop.additionalInfo
  })
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
