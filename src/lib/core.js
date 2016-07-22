'use strict'

const EventEmitter = require('eventemitter2')
const RoutingTables = require('five-bells-routing').RoutingTables

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
    this.tables = options.routingTables || new RoutingTables(null, [], null)
  }

  /**
   * @param {IlpAddress} address
   * @returns {Client|null}
   */
  resolve (address) {
    const prefixes = makeAddressPrefixes(address)
    for (const prefix of prefixes) {
      // Local route
      const localClient = this.clients[prefix]
      if (localClient) return localClient

      // Remote route
      const nextHop = this._findBestHopForSourceAmount(prefix)
      if (nextHop) return this.resolve(nextHop.bestRoute.sourceAccount)
    }
    // No route to account
    return null
  }

  /**
   * @param {IlpAddress} address
   * @returns {LedgerPlugin|null}
   */
  resolvePlugin (address) {
    const client = this.resolve(address)
    return client && client.getPlugin()
  }

  /**
   * @param {IlpAddress} address
   * @returns {Boolean}
   */
  isLocalAddress (address) {
    const prefixes = makeAddressPrefixes(address)
    for (const prefix of prefixes) {
      if (this.clients[prefix]) return true
    }
    return false
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
    client.onAny((event, arg1, arg2, arg3) =>
      this.emitAsync(event, client, arg1, arg2, arg3))
    this.clientList.push(client)
    this.clients[prefix] = client
  }

  connect () {
    return Promise.all(this.clientList.map((client) => client.connect()))
  }

  disconnect () {
    return Promise.all(this.clientList.map((client) => client.disconnect()))
  }

  /**
   * Used by a client to populate remote routes. Connectors should use the
   * RoutingTables API directly.
   *
   * @param {IlpAddress} destinationAddress
   * @param {String} nextHop
   * @param {IlpAddress} connectorSourceAddress
   */
  addRoute (destinationAddress, nextHop, connectorSourceAddress) {
    this.tables.addLocalRoutes([{
      source_ledger: '*',
      destination_ledger: destinationAddress,
      connector: nextHop,
      source_account: connectorSourceAddress,
      points: [[0, 0], [1, 1]]
    }])
  }

  _findBestHopForSourceAmount (destinationAddress) {
    const amount = '1.00'
    let bestHop
    this.tables.eachSource((table) => {
      const nextHop = table.findBestHopForSourceAmount(destinationAddress, amount)
      if (!bestHop || bestHop.value < nextHop.value) bestHop = nextHop
    })
    return bestHop
  }
}

/**
 * @param {IlpAddress} address
 * @returns {IlpAddress[]} Returns a list of address prefixes, longest-to-shortest.
 */
function makeAddressPrefixes (address) {
  const parts = address.split('.')
  const partCount = parts.length
  return parts.map((_, i) => parts.slice(0, partCount - i).join('.'))
}

module.exports = Core
