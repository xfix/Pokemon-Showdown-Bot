/**
* This is the file where commands get parsed
*
* Some parts of this code are taken from the Pokémon Showdown server code, so
* credits also go to Guangcong Luo and other Pokémon Showdown contributors.
* https://github.com/Zarel/Pokemon-Showdown
*
* @license MIT license
*/

import {Config, send} from './main'
import {Room, getRoom, addRoom, joinRooms} from './rooms'
import {isEmpty, toId, info, cmdr, error, ok} from './utils'
import {User, self, getUser, addUser} from './users'
import commands from './commands'

import {writeFile, rename} from 'fs'
import {request as httpRequest} from 'http'
import {request as httpsRequest, get as httpsGet} from 'https'
import {parse} from 'url'

const ACTION_COOLDOWN = 3 * 1000
const FLOOD_MESSAGE_NUM = 5
const FLOOD_PER_MSG_MIN = 500; // this is the minimum time between messages for legitimate spam. It's used to determine what "flooding" is caused by lag
const FLOOD_MESSAGE_TIME = 6 * 1000
const MIN_CAPS_LENGTH = 12
const MIN_CAPS_PROPORTION = 0.8

// TODO: move to rooms.js
// TODO: store settings by room, not command/blacklists
export var settings: any
try {
    settings = require('./settings')
} catch (e) {} // file doesn't exist [yet]
if (!settings) settings = {}

var actionUrl = parse('https://play.pokemonshowdown.com/~~' + Config.serverid + '/action.php')
// TODO: handle chatdata in users.js
export var chatData: any = {}
// TODO: handle blacklists in rooms.js
var blacklistRegexes: {[roomid: string]: RegExp} = {}

