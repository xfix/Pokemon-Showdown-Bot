/**
 * This is where joined rooms are stored.
 * 
 * On startup, the Pokemon Showdown Bot joins the configured rooms here,
 * and tracks their userlists. Room command and modding settings are
 * loaded on room join, if present.
 */

import {Config, send} from './main'
import {toId} from './utils'
import {self, getUser, addUser} from './users'

export var rooms = new Map<string, Room>()

export function joinRooms() {
	var rooms = (Config.rooms || []).concat(Config.privaterooms || [])
	for (let i = 0; i < rooms.length; i++) {
		let room = toId(rooms[i])
		if (room === 'lobby' && Config.serverid === 'showdown') continue
		send('|/join ' + room)
	}
}

export class Room {
	id: string
	isPrivate: boolean
	users = new Map<string, string>()

	constructor(roomid: string, type: boolean) {
		this.id = roomid
		this.isPrivate = type
	}

	onUserlist(userList: string) {
		if (userList === '0') return false; // no users in room
		const users = userList.split(',')
		for (let i = 1; i < users.length; i++) {
			let username = users[i]
			let group = username.charAt(0)
			let user = getUser(username)
			if (!user) user = addUser(username, this.id)
			user.rooms.set(this.id, group)
			this.users.set(user.id, group)
		}
	}

	onJoin(username: string, group: string) {
		var user = getUser(username)
		if (!user) user = addUser(username)
		this.users.set(user.id, group)
		user.rooms.set(this.id, group)
		return user
	}

	onRename(username: string, oldid: string) {
		var user = getUser(oldid)
		var group = username.charAt(0)
		this.users.delete(oldid)
		if (!user) { // already changed nick
			user = getUser(username)
		} else if (username.substr(1) !== user.name) { // changing nick
			user = user.rename(username)
		}
		this.users.set(user.id, group)
		user.rooms.set(this.id, group)
		return user
	}

	onLeave(username: string) {
		var user = getUser(username)
		this.users.delete(user.id)
		user.rooms.delete(this.id)
		if (user.rooms.size || user.id === self.id) return user
		user.destroy()
		return null
	}

	destroy() {
		this.users.forEach(function (group, userid) {
			var user = getUser(userid)
			user.rooms.delete(this.id)
			if (!user.rooms.size) user.destroy()
		})
		rooms.delete(this.id)
	}

	say(message: string) {
		send((this.id !== 'lobby' ? this.id : '') + '|' + message)
	}
}

export function getRoom(name: string) {
	return rooms.get(name)
}

export function addRoom(roomid: string, type: boolean) {
	var room = getRoom(roomid)
	if (room) return room
	room = new Room(roomid, type)
	rooms.set(roomid, room)
	return room
}
