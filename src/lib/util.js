'use strict'

const debug = require('debug')('ilp-core')
const request = require('superagent')

exports.getQuote = function * (connector, query) {
  debug('remote quote connector=' + connector + ' query=' + JSON.stringify(query))
  try {
    const res = yield request.get(connector + '/quote').query(query)
    return res.body
  } catch (err) {
    debug('ignoring remote /quote error: ' + err.message)
  }
}