var rawCommands: {[name: string]: (spl: string[], room?: Room, message?: string) => boolean} = {
    challstr(spl: string[], room?: Room, message?: string) {
        info('received challstr, logging in...')
        var id = spl[2]
        var str = spl[3]

        var requestOptions = {
            hostname: actionUrl.hostname,
            port: +actionUrl.port,
            path: actionUrl.pathname,
            agent: false,
            method: 'GET',
            headers: {}
        }

        var data: string
        if (!Config.pass) {
            requestOptions.path += '?act=getassertion&userid=' + toId(Config.nick) + '&challengekeyid=' + id + '&challenge=' + str
        } else {
            requestOptions.method = 'POST'
            data = 'act=login&name=' + Config.nick + '&pass=' + Config.pass + '&challengekeyid=' + id + '&challenge=' + str
            requestOptions.headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': data.length
            }
        }

        var req = httpsRequest(requestOptions, res => {
            res.setEncoding('utf8')
            var data = ''
            res.on('data', (chunk: string) => {
                data += chunk
            })
            res.on('end', () => {
                if (data === ';') {
                    error('failed to log in; nick is registered - invalid or no password given')
                    process.exit(-1)
                }
                if (data.length < 50) {
                    error('failed to log in: ' + data)
                    process.exit(-1)
                }

                if (data.indexOf('heavy load') !== -1) {
                    error('the login server is under heavy load; trying again in one minute')
                    setTimeout(() => parseMessage(message), 60 * 1000)
                    return
                }

                if (data.substr(0, 16) === '<!DOCTYPE html>') {
                    error('Connection error 522; trying again in one minute')
                    setTimeout(() => parseMessage(message), 60 * 1000)
                    return
                }

                try {
                    const parsedData = JSON.parse(data.substr(1))
                    if (parsedData.actionsuccess) {
                        data = parsedData.assertion
                    } else {
                        error('could not log in; action was not successful: ' + JSON.stringify(data))
                        process.exit(-1)
                    }
                } catch (e) {}
                send('|/trn ' + Config.nick + ',0,' + data)
            })
        })

        req.on('error', (err: Error) => {
            error('login error: ' + err.stack)
        })

        if (data) req.write(data)
        req.end()
        return true
    },
    updateuser(spl: string[]) {
        if (spl[2] !== Config.nick) return

        if (spl[3] !== '1') {
            error('failed to log in, still guest')
            process.exit(-1)
        }

        ok('logged in as ' + spl[2])
        send('|/blockchallenges')

        if (Config.rooms || Config.privaterooms) {
            joinRooms()
        }
        else {
            // Receive list of rooms the bot is auth in.
            send('|/userauth')
        }
        if (!Config.rooms) Config.rooms = []
        if (!Config.privaterooms) Config.privaterooms = []

        if (settings.blacklist) {
            let blacklist = settings.blacklist
            for (let room in blacklist) {
                updateBlacklistRegex(room)
            }
        }
        setInterval(cleanChatData, 30 * 60 * 1000)
        return true
    },
    c(spl: string[], room: Room) {
        var username = spl[2]
        var user = getUser(username)
        if (!user) return false; // various "chat" responses contain other data
        if (user === self) return false
        if (isBlacklisted(user.id, room.id)) say(room, '/roomban ' + user.id + ', Blacklisted user')

        const message = spl.slice(3).join('|')
        if (!user.hasRank(room.id, '%')) processChatData(user.id, room.id, message)
        processChatMessage(message, user, room)
        return true
    },
    'c:'(spl: string[], room: Room) {
        var username = spl[3]
        var user = getUser(username)
        if (!user) return false; // various "chat" responses contain other data
        if (user === self) return false
        if (isBlacklisted(user.id, room.id)) say(room, '/roomban ' + user.id + ', Blacklisted user')

        const message = spl.slice(4).join('|')
        if (!user.hasRank(room.id, '%')) processChatData(user.id, room.id, message)
        processChatMessage(message, user, room)
        return true
    },
    pm(spl: string[]) {
        var username = spl[2]
        var user = getUser(username)
        var group = username.charAt(0)
        if (!user) user = addUser(username)
        if (user === self) return false

        const message = spl.slice(4).join('|')
        const inviteCommand = '/invite '
        if (message.slice(0, inviteCommand.length) === inviteCommand && user.hasRank(group, '%') &&
                !(toId(message.substr(8)) === 'lobby' && Config.serverid === 'showdown')) {
            return send('|/join ' + message.substr(8))
        }
        var isCommand = processChatMessage(message, user, user)
        if (!isCommand) {
            unrecognizedCommand(message, user)
        }
        return true
    },
    N(spl: string[], room: Room) {
        var username = spl[2]
        var oldid = spl[3]
        var user = room.onRename(username, oldid)
        if (isBlacklisted(user.id, room.id)) say(room, '/roomban ' + user.id + ', Blacklisted user')
        updateSeen(oldid, spl[1], user.id)
        return true
    },
    j(spl: string[], room: Room) {
        var username = spl[2]
        var user = room.onJoin(username, username.charAt(0))
        if (user === self) return false
        if (isBlacklisted(user.id, room.id)) say(room, '/roomban ' + user.id + ', Blacklisted user')
        updateSeen(user.id, spl[1], room.id)
        return true
    },
    J(spl: string[], room: Room) {
        this.j(spl, room)
        return true
    },
    l(spl: string[], room: Room) {
        var username = spl[2]
        var user = room.onLeave(username)
        if (user) {
            if (user === self) return false
            updateSeen(user.id, spl[1], room.id)
        } else {
            updateSeen(toId(username), spl[1], room.id)
        }
        return true
    },
    L(spl: string[], room: Room) {
        this.l(spl, room)
        return true
    },
    popup(spl: string[], room: Room) {
        var parts = spl.slice(2).join('|').split('||||')
        if (!/ user auth:$/.test(parts[0])) return
        for (var i = 1; i < parts.length; i++) {
            var part = parts[i]
            var roomAuthMessage = "Room auth: "
            var privateRoomAuthMessage = "Private room auth: "
            if (part.slice(0, roomAuthMessage.length) === roomAuthMessage) {
                Config.rooms = part.slice(roomAuthMessage.length).split(', ')
            } else if (part.slice(0, privateRoomAuthMessage.length) === privateRoomAuthMessage) {
                Config.privaterooms = part.slice(privateRoomAuthMessage.length).split(', ')
            }
        }
        joinRooms()
        return true
    },
}

