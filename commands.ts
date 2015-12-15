/**
 * This is the file where the bot commands are located
 *
 * @license MIT license
 */

/// <reference path="typings/node.d.ts" />

import {Config} from './main'
import {Room, getRoom} from './rooms'
import {User, self, getUser} from './users'
import {isEmpty, toId} from './utils'
import {
    chatData, settings, writeSettings, blacklistUser,
    unblacklistUser, uploadToHastebin, getTimeAgo
} from './parser'

import {request} from 'http'

// .set constants
const CONFIGURABLE_COMMANDS: {[name: string]: boolean} = {
    autoban: true,
    banword: true,
    say: true,
    joke: true,
    usagestats: true,
    '8ball': true,
    studio: true,
    buzz: true,
}

const CONFIGURABLE_MODERATION_OPTIONS: {[name: string]: boolean} = {
    flooding: true,
    caps: true,
    stretching: true,
    bannedwords: true,
    groupchat: true,
}

const CONFIGURABLE_COMMAND_LEVELS: {[name: string]: boolean|string} = {
    off: false,
    disable: false,
    'false': false,
    on: true,
    enable: true,
    'true': true
}

for (const i in Config.groups) {
    if (i !== ' ') CONFIGURABLE_COMMAND_LEVELS[i] = i
}

function stripCommands(text: string) {
    text = text.trim()
    if (text.charAt(0) === '/') return '/' + text
    if (text.charAt(0) === '!' || /^>>>? /.test(text)) return ' ' + text
    return text
}

