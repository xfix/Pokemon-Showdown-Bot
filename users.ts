/**
 * This is where users are stored.
 *
 * New users are processed when joining new rooms and on receiving join
 * messages from the server. User chat data is processed here for use
 * in command permissions and automatic moderation.
 */

/// <reference path="typings/map.d.ts" />

import {toId} from './utils'
import {Config, send} from './main'
import {settings} from './parser'
import {getRoom} from './rooms'

export var users = Object.create(null)

export class User {
	name: string
	id: string
	rooms = new Map<string, string>()

	constructor (username: string, roomid?: string) {
		this.name = username.substr(1)
		this.id = toId(this.name)
		if (roomid) this.rooms.set(roomid, username.charAt(0))
	}

	isExcepted () {
		return Config.excepts.indexOf(this.id) !== -1
	}

	isWhitelisted () {
		return Config.whitelist.indexOf(this.id) !== -1
	}

	isRegexWhitelisted () {
		return Config.regexautobanwhitelist.indexOf(this.id) !== -1
	}

	hasRank (roomid: string, tarGroup: string) {
		if (this.isExcepted()) return true
		var group = this.rooms.get(roomid) || roomid; // PM messages use the roomid parameter as the user's group
		return Config.groups[group] >= Config.groups[tarGroup]
	}

	canUse (cmd: string, roomid: string) {
		if (this.isExcepted()) return true
		if (!settings[cmd] || !settings[cmd][roomid]) {
			return this.hasRank(roomid, (cmd === 'autoban' || cmd === 'blacklist') ? '#' : Config.defaultrank)
		}

		var setting = settings[roomid]
		if (setting === true) return true
		return this.hasRank(roomid, setting)
	}

	rename (username: string) {
		var oldid = this.id
		delete users[oldid]
		this.id = toId(username)
		this.name = username.substr(1)
		users[this.id] = this
		return this
	}

	destroy () {
		this.rooms.forEach(function (group, roomid) {
			var room = getRoom(roomid)
			room.users.delete(this.id)
		})
		this.rooms.clear()
		delete users[this.id]
	}

	say(message: string) {
		send('|/pm ' + this.id + ', ' + message)
	}
}

export function getUser(username) {
	var userid = toId(username)
	return users[userid]
}

export function addUser(username: string, room?: string) {
	var user = getUser(username)
	if (!user) {
		user = new User(username, room)
		users[user.id] = user
	}
	return user
}

var botId = ' ' + toId(Config.nick)
export var self = getUser(botId) || addUser(botId)