export function parseData(data: string) {
    splitMessage(data)
}
function splitMessage(message: string) {
    if (!message) return

    var room: Room = null
    if (message.indexOf('\n') < 0) {
        parseMessage(message, room)
        return
    }

    var spl = message.split('\n')
    if (spl[0].charAt(0) === '>') {
        if (spl[1].substr(1, 10) === 'tournament') return false
        let roomid = spl.shift().substr(1)
        room = getRoom(roomid)
        if (spl[0].substr(1, 4) === 'init') {
            let users = spl[2].substr(7)
            room = addRoom(roomid, (Config.rooms || []).indexOf(roomid) === -1)
            room.onUserlist(users)
            ok('joined ' + room.id)
            return
        }
    }

    for (let i = 0, len = spl.length; i < len; i++) {
        parseMessage(spl[i], room)
    }
}
function parseMessage(message: string, room?: Room) {
    const spl = message.split('|')
    const command = spl[1]
    if (rawCommands[command]) {
        rawCommands[command](spl, room, message)
    }
}
function processChatMessage(message: string, user: User, room: Room) {
    var cmdrMessage = '["' + room.id + '|' + user.name + '|' + message + '"]'
    message = message.trim()
    if (message.substr(0, Config.commandcharacter.length) !== Config.commandcharacter) return false

    message = message.substr(Config.commandcharacter.length)
    var index = message.indexOf(' ')
    var arg = ''
    var cmd = message
    if (index > -1) {
        cmd = cmd.substr(0, index)
        arg = message.substr(index + 1).trim()
    }

    if (commands[cmd]) {
        let failsafe = 0
        while (typeof commands[cmd] !== "function" && failsafe++ < 10) {
            cmd = <string> commands[cmd]
        }
        if (typeof commands[cmd] === "function") {
            cmdr(cmdrMessage)
            ;(<(arg: string, user: User, room: Room) => void> commands[cmd])(arg, user, room)
        } else {
            error("invalid command type for " + cmd + ": " + (typeof commands[cmd]))
        }
    }
    return true
}
function say(target: Room, text: string) {
    var targetId = target.id
    if (getRoom(targetId)) {
        send((targetId !== 'lobby' ? targetId : '') + '|' + text)
    } else {
        send('|/pm ' + targetId + ', ' + text)
    }
}
function isBlacklisted(userid: string, roomid: string) {
    var blacklistRegex = blacklistRegexes[roomid]
    return blacklistRegex && blacklistRegex.test(userid)
}
export function blacklistUser(userid: string, roomid: string) {
    var blacklist = settings.blacklist || (settings.blacklist = {})
    if (blacklist[roomid]) {
        if (blacklist[roomid][userid]) return false
    } else {
        blacklist[roomid] = {}
    }

    blacklist[roomid][userid] = 1
    updateBlacklistRegex(roomid)
    return true
}
export function unblacklistUser(userid: string, roomid: string) {
    var blacklist = settings.blacklist
    if (!blacklist || !blacklist[roomid] || !blacklist[roomid][userid]) return false

    delete blacklist[roomid][userid]
    if (isEmpty(blacklist[roomid])) {
        delete blacklist[roomid]
        delete blacklistRegexes[roomid]
    } else {
        updateBlacklistRegex(roomid)
    }
    return true
}
function updateBlacklistRegex(roomid: string) {
    var blacklist = settings.blacklist[roomid]
    var buffer: string[] = []
    for (let entry in blacklist) {
        if (entry.startsWith('/') && entry.endsWith('/i')) {
            buffer.push(entry.slice(1, -2))
        } else {
            buffer.push('^' + entry + '$')
        }
    }
    blacklistRegexes[roomid] = new RegExp(buffer.join('|'), 'i')
}
export function uploadToHastebin(toUpload: string, callback: (result: string) => void) {
    if (typeof callback !== 'function') return false
    var reqOpts = {
        hostname: 'hastebin.com',
        method: 'POST',
        path: '/documents'
    }

    var req = httpRequest(reqOpts, function (res) {
        res.on('data', (chunk: string) => {
            // CloudFlare can go to hell for sending the body in a header request like this
            if (typeof chunk === 'string' && chunk.substr(0, 15) === '<!DOCTYPE html>') return callback('Error uploading to Hastebin.')
            var filename = JSON.parse(chunk.toString()).key
            callback('http://hastebin.com/raw/' + filename)
        })
    })
    req.on('error', (e: Error) => {
        callback('Error uploading to Hastebin: ' + e.message)
    })

    req.write(toUpload)
    req.end()
}
function processChatData(userid: string, roomid: string, msg: string) {
    // NOTE: this is still in early stages
    msg = msg.trim().replace(/[ \u0000\u200B-\u200F]+/g, ' '); // removes extra spaces and null characters so messages that should trigger stretching do so
    updateSeen(userid, 'c', roomid)
    var now = Date.now()
    if (!chatData[userid]) chatData[userid] = {
        zeroTol: 0,
        lastSeen: '',
        seenAt: now
    }
    var userData = chatData[userid]
    if (!userData[roomid]) userData[roomid] = {
        times: [],
        points: 0,
        lastAction: 0
    }
    var roomData = userData[roomid]

    roomData.times.push(now)

    // this deals with punishing rulebreakers, but note that the bot can't think, so it might make mistakes
    if (Config.allowmute && self.hasRank(roomid, '%') && Config.whitelist.indexOf(userid) < 0) {
        let useDefault = !(settings.modding && settings.modding[roomid])
        let pointVal = 0
        let muteMessage = ''
        let modSettings = useDefault ? null : settings.modding[roomid]

        // moderation for banned words
        if ((useDefault || !settings.banword[roomid]) && pointVal < 2) {
            let bannedPhraseSettings = settings.bannedphrases
            let bannedPhrases = !!bannedPhraseSettings ? (Object.keys(bannedPhraseSettings[roomid] || {})).concat(Object.keys(bannedPhraseSettings.global || {})) : []
            for (let bannedPhrase of bannedPhrases) {
                if (msg.toLowerCase().indexOf(bannedPhrase) > -1) {
                    pointVal = 2
                    muteMessage = ', Automated response: your message contained a banned phrase'
                    break
                }
            }
        }
        // moderation for flooding (more than x lines in y seconds)
        let times = roomData.times
        let timesLen = times.length
        let isFlooding = (timesLen >= FLOOD_MESSAGE_NUM && (now - times[timesLen - FLOOD_MESSAGE_NUM]) < FLOOD_MESSAGE_TIME &&
            (now - times[timesLen - FLOOD_MESSAGE_NUM]) > (FLOOD_PER_MSG_MIN * FLOOD_MESSAGE_NUM))
        if ((useDefault || !('flooding' in modSettings)) && isFlooding) {
            if (pointVal < 2) {
                pointVal = 2
                muteMessage = ', Automated response: flooding'
            }
        }
        // moderation for caps (over x% of the letters in a line of y characters are capital)
        let capsMatch = msg.replace(/[^A-Za-z]/g, '').match(/[A-Z]/g)
        if ((useDefault || !('caps' in modSettings)) && capsMatch && toId(msg).length > MIN_CAPS_LENGTH && (capsMatch.length >= ~~(toId(msg).length * MIN_CAPS_PROPORTION))) {
            if (pointVal < 1) {
                pointVal = 1
                muteMessage = ', Automated response: caps'
            }
        }
        // moderation for stretching (over x consecutive characters in the message are the same)
        let stretchMatch = /(.)\1{7,}/gi.test(msg) || /(..+)\1{4,}/gi.test(msg); // matches the same character (or group of characters) 8 (or 5) or more times in a row
        if ((useDefault || !('stretching' in modSettings)) && stretchMatch) {
            if (pointVal < 1) {
                pointVal = 1
                muteMessage = ', Automated response: stretching'
            }
        }
        // moderation for group chat links
        let groupChatMatch = /(?:\bplay\.pokemonshowdown\.com\/|\bpsim\.us\/|<<)groupchat-/i.test(msg);
        if ((useDefault || !('groupchat' in modSettings)) && groupChatMatch) {
            if (pointVal < 1) {
                pointVal = 1
                muteMessage = ', Automated response: groupchat links'
            }
        }

        if (pointVal > 0 && now - roomData.lastAction >= ACTION_COOLDOWN) {
            let cmd = 'mute'
            // defaults to the next punishment in Config.punishVals instead of repeating the same action (so a second warn-worthy
            // offence would result in a mute instead of a warn, and the third an hourmute, etc)
            if (roomData.points >= pointVal && pointVal < 4) {
                roomData.points++
                cmd = Config.punishvals[roomData.points] || cmd
            } else { // if the action hasn't been done before (is worth more points) it will be the one picked
                cmd = Config.punishvals[pointVal] || cmd
                roomData.points = pointVal; // next action will be one level higher than this one (in most cases)
            }
            // if the bot has % and not @, it will default to hourmuting as its highest level of punishment instead of roombanning
            if (roomData.points >= 4 && !self.hasRank(roomid, '@')) cmd = 'hourmute'
            if (userData.zeroTol > 4) { // if zero tolerance users break a rule they get an instant roomban or hourmute
                muteMessage = ', Automated response: zero tolerance user'
                cmd = self.hasRank(roomid, '@') ? 'roomban' : 'hourmute'
            }
            if (roomData.points > 1) userData.zeroTol++; // getting muted or higher increases your zero tolerance level (warns do not)
            roomData.lastAction = now
            say(getRoom(roomid), '/' + cmd + ' ' + userid + muteMessage)
        }
    }
}
function cleanChatData() {
    for (let user in chatData) {
        for (let room in chatData[user]) {
            let roomData = chatData[user][room]
            if (!roomData) continue

            if (!roomData.times || !roomData.times.length) {
                delete chatData[user][room]
                continue
            }
            let newTimes: number[] = []
            let now = Date.now()
            let times = roomData.times
            for (let time of times) {
                if (now - time < 5 * 1000) newTimes.push(time)
            }
            newTimes.sort(function (a, b) {
                return a - b
            })
            roomData.times = newTimes
            if (roomData.points > 0 && roomData.points < 4) roomData.points--
        }
    }
}

