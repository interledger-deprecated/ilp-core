'use strict'

const co = require('co')
const uuid = require('uuid')
const request = require('superagent')
const isUndefined = require('lodash/fp/isUndefined')
const omitUndefined = require('lodash/fp/omitBy')(isUndefined)

class Payment {
  constructor (client, opts) {
    // Should provide either source or destination amount, but not both
    if (this.sourceAmount ? !this.destinationAmount : this.destinationAmount) {
      throw new Error('Should provide source or destination amount but not both')
    }

    this.client = client
    this.sourceAmount = opts.sourceAmount
    this.destinationAmount = opts.destinationAmount
    this.destinationAccount = opts.destinationAccount
    this.destinationLedger = opts.destinationLedger
    this.destinationMemo = opts.destinationMemo
    this.expiresAt = opts.expiresAt

    // Only allow sending without an executionCondition if
    // unsafeOptimisticTransport is explicitly set
    this.unsafeOptimisticTransport = opts.unsafeOptimisticTransport
    this.executionCondition = opts.executionCondition

    if (!this.executionCondition && !this.unsafeOptimisticTransport) {
      throw new Error('executionCondition must be provided unless unsafeOptimisticTransport is true')
    }
  }

  quote () {
    return co.wrap(this._quote).call(this)
  }

  * _quote () {
    yield this.client.waitForConnection()

    const connector = (yield this.client.getPlugin().getConnectors())[0]
    const res = yield request.get(connector + '/quote')
      .query({
        source_ledger: this.client.getPlugin().id,
        source_amount: this.sourceAmount,
        destination_ledger: this.destinationLedger,
        destination_amount: this.destinationAmount
      })

    return res.body
  }

  sendQuoted (quote) {
    const transfer = omitUndefined({
      id: uuid.v4(),
      ledger: this.client.getPlugin().id,
      account: quote.source_connector_account,
      amount: quote.source_amount,
      data: {
        ilp_header: omitUndefined({
          account: this.destinationAccount,
          ledger: this.destinationLedger,
          amount: quote.destination_amount,
          data: this.destinationMemo
        })
      },
      executionCondition: this.executionCondition,
      expiresAt: this.expiresAt
    })

    return this.client.getPlugin().send(transfer)
  }
}

module.exports = Payment
