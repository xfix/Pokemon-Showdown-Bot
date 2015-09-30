/// <reference path="typings/node.d.ts" />
/// <reference path="typings/colors.d.ts" />

import {cyan, blue, grey, red, green} from 'colors/safe'
import {Config} from './main'
import {get} from 'https'
import {stringify} from 'querystring'

export function isEmpty(object: Object) {
    for (const key in object) {
        return false
    }
    return true
}

export function toId(text: string) {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function info(text: string) {
    if (Config.debuglevel > 3) return
    console.log(cyan('info') + '  ' + text)
}

export function debug(text: string) {
    if (Config.debuglevel > 2) return
    console.log(blue('debug') + ' ' + text)
}

export function recv(text: string) {
    if (Config.debuglevel > 0) return
    console.log(grey('recv') + '  ' + text)
}

export function cmdr(text: string) { // receiving commands
    if (Config.debuglevel !== 1) return
    console.log(grey('cmdr') + '  ' + text)
}

export function dsend(text: string) {
    if (Config.debuglevel > 1) return
    console.log(grey('send') + '  ' + text)
}

export function error(text: string) {
    console.log(red('error') + ' ' + text)
}

export function ok(text: string) {
    if (Config.debuglevel > 4) return
    console.log(green('ok') + '    ' + text)
}

export function getServerInformation(host: string, callback: (server: string, port: number) => void) {
    function fail(e: Error) {
        error(`Cannot get configuration for server ${host}.`)
        if (e) throw e
    }
    if (!/\./.test(host)) {
        host += '.psim.us'
    }
    get('https://play.pokemonshowdown.com/crossdomain.php?' + stringify({host}), function (result) {
        let gotResponse = false
        result.setEncoding('utf-8')
        result.on('data', (chunk: string) => {
            gotResponse = true
            const configuration = /var config = (.*);$/m.exec(chunk)
            if (!configuration) {
                fail(new Error("Got unexpected response"))
            }
            const parsedConfiguration = JSON.parse(configuration[1])
            callback(parsedConfiguration.host, parsedConfiguration.port)
        })
        result.on('end', () => {
            if (!gotResponse) {
                fail(new Error("Server does not exist"))
            }
        })
    }).on('error', fail)
}
