'use strict';

const express = require('express');
const https = require('https');
const dotenv = require('dotenv');
const fs = require('fs');
const bodyParser = require('body-parser');
const moment = require('moment');
const findIndex = require('lodash.findindex');
const { createEventAdapter } = require('@slack/events-api');
const { WebClient } = require('@slack/web-api');

dotenv.config();

// Config ================================================================================|
const app = express();
const port = process.env.PORT || 3000;

const slackToken = process.env.SLACK_OAUTH_TOKEN;
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

// Event middlewear ======================================================================|
const webClient = new WebClient(slackToken);
const slackEvents = createEventAdapter(slackSigningSecret);

app.use('/slack/events', slackEvents.expressMiddleware());

// Body-parser middlewear ===============================================================|
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

// Regex ================================================================================|
const userIdRegex = /<@([A-Za-z0-9]+)>/;

// Data fetching ========================================================================|
async function getJsonObjectFromURL(url) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        try {
            https.get(url, res => {
                console.log('statusCode:', res.statusCode);
                res.setEncoding('utf8')
                .on('data', (chunk) => {
                    chunks.push(chunk);
                })
                .on('end', () => {
                    resolve(JSON.parse(chunks.join('')));
                });
            }).on('error', e => reject(e));
        } catch (err) {
            reject(err);
        }
    });
};

const getUserName = async (userId) => {
    const endpoint = `https://slack.com/api/users.info?token=${slackToken}&user=${userId}&pretty=1`;

    return await getJsonObjectFromURL(endpoint)
    .then(data => {
        return data.user.profile.real_name;
    })
    .catch(err => console.error(err));
};

// File system =====================================================================|
const readFile = (targetFile) => {
    const rawData = fs.readFileSync(targetFile);
    return JSON.parse(rawData);
};

const writeFile = (data, outputFile) => {
    const stringifiedData = JSON.stringify(data);
    fs.writeFileSync(outputFile, stringifiedData);
};

// Actions ===========================================================================|
const checkForTarget = (target, targetEnum, inputParts) => {
    return inputParts.includes(target) && !Object.keys(targetEnum).filter(e => e !== target).some(e => inputParts.includes(e));
};

const availableActions = Object.freeze({
    help: 'help',
    list: 'list',
    start: 'start',
    pause: 'pause',
    recall: 'recall',
    add: 'add',
    remove: 'remove',
    skip: 'skip',
    back: 'back',
});

const deriveAction = (input) => {
    const inputParts = input.split(' ');

    // Check for target actions
    if (checkForTarget('help', availableActions, inputParts)) { return availableActions.help; }
    else if (checkForTarget('list', availableActions, inputParts)) { return availableActions.list; }
    else if (checkForTarget('start', availableActions, inputParts)) { return availableActions.start; }
    else if (checkForTarget('pause', availableActions, inputParts)) { return availableActions.pause; }
    else if (checkForTarget('recall', availableActions, inputParts)) { return availableActions.recall; }
    else if (checkForTarget('add', availableActions, inputParts)) { return availableActions.add; }
    else if (checkForTarget('remove', availableActions, inputParts)) { return availableActions.remove; }
    else if (checkForTarget('skip', availableActions, inputParts)) { return availableActions.skip; }
    else if (checkForTarget('back', availableActions, inputParts)) { return availableActions.back; }
    else { return undefined; }
};

const availableTeams = Object.freeze({
    all: 'all',
    cr: 'cr',
    rum: 'rum',
    apm: 'apm',
    ss: 'ss',
});

const deriveTeam = (input) => {
    const inputParts = input.split(' ');

    // Check for target teams
    if (checkForTarget('all', availableTeams, inputParts)) { return availableTeams.all; }
    else if (checkForTarget('cr', availableTeams, inputParts)) { return availableTeams.cr; }
    else if (checkForTarget('rum', availableTeams, inputParts)) { return availableTeams.rum; }
    else if (checkForTarget('apm', availableTeams, inputParts)) { return availableTeams.apm; }
    else if (checkForTarget('ss', availableTeams, inputParts)) { return availableTeams.ss; }
    else { return null; }
};

const checkUserInTeam = (userId, teamMembers) => {
    return teamMembers.some(member => member.includes(userId));
};

let announcementTimeoutId, announcementIntervalId;

const startAnnouncements = (channel) => {
    const nextMonday = moment().day("Monday").hour(9).minute(0).second(0);
    const offsetMsUntilMonday = nextMonday.diff(moment());
    const offsetDuration = moment.duration(offsetMsUntilMonday);
    const sevenDaysMs = (1000*60*60*24*7);

    sendMessage(`I've started! Next assignment in ${offsetDuration.days()} days, ${offsetDuration.hours()} hours & ${offsetDuration.minutes()} minutes`, channel);
    announcementTimeoutId = setTimeout(() => {
        announceAssignees(channel);
        announcementIntervalId = setInterval(() => announceAssignees(channel), sevenDaysMs);
    }, offsetMsUntilMonday);
};

