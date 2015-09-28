/// <reference path="typings/node.d.ts" />
/// <reference path="typings/colors.d.ts" />

import {cyan, blue, grey, red, green} from 'colors/safe'
import {Config} from './main'

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
