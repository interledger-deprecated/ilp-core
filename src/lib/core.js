'use strict'

const EventEmitter = require('eventemitter2')

class Core extends EventEmitter {
  constructor () {
    super()
    this.clientList = [] // Client[]
    this.clients = {} // { prefix ⇒ Client }
  }

  /**
   * @param {String} address
   * @returns {Client|null}
   */
  resolve (address) {
    const prefixes = makeAddressPrefixes(address)
    for (const prefix of prefixes) {
      if (this.clients[prefix]) return this.clients[prefix]
    }
    return null
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
  }

  /**
   * @returns {Client[]}
   */
  getClients () { return this.clientList.slice() }

  /**
   * @param {Client} client
   */
  addClient (client) {
    this.clientList.push(client)

    /*
    const prefixes = makeAddressPrefixes(client.plugin.getPrefix())
    */
    const prefixes = makeAddressPrefixes(client.plugin.id)
    for (const prefix of prefixes) {
      this.clients[prefix] = client
    }

    client.onAny(function * (event, arg1, arg2, arg3) {
      yield this.emitAsync(event, client, arg1, arg2, arg3)
    })
  }

  connect () {
    return Promise.all(this.clientList.map((client) => client.connect()))
  }

  disconnect () {
    return Promise.all(this.clientList.map((client) => client.disconnect()))
  }
}

/**
 * @param {String} address
 * @returns {String[]} Returns a list of address prefixes, longest-to-shortest.
 */
function makeAddressPrefixes (address) {
  return [address]
  /*
  const parts = address.split('.')
  const partCount = parts.length
  return parts.map((_, i) => parts.slice(0, partCount - i).join('.'))
  */
}

module.exports = Core
