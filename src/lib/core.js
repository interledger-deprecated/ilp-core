'use strict'

const EventEmitter = require('eventemitter2')
const fiveBellsRouting = require('five-bells-routing')
const Route = fiveBellsRouting.Route
const RoutingTables = fiveBellsRouting.RoutingTables

class Core extends EventEmitter {
  constructor (routingTables) {
    super()
    this.clientList = [] // Client[]
    this.clients = {} // { prefix ⇒ Client }
    this.tables = routingTables || new RoutingTables(null, [], null)
  }

  /**
   * @param {String} address
   * @returns {Client|null}
   */
  resolve (address) {
    return this.clients[address] || this.clients[addressToLedger(address)] || null
    /*
    const prefixes = makeAddressPrefixes(address)
    for (const prefix of prefixes) {
      const localClient = this.clients[prefix]
      if (localClient) return localClient

      const nextHop = this._findBestHopForSourceAmount(prefix)
      if (nextHop) return this.resolve(nextHop.bestRoute.sourceAccount)
    }
    // No route to account.
    return null
    */
  }

  resolvePlugin (address) {
    const client = this.resolve(address)
    return client && client.getPlugin()
  }

  /**
   * @param {String} address
   * @returns {Boolean}
   */
  isLocalAddress (address) {
    return !!this.resolve(address)
    /*
    const prefixes = makeAddressPrefixes(address)
    for (const prefix of prefixes) {
      if (this.clients[prefix]) return true
    }
    return false
    */
  }

  /**
   * @returns {Client[]}
   */
  getClients () { return this.clientList.slice() }

  /**
   * @param {String} prefix
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

  addRoute (destinationAddress, nextHop, connectorSourceAddress) {
    this.tables.addRoute('*', destinationAddress, nextHop,
      new Route([[0, 0], [1, 1]], [
        connectorSourceAddress,
        destinationAddress
      ], {sourceAccount: connectorSourceAddress}))
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

function addressToLedger (address) {
  return address.split('.').slice(0, -1).join('.')
}

/**
 * @param {String} address
 * @returns {String[]} Returns a list of address prefixes, longest-to-shortest.
 */
/*
function makeAddressPrefixes (address) {
  const parts = address.split('.')
  const partCount = parts.length
  return parts.map((_, i) => parts.slice(0, partCount - i).join('.'))
}
*/

module.exports = Core
