/**
 * This is the main file of Pokémon Showdown Bot
 *
 * Some parts of this code are taken from the Pokémon Showdown server code, so
 * credits also go to Guangcong Luo and other Pokémon Showdown contributors.
 * https://github.com/Zarel/Pokemon-Showdown
 *
 * @license MIT license
 */

/// <reference path="typings/colors.d.ts" />
/// <reference path="typings/websocket.d.ts" />

const MESSAGE_THROTTLE = 650

import {info, recv, dsend, error, ok, getServerInformation} from './utils'

// Config and config.js watching...
export let Config = require('./config.js')

function checkCommandCharacter() {
    if (!/[^a-z0-9 ]/i.test(Config.commandcharacter)) {
        error('invalid command character; should at least contain one non-alphanumeric character')
        process.exit(-1)
    }
}

checkCommandCharacter()

import {watchFile} from 'fs'
if (Config.watchconfig) {
    watchFile('./config.js', function (curr, prev) {
        if (curr.mtime <= prev.mtime) return
        try {
            delete require.cache[require.resolve('./config.js')]
            Config = require('./config.js')
            info('reloaded config.js')
            checkCommandCharacter()
        } catch (e) {}
    })
}

// And now comes the real stuff...
info('starting server')

import {client as WebSocketClient, connection} from 'websocket'
import commands from './commands'
import {users} from './users'
import {rooms} from './rooms'
import {parseData} from './parser'
export let Connection: connection

const queue: string[] = []
let dequeueTimeout: NodeJS.Timer
let lastSentAt = 0

export function send(data: string) {
    if (!data || !Connection.connected) return false

    const now = Date.now()
    if (now < lastSentAt + MESSAGE_THROTTLE - 5) {
        queue.push(data)
        if (!dequeueTimeout) {
            dequeueTimeout = setTimeout(dequeue, now - lastSentAt + MESSAGE_THROTTLE)
        }
        return false
    }

    dsend(data)
    Connection.send(data)

    lastSentAt = now
    if (dequeueTimeout) {
        if (queue.length) {
            dequeueTimeout = setTimeout(dequeue, MESSAGE_THROTTLE)
        } else {
            dequeueTimeout = null
        }
    }
}

function dequeue() {
    send(queue.shift())
}

function connect(address: string, retry: boolean) {
    if (retry) {
        info('retrying...')
    }

    const ws = new WebSocketClient()

    ws.on('connectFailed', function (err) {
        error('Could not connect to server ' + Config.server + ': ' + err.stack)
        info('retrying in one minute')

        setTimeout(function () {
            connect(address, true)
        }, 60000)
    })

    ws.on('connect', function (con) {
        Connection = con
        ok('connected to server ' + Config.server)

        con.on('error', function (err) {
            error('connection error: ' + err.stack)
        })

        con.on('close', function (code, reason) {
            // Is this always error or can this be intended...?
            error('connection closed: ' + reason + ' (' + code + ')')
            info('retrying in one minute')

            for (const i in users) {
                delete users[i]
            }
            rooms.clear()
            setTimeout(function () {
                connect(address, true)
            }, 60000)
        })

        con.on('message', function (response) {
            if (response.type !== 'utf8') return false
            const message = response.utf8Data
            recv(message)
            parseData(message)
        })
    })

    info('connecting to ' + address + ' - secondary protocols: ' + (Config.secprotocols.join(', ') || 'none'))
    ws.connect(address, Config.secprotocols)
}

getServerInformation(Config.server, (server, port) => {
    connect(`ws://${server}:${port}/showdown/websocket`, false)
})