function updateSeen(user: string, type: string, detail: string) {
    if (type !== 'n' && Config.rooms.indexOf(detail) < 0 || Config.privaterooms.indexOf(detail) > -1) return
    var now = Date.now()
    if (!chatData[user]) chatData[user] = {
        zeroTol: 0,
        lastSeen: '',
        seenAt: now
    }
    if (!detail) return
    var userData = chatData[user]
    var msg = ''
    switch (type) {
    case 'j':
    case 'J':
        msg += 'joining '
        break
    case 'l':
    case 'L':
        msg += 'leaving '
        break
    case 'c':
    case 'c:':
        msg += 'chatting in '
        break
    case 'N':
        msg += 'changing nick to '
        if (detail.charAt(0) !== ' ') detail = detail.substr(1)
        break
    }
    msg += detail.trim() + '.'
    userData.lastSeen = msg
    userData.seenAt = now
}
export function getTimeAgo(time: number) {
    time = ~~((Date.now() - time) / 1000)

    var seconds = time % 60
    var times: string[] = []
    if (seconds) times.push(seconds + (seconds === 1 ? ' second': ' seconds'))
    if (time >= 60) {
        time = ~~((time - seconds) / 60)
        let minutes = time % 60
        if (minutes) times.unshift(minutes + (minutes === 1 ? ' minute' : ' minutes'))
        if (time >= 60) {
            time = ~~((time - minutes) / 60)
            let hours = time % 24
            if (hours) times.unshift(hours + (hours === 1 ? ' hour' : ' hours'))
            if (time >= 24) {
                let days = ~~((time - hours) / 24)
                if (days) times.unshift(days + (days === 1 ? ' day' : ' days'))
            }
        }
    }
    if (!times.length) return '0 seconds'
    return times.join(', ')
}

