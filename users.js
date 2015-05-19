/**
 * This is where users are stored.
 *
 * New users are processed when joining new rooms and on receiving join
 * messages from the server. User chat data is processed here for use
 * in command permissions and automatic moderation.
 */

var Users = Object.create(null);
var users = Users.users = Object.create(null);
var getUser = Users.get = function (username) {
	var userid = toId(username);
	return users[userid];
};	
var addUser = Users.add = function (username, room) {
	var user = getUser(username);
	if (!user) {
		user = new User(username, room);
		users[user.id] = user;
	}
	return user;
};

class User {
	constructor(username, roomid) {
		this.name = username.substr(1);
		this.id = toId(this.name);
		this.isExcepted = Config.excepts.includes(this.id);
		this.isWhitelisted = Config.whitelist.includes(this.id);
		this.isRegexWhitelisted = Config.regexautobanwhitelist.includes(this.id);
		this.rooms = new Map();
		if (roomid) this.rooms.set(roomid, username.charAt(0));
	}

	hasRank(room, tarGroup) {
		if (this.isExcepted) return true;
		var group = room.users.get(this.id);
		return Config.groups.indexOf(group) >= Config.groups.indexOf(tarGroup);
	}

	canUse(cmd, room) {
		var settings = Parse.settings[cmd];
		var roomid = room.id;
		if (!settings || !settings[roomid]) {
			return this.hasRank(room, (cmd === 'autoban' || cmd === 'blacklist') ? '#' : Config.defaultrank);
		}

		var setting = settings[roomid];
		if (setting === true) return true;
		return this.hasRank(room, setting);
	}

	rename(username) {
		var oldid = this.id;
		delete users[oldid];
		this.id = toId(username);
		this.name = username.substr(1);
		this.isExcepted = Config.excepts.includes(this.id);
		this.isWhitelisted = Config.whitelist.includes(this.id);
		this.isRegexWhitelisted = Config.regexautobanwhitelist.includes(this.id);
		users[this.id] = this;
		return this;
	}

	destroy() {
		this.rooms.forEach(function (group, roomid) {
			var room = Rooms.get(roomid);
			room.users.delete(this.id);
		});
		this.rooms.clear();
		delete users[this.id];
	}
}

Users.self = addUser(' ' + Config.nick);
module.exports = Users;