const pauseAnnouncements = (channel) => {
    clearTimeout(announcementTimeoutId);
    clearInterval(announcementIntervalId);
    sendMessage(`I've paused! Type \`@SupportRoster start\` to resume`, channel);
};

const addUserToTeam = async (userId, team, channel) => {
    let rosterData = readFile('./roster.json');
    const userName = await getUserName(userId);

    if (checkUserInTeam(userId, rosterData[team].members)) {
        sendMessage(`${userName} is already apart of the ${team.toUpperCase()} team!`, channel);
    } else {
        rosterData[team].members.push([userName, userId]);
        sendMessage(`I've just added ${userName} to the CR roster!`, channel);
        writeFile(rosterData, './roster.json');
    }
};

const addToTeam = (userId, team, channel) => {
    if (Object.keys(availableTeams).some(t => t ===team) && team !== availableTeams.all) {
        addUserToTeam(userId, team, channel);
    }
    else {
        sendMessage(`${team.toUpperCase()} is not a valid team, please try again.`, channel);
    }
};

const removeUserForTeam = async (userId, team, channel) => {
    let rosterData = readFile('./roster.json');
    const userName = await getUserName(userId);

    if (checkUserInTeam(userId, rosterData[team].members)) {
        if (findIndex(rosterData[team].members, user => user[1] === userId) === (rosterData[team].members.length - 1)) {
            rosterData[team].currentTick = 0;
            sendMessage(`I've just updated the tick index to ${rosterData[team].currentTick}`, channel);
        }

        rosterData[team].members = rosterData[team].members.filter(member => !member.includes(userId));
        sendMessage(`I've just removed ${userName} from the ${team.toUpperCase()} roster!`, channel);

        writeFile(rosterData, './roster.json');
    } else {
        sendMessage(`${userName} wasn't found in the ${team.toUpperCase()} team!`, channel);
    }
};

const removeFromTeam = (userId, team, channel) => {
    if (Object.keys(availableTeams).some(t => t ===team) && team !== availableTeams.all) {
        removeUserForTeam(userId, team, channel);
    }
    else {
        sendMessage(`${team.toUpperCase()} is not a valid team, please try again.`, channel);
    }
};

const availableDirections = Object.freeze({
    forward: 'forward',
    back: 'back',
});

const updateTeamTick = (direction, team, channel) => {
    let rosterData = readFile('./roster.json');

    if (Object.keys(availableTeams).some(t => t === team) && team !== availableTeams.all) {
        if (direction === availableDirections.forward) {
            if (rosterData[team].currentTick < (rosterData[team].members.length - 1)) { rosterData[team].currentTick++; }
            else { rosterData[team].currentTick = 0; }
            if (channel !== null) {
                sendMessage(`I've just moved the ${team.toUpperCase()} roster queue forward one!`, channel);
            }
            writeFile(rosterData, './roster.json');
        } else if (direction === availableDirections.back) {
            if (rosterData[team].currentTick > 0) { rosterData[team].currentTick--; }
            else { rosterData[team].currentTick = (rosterData[team].members.length - 1); }
            if (channel !== null) {
                sendMessage(`I've just moved the ${team.toUpperCase()} roster queue back one!`, channel);
            }
            writeFile(rosterData, './roster.json');
        } else {
            if (channel !== null) {
                unknownMessage(channel);
            }
        }
    } else {
        if (channel !== null) {
            sendMessage(`${team.toUpperCase()} is not a valid team, please try again.`, channel);
        }
    }
};

// Messages =========================================================================|
const sendMessage = async (messageText, channel) => {
    const res = await webClient.chat.postMessage({
        text: messageText,
        channel: channel,
    });
    console.log('Message sent: ', res.ts);
};

const unknownMessage = (channel) => {
    sendMessage(
`Sorry, I didn't understand that command. \n
Type \`@SupportRoster help\` to learn more.`,
        channel
    );
};

const helpMessage = (channel) => {
    sendMessage(
`Here's a list of my available commands: \n
\`@SupportRoster list [all|cr|rum|apm|ss]\` - Lists the roster for a team \n
\`@SupportRoster start\` - Starts the weekly announcements (called every Monday @ 9am NZT) \n
\`@SupportRoster pause\` - Pause the weekly announcements (current state will be remembered) \n
\`@SupportRoster recall\` - Recall the current week's intercom assignees \n
\`@SupportRoster add [@user] [cr|rum|apm|ss]\` - Adds a user to a team roster \n
\`@SupportRoster remove [@user] [cr|rum|apm|ss]\` - Removes a user from a team roster \n
\`@SupportRoster skip [cr|rum|apm|ss]\` - Moves forward one in the queue for a team \n
\`@SupportRoster back [cr|rum|apm|ss]\` - Moves back one in the queue for a team`,
        channel
    );
};