const commands: {
    [name: string]: string
    | ((arg: string, user: User, room: Room|User) => boolean)
    | ((arg: string, user: User, room: Room|User) => void)
} = {
    /**
     * Help commands
     *
     * These commands are here to provide information about the bot.
     */

    credits: 'about',
    about(arg, user, room) {
        const target = user.hasRank(room.id, '#') ? room : user
        const text = '**Pokémon Showdown Bot** by: Quinella, TalkTakesTime, and Morfent'
        target.say(text)
    },
    git(arg, user, room) {
        const target = user.isExcepted() ? room : user
        const text = '**Pokemon Showdown Bot** source code: ' + Config.fork
        target.say(text)
    },
    help: 'guide',
    guide(arg, user, room) {
        const target = user.hasRank(room.id, '#') ? room : user
        let text: string
        if (Config.botguide) {
            text = 'A guide on how to use this bot can be found here: ' + Config.botguide
        } else {
            text = 'There is no guide for this bot. PM the owner with any questions.'
        }
        target.say(text)
    },

    /**
     * Dev commands
     *
     * These commands are here for highly ranked users (or the creator) to use
     * to perform arbitrary actions that can't be done through any other commands
     * or to help with upkeep of the bot.
     */

    custom(arg, user, room) {
        if (!user.isExcepted()) return false
        // Custom commands can be executed in an arbitrary room using the syntax
        // ".custom [room] command", e.g., to do !data pikachu in the room lobby,
        // the command would be ".custom [lobby] !data pikachu". However, using
        // "[" and "]" in the custom command to be executed can mess this up, so
        // be careful with them.
        if (arg.indexOf('[') !== 0 || arg.indexOf(']') < 0) {
            return room.say(arg)
        }
        const tarRoomid = arg.slice(1, arg.indexOf(']'))
        const tarRoom = getRoom(tarRoomid)
        if (!tarRoom) return room.say(self.name + ' is not in room ' + tarRoomid + '!')
        arg = arg.substr(arg.indexOf(']') + 1).trim()
        tarRoom.say(arg)
    },
    js(arg, user, room) {
        if (!user.isExcepted()) return false
        try {
            const result = eval(arg.trim())
            room.say(JSON.stringify(result))
        } catch (e) {
            room.say(e.name + ": " + e.message)
        }
    },
    uptime(arg, user, room) {
        let text = ((room === user || user.isExcepted()) ? '' : '/pm ' + user.id + ', ') + '**Uptime:** '
        const divisors = [52, 7, 24, 60, 60]
        const units = ['week', 'day', 'hour', 'minute', 'second']
        const buffer: string[] = []
        let uptime = ~~(process.uptime())
        do {
            const divisor = divisors.pop()
            const unit = uptime % divisor
            buffer.push(unit > 1 ? unit + ' ' + units.pop() + 's' : unit + ' ' + units.pop())
            uptime = ~~(uptime / divisor)
        } while (uptime)

        switch (buffer.length) {
        case 5:
            text += buffer[4] + ', '
            /* falls through */
        case 4:
            text += buffer[3] + ', '
            /* falls through */
        case 3:
            text += buffer[2] + ', ' + buffer[1] + ', and ' + buffer[0]
            break
        case 2:
            text += buffer[1] + ' and ' + buffer[0]
            break
        case 1:
            text += buffer[0]
            break
        }

        room.say(text)
    },


    /**
     * Room Owner commands
     *
     * These commands allow room owners to personalise settings for moderation and command use.
     */

    settings: 'set',
    set(arg, user, room) {
        if (room === user || !user.hasRank(room.id, '#')) return false

        const opts = arg.split(',')
        let cmd = toId(opts[0])
        const roomid = room.id
        if (cmd === 'm' || cmd === 'mod' || cmd === 'modding') {
            let modOpt: string
            if (!opts[1] || !CONFIGURABLE_MODERATION_OPTIONS[(modOpt = toId(opts[1]))]) {
                return room.say('Incorrect command: correct syntax is ' + Config.commandcharacter + 'set mod, [' +
                    Object.keys(CONFIGURABLE_MODERATION_OPTIONS).join('/') + '](, [on/off])')
            }
            if (!opts[2]) return room.say('Moderation for ' + modOpt + ' in this room is currently ' +
                (settings.modding && settings.modding[roomid] && modOpt in settings.modding[roomid] ? 'OFF' : 'ON') + '.')

            if (!settings.modding) settings.modding = {}
            if (!settings.modding[roomid]) settings.modding[roomid] = {}

            const setting = toId(opts[2])
            if (setting === 'on') {
                delete settings.modding[roomid][modOpt]
                if (isEmpty(settings.modding[roomid])) delete settings.modding[roomid]
                if (isEmpty(settings.modding)) delete settings.modding
            } else if (setting === 'off') {
                settings.modding[roomid][modOpt] = 0
            } else {
                return room.say('Incorrect command: correct syntax is ' + Config.commandcharacter + 'set mod, [' +
                    Object.keys(CONFIGURABLE_MODERATION_OPTIONS).join('/') + '](, [on/off])')
            }

            writeSettings()
            return room.say('Moderation for ' + modOpt + ' in this room is now ' + setting.toUpperCase() + '.')
        }

        if (!(cmd in commands)) return room.say(Config.commandcharacter + '' + opts[0] + ' is not a valid command.')

        let failsafe = 0
        while (true) {
            const newCommand = commands[cmd]
            if (typeof newCommand === 'string') {
                cmd = newCommand
            } else if (typeof newCommand === 'function') {
                if (cmd in CONFIGURABLE_COMMANDS) break
                return room.say('The settings for ' + Config.commandcharacter + '' + opts[0] + ' cannot be changed.')
            } else {
                return room.say('Something went wrong. PM Morfent or TalkTakesTime here or on Smogon with the command you tried.')
            }

            if (++failsafe > 5) return room.say('The command "' + Config.commandcharacter + '' + opts[0] + '" could not be found.')
        }

        if (!opts[1]) {
            let msg = '' + Config.commandcharacter + '' + cmd + ' is '
            if (!settings[cmd] || (!(roomid in settings[cmd]))) {
                msg += 'available for users of rank ' + ((cmd === 'autoban' || cmd === 'banword') ? '#' : Config.defaultrank) + ' and above.'
            } else if (<string> settings[cmd][roomid] in CONFIGURABLE_COMMAND_LEVELS) {
                msg += 'available for users of rank ' + settings[cmd][roomid] + ' and above.'
            } else {
                msg += settings[cmd][roomid] ? 'available for all users in this room.' : 'not available for use in this room.'
            }

            return room.say(msg)
        }

        const setting = opts[1].trim()
        if (!(setting in CONFIGURABLE_COMMAND_LEVELS)) return room.say('Unknown option: "' + setting + '". Valid settings are: off/disable/false, +, %, @, #, &, ~, on/enable/true.')
        if (!settings[cmd]) settings[cmd] = {}
        settings[cmd][roomid] = CONFIGURABLE_COMMAND_LEVELS[setting]

        writeSettings()
        room.say('The command ' + Config.commandcharacter + '' + cmd + ' is now ' +
            (CONFIGURABLE_COMMAND_LEVELS[setting] === setting ? ' available for users of rank ' + setting + ' and above.' :
            (settings[cmd][roomid] ? 'available for all users in this room.' : 'unavailable for use in this room.')))
    },
    blacklist: 'autoban',
    ban: 'autoban',
    ab: 'autoban',
    autoban(arg, user, room) {
        if (room === user || !user.canUse('autoban', room.id)) return false
        if (!self.hasRank(room.id, '@')) return room.say(self.name + ' requires rank of @ or higher to (un)blacklist.')
        if (!toId(arg)) return room.say('You must specify at least one user to blacklist.')

        const args = arg.split(',')
        const added: string[] = []
        const illegalNick: string[] = []
        const alreadyAdded: string[] = []
        const roomid = room.id
        for (let u of args) {
            const tarUser = toId(u)
            if (!tarUser || tarUser.length > 18) {
                illegalNick.push(tarUser)
            } else if (!blacklistUser(tarUser, roomid)) {
                alreadyAdded.push(tarUser)
            } else {
                added.push(tarUser)
                room.say('/roomban ' + tarUser + ', Blacklisted user')
            }
        }

        let text = ''
        if (added.length) {
            text += 'User' + (added.length > 1 ? 's "' + added.join('", "') + '" were' : ' "' + added[0] + '" was') + ' added to the blacklist.'
            room.say('/modnote ' + text + ' by ' + user.name + '.')
            writeSettings()
        }
        if (alreadyAdded.length) {
            text += ' User' + (alreadyAdded.length > 1 ? 's "' + alreadyAdded.join('", "') + '" are' : ' "' + alreadyAdded[0] + '" is') + ' already present in the blacklist.'
        }
        if (illegalNick.length) text += (text ? ' All other' : 'All') + ' users had illegal nicks and were not blacklisted.'
        room.say(text)
    },
    unblacklist: 'unautoban',
    unban: 'unautoban',
    unab: 'unautoban',
    unautoban(arg, user, room) {
        if (room === user || !user.canUse('autoban', room.id)) return false
        if (!self.hasRank(room.id, '@')) return room.say(self.name + ' requires rank of @ or higher to (un)blacklist.')
        if (!toId(arg)) return room.say('You must specify at least one user to unblacklist.')

        const args = arg.split(',')
        const removed: string[] = []
        const notRemoved: string[] = []
        const roomid = room.id
        for (let u of args) {
            const tarUser = toId(u)
            if (!tarUser || tarUser.length > 18) {
                notRemoved.push(tarUser)
            } else if (!unblacklistUser(tarUser, roomid)) {
                notRemoved.push(tarUser)
            } else {
                removed.push(tarUser)
                room.say('/roomunban ' + tarUser)
            }
        }

        let text = ''
        if (removed.length) {
            text += ' User' + (removed.length > 1 ? 's "' + removed.join('", "') + '" were' : ' "' + removed[0] + '" was') + ' removed from the blacklist'
            room.say('/modnote ' + text + ' by user ' + user.name + '.')
            writeSettings()
        }
        if (notRemoved.length) text += (text.length ? ' No other' : 'No') + ' specified users were present in the blacklist.'
        room.say(text)
    },
    rab: 'regexautoban',
    regexautoban(arg, user, room) {
        if (room === user || !user.isRegexWhitelisted() || !user.canUse('autoban', room.id)) return false
        if (!self.hasRank(room.id, '@')) return room.say(self.name + ' requires rank of @ or higher to (un)blacklist.')
        if (!arg) return room.say('You must specify a regular expression to (un)blacklist.')

        let regularExpression: RegExp
        try {
            regularExpression = new RegExp(arg, 'i')
        } catch (e) {
            return room.say(e.message)
        }

        // Detect regular expressions that match too much. Slayer95 was added,
        // as his nick has digits, and is unlikely to ever become malicious.
        if (regularExpression.test('xfix') || regularExpression.test('slayer95') || regularExpression.test(user.id)) {
            return room.say('Regular expression /' + arg + '/i cannot be added to the blacklist as it\'s not specific enough.')
        }

        const regex = '/' + arg + '/i'
        if (!blacklistUser(regex, room.id)) return room.say('/' + regex + ' is already present in the blacklist.')

        const regexObj = new RegExp(arg, 'i')
        // Deal with TypeScript limitations by completely ignoring strict typing.
        const users: string[] = (<any> Array).from((<any> room).users.entries())
        const groups = Config.groups
        const selfid = self.id
        const selfidx = groups[(<Room> room).users.get(selfid)]
        for (let u of users) {
            const userid = u[0]
            if (userid !== selfid && regexObj.test(userid) && groups[u[1]] < selfidx) {
                room.say('/roomban ' + userid + ', Blacklisted user')
            }
        }

        writeSettings()
        room.say('/modnote Regular expression ' + regex + ' was added to the blacklist by user ' + user.name + '.')
        room.say('Regular expression ' + regex + ' was added to the blacklist.')
    },
    unrab: 'unregexautoban',
    unregexautoban(arg, user, room) {
        if (room === user || !user.isRegexWhitelisted() || !user.canUse('autoban', room.id)) return false
        if (!self.hasRank(room.id, '@')) return room.say(self.name + ' requires rank of @ or higher to (un)blacklist.')
        if (!arg) return room.say('You must specify a regular expression to (un)blacklist.')

        arg = '/' + arg.replace(/\\\\/g, '\\') + '/i'
        if (!unblacklistUser(arg, room.id)) return room.say('/' + arg + ' is not present in the blacklist.')

        writeSettings()
        room.say('/modnote Regular expression ' + arg + ' was removed from the blacklist user by ' + user.name + '.')
        room.say('Regular expression ' + arg + ' was removed from the blacklist.')
    },
    viewbans: 'viewblacklist',
    vab: 'viewblacklist',
    viewautobans: 'viewblacklist',
    viewblacklist(arg, user, room) {
        if (room === user || !user.canUse('autoban', room.id)) return false

        let text = '/pm ' + user.id + ', '
        if (!settings.blacklist) return room.say(text + 'No users are blacklisted in this room.')

        const roomid = room.id
        const blacklist = settings.blacklist[roomid]
        if (!blacklist) return room.say(text + 'No users are blacklisted in this room.')

        if (!arg.length) {
            const userlist = Object.keys(blacklist)
            if (!userlist.length) return room.say(text + 'No users are blacklisted in this room.')
            return uploadToHastebin('The following users are banned from ' + roomid + ':\n\n' + userlist.join('\n'), link => {
                if (/^Error/.test(link)) return room.say(text + link)
                room.say(text + 'Blacklist for room ' + roomid + ': ' + link)
            })
        }

        const nick = toId(arg)
        if (!nick || nick.length > 18) {
            text += 'Invalid username: "' + nick + '".'
        } else {
            text += `User ${nick} is currently ${blacklist[nick] ? '' : 'not '} blacklisted in ${roomid}.`
        }
        room.say(text)
    },
    banphrase: 'banword',
    banword(arg, user, room) {
        arg = arg.trim().toLowerCase()
        if (!arg) return false

        let tarRoom = room.id
        if (room === user) {
            if (!user.isExcepted()) return false
            tarRoom = 'global'
        } else if (user.canUse('banword', room.id)) {
            tarRoom = room.id
        } else {
            return false
        }

        let bannedPhrases = settings.bannedphrases ? settings.bannedphrases[tarRoom] : null
        if (!bannedPhrases) {
            if (bannedPhrases === null) settings.bannedphrases = {}
            bannedPhrases = (settings.bannedphrases[tarRoom] = {})
        } else if (bannedPhrases[arg]) {
            return room.say('Phrase "' + arg + '" is already banned.')
        }
        bannedPhrases[arg] = 1

        writeSettings()
        room.say('Phrase "' + arg + '" is now banned.')
    },
    unbanphrase: 'unbanword',
    unbanword(arg, user, room) {
        let tarRoom: string
        if (room === user) {
            if (!user.isExcepted()) return false
            tarRoom = 'global'
        } else if (user.canUse('banword', room.id)) {
            tarRoom = room.id
        } else {
            return false
        }

        arg = arg.trim().toLowerCase()
        if (!arg) return false
        if (!settings.bannedphrases) return room.say('Phrase "' + arg + '" is not currently banned.')

        const bannedPhrases = settings.bannedphrases[tarRoom]
        if (!bannedPhrases || !bannedPhrases[arg]) return room.say('Phrase "' + arg + '" is not currently banned.')

        delete bannedPhrases[arg]
        if (isEmpty(bannedPhrases)) {
            delete settings.bannedphrases[tarRoom]
            if (isEmpty(settings.bannedphrases)) delete settings.bannedphrases
        }

        writeSettings()
        room.say('Phrase "' + arg + '" is no longer banned.')
    },
    viewbannedphrases: 'viewbannedwords',
    vbw: 'viewbannedwords',
    viewbannedwords(arg, user, room) {
        let tarRoom = room.id
        let text = ''
        let bannedFrom = ''
        if (room === user) {
            if (!user.isExcepted()) return false
            tarRoom = 'global'
            bannedFrom += 'globally'
        } else if (user.canUse('banword', room.id)) {
            text += '/pm ' + user.id + ', '
            bannedFrom += 'in ' + room.id
        } else {
            return false
        }

        if (!settings.bannedphrases) return room.say(text + 'No phrases are banned in this room.')
        const bannedPhrases = settings.bannedphrases[tarRoom]
        if (!bannedPhrases) return room.say(text + 'No phrases are banned in this room.')

        if (arg.length) {
            text += 'The phrase "' + arg + '" is currently ' + (bannedPhrases[arg] || 'not ') + 'banned ' + bannedFrom + '.'
            return room.say(text)
        }

        const banList = Object.keys(bannedPhrases)
        if (!banList.length) return room.say(text + 'No phrases are banned in this room.')

        uploadToHastebin('The following phrases are banned ' + bannedFrom + ':\n\n' + banList.join('\n'), link => {
            if (/^Error/.test(link)) return room.say(link)
            room.say(text + 'Banned phrases ' + bannedFrom + ': ' + link)
        })
    },

    /**
     * General commands
     *
     * Add custom commands here.
     */

    tell: 'say',
    say(arg, user, room) {
        if (room === user || !user.canUse('say', room.id)) return false
        room.say(stripCommands(arg) + ' (' + user.name + ' said this)')
    },
    joke(arg, user, room) {
        if (room === user || !user.canUse('joke', room.id)) return false

        const reqOpt = {
            hostname: 'api.icndb.com',
            path: '/jokes/random',
            method: 'GET'
        }
        const req = request(reqOpt, res => {
            res.on('data', (chunk: string) => {
                try {
                    const data = JSON.parse(chunk)
                    room.say(data.value.joke.replace(/&quot;/g, "\""))
                } catch (e) {
                    room.say('Sorry, couldn\'t fetch a random joke... :(')
                }
            })
        })
        req.end()
    },
    usage: 'usagestats',
    usagestats(arg, user, room) {
        if (arg) return false
        let text = (room === user || user.canUse('usagestats', room.id)) ? '' : '/pm ' + user.id + ', '
        text += 'http://www.smogon.com/stats/2015-10/'
        room.say(text)
    },
    seen(arg, user, room) { // this command is still a bit buggy
        let text = (room === user ? '' : '/pm ' + user.id + ', ')
        arg = toId(arg)
        if (!arg || arg.length > 18) return room.say(text + 'Invalid username.')
        if (arg === user.id) {
            text += 'Have you looked in the mirror lately?'
        } else if (arg === self.id) {
            text += 'You might be either blind or illiterate. Might want to get that checked out.'
        } else if (!chatData[arg] || !chatData[arg].seenAt) {
            text += 'The user ' + arg + ' has never been seen.'
        } else {
            text += arg + ' was last seen ' + getTimeAgo(chatData[arg].seenAt) + ' ago' + (
                chatData[arg].lastSeen ? ', ' + chatData[arg].lastSeen : '.')
        }
        room.say(text)
    },
    '8ball': function (arg, user, room) {
        if (room === user) return false
        let text = user.canUse('8ball', room.id) ? '' : '/pm ' + user.id + ', '
        const rand = ~~(20 * Math.random())

        switch (rand) {
             case 0:
                text += "Signs point to yes."
                break
              case 1:
                text += "Yes."
                break
            case 2:
                text += "Reply hazy, try again."
                break
            case 3:
                text += "Without a doubt."
                break
            case 4:
                text += "My sources say no."
                break
            case 5:
                text += "As I see it, yes."
                break
            case 6:
                text += "You may rely on it."
                break
            case 7:
                text += "Concentrate and ask again."
                break
            case 8:
                text += "Outlook not so good."
                break
            case 9:
                text += "It is decidedly so."
                break
            case 10:
                text += "Better not tell you now."
                break
            case 11:
                text += "Very doubtful."
                break
            case 12:
                text += "Yes - definitely."
                break
            case 13:
                text += "It is certain."
                break;
            case 14:
                text += "Cannot predict now."
                break
            case 15:
                text += "Most likely."
                break
            case 16:
                text += "Ask again later."
                break
            case 17:
                text += "My reply is no."
                break
            case 18:
                text += "Outlook good."
                break
            case 19:
                text += "Don't count on it."
                break
        }

        room.say(text)
    },

    /**
     * The Studio commands
     *
     * The following command is the command for the weekly Saturday-night
     * rap battle in The Studio.
     */

    mic(arg, user, room) {
        if (!arg || user === room || room.id !== 'thestudio' || !user.hasRank(room.id, '%')) {
            return false
        }

        const args = arg.split(',')
        if (args.length !== 2) return room.say('Not enough rappers were provided. Syntax: .mic [rapper1], [rapper2]')

        const rapper1 = getUser(toId(args[0]))
        if (!rapper1) return room.say('User ' + args[0].trim() + ' does not exist.')
        const rapper2 = getUser(toId(args[1]))
        if (!rapper2) return room.say('User ' + args[1].trim() + ' does not exist.')

        const now = new Date
        const date = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() - 4, now.getUTCMinutes(), now.getUTCSeconds())
        if (date.getDay() !== 6) return room.say('Rap battles take place weekly on Saturday night, at 9pm EST (GMT-4).')

        const hours = date.getHours()
        if (hours !== 21) {
            if (hours > 22 && date.getMinutes() > 30) {
                return room.say('Rap battles have already taken place.')
            }
            return room.say('Rap battles will not take place until 9pm EST (GMT-4).')
        }

        const willVoiceR1 = ((<Room> room).users.get(rapper1.id) === ' ')
        const willVoiceR2 = ((<Room> room).users.get(rapper2.id) === ' ')

        if (willVoiceR1) room.say('/roomvoice ' + rapper1.id)
        if (willVoiceR2) room.say('/roomvoice ' + rapper2.id)
        room.say('/modchat +')

        setTimeout(() => {
            if (willVoiceR1) room.say('/roomdeauth ' + rapper1.id)
            setTimeout(() => {
                if (willVoiceR2) room.say('/roomdeauth ' + rapper2.id)
                room.say('/modchat false')
            }, 3 * 60 * 1000)
        }, 3 * 60 * 1000)
    },
    calc: 'damagecalc',
    damagecalc(arg, user, room) {
        if (room === user || !user.canUse('damagecalc', room.id)) return false
        let text: string
        if (arg) {
            text = 'Damage calculator to be implemented. Until then, refer to https://pokemonshowdown.com/damagecalc/'
        } else {
            text = 'https://pokemonshowdown.com/damagecalc/'
        }
        room.say(text)
    },

    /**
    * Jeopardy commands
    *
    * The following commands are used for Jeopardy in the Academics room
    * on the Smogon server.
    */


    b: 'buzz',
    buzz(arg: string, user: User, room: Room) {
        if (!(room instanceof Room) || room.buzzer || !user.canUse('buzz', room.id)) return false

        room.say('**' + user.name + ' has buzzed in!**')
        room.buzzer = setTimeout(() => {
            room.say(`${user.name}, your time to answer is up!`)
            room.buzzer = null
        }, 7 * 1000)
    },
    reset(arg: string, user: User, room: Room) {
        if (!(room instanceof Room) || !room.buzzer || !user.hasRank(room.id, '%')) return false
        clearTimeout(room.buzzer)
        room.buzzer = null
        room.say('The buzzer has been reset.')
    },
}
export default commands