// Writing settings
var writing = false
var writePending = false; // whether or not a new write is pending
function finishWriting() {
    writing = false
    if (writePending) {
        writePending = false
        writeSettings()
    }
}
export function writeSettings() {
    if (writing) {
        writePending = true
        return
    }
    writing = true
    var data = JSON.stringify(settings)
    writeFile('settings.json.0', data, function () {
        // rename is atomic on POSIX, but will throw an error on Windows
        rename('settings.json.0', 'settings.json', function (err) {
            if (err) {
                // This should only happen on Windows.
                writeFile('settings.json', data, finishWriting)
                return
            }
            finishWriting()
        })
    })
}
function unrecognizedCommand(message: string, user: User) {
    if (user.id === self.id) return
    var failureMessage: string
    var scavengers = getRoom('scavengers')
    if (scavengers && scavengers.users.has(user.id) && /\b(?:starthunt|[hp]astebin)\b/i.test(message)) {
        failureMessage = "Thank you for submitting a hunt, but I'm just a bot. Please PM some other staff member to start your hunt."
    } else {
        failureMessage = "Hi, " + user.name + "! I'm just a bot, for assistance, please ask another staff member."
        if (Config.botguide) {
            failureMessage += " Command list: " + Config.botguide
        }
    }
    user.say(failureMessage)
}
