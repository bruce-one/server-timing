'use strict'

const onHeaders = require('on-headers')
const Timer = require('./timer')

module.exports = function serverTiming(options) {
  const opts = Object.assign({
    total: true,
    enabled: true,
    trailers: false,
    completeTimingsOnEnd: true,
  }, options);
  return (req, res, next) => {
    const measurements = []
    const timer = new Timer()
    if (res.setMetric) {
      throw new Error('res.setMetric already exists.')
    }

    const startAt = process.hrtime()

    res.setMetric = setMetric(measurements)
    res.startTime = startTime(timer)
    res.endTime = endTime(timer, res)

    if(opts.trailers && (req.httpVersionMajor === 1 && req.httpVersionMinor >= 1) || req.httpVersionMajor >= 2) {
      res.setHeader('Transfer-Encoding', 'chunked')
      onHeaders(res, () => {
        if(res.statusCode === 204 || res.statusCode === 304) {
          res.end = end
          if (opts.completeTimingsOnEnd) {
            timer.keys().forEach( (k) => res.endTime(k))
          }
          setHeader(res)
        } else { // node override (for 204 and 304 in particular)
          res.setHeader('Trailer', 'Server-Timing')
          res.removeHeader('Content-Length') // Transfer-Encoding and Content-Length can't coexist; but Transfer-Encoding is required for trailers
        }
      })
      const end = res.end
      res.end = (...args) => {
        if (opts.completeTimingsOnEnd) {
          timer.keys().forEach( (k) => res.endTime(k))
        }
        processTiming()
        if (opts.enabled) {
          res.addTrailers({ 'Server-Timing': measurements.join(', ') })
        }
        end.call(res, ...args)
      }
    } else {
      onHeaders(res, setHeader)
    }
    function setHeader(res) {
      processTiming()
      if (opts.enabled) {
        const existingHeaders = res.getHeader('Server-Timing')
        res.setHeader('Server-Timing', [].concat(existingHeaders || []).concat(measurements).join(', '))
      }
    }
    function processTiming() {
      if (opts.total) {
        const diff = process.hrtime(startAt)
        const timeSec = (diff[0] * 1E3) + (diff[1] * 1e-6)
        measurements.push(`total; dur=${timeSec}; desc="Total Response Time"`)
      }
      timer.clear()
    }
    if (typeof next === 'function') {
      next()
    }
  }
}

function setMetric(headers) {
  return (name, value, description) => {
    if (typeof name !== 'string') {
      return console.warn('1st argument name is not string')
    }
    if (typeof value !== 'number') {
      return console.warn('2nd argument value is not number')
    }

    const metric = typeof description !== 'string' || !description ?
      `${name}; dur=${value}` : `${name}; dur=${value}; desc="${description}"`

    headers.push(metric)
  }
}

function startTime(timer) {
  return (name, description) => {
    if (typeof name !== 'string') {
      return console.warn('1st argument name is not string')
    }

    timer.time(name, description)
  }
}

function endTime(timer, res) {
  return (name) => {
    if (typeof name !== 'string') {
      return console.warn('1st argument name is not string')
    }

    const obj = timer.timeEnd(name)
    if (!obj) {
      return
    }
    res.setMetric(obj.name, obj.value, obj.description)
  }
}