const listRosterMessage = (team, channel) => {
    let rosterData = readFile('./roster.json');
    let message = '';

    if (team === availableTeams.all) {
        const { 
            cr: {
                currentTick: crTick,
                members: crMembers,
            },
            rum: {
                currentTick: rumTick,
                members: rumMembers,
            },
            apm: {
                currentTick: apmTick,
                members: apmMembers,
            },
            ss: {
                currentTick: ssTick,
                members: ssMembers,
            },
        } = rosterData;

        message += `*CR roster:* \n`;
        crMembers.map((member, i) => {
            message += crTick !== i ? `- ${member[0]} \n` : `- *${member[0]} - Current* \n`;
        });
        message += `----------------------------------------- \n`;
        message += `*RUM roster:* \n`;
        rumMembers.map((member, i) => {
            message += rumTick !== i ? `- ${member[0]} \n` : `- *${member[0]} - Current* \n`;
        });
        message += `----------------------------------------- \n`;
        message += `*APM roster:* \n`;
        apmMembers.map((member, i) => {
            message += apmTick !== i ? `- ${member[0]} \n` : `- *${member[0]} - Current* \n`;
        });
        message += `----------------------------------------- \n`;
        message += `*SS roster:* \n`;
        ssMembers.map((member, i) => {
            message += ssTick !== i ? `- ${member[0]} \n` : `- *${member[0]} - Current* \n`;
        });
    } else if (team === availableTeams.cr) {
        const { cr: { currentTick, members } } = rosterData;
        message += `*CR roster:* \n`;
        members.map((member, i) => {
            message += currentTick !== i ? `- ${member[0]} \n` : `- *${member[0]} - Current* \n`;
        });
    } else if (team === availableTeams.rum) {
        const { rum: { currentTick, members } } = rosterData;
        message += `*RUM roster:* \n`;
        members.map((member, i) => {
            message += currentTick !== i ? `- ${member[0]} \n` : `- *${member[0]} - Current* \n`;
        });
    } else if (team === availableTeams.apm) {
        const { apm: { currentTick, members } } = rosterData;
        message += `*APM roster:* \n`;
        members.map((member, i) => {
            message += currentTick !== i ? `- ${member[0]} \n` : `- *${member[0]} - Current* \n`;
        });
    } else if (team === availableTeams.ss) {
        const { ss: { currentTick, members } } = rosterData;
        message += `*SS roster:* \n`;
        members.map((member, i) => {
            message += currentTick !== i ? `- ${member[0]} \n` : `- *${member[0]} - Current* \n`;
        });
    }

    if (message !== '') {
        sendMessage(message, channel);
    } else {
        unknownMessage(channel);
    }
};

const announceAssignees = (channel) => {
    let rosterData = readFile('./roster.json');
    let message = `*This week's intercom assignees:* \n`;

    Object.keys(availableTeams).map(team => {
        if (team !== availableTeams.all) {
            const user = rosterData[team].members[rosterData[team].currentTick];
            message += `${team.toUpperCase()} - ${user[0]} - <@${user[1]}> \n`;
            updateTeamTick(availableDirections.forward, team, null);
        }
    });

    sendMessage(message, channel);
};

// Events =========================================================================|
slackEvents.on('app_mention', async (event) => {
    try {
        console.log("I got a mention in this channel: ", event.channel);
        const mentionText = event.text;
        const intendedAction = deriveAction(mentionText);
        const intendedTeam = deriveTeam(mentionText);

        if (intendedAction != undefined) {
            if (intendedAction === availableActions.help) { helpMessage(event.channel); }
            else if (intendedAction === availableActions.list) { listRosterMessage(intendedTeam, event.channel); }
            else if (intendedAction === availableActions.start) { startAnnouncements(event.channel); }
            else if (intendedAction === availableActions.pause) { pauseAnnouncements(event.channel); }
            else if (intendedAction === availableActions.recall) { announceAssignees(event.channel); }
            else if (intendedAction === availableActions.add) {
                if (userIdRegex.test(mentionText.split(' ')[2])) {
                    addToTeam(mentionText.split(' ')[2].match(/<@([A-Za-z0-9]+)>/)[1], intendedTeam, event.channel);
                } else {
                    sendMessage(`Sorry I couldn't match that user, Please try again.`, event.channel);
                }
            }
            else if (intendedAction === availableActions.remove) { 
                if (userIdRegex.test(mentionText.split(' ')[2])) {
                    removeFromTeam(mentionText.split(' ')[2].match(/<@([A-Za-z0-9]+)>/)[1], intendedTeam, event.channel);
                } else {
                    sendMessage(`Sorry I couldn't match that user, Please try again.`, event.channel);
                }
            }
            else if (intendedAction === availableActions.skip) { updateTeamTick(availableDirections.forward, intendedTeam, event.channel); }
            else if (intendedAction === availableActions.back) { updateTeamTick(availableDirections.back, intendedTeam, event.channel); }
            else { unknownMessage(event.channel); }
        } else { unknownMessage(event.channel); }
    } catch (e) {
        console.error(JSON.stringify(e));
        return sendMessage(`:ambulance: He's dead Jim - please check console for errors...`, event.channel);
    }
});

// Start server ===================================================================|
app.listen(port, function () {
    // Callback triggered when server is successfully listening.
    console.log("SupportRoster bot listening on port: " + port);
});